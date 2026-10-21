import re
import logging
from functools import lru_cache
from typing import Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# A note's kind. Time and place are separate fields, so a date or a time
# alone never decides the kind.
#   todo   - something to do (the default)
#   errand - shopping: something to buy, pick up or send at a store (the app
#            calls it "Shopping"); going somewhere or chores are to-dos
#   idea   - something to keep; never alerts
#   event  - an appointment, meeting, exam...
KINDS = ("todo", "errand", "idea", "event")

idea_words = [
    "idea", "ideas", "feature idea", "what if", "brainstorm", "random thought", "someday",
    "would be nice", "would be cool", "it'd be nice", "it'd be cool", "could add", "how about",
]
# hedges: an idea only when the note isn't also a concrete event or errand
# ("maybe buy milk" is still an errand)
weak_idea_words = ["maybe", "consider"]
event_words = [
    "appointment", "meeting", "exam", "exams", "quiz", "midterm", "dentist", "doctor",
    "interview", "lecture", "class", "seminar", "conference", "webinar", "party",
    "wedding", "birthday", "concert", "flight", "reservation", "checkup", "check-up",
]
errand = [
    "buy", "shopping", "shopping list",
    "grocery", "groceries", "supermarket", "store",
    "pharmacy", "prescription", "post office", "parcel", "package",
]
# supermarket and drugstore chains, and toiletries: naming one is an errand
# ("Rami Levi: milk, bread", "sunscreen")
supermarket_chains = [
    "rami levi", "rami levy", "shufersal", "yochananof", "osher ad", "tiv taam",
    "רמי לוי", "שופרסל", "יוחננוף", "אושר עד", "טיב טעם", "ויקטורי", "יינות ביתן", "חצי חינם",
]
drugstore_words = [
    "super-pharm", "super pharm", "superpharm", "good pharm", "drugstore",
    "soap", "face soap", "face wash", "shampoo", "conditioner", "toothpaste", "toothbrush",
    "deodorant", "sunscreen", "moisturizer", "face cream", "makeup", "mascara", "lipstick", "razors", "cotton pads",
    "סופר פארם", "סופרפארם", "גוד פארם", "סבון", "סבון פנים", "שמפו", "מרכך", "משחת שיניים",
    "מברשת שיניים", "דאודורנט", "קרם הגנה", "קרם פנים", "קרם לחות", "איפור", "סכיני גילוח",
]
# Hebrew errands: to buy, shopping, the supermarket / corner store,
# pharmacy, post office, package
hebrew_errand = [
    "לקנות", "קניות", "סופר", "סופרמרקט", "מכולת",
    "בית מרקחת", "מרקחת", "דואר", "חבילה", "חבילות",
]
# "get carrots" is an errand, but "get to the exam", "get up early" or
# "get ready" are not: get/grab/pick up count only when an item follows,
# not a person ("pick up the kids", "pick up Sarah") or a chore ("pick up
# the trash"). A capitalized word after "pick up" is taken as a name.
_PEOPLE = r"(the\s+|my\s+)?(kids?|children|son|daughter|baby|mom|dad|grandma|grandpa|friends?|him|her|them|me|us)\b"
_PICKUP_CHORES = r"(the\s+|my\s+|your\s+)?(trash|garbage|rubbish|laundry|toys|mess|room|clothes|dishes|phone|call)\b"
weak_errand = re.compile(
    r"\b(get|grab|pick\s+up)\s+(?!(to|up|ready|back|home|out|there|in|on|off|started|better)\b)"
    r"(?!" + _PEOPLE + r")(?!" + _PICKUP_CHORES + r")\w"
)
# run on the original text, before lower-casing
_PICKUP_NAME = re.compile(r"\b[Pp]ick\s+up\s+[A-Z][a-z]")

