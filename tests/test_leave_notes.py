import os
import sys
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from agents.categorizer import is_about_leaving, is_about_arriving  # noqa: E402
from agents.pipeline import alert_on, compute_enrichment, reminder_time_source  # noqa: E402
from api.main import app  # noqa: E402
from notepad import Note, note_to_dict  # noqa: E402
from places import Place  # noqa: E402
from tests.support import delete_any, note_doc  # noqa: E402

# A place note alerts either on arriving there (the default) or on leaving
# it: "when I leave home take the umbrella" alerts on walking out of Home's
# radius, not on walking in.

HOME = Place(id="p-home", user_id=None, name="Home", kind="home")
UNI = Place(id="p-uni", user_id=None, name="Uni", kind="uni")
WORK = Place(id="p-work", user_id=None, name="Work", kind="work")
PLACES = [HOME, UNI, WORK]
AFTERNOON = datetime(2026, 11, 4, 14, 30)

client = TestClient(app)


def _enrich(content, places=PLACES, now=AFTERNOON, **fields):
    note = Note(content=content, **fields)
    result = compute_enrichment(note, places, now)
    note.category = result["category"]
    note.contexts = result["contexts"]
    note.remind_on_date = result["remind_on_date"]
    return note


def test_leaving_phrases():
    for text in [
        "when I leave home take the umbrella",
        "When I'm leaving work turn off the AC",
        "before I leave the office print the slides",
        "as soon as I leave uni call dad",
        "on my way out take the trash",
        "כשאצא מהבית לקחת מטרייה",  # כשאצא מהבית לקחת מטרייה
        "כשאני יוצאת מהעבודה להתקשר לאמא",  # כשאני יוצאת מהעבודה להתקשר לאמא
        "לפני שאצא מהאוניברסיטה להחזיר ספר",  # לפני שאצא מהאוניברסיטה להחזיר ספר
        "ברגע שאני עוזב את המשרד לשלוח מייל",  # ברגע שאני עוזב את המשרד לשלוח מייל
    ]:
        assert is_about_leaving(text), text


def test_leave_alone_is_not_about_leaving():
    for text in [
        "leave a message for Dana",
        "leave the keys on the table",
        "ask for a day of leave",
        "when I get home do the laundry",
        "כשאגיע הביתה לתלות כביסה",  # כשאגיע הביתה לתלות כביסה
        "לצאת לריצה",  # לצאת לריצה
    ]:
        assert not is_about_leaving(text), text


def test_leaving_note_belongs_to_the_place_it_leaves():
    assert _enrich("when I leave home take the umbrella").contexts[0] == "p-home"
    assert _enrich("כשאצא מהבית לקחת מטרייה").contexts[0] == "p-home"
    assert _enrich("when I'm leaving work turn off the AC").contexts[0] == "p-work"


def test_leaving_note_has_no_guessed_time():
    note = _enrich("when I leave home take the umbrella")
    assert note.contexts == ["p-home"]
    assert reminder_time_source(note) is None


def test_leaving_note_keeps_a_written_clock_time():
    note = _enrich("when I leave work at 18:00 call mom")
    assert "18:00" in note.contexts


def test_alert_on_comes_from_the_text():
    assert alert_on(Note(content="when I leave home take the umbrella")) == "leave"
    assert alert_on(Note(content="when I get home call mom")) == "arrive"
    assert alert_on(Note(content="feed the cat")) == "arrive"


def test_arriving_wins_when_a_note_says_both():
    text = "when I leave work, and when I get home start the laundry"
    assert is_about_arriving(text)
    assert alert_on(Note(content=text)) == "arrive"


def test_a_chosen_trigger_beats_the_text():
    assert alert_on(Note(content="when I leave home take the umbrella", place_trigger="arrive")) == "arrive"
    assert alert_on(Note(content="feed the cat", place_trigger="leave")) == "leave"


def test_a_chosen_trigger_drops_the_guessed_time():
    # the place's 09:00 default makes no sense for "on leaving Home"
    note = _enrich("feed the cat at home", place_trigger="leave")
    assert note.contexts == ["p-home"]


# ---- GET /reminders for a place, on arriving or on leaving ----

