import { Note } from "../types/notes";
import { noteTime } from "./noteLabels";

export { noteTime };

// Groups the notes list into sections: Earlier, Today, Tomorrow · Mon 5 Oct,
// later dates ("Wed 7 Oct"), Smart alerts, Alerts off. Day/month names are
// English on purpose (the UI is English even on a Hebrew phone).

export interface NoteSection {
  title: string;
  key: string;
  notes: Note[];
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function parseDay(value: string | null | undefined): Date | null {
  const m = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) {
    return null;
  }
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayLabel(d: Date): string {
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// whole days from `from` to `to` (local dates, safe across DST)
export function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

interface Placed {
  key: string;
  title: string;
  rank: number; // section order
}

function placeNote(note: Note, now: Date): Placed {
  if (note.reminders_enabled === false) {
    return { key: "alerts-off", title: "Alerts off", rank: 5_000_000 };
  }
  const day = parseDay(note.remind_on_date);
  if (day) {
    const diff = dayDiff(now, day);
    if (diff < 0) {
      return { key: "earlier", title: "Earlier", rank: 0 };
    }
    if (diff === 0) {
      return { key: "today", title: "Today", rank: 1 };
    }
    if (diff === 1) {
      return { key: "tomorrow", title: `Tomorrow · ${dayLabel(day)}`, rank: 2 };
    }
    const iso = note.remind_on_date as string;
    return { key: `date-${iso}`, title: dayLabel(day), rank: 2 + diff };
  }
  if (noteTime(note)) {
    return { key: "today", title: "Today", rank: 1 }; // repeats daily
  }
  return { key: "smart", title: "Smart alerts", rank: 4_000_000 };
}

export function groupNotes(notes: Note[], now: Date): NoteSection[] {
  const sections = new Map<string, NoteSection & { rank: number }>();
  for (const note of notes) {
    const placed = placeNote(note, now);
    const section = sections.get(placed.key);
    if (section) {
      section.notes.push(note);
    } else {
      sections.set(placed.key, { key: placed.key, title: placed.title, rank: placed.rank, notes: [note] });
    }
  }
  return [...sections.values()]
    .sort((a, b) => a.rank - b.rank)
    .map(({ key, title, notes: sectionNotes }) => ({
      key,
      title,
      // by time; notes without a time keep their order, after the timed ones
      notes: sectionNotes
        .map((n, i) => ({ n, i, t: noteTime(n) }))
        .sort((a, b) => {
          if (a.t && b.t) {
            return a.t < b.t ? -1 : a.t > b.t ? 1 : a.i - b.i;
          }
          if (a.t || b.t) {
            return a.t ? -1 : 1;
          }
          return a.i - b.i;
        })
        .map((x) => x.n),
    }));
}
