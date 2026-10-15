"""Per-user rate limits (in memory, one server instance)."""
import pytest
from fastapi.testclient import TestClient

import api.main as main
import ratelimit
from ratelimit import RateLimiter

client = TestClient(main.app)
TOKENS = {"Bearer token-a": "rl-user-a", "Bearer token-b": "rl-user-b"}
AS_A = {"Authorization": "Bearer token-a"}
AS_B = {"Authorization": "Bearer token-b"}


# ---- the limiter ----

def test_allows_up_to_the_limit_then_blocks_until_the_window_slides():
    now = [1000.0]
    limiter = RateLimiter("x", [(3, 60)], clock=lambda: now[0])
    assert [limiter.check("u") for _ in range(3)] == [None, None, None]
    assert limiter.check("u") == 60  # seconds until a slot frees up
    now[0] += 30
    assert limiter.check("u") == 30
    now[0] += 30
    assert limiter.check("u") is None


def test_users_are_counted_separately():
    limiter = RateLimiter("x", [(1, 60)], clock=lambda: 0.0)
    assert limiter.check("a") is None
    assert limiter.check("a") is not None
    assert limiter.check("b") is None


def test_every_rule_applies_and_blocked_calls_dont_count():
    now = [0.0]
    limiter = RateLimiter("x", [(2, 60), (3, 86400)], clock=lambda: now[0])
    assert limiter.check("u") is None
    assert limiter.check("u") is None
    assert limiter.check("u") is not None  # per minute
    now[0] += 61
    assert limiter.check("u") is None  # 3rd of the day
    now[0] += 61
    retry = limiter.check("u")  # the day is full
    assert retry is not None and retry > 3600
    now[0] += 86400
    assert limiter.check("u") is None


# ---- the endpoints ----

@pytest.fixture
def limits_on(monkeypatch):
    monkeypatch.setenv("RATE_LIMITS", "on")
    monkeypatch.setattr(main, "get_user_id", lambda authorization: TOKENS.get(authorization))
    now = [5000.0]
    monkeypatch.setattr(ratelimit, "_clock", lambda: now[0])
    ratelimit.reset_all()
    yield now
    ratelimit.reset_all()


def _hit(n, call):
    return [call().status_code for _ in range(n)]


def test_search_30_a_minute_then_429_with_a_clear_message(limits_on, monkeypatch):
    calls = []
    monkeypatch.setattr(main.geocode, "search", lambda q, lat=None, lon=None: calls.append(q) or [])
    assert set(_hit(30, lambda: client.get("/places/search", params={"q": "x"}, headers=AS_A))) == {200}
    res = client.get("/places/search", params={"q": "x"}, headers=AS_A)
    assert res.status_code == 429
    assert res.json()["detail"]["kind"] == "too_many_requests"
    assert res.json()["detail"]["message"] == "Too many searches, try again in a minute."
    assert int(res.headers["Retry-After"]) > 0
    assert len(calls) == 30  # the blocked one didn't reach Google/Nominatim
    # another user isn't affected
    assert client.get("/places/search", params={"q": "x"}, headers=AS_B).status_code == 200


def test_search_300_a_day(limits_on, monkeypatch):
    monkeypatch.setattr(main.geocode, "search", lambda q, lat=None, lon=None: [])
    for _ in range(10):
        assert set(_hit(30, lambda: client.get("/places/search", params={"q": "x"}, headers=AS_A))) == {200}
        limits_on[0] += 61
    res = client.get("/places/search", params={"q": "x"}, headers=AS_A)
    assert res.status_code == 429
    assert res.json()["detail"]["message"] == "Too many searches today, try again tomorrow."


@pytest.mark.parametrize("path, params, patch", [
    ("/places/nearby", {"lat": 32.1, "lon": 34.8}, ("nearby", "find", lambda *a, **k: [])),
    ("/places/resolve-link", {"url": "https://maps.app.goo.gl/x"}, ("maps_links", "resolve", lambda url: (32.1, 34.8))),
])
def test_nearby_and_links_30_a_minute(limits_on, monkeypatch, path, params, patch):
    module, name, fake = patch
    monkeypatch.setattr(getattr(main, module), name, fake)
    assert set(_hit(30, lambda: client.get(path, params=params, headers=AS_A))) == {200}
    assert client.get(path, params=params, headers=AS_A).status_code == 429


def test_nearby_and_links_are_separate_budgets(limits_on, monkeypatch):
    monkeypatch.setattr(main.nearby, "find", lambda *a, **k: [])
    monkeypatch.setattr(main.maps_links, "resolve", lambda url: (32.1, 34.8))
    _hit(30, lambda: client.get("/places/nearby", params={"lat": 32.1, "lon": 34.8}, headers=AS_A))
    res = client.get("/places/resolve-link", params={"url": "https://maps.app.goo.gl/x"}, headers=AS_A)
    assert res.status_code == 200