# Which kind of store an errand needs, for alerts near any such store.
# Checked in order; anything else (food, groceries...) is the supermarket.
STORE_TYPES = ("supermarket", "pharmacy", "post_office")
store_type_words = {
    "pharmacy": [
        "pharmacy", "medicine", "medicines", "meds", "pill", "pills", "vitamin", "vitamins",
        "prescription", "painkiller", "painkillers", "aspirin", "ibuprofen", "advil", "bandages",
        "בית מרקחת", "מרקחת", "תרופה", "תרופות", "ויטמינים", "מרשם",
    ] + drugstore_words,
    "post_office": [
        "post office", "package", "packages", "parcel", "parcels", "mail", "stamps",
        "דואר", "חבילה", "חבילות", "בולים",
    ],
}


def infer_store_type(content: str) -> str:
    """The store type an errand needs: one of STORE_TYPES."""
    lower = content.lower()
    for kind, words in store_type_words.items():
        if any(_has_term(lower, w) for w in words):
            return kind
    return "supermarket"


home_keywords = [
    "home", "house", "laundry", "dishes",
    "clean", "trash", "feed", "cook", "kitchen", "bedroom",
]
uni_keywords = [
    "class", "lecture", "campus", "study", "exam",
    "homework", "assignment", "professor", "course",
    "uni", "university", "probability",
]
work_keywords = [
    "work", "office", "meeting", "boss", "client",
    "deadline", "colleague", "presentation", "email",
]


def _has_word(content, keyword):
    """Match whole words only to avoid substring false positives (e.g. 'eat' matching 'at')."""
    return bool(re.search(r'\b' + re.escape(keyword) + r'\b', content))


def _has_term(content, term):
    """_has_word, but a Hebrew term may also carry up to three prefix letters
    (ו ה ב ל מ ש כ: "ברמי לוי", "לסופר", "מהדואר")."""
    if not re.search("[\u05d0-\u05ea]", term):
        return _has_word(content, term)
    prefix = r"(?<![\u05d0-\u05ea])[\u05d5\u05d4\u05d1\u05dc\u05de\u05e9\u05db]{0,3}"
    return bool(re.search(prefix + re.escape(term) + r"(?![\u05d0-\u05ea])", content))


def _picks_up_a_name(content: str, lower: str) -> bool:
    """"pick up Sarah": a capitalized word after "pick up", and no get/grab
    of something else in the note."""
    if not _PICKUP_NAME.search(content):
        return False
    return not re.search(r"\b(get|grab)\s+\w", re.sub(r"\bpick\s+up\b", "", lower))


def categorize(content: str) -> str:
    """One of KINDS. Order: an explicit idea, then an event, then an errand,
    then a hedged idea ("maybe", "consider"); everything else is a to-do."""
    lower = content.lower().replace("’", "'")  # curly apostrophe: "it’d"
    if any(_has_word(lower, w) for w in idea_words):
        result = "idea"
    elif any(_has_word(lower, w) for w in event_words):
        result = "event"
    elif (
        any(_has_word(lower, w) for w in errand)
        or any(_has_term(lower, w) for w in supermarket_chains + drugstore_words + hebrew_errand)
        or (weak_errand.search(lower) and not _picks_up_a_name(content, lower))
    ):
        result = "errand"
    elif any(_has_word(lower, w) for w in weak_idea_words):
        result = "idea"
    else:
        result = "todo"
    logger.debug("categorize -> %s", result)
    return result


fuzzy_time_map = {
    "morning": "09:00",
    "noon": "12:00",
    "lunch": "13:00",
    "afternoon": "15:00",
    "evening": "18:00",
    "tonight": "20:00",
    "night": "20:00",
    "sleep": "20:00",
    "breakfast": "09:00",
    "dinner": "20:00",
}


# a time written in the note: "at 14:30", "the 9:45 exam", "4pm", "9:30am".
# "at ..." wins over a bare time; dates like "9/10" are never times.
_at_time = re.compile(r"\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?![\d:])")
_colon_time = re.compile(r"(?<![\d:/.])(\d{1,2}):(\d{2})\s*(am|pm)?(?![\d:])")
_ampm_time = re.compile(r"(?<![\d:/.])(\d{1,2})()\s*(am|pm)\b")

