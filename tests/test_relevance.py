import os
import sys
from datetime import datetime, timezone, timedelta

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from notepad import Note, save_note  # noqa: E402
from agents.ingestion import ingest_note  # noqa: E402
from agents.relevance import get_relevant_notes, collection  # noqa: E402
from places import resolve_place  # noqa: E402
from tests.support import delete_any  # noqa: E402


def _place_id(name):
    return resolve_place(None, name).id


def test_relevant_notes():
    note = Note(content="prepare for upcoming exam in Computer Networks")
    save_note(note)
    ingest_note(note)
    result = get_relevant_notes("exam", location="uni")
    ids = [x.id for x in result]
    collection.delete(ids=[note.id])
    delete_any(note.id)
    assert note.id in ids


def test_never_show_note_is_filtered():
    note = Note(
        content="prepare for upcoming exam in Computer Networks",
        never_show=True
    )
    save_note(note)
    ingest_note(note)
    result = get_relevant_notes("exam", location="uni")
    ids = [x.id for x in result]
    collection.delete(ids=[note.id])
    delete_any(note.id)
    assert note.id not in ids


def test_cooldown_note_is_filtered():
    note = Note(
        content="prepare for upcoming exam in Computer Networks",
        cooldown_until=datetime.now(timezone.utc) + timedelta(hours=7)
    )
    save_note(note)
    ingest_note(note)
    result = get_relevant_notes("exam", location="uni")
    ids = [x.id for x in result]
    collection.delete(ids=[note.id])
    delete_any(note.id)
    assert note.id not in ids


def test_semantic_synonym_retrieval():
    note = Note(content="buy some dairy")
    save_note(note)
    ingest_note(note)
    result = get_relevant_notes("milk", location="unknown")
    ids = [x.id for x in result]
    collection.delete(ids=[note.id])
    delete_any(note.id)
    assert note.id in ids


def test_conflicting_location_excluded():
    note = Note(content="do the laundry", contexts=[_place_id("home"), "09:00"])
    save_note(note)
    ingest_note(note)
    result = get_relevant_notes("laundry", location="work")
    ids = [x.id for x in result]
    collection.delete(ids=[note.id])
    delete_any(note.id)
    assert note.id not in ids


def test_home_location_returns_home_notes():
    note = Note(content="feed the cat", contexts=[_place_id("home"), "08:00"])
    save_note(note)
    ingest_note(note)
    result = get_relevant_notes("home", location="home")
    ids = [x.id for x in result]
    collection.delete(ids=[note.id])
    delete_any(note.id)
    assert note.id in ids


# ---- the place branch: arrival notes first, never cut; newest first on ties ----

def _arrive_at_home(monkeypatch, notes):
    """get_relevant_notes for Home, with these notes (no database)."""
    import agents.relevance as relevance
    from notepad import note_to_dict
    from places import Place
    home = Place(id="rel-home", user_id="rel-user", name="Home", kind="home")
    docs = []
    for note in notes:
        doc = note_to_dict(note)
        # MongoDB gives back naive datetimes, in UTC
        doc["created_at"] = note.created_at.astimezone(timezone.utc).replace(tzinfo=None)
        docs.append(doc)
    monkeypatch.setattr(relevance, "get_places", lambda user_id: [home])
    monkeypatch.setattr(relevance, "get_all_notes", lambda user_id: docs)
    return [n.content for n in relevance.get_relevant_notes("", location="rel-home", hour=14, minute=0,
                                                            user_id="rel-user")]


def _home_note(content, days_ago):
    return Note(content=content, contexts=["rel-home"], user_id="rel-user",
                created_at=datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc) - timedelta(days=days_ago))


def test_a_new_arrival_note_is_not_hidden_by_older_home_notes(monkeypatch):
    older = [_home_note(f"old chore {i}", days_ago=10 + i) for i in range(4)]
    new = _home_note("when I get home call mom", days_ago=0)
    shown = _arrive_at_home(monkeypatch, older + [new])
    assert shown[0] == "when I get home call mom"
    assert len(shown) == 3


def test_every_arrival_note_is_kept_even_past_three(monkeypatch):
    arrivals = [_home_note(f"when I get home do thing {i}", days_ago=i) for i in range(4)]
    hebrew = _home_note("כשאגיע הביתה לתלות כביסה", days_ago=5)
    other = _home_note("water the plants", days_ago=0)
    shown = _arrive_at_home(monkeypatch, [other] + arrivals + [hebrew])
    assert len(shown) == 5
    assert "water the plants" not in shown
    assert shown[-1] == "כשאגיע הביתה לתלות כביסה"  # the oldest arrival note


def test_equal_scores_newest_first(monkeypatch):
    notes = [_home_note("oldest", days_ago=3), _home_note("newest", days_ago=0),
             _home_note("middle", days_ago=1), _home_note("older", days_ago=2)]
    assert _arrive_at_home(monkeypatch, notes) == ["newest", "middle", "older"]


def test_a_higher_score_still_wins_over_a_newer_note(monkeypatch):
    liked = _home_note("liked chore", days_ago=9)
    liked.useful_count = 2
    notes = [_home_note(f"new chore {i}", days_ago=i) for i in range(3)] + [liked]
    assert _arrive_at_home(monkeypatch, notes)[0] == "liked chore"