def test_note_create_and_update_60_a_minute_together(limits_on, monkeypatch):
    monkeypatch.setattr(main, "save_note", lambda note: None)
    monkeypatch.setattr(main, "enrich_note", lambda note: None)
    monkeypatch.setattr(main, "update_note", lambda *a, **k: 1)
    monkeypatch.setattr(main, "get_note_by_id", lambda *a, **k: None)
    statuses = _hit(40, lambda: client.post("/notes/", json={"content": "x"}, headers=AS_A))
    statuses += _hit(20, lambda: client.put("/notes/n1", params={"list_name": "Uni"}, headers=AS_A))
    assert set(statuses) == {200}
    assert client.post("/notes/", json={"content": "x"}, headers=AS_A).status_code == 429
    assert client.put("/notes/n1", params={"list_name": "Uni"}, headers=AS_A).status_code == 429
    # reading isn't limited
    monkeypatch.setattr(main, "get_all_notes", lambda user_id: [])
    assert client.get("/notes/", headers=AS_A).status_code == 200


def test_account_deletion_3_an_hour(limits_on, monkeypatch):
    monkeypatch.setattr(main, "delete_user_data", lambda uid: {"notes": 0, "places": 0, "vectors": 0})
    monkeypatch.setattr(main, "delete_firebase_user", lambda uid: "deleted")
    assert set(_hit(3, lambda: client.delete("/account", headers=AS_A))) == {200}
    res = client.delete("/account", headers=AS_A)
    assert res.status_code == 429
    limits_on[0] += 3601
    assert client.delete("/account", headers=AS_A).status_code == 200


def test_unauthenticated_calls_dont_use_anyones_budget(limits_on, monkeypatch):
    monkeypatch.setattr(main.geocode, "search", lambda q, lat=None, lon=None: [])
    assert set(_hit(40, lambda: client.get("/places/search", params={"q": "x"}))) == {401}
    assert client.get("/places/search", params={"q": "x"}, headers=AS_A).status_code == 200


def test_off_for_the_rest_of_the_test_suite():
    import os
    assert os.environ.get("RATE_LIMITS") == "off"  # set by conftest; the fixture above turns it on


def test_place_changes_20_a_minute_together(limits_on, monkeypatch):
    from places import Place
    place = Place(id="p1", user_id="rl-user-a", name="Gym")
    monkeypatch.setattr(main, "create_place", lambda user_id, name, keywords: place)
    monkeypatch.setattr(main, "update_place", lambda *a, **k: True)
    monkeypatch.setattr(main, "resolve_place", lambda *a, **k: place)
    monkeypatch.setattr(main, "delete_place", lambda *a, **k: True)
    monkeypatch.setattr(main, "reenrich_user_notes", lambda user_id: None)
    monkeypatch.setattr(main, "untag_place", lambda *a, **k: None)
    statuses = _hit(10, lambda: client.post("/places/", json={"name": "Gym"}, headers=AS_A))
    statuses += _hit(5, lambda: client.put("/places/p1", json={"name": "Gym 2"}, headers=AS_A))
    statuses += _hit(5, lambda: client.delete("/places/p1", headers=AS_A))
    assert set(statuses) == {200}
    res = client.post("/places/", json={"name": "Gym"}, headers=AS_A)
    assert res.status_code == 429
    assert res.json()["detail"]["message"] == "Too many place changes, try again in a minute."
    assert client.delete("/places/p1", headers=AS_A).status_code == 429
    # listing places isn't limited, and another user has their own budget
    monkeypatch.setattr(main, "get_places", lambda user_id: [])
    assert client.get("/places/", headers=AS_A).status_code == 200
    assert client.post("/places/", json={"name": "Gym"}, headers=AS_B).status_code == 200


def test_folder_changes_20_a_minute(limits_on, monkeypatch):
    monkeypatch.setattr(main, "create_folder", lambda user_id, name: name)
    monkeypatch.setattr(main, "delete_folder", lambda user_id, name: {"deleted": True, "moved": 0})
    statuses = _hit(10, lambda: client.post("/folders/", json={"name": "Games"}, headers=AS_A))
    statuses += _hit(10, lambda: client.delete("/folders/Games", headers=AS_A))
    assert set(statuses) == {200}
    res = client.post("/folders/", json={"name": "Games"}, headers=AS_A)
    assert res.status_code == 429
    assert res.json()["detail"]["message"] == "Too many folder changes, try again in a minute."


def test_saving_the_folder_order_30_a_minute(limits_on, monkeypatch):
    monkeypatch.setattr(main, "set_folder_order", lambda user_id, names: names)
    statuses = _hit(30, lambda: client.put("/folders/order", json={"names": ["Games"]}, headers=AS_A))
    assert set(statuses) == {200}
    res = client.put("/folders/order", json={"names": ["Games"]}, headers=AS_A)
    assert res.status_code == 429
    assert res.json()["detail"]["message"] == "Too many folder order changes, try again in a minute."
