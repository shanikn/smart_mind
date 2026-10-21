from agents.ingestion import ingest_note
from agents.pipeline import (  # noqa: E501
    process_feedback, process_new_notes, get_reminders
)
from agents.relevance import collection
from notepad import save_note, Note
from tests.support import delete_any, note_doc, update_any  # noqa: E402


def test_processor():
    note = Note(content="walk Libby")
    process_new_notes(note)
    assert note.category == "todo"  # walking the dog isn't shopping
    delete_any(note.id)


def test_get_reminders():
    # clear stale ChromaDB entries before inserting test data
    existing = collection.get()
    if existing["ids"]:
        collection.delete(ids=existing["ids"])

    note1 = Note(content="walk Libby")
    note2 = Note(content="buy groceries")
    note3 = Note(content="pick up dry cleaning")
    process_new_notes(note1)
    process_new_notes(note2)
    process_new_notes(note3)

    result = get_reminders("walk the dog", "unknown", 18)
    expected_ids = {note1.id, note2.id, note3.id}
    delete_any(note1.id)
    delete_any(note2.id)
    delete_any(note3.id)
    assert all(x.id in expected_ids for x in result)


def test_process_feedback_useful():
    note = Note(content="walk Libby")
    save_note(note)
    ingest_note(note)
    process_feedback(note, "useful")
    assert note.useful_count == 1
    delete_any(note.id)


def test_process_feedback_dismiss():
    note = Note(content="walk Libby")
    save_note(note)
    ingest_note(note)
    process_feedback(note, "dismiss")
    assert note.dismissed_count == 1
    delete_any(note.id)


def test_process_feedback_never_show():
    note = Note(content="walk Libby")
    save_note(note)
    ingest_note(note)
    process_feedback(note, "never show")
    assert note.never_show is True
    delete_any(note.id)


def test_process_feedback_cooldown():
    note = Note(content="walk Libby")
    save_note(note)
    ingest_note(note)
    process_feedback(note, "show less")
    assert note.cooldown_until is not None
    delete_any(note.id)


def test_full_delete():
    note = Note(content="walk Libby")
    save_note(note)
    ingest_note(note)
    delete_any(note.id)
    assert note_doc(note.id) is None


def test_reminder_time_source():
    from agents.pipeline import reminder_time_source

    explicit = Note(content="call mom", contexts=["14:30"],
                    remind_time_explicit=True, remind_at_hour=14, remind_at_minute=30)
    written = Note(content="remind me at 17:53 that im at home", contexts=["home", "17:53"])
    fuzzy = Note(content="go for an evening jog", contexts=["18:00"])
    default = Note(content="do the laundry", contexts=["home", "09:00"])
    no_time = Note(content="random idea", contexts=[])

    assert reminder_time_source(explicit) == "explicit"
    assert reminder_time_source(written) == "text"
    assert reminder_time_source(fuzzy) == "text"
    assert reminder_time_source(default) == "default"
    assert reminder_time_source(no_time) is None


def test_date_only_note_gets_a_morning_alarm_on_that_day():
    from datetime import datetime
    from agents.pipeline import compute_enrichment, reminder_time_source
    from places import Place

    uni = Place(id="p-uni", user_id=None, name="Uni", kind="uni")
    note = Note(content="get 20 minutes early to the exam on the 9th of October")
    fields = compute_enrichment(note, [uni], datetime(2026, 10, 4, 13, 0))

    assert fields["category"] == "event"
    assert fields["contexts"] == ["p-uni", "08:00"]
    assert fields["remind_on_date"] == "2026-10-09"
    note.contexts = fields["contexts"]
    assert reminder_time_source(note) == "text"


def test_written_time_beats_the_date_only_default():
    from datetime import datetime
    from agents.pipeline import compute_enrichment

    note = Note(content="exam on 9 October at 9:25")
    fields = compute_enrichment(note, [], datetime(2026, 10, 4, 13, 0))
    assert fields["contexts"] == ["09:25"]
    assert fields["remind_on_date"] == "2026-10-09"


def test_ideas_never_get_an_alarm():
    from agents.pipeline import reminder_time_source
    idea = Note(content="idea: an app that reminds you at 18:00", category="idea", contexts=["18:00"])
    assert reminder_time_source(idea) is None
    explicit = Note(
        content="idea for later", category="idea", contexts=["09:30"],
        remind_time_explicit=True, remind_at_hour=9, remind_at_minute=30,
    )
    assert reminder_time_source(explicit) is None


def test_ideas_are_never_returned_as_reminders():
    idea = Note(content="random idea about home automation at home", category_explicit=True, category="idea")
    todo = Note(content="clean the kitchen at home")
    process_new_notes(idea)
    process_new_notes(todo)
    # smart dating may push the default 09:00 to tomorrow; make both due today
    for n in (idea, todo):
        update_any(n.id, {"remind_on_date": None})
    ids = [n.id for n in get_reminders("home", "home", 9)]
    delete_any(idea.id)
    delete_any(todo.id)
    assert idea.id not in ids
    assert todo.id in ids


def test_lead_time_moves_the_alarm_before_the_written_time():
    from datetime import datetime
    from agents.pipeline import compute_enrichment, reminder_time_source
    from places import Place

    uni = Place(id="p-uni", user_id=None, name="Uni", kind="uni")
    note = Note(content="Get 20 minuets early to the 9:45 exam in on the 9th of October")
    fields = compute_enrichment(note, [uni], datetime(2026, 10, 4, 13, 0))

    assert fields["contexts"] == ["p-uni", "09:25"]
    assert fields["remind_on_date"] == "2026-10-09"
    note.contexts = fields["contexts"]
    assert reminder_time_source(note) == "text"
