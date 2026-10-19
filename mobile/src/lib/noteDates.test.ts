import { formatNoteTime, noteDatesLine } from "./noteDates";

// local times, so the tests pass in any time zone; the server sends UTC
const NOW = new Date(2026, 9, 19, 15, 0);
const utc = (d: Date) => d.toISOString();
const utcNoZone = (d: Date) => d.toISOString().replace("Z", "");

describe("formatNoteTime", () => {
  test("today shows only the time", () => {
    expect(formatNoteTime(new Date(2026, 9, 19, 9, 5), NOW)).toBe("today, 09:05");
  });

  test("yesterday says yesterday", () => {
    expect(formatNoteTime(new Date(2026, 9, 18, 22, 30), NOW)).toBe("yesterday, 22:30");
  });

  test("earlier this year shows day and month", () => {
    expect(formatNoteTime(new Date(2026, 2, 4, 8, 0), NOW)).toBe("4 Mar, 08:00");
  });

  test("another year adds the year", () => {
    expect(formatNoteTime(new Date(2025, 11, 31, 23, 59), NOW)).toBe("31 Dec 2025, 23:59");
  });
});

describe("noteDatesLine", () => {
  const created = new Date(2026, 9, 1, 10, 0);

  test("created only, when never edited", () => {
    expect(noteDatesLine({ created_at: utc(created), edited_at: null }, NOW)).toBe("Created 1 Oct, 10:00");
  });

  test("server times without a zone are UTC", () => {
    expect(noteDatesLine({ created_at: utcNoZone(created) }, NOW)).toBe("Created 1 Oct, 10:00");
  });

  test("adds the edit time when the note was changed", () => {
    const edited = new Date(2026, 9, 19, 14, 5);
    expect(noteDatesLine({ created_at: utc(created), edited_at: utcNoZone(edited) }, NOW)).toBe(
      "Created 1 Oct, 10:00 · Edited today, 14:05"
    );
  });

  test("an edit within a minute of creating is not shown", () => {
    const edited = new Date(created.getTime() + 30_000);
    expect(noteDatesLine({ created_at: utc(created), edited_at: utc(edited) }, NOW)).toBe("Created 1 Oct, 10:00");
  });

  test("nothing to show without a valid created time", () => {
    expect(noteDatesLine({ created_at: undefined }, NOW)).toBeNull();
    expect(noteDatesLine({ created_at: "not a date" }, NOW)).toBeNull();
  });
});