# how long before that time to alert: "20 minutes early", "half an hour
# before", "an hour ahead", "20 minuets early" (typos of minute count too),
# "20 דקות לפני", "חצי שעה לפני", "שעתיים לפני"
_lead_en = re.compile(
    r"\b(?:(\d+(?:\.\d+)?)|(an?|one)|(half\s+an?)|((?:a\s+)?quarter\s+of\s+an?))\s*"
    r"(min\w*|hours?|hrs?)\s+(?:early|earlier|before|ahead|in\s+advance|prior)\b"
)
_HEB = "\u05d0-\u05ea"
_lead_he = re.compile(
    r"(?<![" + _HEB + r"])(?:(\d+(?:\.\d+)?)\s*(דקות|דקה|דק'|שעות|שעה)|(חצי שעה|רבע שעה|שעתיים|שעה))"
    r"\s+(?:לפני|מוקדם|קודם)"
)
_HE_LEADS = {"חצי שעה": 30, "רבע שעה": 15, "שעתיים": 120, "שעה": 60}


def _clock(match) -> Optional[tuple]:
    """(hour, minute) of a time match, or None if it isn't a real time."""
    hour = int(match.group(1))
    minute = int(match.group(2) or 0)
    ampm = match.group(3)
    if minute > 59:
        return None
    if ampm:
        if not 1 <= hour <= 12:
            return None
        if ampm == "pm" and hour != 12:
            hour += 12
        if ampm == "am" and hour == 12:
            hour = 0
    elif match.group(2) is None or hour > 23:
        # "at 5" alone isn't a time
        return None
    return hour, minute


def _written_time(content_lower: str) -> Optional[tuple]:
    for pattern in (_at_time, _colon_time, _ampm_time):
        for match in pattern.finditer(content_lower):
            clock = _clock(match)
            if clock:
                return clock
    return None


def lead_minutes(content: str) -> int:
    """How many minutes before the note's time it wants the alert (0 if none)."""
    lower = content.lower()
    match = _lead_en.search(lower)
    if match:
        count, one, half, quarter, unit = match.groups()
        per_unit = 1 if unit.startswith("min") else 60
        if count:
            return round(float(count) * per_unit)
        if one:
            return per_unit
        if half:
            return per_unit // 2
        return per_unit // 4
    match = _lead_he.search(content)
    if match:
        count, unit, phrase = match.groups()
        if phrase:
            return _HE_LEADS[phrase]
        return round(float(count) * (60 if unit.startswith("שע") else 1))
    return 0


def infer_time(content: str) -> Optional[str]:
    """Returns time as 'HH:MM' string, or None if not found.
    A lead time ("20 minutes early") moves it earlier the same day."""
    content_lower = content.lower()

    clock = _written_time(content_lower)
    if clock is None:
        # fuzzy words
        for word, t in fuzzy_time_map.items():
            if word in content_lower:
                clock = tuple(int(x) for x in t.split(":"))
                break
    if clock is None:
        return None

    total = clock[0] * 60 + clock[1]
    lead = lead_minutes(content)
    if 0 < lead <= total:
        total -= lead
    return f"{total // 60:02d}:{total % 60:02d}"


months = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5,
    "june": 6, "july": 7, "august": 8, "september": 9, "october": 10,
    "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7,
    "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
_month_pat = "(" + "|".join(sorted(months, key=len, reverse=True)) + r")\.?"
_day_pat = r"(\d{1,2})(?:st|nd|rd|th)?"
_year_pat = r"(?:,?\s+(\d{4}))?"
# "9th of October", "9 Oct 2026"
_day_month = re.compile(r"\b" + _day_pat + r"\s+(?:of\s+)?" + _month_pat + _year_pat + r"\b")
# "October 9th", "Oct 9, 2026"
_month_day = re.compile(r"\b" + _month_pat + r"\s+(?:the\s+)?" + _day_pat + _year_pat + r"\b")
# "9/10" or "9/10/2026" (day first, as written in Israel)
_numeric = re.compile(r"(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{2}|\d{4}))?(?![\d/])")


