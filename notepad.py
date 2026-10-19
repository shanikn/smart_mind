from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4
from typing import Optional
from pymongo import MongoClient
from dotenv import load_dotenv
import os
import logging

logger = logging.getLogger(__name__)
# the driver's debug logs print whole documents (note text); keep them off
# even when the app logs at DEBUG
logging.getLogger("pymongo").setLevel(logging.WARNING)

# for mongodb
load_dotenv()

# mongodb connection setup
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "contextmind")

client = MongoClient(MONGO_URI)
db = client[MONGO_DB_NAME]
notes_collection = db["notes"]


@dataclass
class Note:
    content: str
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    edited_at: Optional[datetime] = None  # last change by the user (PUT /notes/{id}); None = never
    category: str = "todo"
    contexts: list = field(default_factory=list)
    list_name: str = "General"
    shown_count: int = 0
    dismissed_count: int = 0
    useful_count: int = 0
    never_show: bool = False
    last_shown: Optional[datetime] = None
    cooldown_until: Optional[datetime] = None
    reminders_enabled: bool = True
    category_explicit: bool = False
    location_explicit: bool = False
    location_value: Optional[str] = None
    remind_date_explicit: bool = False
    remind_time_explicit: bool = False
    remind_at_hour: Optional[int] = None  # manual override: force reminder at this hour (0-23)
    remind_at_minute: Optional[int] = None  # manual override minute (0-59)
    remind_on_date: Optional[str] = None  # YYYY-MM-DD; set to today at save time if not provided
    user_id: Optional[str] = None


# helper functions
def note_to_dict(note: Note) -> dict:
    return {
        "_id": note.id,
        "content": note.content,
        "created_at": note.created_at,
        "edited_at": note.edited_at,
        "category": note.category,
        "contexts": note.contexts,
        "list_name": note.list_name,
        "shown_count": note.shown_count,  # how many times shown to user
        "dismissed_count": note.dismissed_count,  # how many times dismissed
        "useful_count": note.useful_count,  # how many times marked useful
        "never_show": note.never_show,
        "last_shown": note.last_shown,  # when last resurfaced
        "cooldown_until": note.cooldown_until,  # Later=24h, Annoying=7d
        "reminders_enabled": note.reminders_enabled,
        "category_explicit": note.category_explicit,
        "location_explicit": note.location_explicit,
        "location_value": note.location_value,
        "remind_date_explicit": note.remind_date_explicit,
        "remind_time_explicit": note.remind_time_explicit,
        "remind_at_hour": note.remind_at_hour,
        "remind_at_minute": note.remind_at_minute,
        "remind_on_date": note.remind_on_date,
        "user_id": note.user_id,
    }


def dict_to_note(d: dict) -> Note:
    return Note(
        id=d["_id"],
        content=d["content"],
        created_at=d["created_at"],
        edited_at=d.get("edited_at"),
        category=d["category"],
        contexts=d.get("contexts", []),
        list_name=d.get("list_name", "General"),
        shown_count=d["shown_count"],
        dismissed_count=d["dismissed_count"],
        useful_count=d["useful_count"],
        never_show=d["never_show"],
        last_shown=d["last_shown"],
        cooldown_until=d["cooldown_until"],
        reminders_enabled=d.get("reminders_enabled", True),
        category_explicit=d.get("category_explicit", False),
        location_explicit=d.get("location_explicit", False),
        location_value=d.get("location_value"),
        remind_date_explicit=d.get("remind_date_explicit", False),
        remind_time_explicit=d.get("remind_time_explicit", False),
        remind_at_hour=d.get("remind_at_hour"),
        remind_at_minute=d.get("remind_at_minute"),
        remind_on_date=d.get("remind_on_date"),
        user_id=d.get("user_id"),
    )


def save_note(note: Note):
    notes_collection.insert_one(note_to_dict(note))


# Every function below is scoped to one owner: user_id is required and always
# part of the query. None matches only notes without an owner (old notes),
# never everyone's. Code that really needs all users' notes (startup sync,
# maintenance scripts) calls get_every_users_notes() by name.

def get_all_notes(user_id: Optional[str]) -> list[dict]:
    return list(notes_collection.find({"user_id": user_id}))


def get_every_users_notes() -> list[dict]:
    """All notes of all users. Only for startup/maintenance, never for a request."""
    return list(notes_collection.find({}))


def update_note(note_id: str, fields: dict, user_id: Optional[str]) -> int:
    result = notes_collection.update_one({"_id": note_id, "user_id": user_id}, {"$set": fields})
    return result.matched_count


def delete_note(note_id: str, user_id: Optional[str]) -> int:
    return notes_collection.delete_one({"_id": note_id, "user_id": user_id}).deleted_count


def get_note_by_id(note_id: str, user_id: Optional[str]):
    return notes_collection.find_one({"_id": note_id, "user_id": user_id})


def delete_all_notes(user_id: str) -> list:
    """Every note of this user (account deletion). Feedback lives on the
    notes, so it goes with them. Returns the deleted note ids."""
    if not user_id:
        raise ValueError("a user id is required")
    ids = [d["_id"] for d in notes_collection.find({"user_id": user_id}, {"_id": 1})]
    if ids:
        notes_collection.delete_many({"user_id": user_id, "_id": {"$in": ids}})
    return ids


def ensure_note_indexes():
    """Idempotent: every request looks notes up by owner."""
    notes_collection.create_index("user_id")


if __name__ == "__main__":
    logger.debug("%d notes", len(get_every_users_notes()))
