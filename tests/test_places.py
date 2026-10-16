import threading

import pytest
from fastapi.testclient import TestClient
from pymongo.errors import DuplicateKeyError

import places
from api.main import app
from agents.pipeline import process_new_notes
from notepad import Note, notes_collection
from places import (
    create_place, delete_place, get_places, places_collection,
    resolve_place, update_place,
)
from tests.support import delete_any, note_doc  # noqa: E402

client = TestClient(app)


def _clear(user_id):
    places_collection.delete_many({"user_id": user_id})


# ---- places.py ----

def test_new_user_gets_home_uni_work():
    _clear("u-defaults")
    places = get_places("u-defaults")
    assert [(p.name, p.kind) for p in places] == [
        ("Home", "home"), ("Uni", "uni"), ("Work", "work"),
    ]
    # seeding is idempotent
    assert [p.id for p in get_places("u-defaults")] == [p.id for p in places]
    _clear("u-defaults")


def test_no_errands_place_by_default():
    _clear("u-errands")
    assert "errands" not in {p.name.lower() for p in get_places("u-errands")}
    _clear("u-errands")


def test_add_several_custom_places():
    _clear("u-custom")
    gym = create_place("u-custom", "Gym", ["workout"])
    pharmacy = create_place("u-custom", "Pharmacy")
    names = [p.name for p in get_places("u-custom")]
    assert names == ["Home", "Uni", "Work", "Gym", "Pharmacy"]
    assert gym.keywords == ["workout"] and gym.kind is None
    assert pharmacy.id != gym.id
    _clear("u-custom")


def test_place_names_are_unique_per_user_ignoring_case():
    _clear("u-unique")
    create_place("u-unique", "Gym")
    try:
        create_place("u-unique", "gym")
        assert False, "expected ValueError"
    except ValueError:
        pass
    _clear("u-unique")


def test_places_are_per_user():
    _clear("u-a")
    _clear("u-b")
    create_place("u-a", "Gym")
    assert "Gym" not in [p.name for p in get_places("u-b")]
    _clear("u-a")
    _clear("u-b")


def test_resolve_place_by_id_or_name():
    _clear("u-resolve")
    gym = create_place("u-resolve", "Gym")
    assert resolve_place("u-resolve", gym.id).id == gym.id
    assert resolve_place("u-resolve", "gym").id == gym.id
    assert resolve_place("u-resolve", "HOME").kind == "home"
    assert resolve_place("u-resolve", "errands") is None
    assert resolve_place("u-resolve", "unknown") is None
    _clear("u-resolve")


def test_rename_place_keeps_id():
    _clear("u-rename")
    gym = create_place("u-rename", "Gym")
    assert update_place("u-rename", gym.id, name="Fitness")
    assert resolve_place("u-rename", gym.id).name == "Fitness"
    _clear("u-rename")


def test_delete_place():
    _clear("u-del")
    gym = create_place("u-del", "Gym")
    assert delete_place("u-del", gym.id)
    assert resolve_place("u-del", gym.id) is None
    assert not delete_place("u-del", gym.id)
    _clear("u-del")


# ---- notes are tagged with place ids ----

def test_note_is_tagged_with_place_id():
    home = resolve_place(None, "home")
    note = Note(content="do the laundry")
    process_new_notes(note)
    delete_any(note.id)
    assert home.id in note.contexts
    assert "home" not in note.contexts


def test_custom_place_tagged_by_name_keyword_and_meaning():
    gym = create_place(None, "Gym", ["squats"])
    by_name = Note(content="go to the gym")
    by_keyword = Note(content="do some squats")
    by_meaning = Note(content="leg day workout")  # no keyword, semantic match
    unrelated = Note(content="call mom")
    for n in (by_name, by_keyword, by_meaning, unrelated):
        process_new_notes(n)
        delete_any(n.id)
    delete_place(None, gym.id)
    assert gym.id in by_name.contexts
    assert gym.id in by_keyword.contexts
    assert gym.id in by_meaning.contexts
    assert gym.id not in unrelated.contexts


def test_errand_notes_get_no_location_and_no_default_time():
    note = Note(content="buy milk")
    process_new_notes(note)
    delete_any(note.id)
    assert note.category == "errand"
    assert note.contexts == []


# ---- API ----

def test_places_api_crud():
    res = client.get("/places/")
    assert res.status_code == 200
    names = [p["name"] for p in res.json()]
    assert names[:3] == ["Home", "Uni", "Work"]

    created = client.post("/places/", json={"name": "Pharmacy", "keywords": ["medicine"]})
    assert created.status_code == 200
    place = created.json()
    assert place["name"] == "Pharmacy" and place["keywords"] == ["medicine"]
    assert set(place) == {"id", "name", "keywords", "kind"}  # no coordinates

    dup = client.post("/places/", json={"name": "pharmacy"})
    assert dup.status_code == 409

    renamed = client.put(f"/places/{place['id']}", json={"name": "Drugstore"})
    assert renamed.status_code == 200
    assert "Drugstore" in [p["name"] for p in client.get("/places/").json()]

    assert client.delete(f"/places/{place['id']}").status_code == 200
    assert client.delete(f"/places/{place['id']}").status_code == 404


