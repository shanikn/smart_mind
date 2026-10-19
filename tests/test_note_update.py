"""PUT /notes/{id}: a JSON body (current app) or query parameters (older
app versions), validated the same way."""
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

import api.main as main
from agents.clock import local_now
from notepad import notes_collection
from tests.support import delete_any, note_doc

client = TestClient(main.app)
TOKENS = {"Bearer token-a": "upd-user-a", "Bearer token-b": "upd-user-b"}
AS_A = {"Authorization": "Bearer token-a"}
AS_B = {"Authorization": "Bearer token-b"}
# a reminder date can't be in the past, so tests use one a week ahead
LATER = (local_now().date() + timedelta(days=7)).isoformat()


@pytest.fixture
def note_id(monkeypatch):
    monkeypatch.setattr(main, "get_user_id", lambda authorization: TOKENS.get(authorization))
    created = client.post("/notes/", json={"content": "call mom"}, headers=AS_A).json()["id"]
    yield created
    delete_any(created)
    notes_collection.delete_many({"user_id": {"$in": list(TOKENS.values())}})


# ---- JSON body ----

def test_json_body_updates_the_note(note_id):
    res = client.put(
        f"/notes/{note_id}",
        json={
            "content": "buy milk",
            "list_name": "Errands",
            "remind_time_explicit": True,
            "remind_at_hour": 18,
            "remind_at_minute": 30,
            "remind_date_explicit": True,
            "remind_on_date": LATER,
            "reminders_enabled": False,
        },
        headers=AS_A,
    )
    assert res.status_code == 200
    doc = note_doc(note_id)
    assert doc["content"] == "buy milk"
    assert doc["list_name"] == "Errands"
    assert (doc["remind_at_hour"], doc["remind_at_minute"]) == (18, 30)
    assert doc["remind_on_date"] == LATER
    assert doc["reminders_enabled"] is False
    assert doc["category"] == "errand"  # content changed: re-enriched


def test_json_numbers_may_also_come_as_strings(note_id):
    client.put(f"/notes/{note_id}", json={"remind_at_hour": "7", "remind_at_minute": "05"}, headers=AS_A)
    doc = note_doc(note_id)
    assert (doc["remind_at_hour"], doc["remind_at_minute"]) == (7, 5)


@pytest.mark.parametrize("contexts", ["home-id, 09:00", ["home-id", "09:00"]])
def test_json_contexts_as_text_or_list(note_id, contexts):
    client.put(f"/notes/{note_id}", json={"contexts": contexts}, headers=AS_A)
    assert note_doc(note_id)["contexts"] == ["home-id", "09:00"]


@pytest.mark.parametrize("empty", ["", None])
def test_json_empty_or_null_clears(note_id, empty):
    client.put(
        f"/notes/{note_id}",
        json={"remind_at_hour": 9, "remind_on_date": LATER, "location_value": "Home"},
        headers=AS_A,
    )
    res = client.put(
        f"/notes/{note_id}",
        json={"remind_at_hour": empty, "remind_on_date": empty, "location_value": empty},
        headers=AS_A,
    )
    assert res.status_code == 200
    doc = note_doc(note_id)
    assert doc["remind_at_hour"] is None
    assert doc["remind_on_date"] is None
    assert doc["location_value"] is None


def test_json_fields_left_out_are_unchanged(note_id):
    client.put(f"/notes/{note_id}", json={"list_name": "Uni"}, headers=AS_A)
    client.put(f"/notes/{note_id}", json={"reminders_enabled": False}, headers=AS_A)
    doc = note_doc(note_id)
    assert doc["list_name"] == "Uni"
    assert doc["content"] == "call mom"


