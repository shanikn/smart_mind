"""Coordinates from pasted text and Google Maps links.

Full links carry the coordinates in the URL (!3d..!4d.. for a place's pin,
@lat,lon for the map's center, or q=/query=/ll=). Short share links
(maps.app.goo.gl) only redirect to such a URL, so the server follows the
redirects for the phone.

Newer share links of a named place or address often carry no coordinates
at all (/maps/place/<name>/data=!...!1s0x..:0x.. or ?q=<address>&ftid=..).
Then the place's text is returned with the error, and the endpoint looks it
up by address search instead.

Following user-supplied URLs is a server-side request forgery risk, so:
https only, only Google Maps hosts, every redirect hop checked before it's
requested, HEAD requests (no page content is read), a few hops at most.
"""
import re
import socket
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.parse import unquote, unquote_plus, urljoin, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

USER_AGENT = "SmartMind/1.0 (university project; contextmind-api.azurewebsites.net)"
TIMEOUT_SECONDS = 8
MAX_HOPS = 5

_SHORT_HOSTS = {"maps.app.goo.gl", "goo.gl"}
# google.com, google.co.il, www./maps./consent. variants
_GOOGLE_HOST = re.compile(r"^(www\.|maps\.|consent\.)?google\.(com|[a-z]{2}|com?\.[a-z]{2})$")

_NUM = r"(-?\d{1,3}(?:\.\d+)?)"
_PIN = re.compile(r"!3d" + _NUM + r"!4d" + _NUM)  # a place's pin
_QUERY = re.compile(r"[?&](?:q|query|ll|sll|destination|center)=" + _NUM + r"\s*,\s*\+?" + _NUM + r"(?![\d.])")
_AT = re.compile(r"@" + _NUM + r"," + _NUM + r"(?![\d.])")  # the map's center
_PLAIN = re.compile(r"^\s*" + _NUM + r"\s*[,\s]\s*" + _NUM + r"\s*$")
_PLACE_NAME = re.compile(r"/maps/place/([^/?#&]+)")
_QUERY_TEXT = re.compile(r"[?&](?:q|query|destination)=([^&#]+)")
MAX_PLACE_TEXT = 200


class LinkError(Exception):
    """kind: not_allowed | no_coordinates | network | http. A no_coordinates
    error may carry place_text: the place's name or address from the link."""

    def __init__(self, kind: str, detail: str = "", place_text: Optional[str] = None):
        super().__init__(f"{kind} {detail}".strip())
        self.kind = kind
        self.detail = detail
        self.place_text = place_text


def _valid(lat: float, lon: float) -> bool:
    return -90 <= lat <= 90 and -180 <= lon <= 180


def coordinates_from_text(text: str) -> Optional[tuple]:
    """(lat, lon) from "lat, lon" or a full Google Maps link, else None."""
    if not text:
        return None
    # links can be encoded twice (the consent page wraps the real link)
    decoded = unquote(unquote(text.strip()))
    for pattern, last in ((_PIN, True), (_QUERY, False), (_AT, False), (_PLAIN, False)):
        matches = list(pattern.finditer(decoded))
        if not matches:
            continue
        m = matches[-1] if last else matches[0]
        lat, lon = float(m.group(1)), float(m.group(2))
        return (lat, lon) if _valid(lat, lon) else None
    return None


def place_text_from_link(url: str) -> Optional[str]:
    """The place's name or address in a Google Maps link without coordinates
    ("/maps/place/Azrieli+Center/..." or "?q=Rothschild+10,+Tel+Aviv"), else None."""
    decoded = unquote(url or "")  # the consent page wraps the real link once
    for pattern in (_PLACE_NAME, _QUERY_TEXT):
        m = pattern.search(decoded)
        if m:
            text = " ".join(unquote_plus(m.group(1)).split())[:MAX_PLACE_TEXT]
            if text and not _PLAIN.match(text):
                return text
    return None


def is_allowed(url: str) -> bool:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or parsed.port not in (None, 443):
        return False
    if host == "maps.app.goo.gl":
        return True
    if host == "goo.gl":
        return parsed.path.startswith("/maps")
    return bool(_GOOGLE_HOST.match(host))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # we check each hop ourselves


_opener = build_opener(_NoRedirect)


def _next_location(url: str) -> Optional[str]:
    """The redirect target of one request, or None when there's no redirect."""
    for method in ("HEAD", "GET"):
        request = Request(url, method=method, headers={"User-Agent": USER_AGENT})
        try:
            with _opener.open(request, timeout=TIMEOUT_SECONDS):
                return None  # not a redirect; the body isn't read
        except HTTPError as e:
            if 300 <= e.code < 400:
                return e.headers.get("Location")
            if e.code == 405 and method == "HEAD":
                continue  # some servers don't answer HEAD
            raise LinkError("http", str(e.code))
        except (URLError, socket.timeout, TimeoutError, OSError) as e:
            raise LinkError("network", str(getattr(e, "reason", e)))
    return None


def resolve(url: str) -> tuple:
    """(lat, lon) for a Google Maps link, following short-link redirects.
    Raises LinkError."""
    url = (url or "").strip()
    if not is_allowed(url):
        raise LinkError("not_allowed", "only https Google Maps links")
    coords = coordinates_from_text(url)
    if coords:
        return coords
    seen = set()
    current = url
    place_text = place_text_from_link(url)
    for _ in range(MAX_HOPS):
        if current in seen:
            break
        seen.add(current)
        location = _next_location(current)
        if not location:
            break
        location = urljoin(current, location)
        coords = coordinates_from_text(location)
        if coords:
            return coords
        if not is_allowed(location):
            raise LinkError("not_allowed", "redirected outside Google Maps")
        place_text = place_text_from_link(location) or place_text
        current = location
    raise LinkError("no_coordinates", "the link has no coordinates", place_text=place_text)
