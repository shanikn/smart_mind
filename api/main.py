import logging
import threading
from typing import Optional
import os
from dotenv import load_dotenv

load_dotenv()

import re  # noqa: E402
from datetime import date  # noqa: E402
from typing import Annotated, List, Union  # noqa: E402
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr  # noqa: E402
from fastapi import Body, FastAPI, Header, HTTPException, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from notepad import (  # noqa: E402
    Note, get_all_notes, update_note, note_to_dict, save_note,
    get_note_by_id, dict_to_note, ensure_note_indexes
)
from agents.pipeline import (  # noqa: E402
    enrich_note, full_delete, process_feedback,
    get_reminders, process_all_notes, reminder_time_source, store_type, sync_vectors,
    delete_user_data,
    reenrich_user_notes, untag_place,
)
from agents.ranking_policy import FEEDBACK_ACTIONS  # noqa: E402
from places import (  # noqa: E402
    ensure_place_indexes,
    create_place, delete_place, get_places, place_to_dict, resolve_place,
    update_place,
)
from auth import FirebaseDeleteError, delete_firebase_user, get_user_id  # noqa: E402
import geocode  # noqa: E402
import nearby  # noqa: E402
import maps_links  # noqa: E402
from folders import (  # noqa: E402
    FolderError, clean_note_folder, create_folder, delete_folder, ensure_folder, ensure_folder_indexes, list_folders,
    set_folder_order,
)
import ratelimit  # noqa: E402
from agents.clock import local_now  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)


# input size limits: a note's text, and an address search
MAX_NOTE_CHARS = 5000
MAX_SEARCH_CHARS = 200


class NoteRequest(BaseModel):
    content: str = Field(..., max_length=MAX_NOTE_CHARS)
    list_name: str = "General"
    reminders_enabled: bool = True
    category_explicit: bool = False
    category: Optional[str] = None
    location_explicit: bool = False
    location_value: Optional[str] = None
    remind_date_explicit: bool = False
    remind_time_explicit: bool = False
    remind_at_hour: Optional[int] = None
    remind_at_minute: Optional[int] = None
    remind_on_date: Optional[str] = None


class NoteUpdate(BaseModel):
    """PUT /notes/{id} body: only the fields that change. "" or null clears
    remind_at_hour, remind_at_minute, remind_on_date and location_value;
    hour and minute may be numbers or numeric strings."""
    model_config = ConfigDict(extra="forbid")

    content: str = Field(None, max_length=MAX_NOTE_CHARS)
    list_name: str = None
    category: str = None
    category_explicit: bool = None
    location_explicit: bool = None
    location_value: Optional[str] = None
    contexts: Union[str, list[str]] = None
    remind_date_explicit: bool = None
    remind_time_explicit: bool = None
    remind_at_hour: Optional[Union[StrictInt, StrictStr]] = None
    remind_at_minute: Optional[Union[StrictInt, StrictStr]] = None
    remind_on_date: Optional[str] = None
    reminders_enabled: bool = None


app = FastAPI()


class AccessLogWithoutQuery(logging.Filter):
    """PUT /notes/{id} sends note text as query parameters; uvicorn's access
    log would print the full URL. Keep only the path."""

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            record.args = args[:2] + (args[2].split("?", 1)[0],) + args[3:]
        return True


logging.getLogger("uvicorn.access").addFilter(AccessLogWithoutQuery())


def cors_origins() -> list[str]:
    """Browser origins allowed to call the API, from CORS_ORIGINS (comma
    separated). The only client is the mobile app, which isn't subject to
    CORS, so by default no browser origin is allowed. "*" is never accepted."""
    raw = os.getenv("CORS_ORIGINS", "")
    return [o.strip() for o in raw.split(",") if o.strip() and o.strip() != "*"]


if cors_origins():
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )


def ensure_indexes():
    try:
        ensure_note_indexes()
        ensure_place_indexes()
        ensure_folder_indexes()
    except Exception:
        logging.exception("Creating MongoDB indexes failed")