def _calendar_date(content_lower: str, reference: datetime) -> Optional[str]:
    """An absolute date written in the note; without a year, the next one to come."""
    day = month = year = None
    match = _day_month.search(content_lower)
    if match:
        day, month, year = int(match.group(1)), months[match.group(2)], match.group(3)
    else:
        match = _month_day.search(content_lower)
        if match:
            month, day, year = months[match.group(1)], int(match.group(2)), match.group(3)
        else:
            match = _numeric.search(content_lower)
            if match:
                day, month, year = int(match.group(1)), int(match.group(2)), match.group(3)
    if day is None:
        return None
    if year is not None:
        year = int(year)
        if year < 100:
            year += 2000
    try:
        date = datetime(year or reference.year, month, day)
    except ValueError:
        return None
    if year is None and date.date() < reference.date():
        try:
            date = date.replace(year=reference.year + 1)
        except ValueError:
            return None
    return date.strftime("%Y-%m-%d")


def infer_date(content: str, now: Optional[datetime] = None) -> Optional[str]:
    content_lower = content.lower()
    reference = now or datetime.now()

    calendar_date = _calendar_date(content_lower, reference)
    if calendar_date:
        return calendar_date
    days_pat = r"\bin\s+(\d+)\s+days?(?:\s+from\s+now)?\b"
    weeks_pat = r"\bin\s+(\d+)\s+weeks?(?:\s+from\s+now)?\b"
    in_days_match = re.search(days_pat, content_lower)
    in_weeks_match = re.search(weeks_pat, content_lower)

    if "today" in content_lower:
        return reference.strftime("%Y-%m-%d")

    if "tomorrow" in content_lower:
        return (reference + timedelta(days=1)).strftime("%Y-%m-%d")

    week_phrases = ("next week", "in a week", "in one week")
    if any(p in content_lower for p in week_phrases):
        return (reference + timedelta(weeks=1)).strftime("%Y-%m-%d")

    if in_days_match:
        delta = timedelta(days=int(in_days_match.group(1)))
        return (reference + delta).strftime("%Y-%m-%d")

    if in_weeks_match:
        delta = timedelta(weeks=int(in_weeks_match.group(1)))
        return (reference + delta).strftime("%Y-%m-%d")

    return None


# ---- notes about arriving ("when I get home ...") ----
#
# They alert on arriving at the place, whatever the hour, so they get no
# guessed time: not the place's default, and not a word like "dinner" read
# as 20:00. Only a clock time written in the note ("at 18:00") is kept.
# Same phrases as the phone's isAboutArriving (mobile/src/lib/arrivalNotes.ts),
# plus Hebrew: "כשאגיע", "כשאני מגיעה", "כשאחזור", "ברגע שאהיה"...

# Like the Hebrew, a time word comes first: "get back to the client" or
# "the flight arrives friday" alone are ordinary to-dos.
_arrival_english = re.compile(
    r"\b(on arrival"
    r"|(when|once|after|as soon as) i (get|reach|come|arrive)\b"
    r"|(when|once) i'?m (at|home|there|back)\b"
    r"|(when|once) i am (at|home|there|back)\b)"
)
# כש / ברגע ש / אחרי ש, maybe אני, then a verb of arriving or being there:
# אגיע מגיע(ה) נגיע, אחזור חוזר(ת) נחזור, אהיה נהיה
_arrival_hebrew = re.compile(
    "(?:\u05db\u05e9|\u05d1\u05e8\u05d2\u05e2 \u05e9|\u05d0\u05d7\u05e8\u05d9 \u05e9)"
    "(?:\u05d0\u05e0\u05d9\\s+)?"
    "(?:\u05d0\u05d2\u05d9\u05e2|\u05de\u05d2\u05d9\u05e2\u05d4?|\u05e0\u05d2\u05d9\u05e2"
    "|\u05d0\u05d7\u05d6\u05d5\u05e8|\u05d7\u05d5\u05d6\u05e8\u05ea?|\u05e0\u05d7\u05d6\u05d5\u05e8"
    "|\u05d0\u05d4\u05d9\u05d4|\u05e0\u05d4\u05d9\u05d4)"
)

