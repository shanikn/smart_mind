import { Note } from "../types/notes";

// A note's place, and whether its time alarm must wait until you're there
// (see placeTimeReminders.ts). Kept apart so reminderSchedule.ts can use it.

export interface WhereAmI {
  currentPlace: string; // a place id or "unknown" (lib/reminderPrefs.ts)
  trackedPlaceIds: string[]; // places geofencing is watching
}

const TIME = /^\d{2}:\d{2}$/;

// the note's place id (contexts hold at most one place id and one "HH:MM")
export function notePlace(note: Note): string | null {
  return note.contexts.find((c) => typeof c === "string" && c !== "" && !TIME.test(c)) ?? null;
}

// a note with a watched place, and you're not there: no alarm now
export function needsToBeThere(note: Note, where: WhereAmI): boolean {
  const place = notePlace(note);
  return place !== null && where.trackedPlaceIds.includes(place) && where.currentPlace !== place;
}
