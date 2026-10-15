"""A user's note folders, kept on the server so they stay until the user
deletes them, even when empty, after reinstalling or on another device.

Notes refer to a folder by name (note.list_name). "General" is the built-in
folder every note without one belongs to; it's never stored.

Each folder has an "order" (0, 1, 2...): the user arranges them, new ones go
at the end. Folders stored before orders existed get one, A to Z, the first
time the user's folders are listed or changed.
"""
import re
from uuid import uuid4

from notepad import db, notes_collection

folders_collection = db["folders"]

GENERAL = "General"
MAX_NAME = 50
_RESERVED = {"general", "all"}


class FolderError(ValueError):
    """kind: invalid | exists"""

    def __init__(self, kind: str, message: str):
        super().__init__(message)
        self.kind = kind


def ensure_folder_indexes():
    """Idempotent: folders are always looked up by owner."""
    folders_collection.create_index("user_id")


def clean_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned or len(cleaned) > MAX_NAME or "/" in cleaned or cleaned.lower() in _RESERVED:
        raise FolderError("invalid", f"a folder name is 1-{MAX_NAME} characters, not General or All, without /")
    return cleaned


def clean_note_folder(name: str) -> str:
    """A note's list_name: General (any capitals), or a valid folder name,
    cleaned. Raises FolderError like clean_name."""
    if " ".join((name or "").split()).lower() == GENERAL.lower():
        return GENERAL
    return clean_name(name)


def _exists(user_id: str, name: str) -> bool:
    return folders_collection.count_documents({"user_id": user_id, "key": name.lower()}) > 0


def _sorted_docs(user_id: str) -> list:
    """The user's folder documents in their order; ones without an order
    (stored before orders existed) come after, A to Z."""
    docs = list(folders_collection.find({"user_id": user_id}, {"name": 1, "order": 1}))
    return sorted(docs, key=lambda d: ("order" not in d, d.get("order", 0), d["name"].lower()))


def _number_folders(user_id: str, docs: list):
    """Store 0, 1, 2... as the order of these documents, where it changed."""
    for i, doc in enumerate(docs):
        if doc.get("order") != i:
            folders_collection.update_one({"_id": doc["_id"]}, {"$set": {"order": i}})
            doc["order"] = i


def _insert(user_id: str, name: str):
    docs = _sorted_docs(user_id)
    _number_folders(user_id, docs)
    folders_collection.insert_one(
        {"_id": str(uuid4()), "user_id": user_id, "name": name, "key": name.lower(), "order": len(docs)}
    )


def create_folder(user_id: str, name: str) -> str:
    """Store a new folder. Raises FolderError (invalid, or exists with any capitals)."""
    cleaned = clean_name(name)
    if _exists(user_id, cleaned):
        raise FolderError("exists", f'"{cleaned}" already exists')
    _insert(user_id, cleaned)
    return cleaned


def ensure_folder(user_id: str, name: str):
    """Store a folder a note uses, if it's a real folder and not stored yet."""
    try:
        cleaned = clean_name(name)
    except FolderError:
        return  # General, empty...
    if not _exists(user_id, cleaned):
        _insert(user_id, cleaned)


def list_folders(user_id: str) -> list:
    """The user's folders in their order. Folders that so far only existed
    because a note uses them (saved by an older app or another device) are
    stored now (at the end), so they stay when their last note moves out."""
    for name in sorted(n for n in notes_collection.distinct("list_name", {"user_id": user_id}) if isinstance(n, str)):
        ensure_folder(user_id, name)
    docs = _sorted_docs(user_id)
    _number_folders(user_id, docs)
    return [d["name"] for d in docs]


def set_folder_order(user_id: str, names: list) -> list:
    """Put the named folders first, in this order (names match with any
    capitals; unknown ones are ignored). Folders not named keep their order
    after them. Returns the new order."""
    docs = _sorted_docs(user_id)
    rank = {}
    for name in names:
        rank.setdefault(" ".join(name.split()).lower(), len(rank))
    docs.sort(key=lambda d: rank.get(d["name"].lower(), len(rank)))  # stable: the rest keep their order
    _number_folders(user_id, docs)
    return [d["name"] for d in docs]


def _same_folder(name: str) -> dict:
    """A list_name query for this folder with any capitals and spaces, like
    its key (notes saved by older apps may say "games" for "Games")."""
    words = (name or "").split()
    if not words:
        return {"$in": []}
    return {"$regex": r"^\s*" + r"\s+".join(re.escape(w) for w in words) + r"\s*$", "$options": "i"}


def delete_folder(user_id: str, name: str) -> dict:
    """Delete the folder and move its notes to General. Safe to repeat."""
    moved = notes_collection.update_many(
        {"user_id": user_id, "list_name": _same_folder(name)}, {"$set": {"list_name": GENERAL}}
    ).modified_count
    deleted = folders_collection.delete_one({"user_id": user_id, "key": " ".join(name.split()).lower()}).deleted_count
    return {"deleted": deleted > 0, "moved": moved}


def delete_all_folders(user_id: str) -> int:
    """Every folder of this user (account deletion)."""
    if not user_id:
        raise ValueError("a user id is required")
    return folders_collection.delete_many({"user_id": user_id}).deleted_count