# the background startup work, so tests can wait for it
_startup_thread: Optional[threading.Thread] = None


def _startup_work(reingest: bool):
    try:
        if reingest:
            # re-runs the AI enrichment on every note (writes to MongoDB)
            logging.info("Re-ingesting all notes into ChromaDB...")
            process_all_notes()
            logging.info("Startup ingestion complete.")
        else:
            # the default: only embed what ChromaDB is missing, notes unchanged
            sync_vectors()
    except Exception:
        logging.exception("Startup vector sync failed")


@app.on_event("startup")
def startup():
    """Indexes first (quick), then the vector sync in the background, so the
    server answers requests right away. Until the sync finishes, semantic
    search may miss notes that aren't embedded yet."""
    global _startup_thread
    ensure_indexes()
    reingest_on_startup = os.getenv("REINGEST_ON_STARTUP", "").lower() in {
        "1", "true", "yes", "on"
    }
    _startup_thread = threading.Thread(
        target=_startup_work, args=(reingest_on_startup,), name="startup-sync", daemon=True
    )
    _startup_thread.start()


@app.get("/")
def root():
    return {"status": "ok"}


def require_user_id(authorization: Optional[str]) -> str:
    user_id = get_user_id(authorization)
    if user_id is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user_id


# ---- per-user rate limits (in memory; one server instance) ----

# search also has a daily cap: each Google Places search costs money
SEARCH_LIMIT = ratelimit.limiter("search", [(30, 60), (300, 24 * 3600)])
NEARBY_LIMIT = ratelimit.limiter("nearby", [(30, 60)])
LINK_LIMIT = ratelimit.limiter("resolve-link", [(30, 60)])
NOTE_WRITE_LIMIT = ratelimit.limiter("note-write", [(60, 60)])  # create + update together
ACCOUNT_DELETE_LIMIT = ratelimit.limiter("account-delete", [(3, 3600)])
# adding, changing or deleting a place re-tags all the user's notes
PLACE_WRITE_LIMIT = ratelimit.limiter("place-write", [(20, 60)])
FOLDER_WRITE_LIMIT = ratelimit.limiter("folder-write", [(20, 60)])
# each drag in the folder list saves the order
FOLDER_ORDER_LIMIT = ratelimit.limiter("folder-order", [(30, 60)])


def _limit_message(what: str, window: int) -> str:
    if window >= 24 * 3600:
        return f"Too many {what} today, try again tomorrow."
    if window >= 3600:
        return f"Too many {what}, try again in an hour."
    return f"Too many {what}, try again in a minute."


def enforce_limit(limit: ratelimit.RateLimiter, user_id: str, what: str):
    """429 with a message the app can show, e.g. "Too many searches, try
    again in a minute." Blocked calls don't do any work."""
    if not ratelimit.enabled():
        return
    blocked = limit.blocked(user_id)
    if blocked:
        retry_after, window = blocked
        message = _limit_message(what, window)
        logging.warning("Rate limited: %s", limit.name)
        raise HTTPException(
            status_code=429,
            detail={"kind": "too_many_requests", "message": message, "retry_after": retry_after},
            headers={"Retry-After": str(retry_after)},
        )


# save note, ingest it, and categorize it
@app.post("/notes/")
def create_note(
    request: NoteRequest,
    authorization: Optional[str] = Header(None),
):
    user_id = require_user_id(authorization)
    enforce_limit(NOTE_WRITE_LIMIT, user_id, "changes")
    _check_remind_date(request.remind_on_date)
    note = Note(
        content=request.content,
        list_name=_note_folder(request.list_name),
        reminders_enabled=request.reminders_enabled,
        category=request.category or "todo",
        category_explicit=request.category_explicit,
        location_explicit=request.location_explicit,
        location_value=request.location_value,
        remind_date_explicit=request.remind_date_explicit,
        remind_time_explicit=request.remind_time_explicit,
        remind_at_hour=request.remind_at_hour,
        remind_at_minute=request.remind_at_minute,
        remind_on_date=request.remind_on_date,
        user_id=user_id,
    )
    save_note(note)
    # the folder stays even after its last note moves out
    ensure_folder(user_id, note.list_name)
    # inline, like PUT: the phone syncs alarms right after saving, so the
    # date/time and place must already be there
    enrich_note(note)
    logging.info("Note created: %s", note.id)
    return {"id": note.id, "content": note.content, "category": note.category}


