"""Address search proxy for the app, backed by OpenStreetMap Nominatim.

The phone asks our backend, and the backend asks Nominatim, following its
usage policy (https://operations.osmfoundation.org/policies/nominatim/):
an identifying User-Agent, at most one request per second for the whole
server, and a short cache of repeated queries.
"""
import json
import logging
import os
import re
import threading
import time
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

SEARCH_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "SmartMind/1.0 (university project; contextmind-api.azurewebsites.net)"
MAX_RESULTS = 5
# labels in Hebrew where OSM has them, else English
ACCEPT_LANGUAGE = "he,en"
# extra, looser queries tried when an English search finds nothing
MAX_VARIANT_TRIES = 3
TIMEOUT_SECONDS = 10
MIN_INTERVAL_SECONDS = 1.0
CACHE_TTL_SECONDS = 10 * 60
CACHE_MAX_ENTRIES = 500

# invisible bidi control characters a Hebrew keyboard or copied RTL text adds
_BIDI_CONTROLS = re.compile("[\u200e\u200f\u202a-\u202e\u2066-\u2069]")

_lock = threading.Lock()
_last_request = float("-inf")
_cache: dict = {}  # cleaned lowercase query -> (stored_at, results)

# indirection so tests can fake time
_now = time.monotonic
_sleep = time.sleep


class GeocodeError(Exception):
    """kind: blocked (403) | rate_limited (429) | http | network | bad_response"""

    def __init__(self, kind: str, status: Optional[int] = None, detail: str = ""):
        super().__init__(f"{kind} {status or ''} {detail}".strip())
        self.kind = kind
        self.status = status
        self.detail = detail


def clean_query(query: str) -> str:
    return " ".join(_BIDI_CONTROLS.sub("", query).split())


def clear_cache():
    global _last_request
    with _lock:
        _cache.clear()
        _last_request = float("-inf")


def _parse(raw) -> list:
    results = []
    if not isinstance(raw, list):
        return results
    for item in raw:
        try:
            lat, lon = float(item["lat"]), float(item["lon"])
            label = item["display_name"]
        except (KeyError, TypeError, ValueError):
            continue
        if isinstance(label, str) and abs(lat) <= 90 and abs(lon) <= 180:
            results.append({"label": label, "latitude": lat, "longitude": lon})
    return results[:MAX_RESULTS]


def _fetch(query: str) -> list:
    params = {"q": query, "format": "jsonv2", "limit": MAX_RESULTS, "accept-language": ACCEPT_LANGUAGE}
    url = f"{SEARCH_URL}?{urlencode(params)}"
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read()
    except HTTPError as e:
        kind = {403: "blocked", 429: "rate_limited"}.get(e.code, "http")
        raise GeocodeError(kind, e.code)
    except (URLError, TimeoutError, OSError) as e:
        raise GeocodeError("network", detail=str(getattr(e, "reason", e)))
    try:
        return _parse(json.loads(body))
    except ValueError:
        raise GeocodeError("bad_response")


_HEBREW = re.compile("[%s-%s]" % (chr(0x0590), chr(0x05FF)))  # the Hebrew block
_LATIN = re.compile("[A-Za-z]")
_COORDINATES = re.compile(r"^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$")
# s or z between vowels: Rozen / Rosen, Weizman / Weisman
_S_OR_Z = re.compile(r"(?<=[aeiou])[sz](?=[aeiou])", re.IGNORECASE)


_S_Z_SWAP = {"s": "z", "z": "s", "S": "Z", "Z": "S"}


def _swap_s_z(text: str) -> str:
    return _S_OR_Z.sub(lambda m: _S_Z_SWAP[m.group(0)], text)


def _drop_first_name(street: str) -> str:
    """'Pinchas Rozen 72' -> 'Rozen 72': streets named after people are often
    known by the surname only. Needs two or more words before the number."""
    words = street.split(" ")
    names = []
    for w in words:
        if any(ch.isdigit() for ch in w):
            break
        names.append(w)
    if len(names) < 2:
        return street
    return " ".join(words[1:])


def query_variants(query: str) -> list:
    """Looser versions of an English address query, most likely first:
    other s/z spelling, then without the first name, then both. Only the
    street part (before the first comma) changes. Hebrew and coordinates
    aren't loosened."""
    if _HEBREW.search(query) or not _LATIN.search(query) or _COORDINATES.match(query):
        return []
    street, comma, rest = query.partition(",")
    street = street.strip()
    tail = f",{rest}" if comma else ""
    without_first = _drop_first_name(street)
    candidates = [_swap_s_z(street), without_first, _swap_s_z(without_first)]
    variants = []
    for c in candidates:
        v = f"{c}{tail}"
        if c and v != query and v not in variants:
            variants.append(v)
    return variants


