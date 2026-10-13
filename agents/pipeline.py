import logging
from datetime import datetime, timedelta
from agents.clock import local_now
from agents.ingestion import ingest_note
from agents.categorizer import (
    categorize, infer_place, infer_time, has_written_clock, is_about_arriving,
    infer_date, default_time_for, DATE_ONLY_TIME, infer_store_type,
)
from agents.relevance import get_relevant_notes, collection
from agents.ranking_policy import apply_feedback
from notepad import (
    save_note, update_note, delete_note, Note, get_all_notes, dict_to_note,
    get_every_users_notes, delete_all_notes,
)
from typing import Optional
from places import delete_all_places, get_places
from folders import delete_all_folders

logger = logging.getLogger(__name__)


def store_type(note: Note) -> Optional[str]:
    """For an errand, the kind of store it needs (supermarket, pharmacy,
    post_office), so the phone can alert near any such store. None otherwise.
    Computed when listing, like reminder_time_source, so it's never stale."""
    return infer_store_type(note.content) if note.category == "errand" else None


def reminder_time_source(note: Note) -> Optional[str]:
    """Where a note's reminder time comes from:
    "explicit" (set by the user), "text" (written in the note, e.g. "at 17:53"
    or "evening"), "default" (the location's default time), or None.
    The phone schedules exact alarms only for explicit and text times.
    Ideas never alert, so they never have a reminder time source."""
    if note.category == "idea":
        return None
    if note.remind_time_explicit and note.remind_at_hour is not None:
        return "explicit"
    time = next(
        (c for c in note.contexts if isinstance(c, str) and _parse_time_text(c)),
        None,
    )
    if time is None:
        return None
    if infer_time(note.content) == time:
        return "text"
    # a day written in the note ("exam on 9 October") earns an alarm too
    if infer_date(note.content) and time == DATE_ONLY_TIME:
        return "text"
    return "default"


def _parse_time_text(time_text: Optional[str]) -> Optional[tuple[int, int]]:
    if not time_text or ":" not in time_text:
        return None

    hour_text, minute_text = time_text.split(":", 1)
    try:
        hour = int(hour_text)
        minute = int(minute_text)
    except ValueError:
        return None

    if 0 <= hour <= 23 and 0 <= minute <= 59:
        return hour, minute
    return None


def _adjust_smart_date_for_future(
    resolved_date: Optional[str],
    time_text: Optional[str],
    note: Note,
    now: datetime,
) -> Optional[str]:
    if note.remind_date_explicit or note.remind_time_explicit:
        return resolved_date

    parsed_time = _parse_time_text(time_text)
    if parsed_time is None:
        return resolved_date

    base_date = resolved_date or now.strftime("%Y-%m-%d")
    try:
        fmt = "%Y-%m-%d %H:%M"
        scheduled = datetime.strptime(
            f"{base_date} {time_text}", fmt
        )
    except ValueError:
        return resolved_date

    if scheduled <= now:
        return (scheduled + timedelta(days=1)).strftime("%Y-%m-%d")
    return resolved_date


def process_new_notes(note: Note):
    logger.info("Processing note %s", note.id)
    save_note(note)
    enrich_note(note)


def compute_enrichment(note: Note, places: list, now: datetime) -> dict:
    """What the AI agents infer for a note, without saving anything.
    Locations are the user's place ids; explicit user choices are kept."""
    if note.category_explicit:
        category = note.category
    else:
        category = categorize(note.content)
    place = None
    if note.location_explicit and note.location_value:
        # accepts a place id or (older clients) a place name
        place = next(
            (p for p in places if p.id == note.location_value), None
        ) or next(
            (p for p in places if p.name.lower() == note.location_value.lower()), None
        )
    if place is None:
        place = infer_place(note.content, places)
    contexts = [place.id] if place else []
    # use manual hour override if set, otherwise infer
    # from content or fall back to the place's default.
    # "when I get home ..." alerts on arriving, so it gets no guessed time:
    # only a clock time written in it ("when I get home at 18:00")
    arriving = is_about_arriving(note.content)
    if note.remind_time_explicit and note.remind_at_hour is not None:
        minute = note.remind_at_minute or 0
        time = f"{note.remind_at_hour:02d}:{minute:02d}"
    elif arriving and not has_written_clock(note.content):
        time = None
    else:
        time = infer_time(note.content)
    if note.remind_date_explicit and note.remind_on_date is not None:
        resolved_date = note.remind_on_date
    else:
        resolved_date = infer_date(note.content, now)
    if time is None and not arriving:
        # a day without a time gets a morning alarm on that day
        later_day = resolved_date and resolved_date > now.strftime("%Y-%m-%d")
        if later_day and not note.remind_date_explicit:
            time = DATE_ONLY_TIME
        else:
            time = default_time_for(place)
    if time is not None:
        contexts.append(time)
    resolved_date = _adjust_smart_date_for_future(
        resolved_date, time, note, now
    )
    explicit_place = note.location_explicit and place is not None
    return {
        "category": category,
        "contexts": contexts,
        "location_explicit": explicit_place,
        "location_value": place.id if explicit_place else None,
        "remind_on_date": resolved_date,
    }


