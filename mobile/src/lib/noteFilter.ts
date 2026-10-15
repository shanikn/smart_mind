import { Note } from "../types/notes";
import { normalizeCategory } from "./categoryColors";
import { ALL, GENERAL } from "./folderOrder";
import { notePlace } from "./notePlace";

// Filters for the notes list: the folder tab, the checked categories, the
// place and the search text. They combine (a note must match all of them) and
// keep the notes' order.

export const ANY_PLACE = "all";
export const NO_PLACE = "none";

export interface NoteFilters {
  folder: string; // "All" or a folder name
  categories: string[]; // the checked categories; none checked = every category
  query: string;
  place: string; // ANY_PLACE, NO_PLACE, or a place id
}

// Hebrew vowel points and cantillation marks (niqqud), and invisible
// direction marks a Hebrew keyboard or copied RTL text can add
const HEBREW_MARKS = /[֑-ׇ]/g;
const BIDI_MARKS = /[‎‏‪-‮⁦-⁩]/g;

export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFC")
    .replace(HEBREW_MARKS, "")
    .replace(BIDI_MARKS, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesPlace(note: Note, place: string, knownPlaceIds: string[] | undefined): boolean {
  if (place === ANY_PLACE) {
    return true;
  }
  const id = notePlace(note);
  if (place === NO_PLACE) {
    // a place that was deleted counts as no place
    return id === null || (knownPlaceIds !== undefined && !knownPlaceIds.includes(id));
  }
  return id === place;
}

// knownPlaceIds: the user's places, so NO_PLACE also finds notes whose place
// was deleted
export function filterNotes(notes: Note[], filters: NoteFilters, knownPlaceIds?: string[]): Note[] {
  const words = normalizeForSearch(filters.query).split(" ").filter(Boolean);
  return notes.filter((note) => {
    if (!matchesPlace(note, filters.place, knownPlaceIds)) {
      return false;
    }
    if (filters.folder !== ALL && (note.list_name || GENERAL) !== filters.folder) {
      return false;
    }
    if (filters.categories.length > 0 && !filters.categories.includes(normalizeCategory(note.category))) {
      return false;
    }
    if (words.length > 0) {
      const text = normalizeForSearch(note.content ?? "");
      return words.every((w) => text.includes(w));
    }
    return true;
  });
}

// A search, checked categories or a place are narrowing the list (the folder is its own tab).
export function hasActiveFilters(filters: NoteFilters): boolean {
  return filters.query.trim() !== "" || filters.categories.length > 0 || filters.place !== ANY_PLACE;
}
