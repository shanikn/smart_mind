"""Dates in notes ("today", "tomorrow") and the "now" used for reminders
follow the users' local time, not the server's clock (UTC on Azure)."""
from datetime import datetime, timezone

import pytest

import agents.clock as clock
import agents.pipeline as pipeline
from agents.context import get_time_bucket
from agents.relevance import get_relevant_notes
from notepad import Note, save_note
from places import get_places
from tests.support import delete_any, note_doc

# 22:30 UTC on Oct 6 is 01:30 on Oct 7 in Israel (UTC+3)
FROZEN_UTC = datetime(2026, 10, 6, 22, 30, tzinfo=timezone.utc)


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return FROZEN_UTC.astimezone(tz) if tz else FROZEN_UTC.replace(tzinfo=None)


@pytest.fixture
def frozen(monkeypatch):
    monkeypatch.setattr(clock, "datetime", _Frozen)
    monkeypatch.delenv("APP_TIMEZONE", raising=False)  # the default: Asia/Jerusalem
    created = []
    yield created
    for note_id in created:
        delete_any(note_id)


# ---- dates written in notes (enrichment) ----

def _enrich(frozen, content):
    note = Note(content=content, user_id="tz-user")
    save_note(note)
    frozen.append(note.id)
    pipeline.enrich_note(note)
    return note_doc(note.id)


def test_tomorrow_after_midnight_in_israel_while_utc_is_still_yesterday(frozen):
    assert _enrich(frozen, "call mom tomorrow")["remind_on_date"] == "2026-10-08"


def test_today_is_the_local_day(frozen):
    assert _enrich(frozen, "call mom today")["remind_on_date"] == "2026-10-07"


def test_app_timezone_setting(frozen, monkeypatch):
    monkeypatch.setenv("APP_TIMEZONE", "UTC")
    assert _enrich(frozen, "call mom tomorrow")["remind_on_date"] == "2026-10-07"


# ---- the clock ----

def test_local_now_is_naive_local_time(frozen):
    now = clock.local_now()
    assert now.tzinfo is None
    assert (now.year, now.month, now.day, now.hour, now.minute) == (2026, 10, 7, 1, 30)


def test_pipeline_uses_the_same_clock():
    assert pipeline.local_now is clock.local_now


def test_unknown_timezone_falls_back_to_the_default(frozen, monkeypatch, caplog):
    monkeypatch.setenv("APP_TIMEZONE", "Mars/Olympus_Mons")
    assert clock.local_now().hour == 1  # Asia/Jerusalem
    assert "APP_TIMEZONE" in caplog.text


def test_tzdata_is_a_requirement():
    import pathlib
    root = pathlib.Path(__file__).resolve().parents[1]
    lines = [ln.strip().lower() for ln in (root / "requirements.txt").read_text().splitlines()]
    assert any(ln.startswith("tzdata") for ln in lines)  # zoneinfo needs it in the slim Docker image (and on Windows)


# ---- "today" and the current hour for reminders ----

def _dated_note(frozen, content, date, place_id, user):
    note = Note(content=content, user_id=user, contexts=[place_id], remind_on_date=date)
    save_note(note)
    frozen.append(note.id)
    return note.id


def test_reminders_use_the_local_day(frozen):
    user = "tz-reminders-user"
    home = next(p for p in get_places(user) if p.kind == "home")
    today = _dated_note(frozen, "dated local today", "2026-10-07", home.id, user)
    yesterday = _dated_note(frozen, "dated local yesterday (UTC's today)", "2026-10-06", home.id, user)
    found = {n.id for n in get_relevant_notes("home", home.id, user_id=user)}
    assert today in found
    assert yesterday not in found


def test_reminders_fall_back_to_the_local_hour(frozen):
    user = "tz-hour-user"
    home = next(p for p in get_places(user) if p.kind == "home")
    near = Note(content="at 01:45 local", user_id=user, contexts=[home.id, "01:45"])
    far = Note(content="at 22:45 (the UTC hour)", user_id=user, contexts=[home.id, "22:45"])
    for n in (far, near):
        save_note(n)
        frozen.append(n.id)
    # no hour sent: ranked by the local hour (01:30), so the 01:45 note gets the time bonus
    ranked = [n.id for n in get_relevant_notes("home", home.id, user_id=user)]
    assert ranked.index(near.id) < ranked.index(far.id)


class _NoonInIsrael(datetime):
    @classmethod
    def now(cls, tz=None):
        utc = datetime(2026, 10, 7, 9, 30, tzinfo=timezone.utc)  # 12:30 in Israel
        return utc.astimezone(tz) if tz else utc.replace(tzinfo=None)


def test_time_bucket_falls_back_to_the_local_hour(frozen, monkeypatch):
    assert get_time_bucket() == "night"  # 01:30 local (22:30 UTC would also be night)
    monkeypatch.setattr(clock, "datetime", _NoonInIsrael)
    assert get_time_bucket() == "noon"  # by UTC (09:30) it would be "morning"