# where an arrival note is going, by Place.kind; Hebrew words may carry
# prefix letters ("לעבודה", "בבית"). Only used for notes about arriving:
# on its own "עבודה" is often an assignment.
arrival_destinations = {
    "home": ["home", "house", "\u05d1\u05d9\u05ea", "\u05d4\u05d1\u05d9\u05ea\u05d4"],  # בית הביתה
    "uni": ["uni", "university", "campus",
            "\u05d0\u05d5\u05e0\u05d9\u05d1\u05e8\u05e1\u05d9\u05d8\u05d4",  # אוניברסיטה
            "\u05d0\u05d5\u05e0\u05d9", "\u05e7\u05de\u05e4\u05d5\u05e1"],  # אוני קמפוס
    "work": ["work", "office", "\u05e2\u05d1\u05d5\u05d3\u05d4", "\u05de\u05e9\u05e8\u05d3"],  # עבודה משרד
}


# a clock time written in the note: "18:00", "at 6pm"; not "dinner"
_written_clock = re.compile(r"(?<![\d:/.])\d{1,2}(?::\d{2}|\s*(?:am|pm)\b)")


def has_written_clock(content: str) -> bool:
    return bool(_written_clock.search(content.lower()))


def is_about_arriving(content: str) -> bool:
    lower = content.lower().replace("\u2019", "'")
    return bool(_arrival_english.search(lower) or _arrival_hebrew.search(lower))


def _arrival_destination(content: str, places: list):
    """For a note about arriving, the Home/Uni/Work place it's going to."""
    tokens = _tokens(content)
    for place in places:
        words = arrival_destinations.get(place.kind, [])
        if any(_token_is(t, w) for t in tokens for w in words):
            return place
    return None


# alarm time for a note that names a day but no time
DATE_ONLY_TIME = "08:00"

# default reminder time for the built-in places; custom places have none
location_time_defaults = {
    "home": "09:00",
    "uni": "09:00",
    "work": "09:00",
}

# built-in keywords for the default places, by Place.kind
kind_keywords = {
    "home": home_keywords,
    "uni": uni_keywords,
    "work": work_keywords,
}

# semantic fallback: tag a place only on a clear match (measured on
# all-MiniLM-L6-v2: real matches 0.31-0.56, unrelated notes <= 0.27)
SEMANTIC_THRESHOLD = 0.30
SEMANTIC_MARGIN = 0.08


def default_time_for(place) -> Optional[str]:
    if place is None:
        return None
    return location_time_defaults.get(place.kind)


def _place_words(place) -> list:
    return [place.name.lower(), *place.keywords]


@lru_cache(maxsize=256)
def _embed(text: str):
    from agents.embedding_model import get_embedding_model
    return get_embedding_model().encode(text, convert_to_tensor=True)


def _semantic_match(content: str, places: list):
    from sentence_transformers.util import cos_sim
    note = _embed(content)
    scored = sorted(
        ((float(cos_sim(note, _embed(", ".join(_place_words(p))))), p) for p in places),
        key=lambda x: x[0],
        reverse=True,
    )
    best_score, best = scored[0]
    runner_up = scored[1][0] if len(scored) > 1 else 0.0
    if best_score >= SEMANTIC_THRESHOLD and best_score - runner_up >= SEMANTIC_MARGIN:
        return best
    return None


# ---- matching a note to the place it names ----
#
# A place matches when the note has its full name, or any word of the name
# that's at least 3 letters long, or one of its keywords; whole words only,
# any capitals ("Evyatar's" is "evyatar" + "s"). Hebrew attaches up to three
# prefix letters to a word (ו ה ב ל מ ש כ: "לשדרות", "ובשדרות"); they're
# stripped only when the rest is a whole word of a place name. An English
# place word also matches the person (or people) who work there and back
# ("Therapy" / "therapist(s)", "Pharmacy" / "pharmacist", "Library" /
# "librarian", "Bakery" / "baker"); other word forms don't ("evyatars"). The place
# with the most matching words wins; then a full-name match; then the
# user's own places over Home/Uni/Work; then the order of the places.