# get all notes
@app.get("/notes/")
def list_notes(authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization)
    # round-trip through Note so older documents get defaults for fields
    # added later (e.g. reminders_enabled=True) instead of omitting them
    notes = [dict_to_note(d) for d in get_all_notes(user_id=user_id)]
    # tells the phone which times get an exact alarm (explicit/text) and
    # which are location defaults left to the location-aware polling
    return [
        {**note_to_dict(n), "reminder_time_source": reminder_time_source(n), "store_type": store_type(n)}
        for n in notes
    ]


# delete note from MongoDB and ChromaDB
@app.delete("/notes/{note_id}")
def remove_note(
    note_id: str,
    authorization: Optional[str] = Header(None),
):
    user_id = require_user_id(authorization)
    deleted = full_delete(note_id, user_id=user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Note not found")
    logging.info("Note deleted: %s", note_id)
    return {"message": "note deleted"}


def _whole_number(value, name: str, low: int, high: int) -> Optional[int]:
    """None or "" clears; otherwise a whole number in [low, high], or 422."""
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise HTTPException(status_code=422, detail=f"{name} must be a whole number")
    if isinstance(value, str):
        if not re.fullmatch(r"-?\d+", value.strip()):
            raise HTTPException(status_code=422, detail=f"{name} must be a whole number")
        value = int(value.strip())
    if not low <= value <= high:
        raise HTTPException(status_code=422, detail=f"{name} must be between {low} and {high}")
    return value


def _check_remind_date(value: Optional[str]) -> None:
    """A reminder date is YYYY-MM-DD and not a day that has already passed
    (the user's local day), or 422. Empty means none."""
    if not value:
        return
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="remind_on_date must be a date (YYYY-MM-DD)")
    if day < local_now().date():
        raise HTTPException(status_code=422, detail="That date has already passed. Pick today or a later day.")


# fields whose change re-runs the AI enrichment (category, place, time, date)
_REENRICH_FIELDS = {
    "content", "category", "category_explicit", "location_explicit", "location_value",
    "remind_date_explicit", "remind_time_explicit", "remind_at_hour", "remind_at_minute", "remind_on_date",
}


def _note_folder(name) -> str:
    """A note's folder name cleaned like a folder's, or 422 like POST /folders/."""
    try:
        return clean_note_folder(name)
    except FolderError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _note_fields(values: dict) -> dict:
    """The MongoDB fields for the values sent (a JSON body or query
    parameters; only the keys present). Raises 422 for a bad hour/minute
    or folder name."""
    fields = {}
    for key in ("content", "category", "category_explicit", "location_explicit",
                "remind_date_explicit", "remind_time_explicit", "reminders_enabled"):
        if key in values:
            fields[key] = values[key]
    if "list_name" in values:
        fields["list_name"] = _note_folder(values["list_name"])
    if "location_value" in values:
        fields["location_value"] = values["location_value"] or None
    if "contexts" in values:
        raw = values["contexts"]
        items = raw.split(",") if isinstance(raw, str) else (raw or [])
        fields["contexts"] = [c.strip() for c in items if c and c.strip()]
    if "remind_at_hour" in values:
        fields["remind_at_hour"] = _whole_number(values["remind_at_hour"], "remind_at_hour", 0, 23)
    if "remind_at_minute" in values:
        fields["remind_at_minute"] = _whole_number(values["remind_at_minute"], "remind_at_minute", 0, 59)
    if "remind_on_date" in values:
        fields["remind_on_date"] = values["remind_on_date"] or None
    return fields


