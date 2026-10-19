"""A reminder date picked by hand can't be a day that has already passed
(the user's local day, agents/clock.py)."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

import api.main as main
from agents.clock import local_now
from notepad import notes_collection
from tests.support import note_doc, update_any

client = TestClient(main.app)
USER = "past-dates-user"
AUTH = {"Authorization": "Bearer token-past"}


def day(offset: int) -> str:
    return (local_now().date() + timedelta(days=offset)).isoformat()


@pytest.fixture(autouse=True)
def signed_in(monkeypatch):
    monkeypatch.setattr(
        main, "get_user_id", lambda authorization: USER if authorization == AUTH["Authorization"] else None
    )
    yield
    notes_collection.delete_many({"user_id": USER})


def create(**fields):
    return client.post("/notes/", json={"content": "call mom", **fields}, headers=AUTH)


# ---- POST /notes/ ----

def test_create_with_yesterday_is_422_and_nothing_saved():
    res = create(remind_date_explicit=True, remind_on_date=day(-1))
    assert res.status_code == 422
    assert "already passed" in res.json()["detail"]
    assert notes_collection.count_documents({"user_id": USER}) == 0


@pytest.mark.parametrize("offset", [0, 1, 30])
def test_create_with_today_or_later_is_fine(offset):
    res = create(remind_date_explicit=True, remind_on_date=day(offset))
    assert res.status_code == 200
    assert note_doc(res.json()["id"])["remind_on_date"] == day(offset)


@pytest.mark.parametrize("bad", ["tomorrow", "2026-13-01", "17/10/2026"])
def test_create_with_a_date_that_isnt_a_date_is_422(bad):
    assert create(remind_date_explicit=True, remind_on_date=bad).status_code == 422


# ---- PUT /notes/{id} ----

@pytest.fixture
def note_id():
    return create().json()["id"]


def test_update_to_yesterday_is_422_and_unchanged(note_id):
    res = client.put(f"/notes/{note_id}", json={"remind_date_explicit": True, "remind_on_date": day(-1)}, headers=AUTH)
    assert res.status_code == 422
    assert note_doc(note_id)["remind_on_date"] != day(-1)


def test_update_to_yesterday_by_query_parameters_is_422(note_id):
    res = client.put(f"/notes/{note_id}", params={"remind_on_date": day(-1)}, headers=AUTH)
    assert res.status_code == 422


def test_update_to_today_is_fine(note_id):
    res = client.put(f"/notes/{note_id}", json={"remind_date_explicit": True, "remind_on_date": day(0)}, headers=AUTH)
    assert res.status_code == 200
    assert note_doc(note_id)["remind_on_date"] == day(0)


def test_an_old_note_keeps_its_past_date_when_its_text_is_edited(note_id):
    # the edit screen sends the saved date back with every save
    update_any(note_id, {"remind_date_explicit": True, "remind_on_date": day(-3)})
    res = client.put(
        f"/notes/{note_id}",
        json={"content": "call mom tonight", "remind_date_explicit": True, "remind_on_date": day(-3)},
        headers=AUTH,
    )
    assert res.status_code == 200
    assert note_doc(note_id)["content"] == "call mom tonight"
