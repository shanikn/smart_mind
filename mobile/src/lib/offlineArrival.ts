import { Note } from "../types/notes";
import { canAlert } from "./alertRules";
import { arriveFirst } from "./arrivalNotes";
import { UNKNOWN } from "./userPlaces";

// The server's choice of notes for a place (agents/relevance.py, the place
// branch), done on the phone from the notes saved at the last sync, for
// when the server can't be reached. Without the server there's no
// meaning-based matching, so only notes tagged with the place count.
// Like the server: notes about arriving first and never cut, others fill up
// to 3, best score first and newest first on equal scores.

export const MAX_OFFLINE_REMINDERS = 3;
const TIME_BONUS_MINUTES = 60;

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// the server stores times in UTC and may send them without a zone
function serverTime(value: string): number {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`).getTime();
}

function isSnoozed(note: Note, now: Date): boolean {
  if (!note.cooldown_until) {
    return false;
  }
  const until = serverTime(note.cooldown_until);
  return !Number.isNaN(until) && until > now.getTime();
}

// when the note was created; the oldest possible when unknown
function createdTime(note: Note): number {
  const time = note.created_at ? serverTime(note.created_at) : NaN;
  return Number.isNaN(time) ? -Infinity : time;
}

function score(note: Note): number {
  return (note.useful_count ?? 0) - (note.dismissed_count ?? 0) * 0.5;
}

// +2 when one of the note's times is within an hour of now, like the server
function timeBonus(note: Note, now: Date): number {
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  for (const item of note.contexts ?? []) {
    const m = typeof item === "string" ? item.match(/^(\d{2}):(\d{2})$/) : null;
    if (m && Math.abs(Number(m[1]) * 60 + Number(m[2]) - nowMinutes) <= TIME_BONUS_MINUTES) {
      return 2;
    }
  }
  return 0;
}

export function offlineReminders(notes: Note[], location: string, now: Date): Note[] {
  if (!location || location === UNKNOWN) {
    return [];
  }
  const today = localDay(now);
  const ranked = notes
    .filter(
      (n) =>
        (n.contexts ?? []).includes(location) &&
        canAlert(n) &&
        !n.never_show &&
        !isSnoozed(n, now) &&
        (n.remind_on_date == null || n.remind_on_date === today)
    )
    .map((n, i) => ({ n, i, rank: score(n) + timeBonus(n, now), created: createdTime(n) }))
    // best first; newest first on equal scores (unknown times tie, keeping their order)
    .sort((a, b) => b.rank - a.rank || (a.created === b.created ? 0 : b.created > a.created ? 1 : -1) || a.i - b.i)
    .map(({ n }) => n);
  return arriveFirst(ranked, MAX_OFFLINE_REMINDERS);
}