def test_adding_a_place_retags_existing_notes():
    note_id = client.post("/notes/", json={"content": "refill my prescription"}).json()["id"]
    place = client.post("/places/", json={"name": "Pharmacy"}).json()
    note = note_doc(note_id)
    client.delete(f"/places/{place['id']}")
    delete_any(note_id)
    assert place["id"] in note["contexts"]


def test_deleting_a_place_untags_notes():
    place = client.post("/places/", json={"name": "Gym"}).json()
    note_id = client.post("/notes/", json={"content": "leg day workout"}).json()["id"]
    assert place["id"] in note_doc(note_id)["contexts"]

    client.delete(f"/places/{place['id']}")
    note = note_doc(note_id)
    delete_any(note_id)
    assert place["id"] not in note["contexts"]


def test_renaming_a_place_keeps_note_tags():
    place = client.post("/places/", json={"name": "Gym"}).json()
    note_id = client.post("/notes/", json={"content": "leg day workout"}).json()["id"]
    client.put(f"/places/{place['id']}", json={"name": "Fitness"})
    note = note_doc(note_id)
    client.delete(f"/places/{place['id']}")
    delete_any(note_id)
    assert place["id"] in note["contexts"]


def test_reminders_accept_place_name_or_id():
    place = client.post("/places/", json={"name": "Gym"}).json()
    note_id = client.post("/notes/", json={"content": "leg day workout"}).json()["id"]

    by_name = [n["_id"] for n in client.get("/reminders/", params={"location": "Gym"}).json()]
    by_id = [n["_id"] for n in client.get("/reminders/", params={"location": place["id"]}).json()]

    client.delete(f"/places/{place['id']}")
    delete_any(note_id)
    assert note_id in by_name
    assert note_id in by_id


def test_location_override_by_name_is_stored_as_id():
    note_id = client.post("/notes/", json={
        "content": "random note", "location_explicit": True, "location_value": "work",
    }).json()["id"]
    work = client.get("/places/").json()[2]
    note = note_doc(note_id)
    delete_any(note_id)
    assert note["location_value"] == work["id"]
    assert work["id"] in note["contexts"]


# ---- default places can't be duplicated ----

def _kinds(user_id):
    return sorted(d["kind"] for d in places_collection.find({"user_id": user_id, "kind": {"$type": "string"}}))


def _drop_default_index():
    if places.DEFAULT_KIND_INDEX in places_collection.index_information():
        places_collection.drop_index(places.DEFAULT_KIND_INDEX)


def test_many_first_requests_at_once_seed_each_default_once():
    places.ensure_place_indexes()
    for n in range(5):
        user = f"dup-race-{n}"
        _clear(user)
        start = threading.Barrier(8)
        errors = []

        def first_request():
            start.wait()
            try:
                get_places(user)
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=first_request) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        assert errors == []
        assert _kinds(user) == ["home", "uni", "work"]
        _clear(user)


def test_a_second_default_is_refused_by_the_database():
    places.ensure_place_indexes()
    user = "dup-index"
    _clear(user)
    get_places(user)
    with pytest.raises(DuplicateKeyError):
        places_collection.insert_one({"_id": "dup-index-home-2", "user_id": user, "name": "Home",
                                      "keywords": [], "kind": "home", "order": 0})
    # custom places (no kind) are not limited
    create_place(user, "Gym")
    create_place(user, "Pool")
    _clear(user)


def test_seeding_ignores_a_default_another_request_just_created(monkeypatch):
    def already_there(*args, **kwargs):
        raise DuplicateKeyError("E11000 duplicate key")

    monkeypatch.setattr(places.places_collection, "update_one", already_there)
    places._seed_defaults("dup-seed")  # doesn't raise


DUP_A, DUP_B, DUP_C = "dup-user-a", "dup-user-b", "dup-user-c"


def _place(pid, user, name, kind, keywords=(), order=0):
    places_collection.insert_one({"_id": pid, "user_id": user, "name": name,
                                  "keywords": list(keywords), "kind": kind, "order": order})


def _tagged_note(nid, user, place_id, explicit=False):
    notes_collection.insert_one({"_id": nid, "user_id": user, "content": "buy milk",
                                 "contexts": [place_id, "09:00"], "location_value": place_id,
                                 "location_explicit": explicit})


def _clear_dup_users():
    for user in (DUP_A, DUP_B, DUP_C):
        _clear(user)
        notes_collection.delete_many({"user_id": user})


