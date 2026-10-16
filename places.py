from dataclasses import dataclass, field
from typing import Optional
from uuid import uuid4
import logging

from pymongo.errors import DuplicateKeyError

from notepad import db, notes_collection

logger = logging.getLogger(__name__)

# User places (names + optional keywords only; coordinates stay on the phone).
# Notes are tagged with a place's id, so renaming a place never breaks them.
places_collection = db["places"]

# every user starts with these; "kind" links them to the built-in keywords
DEFAULT_PLACES = [("home", "Home"), ("uni", "Uni"), ("work", "Work")]
DEFAULT_NAMES = dict(DEFAULT_PLACES)
# one Home, Uni and Work per user; custom places (kind None) aren't limited
DEFAULT_KIND_INDEX = "user_id_kind_unique"


@dataclass
class Place:
    id: str
    user_id: Optional[str]
    name: str
    keywords: list = field(default_factory=list)
    kind: Optional[str] = None  # "home" | "uni" | "work" for defaults, else None
    order: int = 0


def ensure_place_indexes():
    """Idempotent: places are always looked up by owner, and each user has
    one place of each default kind. Duplicates stored before the unique
    index existed are merged first, so it can be created."""
    places_collection.create_index("user_id")
    dedupe_default_places()
    places_collection.create_index(
        [("user_id", 1), ("kind", 1)],
        name=DEFAULT_KIND_INDEX,
        unique=True,
        partialFilterExpression={"kind": {"$type": "string"}},
    )


def _keep_first(doc: dict, note_counts: dict) -> tuple:
    """Sort key: the copy the user edited (renamed or given keywords), then
    the one most notes are tagged with, then the lowest id."""
    edited = doc.get("name") != DEFAULT_NAMES.get(doc["kind"]) or bool(doc.get("keywords"))
    return (not edited, -note_counts[doc["_id"]], doc["_id"])


def _retag_notes(user_id, removed_ids: list, kept_id: str):
    """Point the user's notes at the kept place instead of the removed copies
    (contexts and location_value; location_explicit stays as it was)."""
    removed = set(removed_ids)
    query = {"user_id": user_id, "$or": [{"contexts": {"$in": removed_ids}}, {"location_value": {"$in": removed_ids}}]}
    for note in notes_collection.find(query, {"contexts": 1, "location_value": 1}):
        contexts = []
        for value in note.get("contexts") or []:
            value = kept_id if value in removed else value
            if value not in contexts:
                contexts.append(value)
        fields = {"contexts": contexts}
        if note.get("location_value") in removed:
            fields["location_value"] = kept_id
        notes_collection.update_one({"_id": note["_id"]}, {"$set": fields})


def dedupe_default_places() -> int:
    """Merge copies of a user's default places (made by first requests that
    raced before the unique index). Keeps one copy (see _keep_first) with
    every copy's keywords, re-tags notes to it and deletes the rest.
    Returns how many copies were removed."""
    groups = places_collection.aggregate([
        {"$match": {"kind": {"$type": "string"}}},
        {"$group": {"_id": {"user_id": "$user_id", "kind": "$kind"}, "ids": {"$push": "$_id"}}},
        {"$match": {"ids.1": {"$exists": True}}},
    ])
    removed_count = 0
    for group in groups:
        user_id = group["_id"]["user_id"]
        docs = list(places_collection.find({"_id": {"$in": group["ids"]}}))
        note_counts = {d["_id"]: notes_collection.count_documents({"user_id": user_id, "contexts": d["_id"]})
                       for d in docs}
        docs.sort(key=lambda d: _keep_first(d, note_counts))
        kept, extra = docs[0], docs[1:]
        keywords = []
        for d in docs:
            keywords += [k for k in d.get("keywords") or [] if k not in keywords]
        places_collection.update_one({"_id": kept["_id"]}, {"$set": {"keywords": keywords}})
        extra_ids = [d["_id"] for d in extra]
        _retag_notes(user_id, extra_ids, kept["_id"])
        removed_count += places_collection.delete_many({"_id": {"$in": extra_ids}}).deleted_count
    if removed_count:
        logger.info("Merged duplicate default places: removed %d copies", removed_count)
    return removed_count


