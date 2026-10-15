"""Folders are kept per user on the server and stay until the user deletes
them; deleting one moves its notes to General."""
import pytest
from fastapi.testclient import TestClient

import api.main as main
import folders
from notepad import notes_collection
from tests.support import note_doc

client = TestClient(main.app)
A, B = "fold-user-a", "fold-user-b"
TOKENS = {"Bearer token-a": A, "Bearer token-b": B}
AS_A = {"Authorization": "Bearer token-a"}
AS_B = {"Authorization": "Bearer token-b"}


@pytest.fixture(autouse=True)
def two_users(monkeypatch):
    monkeypatch.setattr(main, "get_user_id", lambda authorization: TOKENS.get(authorization))
    # no AI work: folders are what's under test
    monkeypatch.setattr(main, "enrich_note", lambda note: None)
    yield
    for uid in (A, B):
        notes_collection.delete_many({"user_id": uid})
        folders.folders_collection.delete_many({"user_id": uid})


def _names(headers=AS_A):
    res = client.get("/folders/", headers=headers)
    assert res.status_code == 200
    return [f["name"] for f in res.json()]


def _note(content, folder, headers=AS_A):
    return client.post("/notes/", json={"content": content, "list_name": folder}, headers=headers).json()["id"]


def test_a_created_folder_is_listed_even_when_empty():
    assert client.post("/folders/", json={"name": "Games"}, headers=AS_A).status_code == 200
    assert _names() == ["Games"]


def test_moving_the_only_note_out_keeps_the_folder():
    note_id = _note("play chess", "Games")
    assert "Games" in _names()
    client.put(f"/notes/{note_id}", json={"list_name": "General"}, headers=AS_A)
    assert note_doc(note_id)["list_name"] == "General"
    assert "Games" in _names()


def test_folders_only_used_by_notes_are_kept_from_now_on():
    # notes saved before folders were stored (older app, another device)
    notes_collection.insert_one({"_id": "fold-old", "content": "x", "list_name": "Trips", "user_id": A, "contexts": []})
    assert "Trips" in _names()  # listed, and now stored
    notes_collection.delete_one({"_id": "fold-old"})
    assert "Trips" in _names()


def test_new_folders_go_at_the_end_and_general_is_never_stored():
    for name in ("Work", "Games", "art"):
        client.post("/folders/", json={"name": name}, headers=AS_A)
    _note("x", "General")
    assert _names() == ["Work", "Games", "art"]


@pytest.mark.parametrize("name", ["", "   ", "General", "general", "All", "x" * 51])
def test_bad_names_are_422(name):
    assert client.post("/folders/", json={"name": name}, headers=AS_A).status_code == 422


def test_names_are_trimmed_and_duplicates_are_409():
    assert client.post("/folders/", json={"name": "  Games "}, headers=AS_A).json() == {"name": "Games"}
    res = client.post("/folders/", json={"name": "games"}, headers=AS_A)
    assert res.status_code == 409


def test_delete_an_empty_folder():
    client.post("/folders/", json={"name": "Games"}, headers=AS_A)
    res = client.delete("/folders/Games", headers=AS_A)
    assert res.status_code == 200
    assert res.json() == {"deleted": True, "moved": 0}
    assert _names() == []


def test_delete_a_folder_moves_its_notes_to_general():
    a1 = _note("play chess", "Games")
    a2 = _note("buy a board", "Games")
    other = _note("call mom", "Family")
    res = client.delete("/folders/Games", headers=AS_A)
    assert res.json() == {"deleted": True, "moved": 2}
    assert note_doc(a1)["list_name"] == "General"
    assert note_doc(a2)["list_name"] == "General"
    assert note_doc(other)["list_name"] == "Family"
    assert "Games" not in _names()


def test_delete_moves_notes_saved_with_other_capitals_or_spaces():
    # saved by an older app or another device, before names were cleaned
    for note_id, name in (("fold-lower", "games"), ("fold-spaced", " Games  "), ("fold-other", "Games night")):
        notes_collection.insert_one({"_id": note_id, "content": "x", "list_name": name, "user_id": A, "contexts": []})
    res = client.delete("/folders/Games", headers=AS_A)
    assert res.json()["moved"] == 2
    assert note_doc("fold-lower")["list_name"] == "General"
    assert note_doc("fold-spaced")["list_name"] == "General"
    assert note_doc("fold-other")["list_name"] == "Games night"
    assert "games" not in [n.lower() for n in _names()]


def test_delete_matches_regex_characters_literally():
    notes_collection.insert_one({"_id": "fold-dot", "content": "x", "list_name": "a.c", "user_id": A, "contexts": []})
    notes_collection.insert_one({"_id": "fold-abc", "content": "x", "list_name": "abc", "user_id": A, "contexts": []})
    assert client.delete("/folders/a.c", headers=AS_A).json()["moved"] == 1
    assert note_doc("fold-abc")["list_name"] == "abc"


@pytest.mark.parametrize("name", ["", "   ", "All", "a/b", "x" * 51])
def test_a_note_with_a_bad_folder_name_is_422_and_not_saved(name):
    res = client.post("/notes/", json={"content": "x", "list_name": name}, headers=AS_A)
    assert res.status_code == 422
    assert notes_collection.count_documents({"user_id": A}) == 0
    assert _names() == []