def _lookup(cleaned: str) -> list:
    global _last_request
    key = cleaned.lower()
    with _lock:
        hit = _cache.get(key)
        if hit and _now() - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
        # one upstream request per second across all users
        wait = _last_request + MIN_INTERVAL_SECONDS - _now()
        if wait > 0:
            _sleep(wait)
        _last_request = _now()
        results = _fetch(cleaned)
        _remember(key, results)
        return results


def _remember(key: str, results: list):
    if key not in _cache and len(_cache) >= CACHE_MAX_ENTRIES:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (_now(), results)


# ---- Google Places API (New) Text Search, when GOOGLE_MAPS_API_KEY is set ----
#
# The key is read from the environment on each search, sent only in a request
# header to Google, and never logged or returned to the phone.

GOOGLE_URL = "https://places.googleapis.com/v1/places:searchText"
GOOGLE_FIELD_MASK = "places.displayName,places.formattedAddress,places.location"
GOOGLE_BIAS_RADIUS_M = 30000.0  # prefer results within ~30 km of the user (Google allows up to 50 km)
GOOGLE_TIMEOUT_SECONDS = 8


class _GoogleFailed(Exception):
    def __init__(self, kind: str, status: Optional[int] = None):
        super().__init__(kind)
        self.kind = kind
        self.status = status


def _google_key() -> str:
    return os.getenv("GOOGLE_MAPS_API_KEY", "").strip()


def _google_label(place: dict) -> str:
    name = ((place.get("displayName") or {}).get("text") or "").strip()
    address = (place.get("formattedAddress") or "").strip()
    if name and address and name not in address:
        return f"{name}, {address}"
    return address or name


def _parse_google(raw) -> list:
    if not isinstance(raw, dict) or not isinstance(raw.get("places", []), list):
        raise _GoogleFailed("bad_response")
    results = []
    for place in raw.get("places", []):
        try:
            loc = place["location"]
            lat, lon = float(loc["latitude"]), float(loc["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        label = _google_label(place)
        if label and abs(lat) <= 90 and abs(lon) <= 180:
            results.append({"label": label, "latitude": lat, "longitude": lon})
    return results[:MAX_RESULTS]


def _fetch_google(query: str, lat: Optional[float], lon: Optional[float], key: str) -> list:
    body = {"textQuery": query, "languageCode": "he", "regionCode": "IL", "pageSize": MAX_RESULTS}
    if lat is not None and lon is not None:
        body["locationBias"] = {
            "circle": {"center": {"latitude": lat, "longitude": lon}, "radius": GOOGLE_BIAS_RADIUS_M}
        }
    request = Request(
        GOOGLE_URL,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Goog-Api-Key": key,
            "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
        },
    )
    try:
        with urlopen(request, timeout=GOOGLE_TIMEOUT_SECONDS) as response:
            raw = response.read()
    except HTTPError as e:
        raise _GoogleFailed("http", e.code)
    except (URLError, TimeoutError, OSError):
        raise _GoogleFailed("network")
    try:
        return _parse_google(json.loads(raw))
    except ValueError:
        raise _GoogleFailed("bad_response")


def _google_lookup(cleaned: str, lat: Optional[float], lon: Optional[float], key: str) -> list:
    # the same words near the same spot (~1 km) give the same answer
    area = (round(lat, 2), round(lon, 2)) if lat is not None and lon is not None else None
    cache_key = ("google", cleaned.lower(), area)
    with _lock:
        hit = _cache.get(cache_key)
        if hit and _now() - hit[0] < CACHE_TTL_SECONDS:
            return hit[1]
    results = _fetch_google(cleaned, lat, lon, key)
    with _lock:
        _remember(cache_key, results)
    return results


def search(query: str, lat: Optional[float] = None, lon: Optional[float] = None) -> list:
    """Up to 5 results as {label, latitude, longitude}.

    With GOOGLE_MAPS_API_KEY set, Google Places Text Search answers first
    (Hebrew, Israel, biased toward lat/lon when given); if it fails or finds
    nothing, Nominatim does. "lat,lon" lookups always go to Nominatim, which
    answers them with the nearest address. An English query Nominatim can't
    find is retried with up to MAX_VARIANT_TRIES looser variants.
    Raises GeocodeError (Nominatim's)."""
    cleaned = clean_query(query)
    if not cleaned:
        return []
    key = _google_key()
    if key and not _COORDINATES.match(cleaned):
        try:
            results = _google_lookup(cleaned, lat, lon, key)
            if results:
                return results
        except _GoogleFailed as e:
            logger.warning("Google Places search failed (%s %s); using Nominatim", e.kind, e.status or "")
    results = _lookup(cleaned)
    if results:
        return results
    for variant in query_variants(cleaned)[:MAX_VARIANT_TRIES]:
        results = _lookup(variant)
        if results:
            with _lock:
                _remember(cleaned.lower(), results)  # the original query answers from the cache next time
            return results
    return []