def enrich_note(note: Note):
    # the users' local date and time (agents/clock.py), not the server's UTC
    fields = compute_enrichment(note, get_places(note.user_id), local_now())
    note.category = fields["category"]
    note.contexts = fields["contexts"]
    note.location_explicit = fields["location_explicit"]
    note.location_value = fields["location_value"]
    note.remind_on_date = fields["remind_on_date"]
    logger.info("Category: %s, contexts: %s", note.category, note.contexts)
    update_note(note.id, fields, note.user_id)
    # ingest after categorization so ChromaDB gets complete metadata
    ingest_note(note)


def get_reminders(
    query: str,
    location: str = "unknown",
    hour: Optional[int] = None,
    minute: Optional[int] = None,
    user_id: Optional[str] = None,
):
    return get_relevant_notes(query, location, hour, minute, user_id)


def process_feedback(note: Note, action: str):
    apply_feedback(note, action)
    update_note(note.id, {
        "useful_count": note.useful_count,
        "dismissed_count": note.dismissed_count,
        "never_show": note.never_show,
        "cooldown_until": note.cooldown_until,
    }, note.user_id)


def full_delete(note_id: str, user_id: Optional[str]) -> bool:
    """Delete one of this user's notes from MongoDB and ChromaDB. Another
    user's note is left alone (and its vector too)."""
    if delete_note(note_id, user_id) == 0:
        return False
    try:
        collection.delete(ids=[note_id])
    except Exception:
        pass
    return True


def reingest_note(note: Note):
    """Re-categorize, re-tag and re-embed an existing note."""
    enrich_note(note)


def reenrich_user_notes(user_id: Optional[str]):
    """Re-tag a user's notes after their places changed. Notes with a
    location the user picked by hand keep it."""
    for doc in get_all_notes(user_id=user_id):
        note = dict_to_note(doc)
        if not note.location_explicit:
            enrich_note(note)


def untag_place(user_id: Optional[str], place_id: str):
    """A place was deleted: drop it from the user's notes and re-tag them."""
    for doc in get_all_notes(user_id=user_id):
        note = dict_to_note(doc)
        if place_id in note.contexts or note.location_value == place_id:
            if note.location_value == place_id:
                note.location_explicit = False
                note.location_value = None
            enrich_note(note)


def process_all_notes():
    notes = get_every_users_notes()
    logger.info("Re-ingesting %d notes into ChromaDB", len(notes))
    for note in notes:
        reingest_note(dict_to_note(note))
    logger.info("Re-ingestion complete")


def sync_vectors():
    """Make ChromaDB match MongoDB without re-running the AI: embed notes
    that have no vector (ChromaDB isn't persisted on Azure), set the owner
    on vectors stored before user_id was, and drop vectors of deleted notes.
    Doesn't change any note."""
    docs = {d["_id"]: d for d in get_every_users_notes()}
    stored = collection.get(include=["metadatas"])
    vectors = dict(zip(stored["ids"], stored["metadatas"]))
    orphans = [i for i in vectors if i not in docs]
    if orphans:
        collection.delete(ids=orphans)
    added = fixed = 0
    for note_id, doc in docs.items():
        owner = doc.get("user_id") or ""
        if note_id not in vectors:
            ingest_note(dict_to_note(doc))
            added += 1
        elif (vectors[note_id] or {}).get("user_id") != owner:
            collection.update(ids=[note_id], metadatas=[{**(vectors[note_id] or {}), "user_id": owner}])
            fixed += 1
    logger.info(
        "Vectors synced: %d added, %d owners set, %d orphans removed", added, fixed, len(orphans)
    )


def delete_user_data(user_id: str) -> dict:
    """Everything stored for this user: notes (with their feedback), places,
    folders and vectors. Never for an empty id (that would mean unowned notes)."""
    if not user_id:
        raise ValueError("a user id is required")
    note_ids = delete_all_notes(user_id)
    places = delete_all_places(user_id)
    folders = delete_all_folders(user_id)
    # vectors tagged with the owner, and any old untagged ones of these notes
    tagged = collection.get(where={"user_id": user_id})["ids"]
    untagged = collection.get(ids=note_ids)["ids"] if note_ids else []
    vectors = sorted(set(tagged) | set(untagged))
    if vectors:
        collection.delete(ids=vectors)
    logger.info(
        "Account data deleted: %d notes, %d places, %d folders, %d vectors",
        len(note_ids), places, folders, len(vectors),
    )
    return {"notes": len(note_ids), "places": places, "vectors": len(vectors), "folders": folders}