@pytest.fixture
def duplicates():
    _drop_default_index()
    _clear_dup_users()
    # user A: two Home copies (the second renamed, with a keyword), three Uni copies
    _place("a-home-1", DUP_A, "Home", "home", order=0)
    _place("a-home-2", DUP_A, "My flat", "home", keywords=["flat"], order=0)
    _place("a-uni-1", DUP_A, "Uni", "uni", order=1)
    _place("a-uni-2", DUP_A, "Uni", "uni", keywords=["campus"], order=1)
    _place("a-uni-3", DUP_A, "Uni", "uni", keywords=["campus", "lab"], order=1)
    _place("a-work-1", DUP_A, "Work", "work", order=2)
    _place("a-gym", DUP_A, "Gym", None, order=3)
    _place("a-gym-2", DUP_A, "Gym 2", None, order=4)
    # user B: only one copy of each
    _place("b-home", DUP_B, "Home", "home", order=0)
    _place("b-uni", DUP_B, "Uni", "uni", order=1)
    _place("b-work", DUP_B, "Work", "work", order=2)
    _tagged_note("a-note-home", DUP_A, "a-home-1", explicit=True)
    _tagged_note("a-note-uni", DUP_A, "a-uni-1")
    notes_collection.insert_one({"_id": "a-note-both", "user_id": DUP_A, "content": "x",
                                 "contexts": ["a-home-1", "a-home-2"], "location_value": None,
                                 "location_explicit": False})
    _tagged_note("a-note-gym", DUP_A, "a-gym")
    _tagged_note("b-note", DUP_B, "b-home")
    yield
    _clear_dup_users()
    places.ensure_place_indexes()


def _ids(user, kind):
    return sorted(d["_id"] for d in places_collection.find({"user_id": user, "kind": kind}))


def test_dedupe_keeps_the_renamed_copy_and_merges_keywords(duplicates):
    places.dedupe_default_places()
    assert _ids(DUP_A, "home") == ["a-home-2"]
    home = places_collection.find_one({"_id": "a-home-2"})
    assert home["name"] == "My flat"
    assert home["keywords"] == ["flat"]
    uni_ids = _ids(DUP_A, "uni")
    assert len(uni_ids) == 1
    assert sorted(places_collection.find_one({"_id": uni_ids[0]})["keywords"]) == ["campus", "lab"]
    assert _ids(DUP_A, "work") == ["a-work-1"]


def test_dedupe_retags_notes_from_removed_copies(duplicates):
    places.dedupe_default_places()
    kept_uni = _ids(DUP_A, "uni")[0]
    home_note = notes_collection.find_one({"_id": "a-note-home"})
    assert home_note["contexts"] == ["a-home-2", "09:00"]
    assert home_note["location_value"] == "a-home-2"
    assert home_note["location_explicit"] is True
    uni_note = notes_collection.find_one({"_id": "a-note-uni"})
    assert uni_note["contexts"] == [kept_uni, "09:00"]
    assert uni_note["location_value"] == kept_uni
    assert uni_note["location_explicit"] is False
    # tagged with two copies: one tag left
    assert notes_collection.find_one({"_id": "a-note-both"})["contexts"] == ["a-home-2"]


def test_dedupe_without_edits_keeps_the_copy_with_most_notes_then_the_lowest_id():
    _drop_default_index()
    _clear_dup_users()
    _place("c-home-1", DUP_C, "Home", "home")
    _place("c-home-2", DUP_C, "Home", "home")
    _tagged_note("c-note", DUP_C, "c-home-2")
    _place("c-uni-2", DUP_C, "Uni", "uni", order=1)
    _place("c-uni-1", DUP_C, "Uni", "uni", order=1)
    try:
        places.dedupe_default_places()
        assert _ids(DUP_C, "home") == ["c-home-2"]
        assert _ids(DUP_C, "uni") == ["c-uni-1"]
    finally:
        _clear_dup_users()
        places.ensure_place_indexes()


def test_dedupe_leaves_custom_places_and_other_users_alone_and_is_idempotent(duplicates):
    users = {"user_id": {"$in": [DUP_A, DUP_B]}}
    b_places = list(places_collection.find({"user_id": DUP_B}).sort("_id", 1))
    b_notes = list(notes_collection.find({"user_id": DUP_B}).sort("_id", 1))
    assert places.dedupe_default_places() == 3  # user A's extra Home and 2 extra Uni copies
    assert _ids(DUP_A, None) == ["a-gym", "a-gym-2"]
    assert notes_collection.find_one({"_id": "a-note-gym"})["contexts"] == ["a-gym", "09:00"]
    assert list(places_collection.find({"user_id": DUP_B}).sort("_id", 1)) == b_places
    assert list(notes_collection.find({"user_id": DUP_B}).sort("_id", 1)) == b_notes
    places_after = list(places_collection.find(users).sort("_id", 1))
    notes_after = list(notes_collection.find(users).sort("_id", 1))
    assert places.dedupe_default_places() == 0
    assert list(places_collection.find(users).sort("_id", 1)) == places_after
    assert list(notes_collection.find(users).sort("_id", 1)) == notes_after


def test_index_setup_merges_old_duplicates_first_so_startup_works(duplicates):
    places.ensure_place_indexes()
    assert places.DEFAULT_KIND_INDEX in places_collection.index_information()
    assert _kinds(DUP_A) == ["home", "uni", "work"]