# update note fields: a JSON body (the app), or query parameters (older app
# versions, which sent the note text in the URL)
@app.put("/notes/{note_id}")
def change_note(
    note_id: str,
    body: Optional[NoteUpdate] = Body(None),
    content: Optional[str] = Query(None, max_length=MAX_NOTE_CHARS),
    list_name: Optional[str] = None,
    category: Optional[str] = None,
    category_explicit: Optional[bool] = None,
    location_explicit: Optional[bool] = None,
    location_value: Optional[str] = None,
    contexts: Optional[str] = None,
    remind_date_explicit: Optional[bool] = None,
    remind_time_explicit: Optional[bool] = None,
    remind_at_hour: Optional[str] = None,
    remind_at_minute: Optional[str] = None,
    remind_on_date: Optional[str] = None,
    reminders_enabled: Optional[bool] = None,
    authorization: Optional[str] = Header(None),
):
    user_id = require_user_id(authorization)
    enforce_limit(NOTE_WRITE_LIMIT, user_id, "changes")
    if body is not None:
        # only the fields sent; an explicit null counts (it clears)
        values = body.model_dump(exclude_unset=True)
    else:
        query = {
            "content": content, "list_name": list_name, "category": category,
            "category_explicit": category_explicit, "location_explicit": location_explicit,
            "location_value": location_value, "contexts": contexts,
            "remind_date_explicit": remind_date_explicit, "remind_time_explicit": remind_time_explicit,
            "remind_at_hour": remind_at_hour, "remind_at_minute": remind_at_minute,
            "remind_on_date": remind_on_date, "reminders_enabled": reminders_enabled,
        }
        values = {k: v for k, v in query.items() if v is not None}
    fields = _note_fields(values)
    if fields.get("remind_on_date"):
        # the edit screen sends the saved date back on every save, so an old
        # note can keep a date that has passed; only a new date is checked
        saved = get_note_by_id(note_id, user_id=user_id)
        if saved and saved.get("remind_on_date") != fields["remind_on_date"]:
            _check_remind_date(fields["remind_on_date"])
    matched = update_note(note_id, fields, user_id=user_id)
    if matched == 0:
        raise HTTPException(status_code=404, detail="Note not found")
    if "list_name" in fields:
        ensure_folder(user_id, fields["list_name"])
    # re-categorize, re-infer context, and re-embed when content changes
    if _REENRICH_FIELDS & values.keys():
        doc = get_note_by_id(note_id, user_id=user_id)
        if doc:
            note = dict_to_note(doc)
            enrich_note(note)
    return {"message": "updated note"}


# get relevant notes based on current context (via semantic pipeline)
@app.get("/reminders/")
def get_reminders_endpoint(
    location: str = "unknown", hour: Optional[int] = None,
    minute: Optional[int] = None,
    authorization: Optional[str] = Header(None),
):
    user_id = require_user_id(authorization)
    # location is a place name or id; search semantically by the name
    place = resolve_place(user_id, location)
    label = place.name if place else location
    query = f"{label} {hour}" if hour is not None else label
    notes = get_reminders(query, location, hour, minute, user_id)
    # the phone uses the source to keep timed notes out of arrival alerts
    return [
        {**note_to_dict(n), "reminder_time_source": reminder_time_source(n), "store_type": store_type(n)}
        for n in notes
    ]


# ---- address search: the phone asks us, we ask OpenStreetMap Nominatim ----

# upstream problem -> our status: 429 passes through, an unreachable or
# slow Nominatim is a gateway timeout, anything else a bad gateway
_GEOCODE_STATUS = {"rate_limited": 429, "network": 504}


@app.get("/places/search")
def search_places(
    q: str = Query(..., max_length=MAX_SEARCH_CHARS),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    authorization: Optional[str] = Header(None),
):
    """Top 5 address matches for q: Google Places when the server has a key
    (biased toward lat/lon if sent), else Nominatim. Coordinates are only
    returned to the phone, never stored here."""
    user_id = require_user_id(authorization)
    enforce_limit(SEARCH_LIMIT, user_id, "searches")
    try:
        return geocode.search(q, lat=lat, lon=lon)
    except geocode.GeocodeError as e:
        logging.warning("Geocode failed: %s", e)
        raise HTTPException(
            status_code=_GEOCODE_STATUS.get(e.kind, 502),
            detail={"kind": e.kind, "upstream_status": e.status},
        )


