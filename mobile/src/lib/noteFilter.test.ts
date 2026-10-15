import { filterNotes, hasActiveFilters, normalizeForSearch } from "./noteFilter";
import { Note } from "../types/notes";

let n = 0;
function note(content: string, fields: Partial<Note> = {}): Note {
  n += 1;
  return { _id: `n${n}`, content, category: "todo", list_name: "General", contexts: [], ...fields } as Note;
}

const buyMilk = note("Buy MILK and eggs", { category: "errand" });
const exam = note("Prepare for the Computer Networks exam", { category: "event", list_name: "Uni" });
const hebrew = note("לקנות חלב ולחם", { category: "errand", list_name: "Home" });
const niqqud = note("לִקְנוֹת פֵּרוֹת", { category: "errand" });
const idea = note("App idea: smart notes", { category: "idea" });
const noFolder = note("call mom", { category: "reminder", list_name: "" });
const unknownCategory = note("something odd", { category: "weird" });
const ALL_NOTES = [buyMilk, exam, hebrew, niqqud, idea, noFolder, unknownCategory];

const ids = (notes: Note[]) => notes.map((x) => x._id);
const all = { folder: "All", categories: [] as string[], query: "", place: "all" };

describe("normalizeForSearch", () => {
  test("lowercases, trims and collapses spaces", () => {
    expect(normalizeForSearch("  Buy   MILK ")).toBe("buy milk");
  });

  test("removes Hebrew vowel marks (niqqud) and invisible direction marks", () => {
    expect(normalizeForSearch("לִקְנוֹת")).toBe("לקנות");
    expect(normalizeForSearch("‏חלב‎")).toBe("חלב");
  });
});

describe("filterNotes", () => {
  test("no filters: everything, in the same order", () => {
    expect(ids(filterNotes(ALL_NOTES, all))).toEqual(ids(ALL_NOTES));
  });

  describe("search", () => {
    test("case-insensitive, anywhere in the text", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "milk" }))).toEqual([buyMilk._id]);
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "NETWORKS" }))).toEqual([exam._id]);
    });

    test("Hebrew, with or without vowel marks", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "חלב" }))).toEqual([hebrew._id]);
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "לקנות" }))).toEqual([hebrew._id, niqqud._id]);
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "לִקְנוֹת" }))).toEqual([hebrew._id, niqqud._id]);
    });

    test("every word must appear, in any order", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "eggs buy" }))).toEqual([buyMilk._id]);
      expect(ids(filterNotes(ALL_NOTES, { ...all, query: "buy exam" }))).toEqual([]);
    });

    test("only spaces counts as no search", () => {
      expect(filterNotes(ALL_NOTES, { ...all, query: "   " })).toHaveLength(ALL_NOTES.length);
    });
  });

  describe("categories", () => {
    test("none checked: every category", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, categories: [] }))).toEqual(ids(ALL_NOTES));
    });

    test("one checked: only notes of that kind", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, categories: ["errand"] }))).toEqual([
        buyMilk._id,
        hebrew._id,
        niqqud._id,
      ]);
    });

    test("several checked: notes of any of them, in the same order", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, categories: ["idea", "event"] }))).toEqual([exam._id, idea._id]);
    });

    test("old and unknown categories count as To-do", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, categories: ["todo"] }))).toEqual([noFolder._id, unknownCategory._id]);
    });
  });

  describe("folder (one tab)", () => {
    test("All: every folder", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, folder: "All" }))).toEqual(ids(ALL_NOTES));
    });

    test("only notes in that folder; no folder counts as General", () => {
      expect(ids(filterNotes(ALL_NOTES, { ...all, folder: "Uni" }))).toEqual([exam._id]);
      expect(ids(filterNotes(ALL_NOTES, { ...all, folder: "General" }))).toEqual([
        buyMilk._id,
        niqqud._id,
        idea._id,
        noFolder._id,
        unknownCategory._id,
      ]);
    });
  });

  test("the folder AND one of the checked categories AND the search", () => {
    expect(ids(filterNotes(ALL_NOTES, { ...all, folder: "Home", categories: ["errand"], query: "חלב" }))).toEqual([hebrew._id]);
    expect(ids(filterNotes(ALL_NOTES, { ...all, folder: "General", categories: ["errand", "idea"] }))).toEqual([
      buyMilk._id,
      niqqud._id,
      idea._id,
    ]);
    expect(filterNotes(ALL_NOTES, { ...all, folder: "Uni", categories: ["errand"] })).toEqual([]);
  });
});

test("hasActiveFilters: a search or checked categories (the folder is its own tab)", () => {
  expect(hasActiveFilters({ ...all })).toBe(false);
  expect(hasActiveFilters({ ...all, query: "  " })).toBe(false);
  expect(hasActiveFilters({ ...all, query: "milk" })).toBe(true);
  expect(hasActiveFilters({ ...all, categories: ["idea"] })).toBe(true);
  expect(hasActiveFilters({ ...all, folder: "Uni" })).toBe(false);
});

describe("place (one choice: all, none, or a place id)", () => {
  const atHome = note("water the plants", { contexts: ["p-home"] });
  const atGymAt6 = note("bring a towel", { category: "errand", list_name: "Uni", contexts: ["p-gym", "18:00"] });
  const timeOnly = note("call dad", { contexts: ["18:00"] });
  const deletedPlace = note("return the book", { category: "errand", contexts: ["p-deleted"] });
  const PLACE_NOTES = [buyMilk, atHome, atGymAt6, timeOnly, deletedPlace];
  const KNOWN = ["p-home", "p-gym"];

  test("a place id: only notes at that place", () => {
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "p-home" }, KNOWN))).toEqual([atHome._id]);
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "p-gym" }, KNOWN))).toEqual([atGymAt6._id]);
  });

  test("none: notes with no place, and notes whose place was deleted", () => {
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "none" }, KNOWN))).toEqual([
      buyMilk._id,
      timeOnly._id,
      deletedPlace._id,
    ]);
  });

  test("a time-only context like 18:00 isn't a place", () => {
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "18:00" }, KNOWN))).toEqual([]);
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "none" }, KNOWN))).toContain(timeOnly._id);
  });

  test("all: changes nothing", () => {
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "all" }, KNOWN))).toEqual(ids(PLACE_NOTES));
  });

  test("combines with the folder, the categories and the search, keeping the order", () => {
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "none", categories: ["errand"] }, KNOWN))).toEqual([
      buyMilk._id,
      deletedPlace._id,
    ]);
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "none", query: "book" }, KNOWN))).toEqual([deletedPlace._id]);
    expect(ids(filterNotes(PLACE_NOTES, { ...all, place: "p-gym", folder: "Uni", categories: ["errand"] }, KNOWN))).toEqual(
      [atGymAt6._id]
    );
    expect(filterNotes(PLACE_NOTES, { ...all, place: "p-gym", folder: "General" }, KNOWN)).toEqual([]);
  });

  test("hasActiveFilters: a picked place counts, All places doesn't", () => {
    expect(hasActiveFilters({ ...all, place: "p-home" })).toBe(true);
    expect(hasActiveFilters({ ...all, place: "none" })).toBe(true);
    expect(hasActiveFilters({ ...all, place: "all" })).toBe(false);
  });
});
