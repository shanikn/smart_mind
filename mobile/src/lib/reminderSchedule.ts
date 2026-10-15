import { Note } from "../types/notes";
import { canAlert } from "./alertRules";
import { needsToBeThere, WhereAmI } from "./notePlace";

// Pure planning for exact reminder alarms. Notes with a time the user set or
// wrote ("at 17:53", "evening") get one; location default times don't, they
// stay with the location-aware polling.

export const REMINDER_ID_PREFIX = "reminder-";

// keeps well under Android's per-app alarm limit
export const MAX_SCHEDULED_REMINDERS = 50;

export type ReminderTrigger =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "date"; date: Date };

export interface PlannedReminder {
  identifier: string;
  noteId: string;
  body: string;
  trigger: ReminderTrigger;
}

export function reminderTime(note: Note): { hour: number; minute: number } | null {
  if (note.remind_time_explicit && note.remind_at_hour != null) {
    return { hour: note.remind_at_hour, minute: note.remind_at_minute ?? 0 };
  }
  const text = note.contexts.find((c) => typeof c === "string" && /^\d{2}:\d{2}$/.test(c));
  if (!text) {
    return null;
  }
  const [hour, minute] = text.split(":").map(Number);
  return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function hasExactTime(note: Note): boolean {
  const source = note.reminder_time_source;
  if (source === undefined) {
    // older backend that doesn't report the source: only trust times the user set
    return note.remind_time_explicit && note.remind_at_hour != null;
  }
  return source === "explicit" || source === "text";
}

export function isActive(note: Note, now: Date): boolean {
  if (!canAlert(note) || note.never_show) {
    return false;
  }
  if (note.cooldown_until) {
    const until = new Date(note.cooldown_until);
    if (!Number.isNaN(until.getTime()) && until > now) {
      return false;
    }
  }
  return true;
}

export function dateAt(day: string, hour: number, minute: number): Date | null {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    return null;
  }
  return new Date(year, month - 1, date, hour, minute, 0, 0);
}

// `where`: a note with a time and a watched place gets its alarm only while
// you're at that place (see placeTimeReminders.ts); without it, every timed
// note gets one.
export function planReminderSchedule(
  notes: Note[],
  now: Date,
  max: number = MAX_SCHEDULED_REMINDERS,
  where?: WhereAmI
): PlannedReminder[] {
  const daily: PlannedReminder[] = [];
  const dated: PlannedReminder[] = [];

  for (const note of notes) {
    if (!isActive(note, now) || !hasExactTime(note)) {
      continue;
    }
    if (where && needsToBeThere(note, where)) {
      continue;
    }
    const time = reminderTime(note);
    if (!time) {
      continue;
    }
    const base = {
      identifier: `${REMINDER_ID_PREFIX}${note._id}`,
      noteId: note._id,
      body: note.content,
    };
    if (note.remind_on_date) {
      const date = dateAt(note.remind_on_date, time.hour, time.minute);
      if (date && date > now) {
        dated.push({ ...base, trigger: { kind: "date", date } });
      }
    } else {
      // undated notes stay eligible every day, like the polling path
      daily.push({ ...base, trigger: { kind: "daily", hour: time.hour, minute: time.minute } });
    }
  }

  const byDate = (a: PlannedReminder, b: PlannedReminder) =>
    (a.trigger as { date: Date }).date.getTime() - (b.trigger as { date: Date }).date.getTime();
  return [...daily, ...dated.sort(byDate)].slice(0, max);
}