# ---- nearby stores: the phone asks us, we ask OpenStreetMap Overpass ----

_NEARBY_STATUS = {"rate_limited": 429, "timeout": 504, "network": 504}


@app.get("/places/nearby")
def nearby_stores(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    type: str = "supermarket",
    radius_m: int = Query(2000, ge=100, le=5000),
    authorization: Optional[str] = Header(None),
):
    """Up to 20 stores of this type ({id, name, lat, lon}, nearest first)
    around the phone, for errand alerts. Nothing is stored."""
    user_id = require_user_id(authorization)
    enforce_limit(NEARBY_LIMIT, user_id, "store lookups")
    if type not in nearby.STORE_SELECTORS:
        raise HTTPException(status_code=422, detail=f"type must be one of {sorted(nearby.STORE_SELECTORS)}")
    try:
        return nearby.find(type, lat, lon, radius_m)
    except nearby.NearbyError as e:
        logging.warning("Nearby stores failed: %s", e)
        raise HTTPException(
            status_code=_NEARBY_STATUS.get(e.kind, 502),
            detail={"kind": e.kind, "upstream_status": e.status},
        )


# ---- pasted Google Maps links: the phone asks us to follow short links ----

_LINK_STATUS = {"not_allowed": 422, "no_coordinates": 422, "network": 504}


@app.get("/places/resolve-link")
def resolve_maps_link(url: str, authorization: Optional[str] = Header(None)):
    """Coordinates of a Google Maps link (short maps.app.goo.gl links are
    followed, Google hosts only). A link with only a place's name or address
    is looked up by address search. Nothing is stored."""
    user_id = require_user_id(authorization)
    enforce_limit(LINK_LIMIT, user_id, "links")
    try:
        lat, lon = maps_links.resolve(url)
    except maps_links.LinkError as e:
        if e.kind == "no_coordinates" and e.place_text:
            return _place_from_text(e.place_text)
        logging.warning("Maps link failed: %s", e.kind)
        raise HTTPException(status_code=_LINK_STATUS.get(e.kind, 502), detail={"kind": e.kind})
    return {"latitude": lat, "longitude": lon}


def _place_from_text(text: str) -> dict:
    """The first address search match for a link's place name or address."""
    try:
        results = geocode.search(text)
    except geocode.GeocodeError as e:
        logging.warning("Maps link place search failed: %s", e)
        raise HTTPException(status_code=_GEOCODE_STATUS.get(e.kind, 502), detail={"kind": e.kind})
    if not results:
        raise HTTPException(status_code=422, detail={"kind": "no_coordinates"})
    return {"latitude": results[0]["latitude"], "longitude": results[0]["longitude"]}


# ---- places: names (and optional keywords) only; coordinates stay on the phone ----

class PlaceRequest(BaseModel):
    name: str
    keywords: list[str] = []


class PlaceUpdate(BaseModel):
    name: Optional[str] = None
    keywords: Optional[list[str]] = None


@app.get("/places/")
def list_places(authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization)
    return [place_to_dict(p) for p in get_places(user_id)]


@app.post("/places/")
def add_place(request: PlaceRequest, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization)
    enforce_limit(PLACE_WRITE_LIMIT, user_id, "place changes")
    try:
        place = create_place(user_id, request.name, request.keywords)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    # existing notes may belong to the new place
    reenrich_user_notes(user_id)
    return place_to_dict(place)