@pytest.mark.parametrize("name", ["", "   ", "All", "a/b", "x" * 51])
def test_moving_a_note_to_a_bad_folder_name_is_422_and_unchanged(name):
    note_id = _note("play chess", "Games")
    assert client.put(f"/notes/{note_id}", json={"list_name": name}, headers=AS_A).status_code == 422
    if name:  # query parameters: older app versions ("" isn't sent)
        assert client.put(f"/notes/{note_id}", params={"list_name": name}, headers=AS_A).status_code == 422
    assert note_doc(note_id)["list_name"] == "Games"


def test_note_folder_names_are_cleaned_like_folders():
    note_id = _note("play chess", "  Board   games ")
    assert note_doc(note_id)["list_name"] == "Board games"
    client.put(f"/notes/{note_id}", json={"list_name": "general"}, headers=AS_A)
    assert note_doc(note_id)["list_name"] == "General"
    assert _names() == ["Board games"]


def test_delete_a_folder_name_with_spaces_and_hebrew():
    client.post("/folders/", json={"name": "משחקים לילדים"}, headers=AS_A)
    assert client.delete("/folders/משחקים לילדים", headers=AS_A).json()["deleted"] is True


def test_deleting_twice_is_safe():
    client.post("/folders/", json={"name": "Games"}, headers=AS_A)
    client.delete("/folders/Games", headers=AS_A)
    assert client.delete("/folders/Games", headers=AS_A).json() == {"deleted": False, "moved": 0}


def test_each_user_has_their_own_folders():
    client.post("/folders/", json={"name": "Games"}, headers=AS_A)
    b_note = _note("b's note", "Games", headers=AS_B)
    assert _names(AS_B) == ["Games"]  # B's own, from B's note
    client.delete("/folders/Games", headers=AS_A)
    assert note_doc(b_note)["list_name"] == "Games"  # A deleting theirs didn't touch B
    assert _names(AS_B) == ["Games"]


def test_account_deletion_removes_folders():
    from agents.pipeline import delete_user_data
    client.post("/folders/", json={"name": "Games"}, headers=AS_A)
    assert delete_user_data(A)["folders"] == 1
    assert folders.folders_collection.count_documents({"user_id": A}) == 0


def test_requires_sign_in():
    assert client.get("/folders/").status_code == 401
    assert client.post("/folders/", json={"name": "x"}).status_code == 401
    assert client.delete("/folders/x").status_code == 401
    assert client.put("/folders/order", json={"names": []}).status_code == 401


# ---- the user's own folder order ----

def _order(names, headers=AS_A):
    return client.put("/folders/order", json={"names": names}, headers=headers)


def test_save_an_order_and_it_is_listed_that_way():
    for name in ("Work", "Games", "Trips"):
        client.post("/folders/", json={"name": name}, headers=AS_A)
    res = _order(["Trips", "Work", "Games"])
    assert res.status_code == 200
    assert [f["name"] for f in res.json()] == ["Trips", "Work", "Games"]
    assert _names() == ["Trips", "Work", "Games"]


def test_a_new_folder_goes_after_the_saved_order():
    for name in ("Work", "Games"):
        client.post("/folders/", json={"name": name}, headers=AS_A)
    _order(["Games", "Work"])
    client.post("/folders/", json={"name": "Art"}, headers=AS_A)
    _note("pack", "Trips")  # a folder made by saving a note goes last too
    assert _names() == ["Games", "Work", "Art", "Trips"]


def test_order_matches_names_with_any_capitals_and_ignores_unknown_ones():
    for name in ("Work", "Games", "Trips"):
        client.post("/folders/", json={"name": name}, headers=AS_A)
    # "Nope" isn't a folder; Work isn't mentioned, so it keeps its place after the others
    assert [f["name"] for f in _order(["trips", "Nope", "GAMES"]).json()] == ["Trips", "Games", "Work"]
    assert "Nope" not in _names()


def test_folders_saved_before_orders_existed_list_a_to_z_then_new_ones():
    for name in ("Work", "art", "Games"):
        folders.folders_collection.insert_one(
            {"_id": f"old-{name}", "user_id": A, "name": name, "key": name.lower()}
        )
    assert _names() == ["art", "Games", "Work"]
    client.post("/folders/", json={"name": "Trips"}, headers=AS_A)
    assert _names() == ["art", "Games", "Work", "Trips"]


def test_each_user_has_their_own_order():
    for headers in (AS_A, AS_B):
        for name in ("Work", "Games"):
            client.post("/folders/", json={"name": name}, headers=headers)
    _order(["Games", "Work"], headers=AS_A)
    assert _names(AS_A) == ["Games", "Work"]
    assert _names(AS_B) == ["Work", "Games"]


def test_a_deleted_folder_made_again_goes_at_the_end():
    for name in ("Work", "Games", "Trips"):
        client.post("/folders/", json={"name": name}, headers=AS_A)
    client.delete("/folders/Work", headers=AS_A)
    client.post("/folders/", json={"name": "Work"}, headers=AS_A)
    assert _names() == ["Games", "Trips", "Work"]


@pytest.mark.parametrize("body", [{}, {"names": "Work"}, {"names": [1, 2]}, {"names": ["x" * 201]},
                                  {"names": ["a"] * 501}])
def test_a_bad_order_is_422(body):
    assert client.put("/folders/order", json=body, headers=AS_A).status_code == 422