def _at_home(monkeypatch, notes, event=None):
    import agents.relevance as relevance
    home = Place(id="rel-home", user_id="rel-user", name="Home", kind="home")
    docs = []
    for note in notes:
        doc = note_to_dict(note)
        doc["created_at"] = note.created_at.astimezone(timezone.utc).replace(tzinfo=None)
        docs.append(doc)
    monkeypatch.setattr(relevance, "get_places", lambda user_id: [home])
    monkeypatch.setattr(relevance, "get_all_notes", lambda user_id: docs)
    return [n.content for n in relevance.get_relevant_notes(
        "", location="rel-home", hour=14, minute=0, user_id="rel-user", event=event)]


def _home_note(content, days_ago=0, **fields):
    return Note(content=content, contexts=["rel-home"], user_id="rel-user",
                created_at=datetime(2026, 11, 1, 9, 0, tzinfo=timezone.utc) - timedelta(days=days_ago),
                **fields)


def test_arriving_skips_leaving_notes(monkeypatch):
    notes = [_home_note("when I leave home take the umbrella"), _home_note("when I get home call mom"),
             _home_note("water the plants")]
    shown = _at_home(monkeypatch, notes, event="arrive")
    assert "when I leave home take the umbrella" not in shown
    assert shown[0] == "when I get home call mom"


def test_leaving_gives_only_leaving_notes_every_one(monkeypatch):
    leaving = [_home_note(f"when I leave home do thing {i}", days_ago=i) for i in range(4)]
    chosen = _home_note("feed the cat", days_ago=9, place_trigger="leave")
    notes = leaving + [chosen, _home_note("when I get home call mom"), _home_note("water the plants")]
    shown = _at_home(monkeypatch, notes, event="leave")
    assert len(shown) == 5
    assert "feed the cat" in shown
    assert "water the plants" not in shown and "when I get home call mom" not in shown


def test_leaving_with_no_leaving_notes_gives_nothing(monkeypatch):
    # no meaning-based fallback: leaving home mustn't pop up other notes
    assert _at_home(monkeypatch, [_home_note("water the plants")], event="leave") == []


def test_no_event_keeps_every_note_for_the_place(monkeypatch):
    # older phones and the reminders screen: unchanged behavior
    notes = [_home_note("when I leave home take the umbrella"), _home_note("water the plants")]
    assert len(_at_home(monkeypatch, notes)) == 2


def test_reminders_rejects_an_unknown_event():
    assert client.get("/reminders/", params={"location": "home", "event": "fly"}).status_code == 422


# ---- the API: saving the choice, and reporting alert_on ----

def test_create_and_list_report_alert_on():
    leave_id = client.post("/notes/", json={"content": "when I leave home take the umbrella"}).json()["id"]
    chosen_id = client.post("/notes/", json={"content": "feed the cat", "place_trigger": "leave"}).json()["id"]
    plain_id = client.post("/notes/", json={"content": "feed the dog"}).json()["id"]
    try:
        notes = {n["_id"]: n for n in client.get("/notes/").json()}
        assert notes[leave_id]["alert_on"] == "leave"
        assert notes[leave_id]["place_trigger"] is None
        assert notes[chosen_id]["alert_on"] == "leave"
        assert notes[chosen_id]["place_trigger"] == "leave"
        assert notes[plain_id]["alert_on"] == "arrive"
    finally:
        for note_id in (leave_id, chosen_id, plain_id):
            delete_any(note_id)


def test_update_sets_and_clears_the_choice():
    note_id = client.post("/notes/", json={"content": "feed the cat"}).json()["id"]
    try:
        assert client.put(f"/notes/{note_id}", json={"place_trigger": "leave"}).status_code == 200
        assert note_doc(note_id)["place_trigger"] == "leave"
        # "" goes back to Smart
        assert client.put(f"/notes/{note_id}", json={"place_trigger": ""}).status_code == 200
        assert note_doc(note_id)["place_trigger"] is None
    finally:
        delete_any(note_id)


def test_bad_trigger_is_rejected():
    assert client.post("/notes/", json={"content": "x", "place_trigger": "fly"}).status_code == 422
    note_id = client.post("/notes/", json={"content": "feed the cat"}).json()["id"]
    try:
        assert client.put(f"/notes/{note_id}", json={"place_trigger": "fly"}).status_code == 422
    finally:
        delete_any(note_id)
