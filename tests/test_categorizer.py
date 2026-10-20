import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents.categorizer import categorize, infer_time, infer_place  # noqa: E402,E501
from places import Place  # noqa: E402

PLACES = [
    Place(id="p-home", user_id=None, name="Home", kind="home"),
    Place(id="p-uni", user_id=None, name="Uni", kind="uni"),
    Place(id="p-work", user_id=None, name="Work", kind="work"),
    Place(id="p-gym", user_id=None, name="Gym"),
    Place(id="p-pharmacy", user_id=None, name="Pharmacy", keywords=["medicine"]),
]


def _place_id(content):
    place = infer_place(content, PLACES)
    return place.id if place else None


# kinds: todo, errand (go somewhere), idea (never alerts), event
def test_only_four_kinds():
    from agents.categorizer import KINDS
    assert KINDS == ("todo", "errand", "idea", "event")


def test_todo_is_the_default():
    assert categorize("I need to do my homework") == "todo"
    assert categorize("Remember to call mom") == "todo"
    assert categorize("blah blah blah") == "todo"


def test_errand():
    assert categorize("Buy milk from the store") == "errand"


def test_idea():
    assert categorize("Random idea for a app") == "idea"
    assert categorize("What if notes could remind you by place?") == "idea"
    assert categorize("brainstorm names for the project") == "idea"


def test_wishes_and_suggestions_are_ideas():
    assert categorize("A dark mode would be nice in Smart Mind app") == "idea"
    assert categorize("it'd be cool to sync with the calendar") == "idea"
    assert categorize("It’d be cool to have widgets") == "idea"  # curly apostrophe
    assert categorize("Could add voice notes") == "idea"
    assert categorize("feature idea: share a folder") == "idea"
    assert categorize("someday learn the piano") == "idea"
    assert categorize("how about a weekly summary?") == "idea"
    assert categorize("what if the app learned my routine") == "idea"
    assert categorize("maybe a darker green for the icon") == "idea"
    assert categorize("consider a tablet layout") == "idea"


def test_ordinary_tasks_stay_todo_or_errand():
    assert categorize("buy milk") == "errand"
    assert categorize("call mom") == "todo"
    assert categorize("Remember to call mom") == "todo"
    assert categorize("get carrots") == "errand"
    assert categorize("pay rent") == "todo"
    assert categorize("Dentist appointment at 3pm") == "event"


def test_maybe_and_consider_are_weak():
    # a concrete errand or event wins over a hedge word
    assert categorize("maybe buy milk") == "errand"
    assert categorize("consider going to the store") == "errand"
    assert categorize("maybe the dentist on Sunday") == "event"
    # the strong phrases win even then
    assert categorize("would be nice to buy a new couch") == "idea"


def test_idea_phrases_match_whole_words():
    assert categorize("pick up Maybelline mascara") == "errand"
    assert categorize("reconsider the gym membership") == "todo"


def test_event():
    assert categorize("Dentist appointment at 3pm") == "event"
    assert categorize("meeting with Dana tomorrow") == "event"
    assert categorize("Computer Networks exam") == "event"
    assert categorize("doctor on Sunday") == "event"
    assert categorize("job interview at 10:00") == "event"


def test_a_date_or_time_alone_does_not_decide_the_kind():
    assert categorize("call mom at 17:00") == "todo"
    assert categorize("pay the electricity bill on the 9th of October") == "todo"
    assert categorize("buy flowers tomorrow at 18:00") == "errand"
    assert categorize("get carrots on Friday") == "errand"


def test_get_to_somewhere_is_not_an_errand():
    assert categorize("get up early") == "todo"
    assert categorize("get ready for the trip") == "todo"


# infer_time tests
def test_infer_time_24h():
    assert infer_time("call dentist at 14:00") == "14:00"


def test_infer_time_24h_minutes():
    assert infer_time("call dentist at 14:30") == "14:30"


def test_infer_time_pm():
    assert infer_time("meeting at 3pm") == "15:00"


def test_infer_time_am():
    assert infer_time("wake up at 7am") == "07:00"


def test_infer_time_12pm():
    assert infer_time("lunch at 12pm") == "12:00"


def test_infer_time_12am():
    assert infer_time("midnight snack at 12am") == "00:00"


def test_infer_time_morning():
    assert infer_time("go for a run in the morning") == "09:00"


def test_infer_time_evening():
    assert infer_time("call mom in the evening") == "18:00"


def test_infer_time_night():
    assert infer_time("take meds at night") == "20:00"


def test_infer_time_none():
    assert infer_time("buy milk") is None


