import { arrivalCandidates, hasSpecificTime, isAboutArriving } from "./arrivalNotes";
import { Note } from "../types/notes";

let n = 0;
function note(fields: Partial<Note>): Note {
  n += 1;
  return {
    _id: `n${n}`,
    content: "note",
    contexts: [],
    reminders_enabled: true,
    remind_time_explicit: false,
    remind_at_hour: null,
    remind_at_minute: null,
    ...fields,
  } as Note;
}

describe("hasSpecificTime", () => {
  test("a time the user set", () => {
    expect(hasSpecificTime(note({ reminder_time_source: "explicit", remind_time_explicit: true, remind_at_hour: 17 }))).toBe(true);
  });

  test("a time written in the note", () => {
    expect(hasSpecificTime(note({ content: "remind me I'm home at 17:54", contexts: ["id-home", "17:54"], reminder_time_source: "text" }))).toBe(true);
  });

  test("the place's default time is not specific", () => {
    expect(hasSpecificTime(note({ content: "do the laundry", contexts: ["id-home", "09:00"], reminder_time_source: "default" }))).toBe(false);
  });

  test("no time", () => {
    expect(hasSpecificTime(note({ content: "buy milk", reminder_time_source: null }))).toBe(false);
  });

  describe("older backend without reminder_time_source", () => {
    test("HH:MM written in the text", () => {
      expect(hasSpecificTime(note({ content: "remind me I'm home at 17:54", contexts: ["id-home", "17:54"] }))).toBe(true);
    });
    test("2pm / evening style times in the text", () => {
      expect(hasSpecificTime(note({ content: "call mom at 2pm", contexts: ["14:00"] }))).toBe(true);
      expect(hasSpecificTime(note({ content: "go for an evening jog", contexts: ["18:00"] }))).toBe(true);
    });
    test("a default time that isn't in the text", () => {
      expect(hasSpecificTime(note({ content: "do the laundry", contexts: ["id-home", "09:00"] }))).toBe(false);
    });
    test("an explicit time the user set", () => {
      expect(hasSpecificTime(note({ remind_time_explicit: true, remind_at_hour: 8 }))).toBe(true);
    });
  });
});

describe("isAboutArriving (same phrases as the server)", () => {
  test("needs a time word first", () => {
    for (const content of [
      "get back to the client tomorrow",
      "need to get to the report",
      "I get to choose the venue",
      "dad's flight arrives friday, pick him up",
    ]) {
      expect([content, isAboutArriving(note({ content }))]).toEqual([content, false]);
    }
  });

  test("arrival phrases", () => {
    for (const content of [
      "when I get home call mom",
      "once I'm at the office print the form",
      "as soon as I arrive email Dana",
      "on arrival check in",
    ]) {
      expect([content, isAboutArriving(note({ content }))]).toEqual([content, true]);
    }
  });

  test("Hebrew, like the server's _arrival_hebrew: כש / ברגע ש / אחרי ש, maybe אני, then arriving or being there", () => {
    for (const content of [
      "כשאגיע הביתה לתלות כביסה",
      "כשאני מגיעה לעבודה לשלוח מייל",
      "כשאחזור הביתה לבשל",
      "ברגע שאהיה בבית להתקשר לאמא",
      "אחרי שנגיע לקמפוס להדפיס",
      "כשאני חוזרת הביתה לבשל",
    ]) {
      expect([content, isAboutArriving(note({ content }))]).toEqual([content, true]);
    }
    for (const content of ["להגיע לפגישה בזמן", "לחזור ללקוח מחר", "לקנות חלב"]) {
      expect([content, isAboutArriving(note({ content }))]).toEqual([content, false]);
    }
  });
});

describe("arrivalCandidates (notes to show when you arrive at a place)", () => {
  test("a note with a specific time waits for that time", () => {
    const timed = note({ content: "remind me I'm home at 17:54", contexts: ["id-home", "17:54"], reminder_time_source: "text" });
    const plain = note({ content: "feed the cat", contexts: ["id-home", "09:00"], reminder_time_source: "default" });
    expect(arrivalCandidates([timed, plain]).map((x) => x._id)).toEqual([plain._id]);
  });

  test("…unless the note is about arriving", () => {
    for (const content of [
      "when I get home at 18:00 water the plants",
      "on arrival at 9:00 sign in at the front desk",
      "when I arrive at uni at 10:00 print the slides",
      "once I'm home at 20:00 call dad",
    ]) {
      const x = note({ content, contexts: ["id-home", "18:00"], reminder_time_source: "text" });
      expect(arrivalCandidates([x])).toEqual([x]);
    }
  });

  test("every arrival note is kept (even past 3), first; other notes only fill up to 3", () => {
    const others = [1, 2, 3].map((i) => note({ content: `chore ${i}` }));
    const arrivals = [
      note({ content: "when I get home water the plants" }),
      note({ content: "כשאגיע הביתה לתלות כביסה" }),
      note({ content: "once I'm home call dad" }),
      note({ content: "on arrival check in" }),
    ];
    expect(arrivalCandidates([others[0], arrivals[0], others[1], arrivals[1], arrivals[2], arrivals[3]])).toEqual(
      arrivals
    );
    expect(arrivalCandidates([others[0], arrivals[1], others[1], others[2]])).toEqual([arrivals[1], others[0], others[1]]);
  });

  test("keeps the backend's ranking and takes at most 3", () => {
    const notes = [1, 2, 3, 4].map((i) => note({ content: `note ${i}` }));
    expect(arrivalCandidates(notes).map((x) => x.content)).toEqual(["note 1", "note 2", "note 3"]);
  });

  test("notes with alerts off are skipped", () => {
    expect(arrivalCandidates([note({ reminders_enabled: false })])).toEqual([]);
  });
});

test("ideas never show up as arrival alerts", () => {
  const idea = note({ content: "idea for the house", category: "idea" });
  const todo = note({ content: "water the plants", category: "todo" });
  expect(arrivalCandidates([idea, todo])).toEqual([todo]);
});