@app.put("/places/{place_id}")
def change_place(
    place_id: str, request: PlaceUpdate,
    authorization: Optional[str] = Header(None),
):
    user_id = require_user_id(authorization)
    enforce_limit(PLACE_WRITE_LIMIT, user_id, "place changes")
    try:
        found = update_place(user_id, place_id, request.name, request.keywords)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if not found:
        raise HTTPException(status_code=404, detail="Place not found")
    # notes are tagged by id, so a rename changes nothing; new keywords may
    if request.keywords is not None:
        reenrich_user_notes(user_id)
    return place_to_dict(resolve_place(user_id, place_id))


@app.delete("/places/{place_id}")
def remove_place(place_id: str, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization)
    enforce_limit(PLACE_WRITE_LIMIT, user_id, "place changes")
    if not delete_place(user_id, place_id):
        raise HTTPException(status_code=404, detail="Place not found")
    untag_place(user_id, place_id)
    return {"message": "place deleted"}


# ---- note folders: kept until the user deletes them ----

class FolderRequest(BaseModel):
    name: str = Field(..., max_length=200)


@app.get("/folders/")
def get_folders(authorization: Optional[str] = Header(None)):
    """The user's folders (General is implicit) in their order, including empty ones."""
    user_id = require_user_id(authorization)
    return [{"name": name} for name in list_folders(user_id)]


@app.post("/folders/")
def add_folder(request: FolderRequest, authorization: Optional[str] = Header(None)):
    user_id = require_user_id(authorization)
    enforce_limit(FOLDER_WRITE_LIMIT, user_id, "folder changes")
    try:
        return {"name": create_folder(user_id, request.name)}
    except FolderError as e:
        raise HTTPException(status_code=409 if e.kind == "exists" else 422, detail=str(e))


class FolderOrderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    names: List[Annotated[StrictStr, Field(max_length=200)]] = Field(..., max_length=500)


@app.put("/folders/order")
def save_folder_order(request: FolderOrderRequest, authorization: Optional[str] = Header(None)):
    """Save the user's folder order (General stays first on the phone)."""
    user_id = require_user_id(authorization)
    enforce_limit(FOLDER_ORDER_LIMIT, user_id, "folder order changes")
    return [{"name": name} for name in set_folder_order(user_id, request.names)]


@app.delete("/folders/{name}")
def remove_folder(name: str, authorization: Optional[str] = Header(None)):
    """Delete the folder; its notes move to General. Safe to repeat."""
    user_id = require_user_id(authorization)
    enforce_limit(FOLDER_WRITE_LIMIT, user_id, "folder changes")
    return delete_folder(user_id, name)


# ---- account deletion (required by Google Play) ----

@app.delete("/account")
def delete_account(authorization: Optional[str] = Header(None)):
    """Delete everything of the signed-in user (notes with their feedback,
    places, vectors), then the Firebase user. Safe to repeat: data first, so
    if Firebase fails the data is already gone and a retry finishes the job."""
    user_id = require_user_id(authorization)
    enforce_limit(ACCOUNT_DELETE_LIMIT, user_id, "attempts")
    deleted = delete_user_data(user_id)
    try:
        firebase_user = delete_firebase_user(user_id)
    except FirebaseDeleteError as e:
        logging.warning("Deleting the Firebase user failed: %s", e)
        raise HTTPException(status_code=502, detail={"kind": "firebase", "deleted": deleted})
    logging.info("Account deleted (firebase: %s)", firebase_user)
    return {"deleted": deleted, "firebase_user": firebase_user}


# submit feedback on a note
@app.post("/notes/{note_id}/feedback")
def feedback(
    note_id: str,
    action: str,
    authorization: Optional[str] = Header(None),
):
    user_id = require_user_id(authorization)
    if action not in FEEDBACK_ACTIONS:
        raise HTTPException(status_code=422, detail=f"action must be one of {list(FEEDBACK_ACTIONS)}")
    doc = get_note_by_id(note_id, user_id=user_id)
    if doc is None:
        raise HTTPException(status_code=404, detail="Note not found")
    note = dict_to_note(doc)
    process_feedback(note, action)
    logging.info("Feedback '%s' on note %s", action, note_id)
    return {"message": f"feedback '{action}' applied"}
