import { missedPlaceTimeNotes, notePlace } from "./placeTimeReminders";
import { MAX_SCHEDULED_REMINDERS, planReminderSchedule } from "./reminderSchedule";
import { Note } from "../types/notes";

// A note with a time and a place ("remind me at home at 17:54") needs both:
// the alarm only rings while you're at the place; missed it (away at the
// time)? It alerts when you next arrive there, until the end of that day.

const HOME = "id-home";
const GYM = "id-gym";
// Friday 2026-10-02
const at = (hour: number, minute = 0, day = 2) => new Date(2026, 9, day, hour, minute, 0, 0);

let counter = 0;
function note(fields: Partial<Note>): Note {
  counter += 1;
  return {
    _id: `n${counter}`,
    content: "note",
    category: "todo",
    contexts: [],
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    remind_time_explicit: false,
    remind_at_hour: null,
    remind_at_minute: null,
    remind_on_date: null,
    reminder_time_source: null,
    ...fields,
  } as Note;
}

const homeAt1754 = (fields: Partial<Note> = {}) =>
  note({ content: "remind me at home at 17:54", contexts: [HOME, "17:54"], reminder_time_source: "text", ...fields });

// geofencing runs for Home and Gym
const tracked = (currentPlace: string) => ({ currentPlace, trackedPlaceIds: [HOME, GYM] });
const planned = (notes: Note[], now: Date, where?: ReturnType<typeof tracked>) =>
  planReminderSchedule(notes, now, MAX_SCHEDULED_REMINDERS, where).map((r) => r.noteId);

test("notePlace: the place id among the contexts, not the time", () => {
  expect(notePlace(homeAt1754())).toBe(HOME);
  expect(notePlace(note({ contexts: ["17:54"] }))).toBeNull();
  expect(notePlace(note({ contexts: [] }))).toBeNull();
});

describe("at the place at the time", () => {
  test("the alarm is scheduled", () => {
    const n = homeAt1754();
    expect(planned([n], at(12), tracked(HOME))).toEqual([n._id]);
  });

  test("nothing extra on arriving: it was there at the time (left after it)", () => {
    const n = homeAt1754();
    // at home at 17:54, left at 18:30, back at 19:00
    expect(missedPlaceTimeNotes([n], HOME, at(19), at(18, 30).getTime(), {})).toEqual([]);
  });
});

describe("away at the time, then arriving later the same day", () => {
  test("no alarm while away", () => {
    const n = homeAt1754();
    expect(planned([n], at(12), tracked("unknown"))).toEqual([]);
    expect(planned([n], at(12), tracked(GYM))).toEqual([]);
  });

  test("arriving after the time alerts it", () => {
    const n = homeAt1754();
    // left home at 08:00, back at 19:00
    expect(missedPlaceTimeNotes([n], HOME, at(19), at(8).getTime(), {}).map((x) => x._id)).toEqual([n._id]);
  });

  test("only once that day", () => {
    const n = homeAt1754();
    expect(missedPlaceTimeNotes([n], HOME, at(21), at(8).getTime(), { [n._id]: "2026-10-02" })).toEqual([]);
  });

  test("arriving before the time: no alert yet (the alarm is scheduled once you're there)", () => {
    const n = homeAt1754();
    expect(missedPlaceTimeNotes([n], HOME, at(16), at(8).getTime(), {})).toEqual([]);
    expect(planned([n], at(16), tracked(HOME))).toEqual([n._id]);
  });

  test("arriving at another place doesn't alert it", () => {
    const n = homeAt1754();
    expect(missedPlaceTimeNotes([n], GYM, at(19), at(8).getTime(), {})).toEqual([]);
  });

  test("a note about arriving isn't repeated: the arrival alert already shows it", () => {
    const n = homeAt1754({ content: "when I get home at 17:54 feed the cat" });
    expect(missedPlaceTimeNotes([n], HOME, at(19), at(8).getTime(), {})).toEqual([]);
  });

  test("no exit on record (e.g. just installed): arriving counts as having been away", () => {
    const n = homeAt1754();
    expect(missedPlaceTimeNotes([n], HOME, at(19), null, {})).toHaveLength(1);
  });
});

describe("away at the time and not arriving that day", () => {
  test("nothing that day, and the next day doesn't bring it back", () => {
    const dated = homeAt1754({ remind_on_date: "2026-10-02" });
    expect(planned([dated], at(12), tracked(GYM))).toEqual([]);
    // arriving the next morning: the 2nd is over
    expect(missedPlaceTimeNotes([dated], HOME, at(9, 0, 3), at(8).getTime(), {})).toEqual([]);
  });

  test("a daily note: the next day is a new day, waiting for its own 17:54", () => {
    const daily = homeAt1754();
    expect(missedPlaceTimeNotes([daily], HOME, at(9, 0, 3), at(8).getTime(), {})).toEqual([]);
  });

  test("a note dated for another day is not missed today", () => {
    const later = homeAt1754({ remind_on_date: "2026-10-05" });
    expect(missedPlaceTimeNotes([later], HOME, at(19), at(8).getTime(), {})).toEqual([]);
  });
});

describe("location unavailable at the time: alert anyway, nothing silently lost", () => {
  test("geofencing isn't running (permission or notifications off)", () => {
    const n = homeAt1754();
    expect(planned([n], at(12), { currentPlace: "unknown", trackedPlaceIds: [] })).toEqual([n._id]);
  });

  test("the place has no location on this phone", () => {
    const n = homeAt1754();
    expect(planned([n], at(12), { currentPlace: "unknown", trackedPlaceIds: [GYM] })).toEqual([n._id]);
  });

  test("no location info at all (as before)", () => {
    const n = homeAt1754();
    expect(planned([n], at(12))).toEqual([n._id]);
  });
});

describe("notes with only a time or only a place work as before", () => {
  test("only a time: the alarm rings wherever you are", () => {
    const n = note({ content: "call mom at 20:00", contexts: ["20:00"], reminder_time_source: "text" });
    expect(planned([n], at(12), tracked(GYM))).toEqual([n._id]);
  });

  test("only a place (Home's default 09:00, not a written time): no alarm, never 'missed'", () => {
    const n = note({ content: "water the plants", contexts: [HOME, "09:00"], reminder_time_source: "default" });
    expect(planned([n], at(8), tracked(HOME))).toEqual([]);
    expect(missedPlaceTimeNotes([n], HOME, at(19), at(8).getTime(), {})).toEqual([]);
  });

  test("ideas and alerts-off notes never alert", () => {
    const idea = homeAt1754({ category: "idea" });
    const off = homeAt1754({ reminders_enabled: false });
    expect(missedPlaceTimeNotes([idea, off], HOME, at(19), at(8).getTime(), {})).toEqual([]);
  });
});
