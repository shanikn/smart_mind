import { Note } from "../types/notes";
import { dateAt, hasExactTime, isActive, reminderTime } from "./reminderSchedule";
import { notePlace } from "./notePlace";
import { isAboutArriving } from "./arrivalNotes";

export { needsToBeThere, notePlace } from "./notePlace";
export type { WhereAmI } from "./notePlace";

// Notes with a time AND a place ("remind me at home at 17:54") need both.
// Nothing can run on the phone at the alarm's moment, so the alarm is kept
// only while geofencing says you're at the place (entering or leaving
// re-plans it; see needsToBeThere). Away at the time? The note alerts when
// you next arrive there, until the end of that day. If the place isn't being
// watched (no location permission, notifications off, no location set for it
// on this phone), the alarm rings as before, so nothing is silently lost.

// "YYYY-MM-DD" in local time
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// On arriving at `placeId` at `now`: the notes for this place whose time
// already passed today while you were away (your last exit from the place was
// before that time, or isn't known), not yet alerted today.
export function missedPlaceTimeNotes(
  notes: Note[],
  placeId: string,
  now: Date,
  lastExitAt: number | null,
  alertedOn: Record<string, string>
): Note[] {
  const today = dayKey(now);
  return notes.filter((note) => {
    if (!isActive(note, now) || !hasExactTime(note) || notePlace(note) !== placeId) {
      return false;
    }
    // "when I get home at 18:00 ..." already alerts on every arrival
    if (isAboutArriving(note)) {
      return false;
    }
    if (note.remind_on_date && note.remind_on_date !== today) {
      return false;
    }
    const time = reminderTime(note);
    const due = time && dateAt(today, time.hour, time.minute);
    if (!due || due > now) {
      return false;
    }
    const wasAway = lastExitAt === null || lastExitAt < due.getTime();
    return wasAway && alertedOn[note._id] !== today;
  });
}