# infer_place tests: notes are tagged with the matching place's id
def test_infer_place_home():
    assert _place_id("do the laundry") == "p-home"


def test_infer_place_uni():
    assert _place_id("study for exam") == "p-uni"


def test_infer_place_work():
    assert _place_id("prepare presentation for client") == "p-work"


def test_infer_place_custom_by_name():
    assert _place_id("go to the gym") == "p-gym"


def test_infer_place_custom_by_keyword():
    assert _place_id("buy medicine for the flu") == "p-pharmacy"


def test_infer_place_custom_by_meaning():
    assert _place_id("refill my prescription") == "p-pharmacy"
    assert _place_id("leg day workout") == "p-gym"


def test_errands_no_longer_a_location():
    assert _place_id("buy milk") is None


def test_infer_place_none():
    assert _place_id("blah blah blah") is None
    assert _place_id("call mom") is None


def test_infer_place_without_places():
    assert infer_place("do the laundry", []) is None


# absolute dates written in the note
def test_infer_date_day_of_month():
    from datetime import datetime
    from agents.categorizer import infer_date
    now = datetime(2026, 10, 4, 13, 0)
    note = "get 20 minutes early to the exam on the 9th of October"
    assert infer_date(note, now) == "2026-10-09"
    assert infer_date("dentist October 9th", now) == "2026-10-09"
    assert infer_date("dentist oct 9, 2027", now) == "2027-10-09"
    assert infer_date("party 9/10", now) == "2026-10-09"


def test_infer_date_past_day_rolls_to_next_year():
    from datetime import datetime
    from agents.categorizer import infer_date
    now = datetime(2026, 10, 4, 13, 0)
    assert infer_date("birthday 3 March", now) == "2027-03-03"


def test_infer_date_ignores_impossible_dates():
    from datetime import datetime
    from agents.categorizer import infer_date
    now = datetime(2026, 10, 4, 13, 0)
    assert infer_date("31st of February", now) is None
    assert infer_date("mix 1/2 cup", now) == "2027-02-01"  # day/month, by design
    assert infer_date("may I borrow it", now) is None


def test_exam_with_a_date_is_an_event():
    note = "get 20 minutes early to the exam on the 9th of October"
    assert categorize(note) == "event"
    assert _place_id(note) == "p-uni"


def test_get_something_is_an_errand():
    assert categorize("get carrots") == "errand"
    assert categorize("grab bread from the supermarket") == "errand"


def test_get_to_an_exam_is_an_event_not_an_errand():
    assert categorize("get to the exam on the 9th of October") == "event"


# a time written without "at": "the 9:45 exam"
def test_infer_time_without_at():
    assert infer_time("the 9:45 exam") == "09:45"
    assert infer_time("exam 14:30 in room 3") == "14:30"
    assert infer_time("dentist 4pm") == "16:00"
    assert infer_time("standup 9:30am") == "09:30"


def test_infer_time_ignores_numbers_that_are_not_times():
    assert infer_time("read pages 25:99") is None
    assert infer_time("exam on 9/10") is None
    assert infer_time("buy 2 milk") is None


# "20 minutes early" moves the alarm before the time written in the note
def test_infer_time_subtracts_lead_time():
    note = "Get 20 minutes early to the 9:45 exam on the 9th of October"
    assert infer_time(note) == "09:25"


def test_infer_time_lead_time_with_typo():
    note = "Get 20 minuets early to the 9:45 exam in on the 9th of October"
    assert infer_time(note) == "09:25"


def test_infer_time_lead_time_phrasings():
    assert infer_time("be there 15 mins before the 10:00 meeting") == "09:45"
    assert infer_time("leave half an hour early for the 18:00 concert") == "17:30"
    assert infer_time("arrive an hour before the flight at 14:00") == "13:00"
    assert infer_time("get there 1.5 hours early for the 12:00 flight") == "10:30"
    assert infer_time("2 hours before the party at 8pm") == "18:00"


def test_infer_time_lead_time_hebrew():
    assert infer_time("להגיע 20 דקות לפני המבחן ב9:45") == "09:25"
    assert infer_time("להגיע חצי שעה לפני הפגישה ב-10:00") == "09:30"
    assert infer_time("לצאת שעה לפני הטיסה ב14:00") == "13:00"
    assert infer_time("להגיע רבע שעה מוקדם לשיעור ב8:30") == "08:15"


def test_infer_time_lead_time_without_a_time_is_ignored():
    # no time written: nothing to subtract from
    assert infer_time("get 20 minutes early to the exam") is None


def test_infer_time_in_minutes_is_not_a_lead_time():
    assert infer_time("call mom at 18:00, in 20 minutes") == "18:00"