MIN_NAME_WORD = 3
_HEBREW_PREFIX_LETTERS = frozenset(chr(c) for c in (0x05D5, 0x05D4, 0x05D1, 0x05DC, 0x05DE, 0x05E9, 0x05DB))
_MAX_HEBREW_PREFIX = 3
_HEBREW_LETTER = re.compile("[%s-%s]" % (chr(0x05D0), chr(0x05EA)))


def _tokens(text: str) -> list:
    return re.findall(r"\w+", text.lower())


MIN_FAMILY_WORD = 5
# people whose place is the word + "y"; a list, since most "-er" words aren't ("water")
_ERY_PEOPLE = frozenset({"baker", "grocer", "brewer", "butcher"})


def _person_forms(word: str) -> set:
    """English words for the person at a place word, and the place for a person word."""
    if len(word) < MIN_FAMILY_WORD or not word.isascii():
        return set()
    forms = set()
    if word.endswith("y"):  # therapy -> therapist(s), library -> librarian(s)
        base = word[:-1]
        forms |= {base + "ist", base + "ists", base + "ian", base + "ians"}
        if base in _ERY_PEOPLE:  # bakery -> baker(s)
            forms |= {base, base + "s"}
    for ending in ("ists", "ist", "ians", "ian"):  # therapist -> therapy
        if word.endswith(ending):
            forms.add(word[:-len(ending)] + "y")
            break
    person = word[:-1] if word.endswith("s") else word
    if person in _ERY_PEOPLE:  # baker -> bakery
        forms.add(person + "y")
    return forms


def _token_is(token: str, word: str) -> bool:
    """The note's token is this name word, maybe with Hebrew prefixes,
    or the English person/place form of it."""
    if token == word or token in _person_forms(word):
        return True
    if not _HEBREW_LETTER.match(word) or not token.endswith(word):
        return False
    prefix = token[:-len(word)]
    return len(prefix) <= _MAX_HEBREW_PREFIX and all(ch in _HEBREW_PREFIX_LETTERS for ch in prefix)


def _has_full_name(tokens: list, name_words: list) -> bool:
    n = len(name_words)
    if n == 0:
        return False
    for i in range(len(tokens) - n + 1):
        if _token_is(tokens[i], name_words[0]) and tokens[i + 1:i + n] == name_words[1:]:
            return True
    return False


def _name_score(place, tokens: list, text: str) -> tuple:
    """(matching words, full name matched) for one place."""
    name_words = _tokens(place.name)
    long_words = {w for w in name_words if len(w) >= MIN_NAME_WORD}
    matched = {w for w in long_words if any(_token_is(t, w) for t in tokens)}
    keyword_hits = sum(1 for k in place.keywords if k and _has_word(text, k.lower()))
    full = _has_full_name(tokens, name_words)
    count = len(matched) + keyword_hits
    if full and count == 0:
        count = 1  # a name made only of short words, e.g. "TA"
    return count, full


def match_place_by_name(content: str, places: list):
    """The place whose name (or keyword) the note mentions most, or None."""
    text = content.lower()
    tokens = _tokens(content)
    best, best_key = None, None
    for index, place in enumerate(places):
        count, full = _name_score(place, tokens, text)
        if count == 0:
            continue
        key = (count, full, place.kind is None, -index)
        if best_key is None or key > best_key:
            best, best_key = place, key
    return best


def infer_place(content: str, places: list):
    """The user's place a note belongs to, or None.
    1. a place the note names (match_place_by_name)
    1b. for a note about arriving, where it's going ("when I get home")
    2. the built-in keywords of Home / Uni / Work
    3. semantic similarity between the note and each place's name + keywords
    """
    if not places:
        return None
    named = match_place_by_name(content, places)
    if named:
        return named
    if is_about_arriving(content):
        destination = _arrival_destination(content, places)
        if destination:
            return destination
    text = content.lower()
    for place in places:
        if place.kind and any(_has_word(text, w) for w in kind_keywords.get(place.kind, [])):
            return place
    return _semantic_match(content, places)