def place_to_dict(place: Place) -> dict:
    """API shape: no user_id, no coordinates."""
    return {
        "id": place.id,
        "name": place.name,
        "keywords": place.keywords,
        "kind": place.kind,
    }


def _from_doc(d: dict) -> Place:
    return Place(
        id=d["_id"],
        user_id=d.get("user_id"),
        name=d["name"],
        keywords=d.get("keywords", []),
        kind=d.get("kind"),
        order=d.get("order", 0),
    )


def _seed_defaults(user_id: Optional[str]):
    # upsert by (user, kind); the unique index stops concurrent first
    # requests from inserting a second copy (they get DuplicateKeyError)
    for order, (kind, name) in enumerate(DEFAULT_PLACES):
        try:
            places_collection.update_one(
                {"user_id": user_id, "kind": kind},
                {"$setOnInsert": {
                    "_id": str(uuid4()), "user_id": user_id, "name": name,
                    "keywords": [], "kind": kind, "order": order,
                }},
                upsert=True,
            )
        except DuplicateKeyError:
            pass  # another request just created it


def get_places(user_id: Optional[str]) -> list[Place]:
    """The user's places, defaults first, then custom ones in creation order."""
    if places_collection.count_documents({"user_id": user_id, "kind": {"$ne": None}}) < len(DEFAULT_PLACES):
        _seed_defaults(user_id)
    docs = places_collection.find({"user_id": user_id}).sort("order", 1)
    return [_from_doc(d) for d in docs]


def _clean_keywords(keywords) -> list:
    return [k.strip().lower() for k in (keywords or []) if k and k.strip()]


def _name_taken(user_id, name, exclude_id=None) -> bool:
    return any(
        p.name.lower() == name.lower() and p.id != exclude_id
        for p in get_places(user_id)
    )


def create_place(user_id: Optional[str], name: str, keywords=None) -> Place:
    name = name.strip()
    if not name:
        raise ValueError("place name is empty")
    if _name_taken(user_id, name):
        raise ValueError(f'a place named "{name}" already exists')
    last = places_collection.find_one({"user_id": user_id}, sort=[("order", -1)])
    place = Place(
        id=str(uuid4()), user_id=user_id, name=name,
        keywords=_clean_keywords(keywords),
        order=(last["order"] + 1) if last else len(DEFAULT_PLACES),
    )
    places_collection.insert_one({
        "_id": place.id, "user_id": user_id, "name": place.name,
        "keywords": place.keywords, "kind": None, "order": place.order,
    })
    return place


def update_place(user_id: Optional[str], place_id: str, name: Optional[str] = None, keywords=None) -> bool:
    fields = {}
    if name is not None:
        name = name.strip()
        if not name:
            raise ValueError("place name is empty")
        if _name_taken(user_id, name, exclude_id=place_id):
            raise ValueError(f'a place named "{name}" already exists')
        fields["name"] = name
    if keywords is not None:
        fields["keywords"] = _clean_keywords(keywords)
    if not fields:
        return places_collection.count_documents({"_id": place_id, "user_id": user_id}) > 0
    result = places_collection.update_one({"_id": place_id, "user_id": user_id}, {"$set": fields})
    return result.matched_count > 0


def delete_place(user_id: Optional[str], place_id: str) -> bool:
    return places_collection.delete_one({"_id": place_id, "user_id": user_id}).deleted_count > 0


def resolve_place(user_id: Optional[str], location: Optional[str]) -> Optional[Place]:
    """Find the user's place by id or by name (case-insensitive)."""
    if not location:
        return None
    places = get_places(user_id)
    for p in places:
        if p.id == location:
            return p
    for p in places:
        if p.name.lower() == location.strip().lower():
            return p
    return None


def delete_all_places(user_id: str) -> int:
    """Every place of this user (account deletion)."""
    if not user_id:
        raise ValueError("a user id is required")
    return places_collection.delete_many({"user_id": user_id}).deleted_count
