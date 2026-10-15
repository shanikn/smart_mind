import sys
import os
from datetime import datetime
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.categorizer import is_about_arriving, infer_place  # noqa: E402
from agents.pipeline import compute_enrichment, reminder_time_source  # noqa: E402
from notepad import Note  # noqa: E402
from places import Place  # noqa: E402

# "when I get home ..." means "when I arrive at Home", whatever the hour:
# no guessed time (the place's 09:00 default, or "dinner" read as 20:00),
# so the note alerts on arriving there, the same day it was written.

HOME = Place(id="p-home", user_id=None, name="Home", kind="home")
UNI = Place(id="p-uni", user_id=None, name="Uni", kind="uni")
WORK = Place(id="p-work", user_id=None, name="Work", kind="work")
PLACES = [HOME, UNI, WORK]
AFTERNOON = datetime(2026, 10, 13, 14, 30)


def _enrich(content, places=PLACES, now=AFTERNOON):
    note = Note(content=content)
    fields = compute_enrichment(note, places, now)
    note.category = fields["category"]
    note.contexts = fields["contexts"]
    note.remind_on_date = fields["remind_on_date"]
    return note


def test_arrival_phrases():
    for text in [
        "when I get home, do the laundry",
        "When I'm home call mom",
        "once I get to uni print the form",
        "when i reach work send the report",
        "כשאגיע הביתה לתלות כביסה",  # כשאגיע הביתה לתלות כביסה
        "כשאני מגיעה לעבודה לשלוח מייל",  # כשאני מגיעה לעבודה לשלוח מייל
        "כשאחזור הביתה לבשל",  # כשאחזור הביתה לבשל
    ]:
        assert is_about_arriving(text), text
    for text in ["buy milk at 18:00", "renew the home insurance", "laundry tonight"]:
        assert not is_about_arriving(text), text


def test_arrival_needs_a_time_word_first():
    # "get back to ..." or "arrives" alone is an ordinary to-do
    for text in [
        "get back to the client tomorrow",
        "need to get to the report",
        "I get to choose the venue",
        "dad's flight arrives friday, pick him up",
    ]:
        assert not is_about_arriving(text), text
    for text in [
        "when I get home call mom",
        "once I'm at the office print the form",
        "as soon as I arrive email Dana",
        "on arrival check in",
    ]:
        assert is_about_arriving(text), text


def test_get_back_to_someone_keeps_a_reminder_time():
    note = _enrich("get back to the client tomorrow")
    assert reminder_time_source(note) is not None
    assert any(len(c) == 5 and c[2] == ":" for c in note.contexts)


def test_get_home_has_no_guessed_time():
    note = _enrich("when I get home, do the laundry")
    assert note.contexts == ["p-home"]
    # written at 14:30: the old 09:00 default pushed it to tomorrow
    assert note.remind_on_date is None
    assert reminder_time_source(note) is None


def test_activity_words_are_not_times_in_arrival_notes():
    # "dinner" used to become 20:00, "lunch" 13:00
    assert _enrich("when I get home cook dinner").contexts == ["p-home"]
    assert _enrich("when I get to uni buy lunch").contexts == ["p-uni"]


def test_a_written_clock_time_is_kept():
    note = _enrich("when I get home at 18:00 water the plants")
    assert note.contexts == ["p-home", "18:00"]
    assert reminder_time_source(note) == "text"


def test_a_written_day_is_kept_without_a_time():
    note = _enrich("tomorrow when I get to work ask about the parking spot")
    assert note.contexts == ["p-work"]
    assert note.remind_on_date == "2026-10-14"


def test_hebrew_destination_picks_the_place():
    home = infer_place("כשאגיע הביתה לתלות כביסה", PLACES)
    work = infer_place("כשאני מגיעה לעבודה לשלוח מייל", PLACES)
    uni = infer_place("כשאגיע לאוניברסיטה להדפיס", PLACES)  # כשאגיע לאוניברסיטה להדפיס
    assert (home.id, work.id, uni.id) == ("p-home", "p-work", "p-uni")
    note = _enrich("כשאגיע הביתה לתלות כביסה")
    assert note.contexts == ["p-home"]


def test_destination_beats_other_place_keywords():
    # "homework" is a Uni keyword, but the note is about arriving home;
    # the user's home place has its own name here
    flat = Place(id="p-flat", user_id=None, name="Dizengoff flat", kind="home")
    note = _enrich("when I get home finish the probability homework", places=[UNI, flat])
    assert note.contexts == ["p-flat"]


def test_notes_not_about_arriving_keep_the_place_default():
    note = _enrich("do the laundry at home")
    assert note.contexts == ["p-home", "09:00"]
