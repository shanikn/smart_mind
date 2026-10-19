"""A note is tagged with the saved place it names: the full name or any word
of it (3+ letters), whole words only, any capitals, possessives, Hebrew
(also with prefixes like ו ה ב ל מ ש כ); the place with the most matching
words wins."""
import pytest

from agents.categorizer import infer_place, match_place_by_name
from places import Place

# in the order the user created them: the shorter "Sderot" comes first
PLACES = [
    Place(id="p-home", user_id=None, name="Home", kind="home"),
    Place(id="p-uni", user_id=None, name="Uni", kind="uni"),
    Place(id="p-work", user_id=None, name="Work", kind="work"),
    Place(id="p-sderot", user_id=None, name="Sderot"),
    Place(id="p-jerusalem", user_id=None, name="Jerusalem"),
    Place(id="p-evyatar", user_id=None, name="Evyatar Sderot"),
    Place(id="p-pizza", user_id=None, name="Ma Pizza"),
]
HEBREW_PLACES = [
    Place(id="h-sderot", user_id=None, name="שדרות"),
    Place(id="h-evyatar", user_id=None, name="אביתר שדרות"),
    Place(id="h-jerusalem", user_id=None, name="ירושלים"),
    Place(id="h-old-city", user_id=None, name="ירושלים העתיקה"),
]


def _tag(text, places=PLACES):
    place = infer_place(text, places)
    return place.id if place else None


def _by_name(text, places=PLACES):
    place = match_place_by_name(text, places)
    return place.id if place else None


# ---- English ----

def test_the_users_example_picks_the_place_with_most_matching_words():
    # "Evyatar" and "Sderot" are both words of "Evyatar Sderot"; "Sderot" alone matches one
    assert _tag("bring Evyatar's lights to gim to Sderot") == "p-evyatar"


def test_one_word_of_a_longer_name_is_enough():
    assert _tag("evyatar") == "p-evyatar"
    assert _tag("call evyatar about the lights") == "p-evyatar"


@pytest.mark.parametrize("text", ["go to Sderot", "to sderot tomorrow", "SDEROT"])
def test_full_name_wins_a_tie(text):
    # "Sderot" and "Evyatar Sderot" each match one word; the full name decides
    assert _tag(text) == "p-sderot"


@pytest.mark.parametrize("text", ["go to Jerusalem", "JERUSALEM at 9", "meeting in jerusalem."])
def test_capitals_and_punctuation(text):
    assert _tag(text) == "p-jerusalem"


@pytest.mark.parametrize("text", ["Evyatar's birthday gift", "Evyatar’s gift"])
def test_possessives(text):
    assert _tag(text) == "p-evyatar"


@pytest.mark.parametrize("text", ["Sderotim are wide", "the jerusalemite", "evyatarr", "prosderot", "evyatars"])
def test_names_never_match_part_of_another_word(text):
    # (the meaning-based fallback may still pick a place; this is about names)
    assert _by_name(text) is None


def test_words_shorter_than_3_letters_are_ignored():
    assert _by_name("ma? what do you mean") is None
    assert _by_name("order a pizza") == "p-pizza"
    assert _by_name("dinner at ma pizza") == "p-pizza"  # the full name still counts


def test_custom_places_beat_built_in_names_on_a_tie():
    gym = Place(id="p-gym", user_id=None, name="Gym")
    assert _tag("home gym session", PLACES + [gym]) == "p-gym"


def test_built_in_places_still_work():
    assert _tag("do the laundry") == "p-home"  # Home's keywords


# ---- the person who works there ("therapist" for "Therapy") ----

THERAPY = Place(id="p-therapy", user_id=None, name="Therapy")


def test_the_users_example_therapist_means_the_therapy_place():
    assert _tag("show therapist my new app", PLACES + [THERAPY]) == "p-therapy"


@pytest.mark.parametrize("name, text", [
    ("Therapy", "ask the therapists about it"),
    ("Pharmacy", "ask the pharmacist about the pills"),
    ("Library", "return books to the librarian"),
    ("Bakery", "tell the baker we need a cake"),
    ("Baker", "bread from the bakery"),
    ("Grocer", "grocery list"),
    ("My Therapist", "therapy at 5"),
    ("Pharmacist", "pharmacy run"),
])
def test_a_place_word_and_its_person_match_both_ways(name, text):
    place = Place(id="p-x", user_id=None, name=name)
    assert _by_name(text, [place]) == "p-x"


@pytest.mark.parametrize("name, text", [
    ("Therapy", "therapeutic music"),
    ("Pharmacy", "pharmacies nearby"),   # plurals aren't matched (see "evyatars")
    ("Gym", "gymnast practice"),
    ("Water", "the soup is watery"),   # only real shops: baker/bakery, grocer/grocery
    ("Battery", "make the batter"),
])
def test_other_word_forms_still_dont_match(name, text):
    place = Place(id="p-x", user_id=None, name=name)
    assert _by_name(text, [place]) is None


# ---- Hebrew ----

def test_hebrew_users_example_with_prefixes():
    # "אביתר" and "לשדרות" (ל + שדרות) are both words of "אביתר שדרות"
    assert _tag("להביא את המנורות של אביתר לשדרות", HEBREW_PLACES) == "h-evyatar"


@pytest.mark.parametrize("text, expected", [
    ("בירושלים", "h-jerusalem"),          # ב
    ("נוסעת לשדרות מחר", "h-sderot"),      # ל
    ("חוזרת משדרות", "h-sderot"),          # מ
    ("ושדרות", "h-sderot"),                # ו
    ("ובשדרות", "h-sderot"),               # ו + ב
    ("שבירושלים", "h-jerusalem"),          # ש + ב
    ("כשבירושלים", "h-jerusalem"),         # כ + ש + ב
    ("טיול בירושלים העתיקה", "h-old-city"),  # two words beat one
])
def test_hebrew_prefixes(text, expected):
    assert _tag(text, HEBREW_PLACES) == expected


@pytest.mark.parametrize("text", [
    "שדרותיים",        # a suffix: another word
    "בשדרותים",        # prefix + another word
    "אשדרות",          # א isn't a prefix letter
    "ולהבשדרות",       # more prefixes than Hebrew allows (4)
])
def test_hebrew_never_matches_part_of_another_word(text):
    assert _by_name(text, HEBREW_PLACES) is None


def test_hebrew_prefix_only_counts_when_the_rest_is_a_whole_name_word():
    # "לבן" is ל + "בן"; "בן" isn't a word of any place, so no match
    short = [Place(id="h-ben", user_id=None, name="בן גוריון")]
    assert _by_name("חולצה לבן", short) is None
    assert _by_name("נסיעה לבן גוריון", short) == "h-ben"  # "גוריון" matches


# ---- across languages (no translation: names only match in the same script) ----

def test_hebrew_note_doesnt_match_an_english_place_name():
    assert _by_name("נוסעת לשדרות", PLACES) is None


def test_english_note_doesnt_match_a_hebrew_place_name():
    assert _by_name("going to Sderot", HEBREW_PLACES) is None
