"""DELETE /account: everything of the signed-in user goes, nobody else's.
Firebase is never called for real here (tests have no admin credentials and
the deletion function is replaced)."""
import pytest
from fastapi.testclient import TestClient
from firebase_admin import auth as firebase_auth

import api.main as main
import auth as auth_module
from agents.ingestion import collection
from notepad import notes_collection
from places import places_collection

client = TestClient(main.app)
A, B = "acct-user-a", "acct-user-b"
TOKENS = {"Bearer token-a": A, "Bearer token-b": B}
AS_A = {"Authorization": "Bearer token-a"}
AS_B = {"Authorization": "Bearer token-b"}


@pytest.fixture
def firebase_calls(monkeypatch):
    calls = []
    monkeypatch.setattr(main, "get_user_id", lambda authorization: TOKENS.get(authorization))
    monkeypatch.setattr(main, "delete_firebase_user", lambda uid: calls.append(uid) or "deleted")
    yield calls
    for uid in (A, B):
        ids = [d["_id"] for d in notes_collection.find({"user_id": uid}, {"_id": 1})]
        if ids:
            collection.delete(ids=ids)
        notes_collection.delete_many({"user_id": uid})
        places_collection.delete_many({"user_id": uid})


def _seed(headers):
    ids = [
        client.post("/notes/", json={"content": text}, headers=headers).json()["id"]
        for text in ("buy milk", "dentist appointment at 9", "call mom")
    ]
    client.post(f"/notes/{ids[0]}/feedback", params={"action": "useful"}, headers=headers)
    client.post(f"/notes/{ids[1]}/feedback", params={"action": "later"}, headers=headers)
    client.post("/places/", json={"name": "Gym"}, headers=headers)
    return ids


def _what_remains(uid, note_ids):
    vectors_by_owner = collection.get(where={"user_id": uid})["ids"]
    vectors_by_id = collection.get(ids=note_ids)["ids"]
    return {
        "notes": notes_collection.count_documents({"user_id": uid}),
        "places": places_collection.count_documents({"user_id": uid}),
        "vectors": len(set(vectors_by_owner) | set(vectors_by_id)),
    }


def test_deletes_everything_of_the_user_and_nothing_else(firebase_calls):
    a_ids = _seed(AS_A)
    b_ids = _seed(AS_B)
    before_b = _what_remains(B, b_ids)
    assert _what_remains(A, a_ids)["notes"] == 3 and before_b["notes"] == 3

    res = client.delete("/account", headers=AS_A)

    assert res.status_code == 200
    body = res.json()
    assert body["deleted"]["notes"] == 3
    assert body["deleted"]["places"] >= 4  # Home, Uni, Work (seeded) + Gym
    assert body["firebase_user"] == "deleted"
    assert _what_remains(A, a_ids) == {"notes": 0, "places": 0, "vectors": 0}
    assert _what_remains(B, b_ids) == before_b
    # B can still use everything
    assert len(client.get("/notes/", headers=AS_B).json()) == 3
    assert firebase_calls == [A]


def test_a_vector_without_an_owner_tag_is_deleted_too(firebase_calls):
    a_ids = _seed(AS_A)
    # an old vector stored before user_id was
    collection.update(ids=[a_ids[0]], metadatas=[{"category": "errand"}])
    client.delete("/account", headers=AS_A)
    assert collection.get(ids=a_ids)["ids"] == []


def test_idempotent(firebase_calls):
    _seed(AS_A)
    assert client.delete("/account", headers=AS_A).status_code == 200
    again = client.delete("/account", headers=AS_A)
    assert again.status_code == 200
    assert again.json()["deleted"] == {"notes": 0, "places": 0, "vectors": 0, "folders": 0}


def test_firebase_failing_keeps_the_data_deleted_and_a_retry_works(firebase_calls, monkeypatch):
    a_ids = _seed(AS_A)

    def down(uid):
        raise auth_module.FirebaseDeleteError("unavailable")

    monkeypatch.setattr(main, "delete_firebase_user", down)
    res = client.delete("/account", headers=AS_A)
    assert res.status_code == 502
    assert res.json()["detail"]["kind"] == "firebase"
    assert _what_remains(A, a_ids) == {"notes": 0, "places": 0, "vectors": 0}
    monkeypatch.setattr(main, "delete_firebase_user", lambda uid: "deleted")
    assert client.delete("/account", headers=AS_A).status_code == 200


def test_requires_sign_in(firebase_calls):
    assert client.delete("/account").status_code == 401
    assert firebase_calls == []


# ---- the Firebase part ----

def test_firebase_deletion_without_admin_credentials_is_skipped(monkeypatch):
    monkeypatch.setattr(auth_module.firebase_admin, "_apps", {})
    assert auth_module.delete_firebase_user("someone") == "skipped"


def test_firebase_user_already_gone_counts_as_done(monkeypatch):
    monkeypatch.setattr(auth_module.firebase_admin, "_apps", {"[DEFAULT]": object()})

    def gone(uid):
        raise firebase_auth.UserNotFoundError("no user")

    monkeypatch.setattr(auth_module.auth, "delete_user", gone)
    assert auth_module.delete_firebase_user("someone") == "not_found"


def test_firebase_deletes_the_user(monkeypatch):
    deleted = []
    monkeypatch.setattr(auth_module.firebase_admin, "_apps", {"[DEFAULT]": object()})
    monkeypatch.setattr(auth_module.auth, "delete_user", deleted.append)
    assert auth_module.delete_firebase_user("someone") == "deleted"
    assert deleted == ["someone"]


def test_firebase_errors_are_reported(monkeypatch):
    monkeypatch.setattr(auth_module.firebase_admin, "_apps", {"[DEFAULT]": object()})

    def broken(uid):
        raise RuntimeError("network")

    monkeypatch.setattr(auth_module.auth, "delete_user", broken)
    with pytest.raises(auth_module.FirebaseDeleteError):
        auth_module.delete_firebase_user("someone")


def test_never_deletes_unowned_data():
    from agents.pipeline import delete_user_data
    for bad in (None, ""):
        with pytest.raises(ValueError):
            delete_user_data(bad)