@pytest.mark.parametrize("body", [
    {"remind_at_hour": 24},
    {"remind_at_hour": -1},
    {"remind_at_hour": "abc"},
    {"remind_at_hour": 7.5},
    {"remind_at_hour": True},
    {"remind_at_minute": 60},
    {"remind_at_minute": "x"},
    {"unknown_field": 1},
    {"content": None},
    {"reminders_enabled": "maybe"},
])
def test_json_bad_values_are_422(note_id, body):
    res = client.put(f"/notes/{note_id}", json=body, headers=AS_A)
    assert res.status_code == 422
    assert note_doc(note_id)["content"] == "call mom"  # nothing written


def test_json_body_wins_over_query_parameters(note_id):
    client.put(f"/notes/{note_id}", params={"list_name": "Query"}, json={"list_name": "Body"}, headers=AS_A)
    assert note_doc(note_id)["list_name"] == "Body"


def test_json_another_users_note_is_404(note_id):
    res = client.put(f"/notes/{note_id}", json={"content": "hacked"}, headers=AS_B)
    assert res.status_code == 404
    assert note_doc(note_id)["content"] == "call mom"


# ---- query parameters (older app versions) ----

def test_query_parameters_still_work(note_id):
    res = client.put(
        f"/notes/{note_id}",
        params={"list_name": "Uni", "remind_at_hour": "8", "remind_at_minute": "15", "reminders_enabled": "false"},
        headers=AS_A,
    )
    assert res.status_code == 200
    doc = note_doc(note_id)
    assert doc["list_name"] == "Uni"
    assert (doc["remind_at_hour"], doc["remind_at_minute"]) == (8, 15)
    assert doc["reminders_enabled"] is False


def test_query_empty_strings_clear(note_id):
    client.put(f"/notes/{note_id}", params={"remind_at_hour": "9", "remind_on_date": LATER}, headers=AS_A)
    client.put(f"/notes/{note_id}", params={"remind_at_hour": "", "remind_on_date": ""}, headers=AS_A)
    doc = note_doc(note_id)
    assert doc["remind_at_hour"] is None
    assert doc["remind_on_date"] is None


@pytest.mark.parametrize("params", [
    {"remind_at_hour": "abc"},
    {"remind_at_hour": "24"},
    {"remind_at_hour": "-1"},
    {"remind_at_minute": "75"},
    {"remind_at_minute": "1.5"},
])
def test_query_bad_hour_or_minute_is_422_not_500(note_id, params):
    res = client.put(f"/notes/{note_id}", params=params, headers=AS_A)
    assert res.status_code == 422


# ---- edited_at: when the user last changed the note ----

def test_a_new_note_has_no_edited_time(note_id):
    assert note_doc(note_id)["edited_at"] is None


def test_changing_the_text_sets_edited_time(note_id):
    client.put(f"/notes/{note_id}", json={"content": "call mom tonight"}, headers=AS_A)
    doc = note_doc(note_id)
    assert doc["edited_at"] is not None
    assert doc["edited_at"] >= doc["created_at"]


def test_saving_without_changes_keeps_no_edited_time(note_id):
    # the edit screen sends every field back on Save, changed or not
    doc = note_doc(note_id)
    client.put(
        f"/notes/{note_id}",
        json={
            "content": doc["content"], "list_name": doc["list_name"], "category": doc["category"],
            "category_explicit": False, "location_explicit": False, "location_value": "",
            "remind_date_explicit": False, "remind_time_explicit": False, "remind_on_date": "",
            "remind_at_hour": "", "remind_at_minute": "", "reminders_enabled": True,
        },
        headers=AS_A,
    )
    assert note_doc(note_id)["edited_at"] is None


def test_turning_reminders_off_is_not_an_edit(note_id):
    # the notification's Done button only turns reminders off
    client.put(f"/notes/{note_id}", json={"reminders_enabled": False}, headers=AS_A)
    assert note_doc(note_id)["edited_at"] is None


def test_the_list_sends_edited_time(note_id):
    client.put(f"/notes/{note_id}", json={"list_name": "Uni"}, headers=AS_A)
    notes = client.get("/notes/", headers=AS_A).json()
    note = next(n for n in notes if n["_id"] == note_id)
    assert note["edited_at"] is not None
