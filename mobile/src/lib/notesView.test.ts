import AsyncStorage from "@react-native-async-storage/async-storage";
import { getNotesView, notesViewSections, setNotesView, sortRecent } from "./notesView";
import { groupNotes } from "./noteSections";
import { Note } from "../types/notes";

const NOW = new Date(2026, 9, 5, 12, 0, 0);

const note = (id: string, created_at: string | undefined, fields: Partial<Note> = {}) =>
  ({ _id: id, content: id, created_at, contexts: [], reminders_enabled: true, ...fields }) as Note;

const old = note("old", "2026-09-01T10:00:00");
const newest = note("newest", "2026-10-04T09:00:00");
const middle = note("middle", "2026-10-01T18:30:00", { remind_on_date: "2026-10-05" });
const noDate = note("noDate", undefined);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("sortRecent", () => {
  test("newest created first", () => {
    expect(sortRecent([old, newest, middle]).map((n) => n._id)).toEqual(["newest", "middle", "old"]);
  });

  test("notes without a valid created_at go last, in their order", () => {
    const bad = note("bad", "not a date");
    expect(sortRecent([noDate, old, bad, newest]).map((n) => n._id)).toEqual(["newest", "old", "noDate", "bad"]);
  });

  test("an edited note counts as new: it goes up by its edit time", () => {
    const editedOld = note("editedOld", "2026-09-01T10:00:00", { edited_at: "2026-10-04T12:00:00" });
    expect(sortRecent([newest, middle, editedOld]).map((n) => n._id)).toEqual(["editedOld", "newest", "middle"]);
  });

  test("an edit earlier than a newer note keeps it below that note", () => {
    const editedOld = note("editedOld", "2026-09-01T10:00:00", { edited_at: "2026-10-02T08:00:00" });
    expect(sortRecent([newest, middle, editedOld]).map((n) => n._id)).toEqual(["newest", "editedOld", "middle"]);
  });

  test("a bad edit time is ignored; the created time still counts", () => {
    const badEdit = note("badEdit", "2026-10-02T08:00:00", { edited_at: "not a date" });
    expect(sortRecent([newest, middle, badEdit]).map((n) => n._id)).toEqual(["newest", "badEdit", "middle"]);
  });

  test("doesn't change the input", () => {
    const input = [old, newest];
    sortRecent(input);
    expect(input).toEqual([old, newest]);
  });
});

describe("notesViewSections", () => {
  test("recent: one untitled section, newest first", () => {
    expect(notesViewSections("recent", [old, newest, middle], NOW)).toEqual([
      { key: "recent", title: "", notes: [newest, middle, old] },
    ]);
  });

  test("recent with no notes: no sections", () => {
    expect(notesViewSections("recent", [], NOW)).toEqual([]);
  });

  test("upcoming: the date sections, exactly as groupNotes", () => {
    const notes = [old, newest, middle];
    expect(notesViewSections("upcoming", notes, NOW)).toEqual(groupNotes(notes, NOW));
  });
});

describe("remembered on the phone", () => {
  test("Recent by default", async () => {
    expect(await getNotesView()).toBe("recent");
  });

  test("saves and reads back the choice", async () => {
    await setNotesView("upcoming");
    expect(await getNotesView()).toBe("upcoming");
    await setNotesView("recent");
    expect(await getNotesView()).toBe("recent");
  });

  test("an unknown stored value falls back to Recent", async () => {
    await AsyncStorage.setItem("smartmind.notesView", "sideways");
    expect(await getNotesView()).toBe("recent");
  });

  test("storage errors fall back to Recent and don't throw on save", async () => {
    jest.spyOn(AsyncStorage, "getItem").mockRejectedValueOnce(new Error("disk"));
    expect(await getNotesView()).toBe("recent");
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk"));
    await expect(setNotesView("upcoming")).resolves.toBeUndefined();
  });
});
