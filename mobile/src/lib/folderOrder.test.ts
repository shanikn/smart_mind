import { folderNames, folderTabs, GENERAL } from "./folderOrder";

const note = (list_name?: string) => ({ list_name }) as { list_name?: string };

test("General first, then the user's folders in their order (not A to Z)", () => {
  expect(folderNames([note("Games")], ["Work", "Games", "art"])).toEqual([GENERAL, "Work", "Games", "art"]);
});

test("folders only notes use (not saved yet) come after the user's, A to Z", () => {
  expect(folderNames([note("Shopping"), note("Games"), note("General"), note("Uni")], ["Uni"])).toEqual([
    GENERAL,
    "Uni",
    "Games",
    "Shopping",
  ]);
});

test("notes without a folder count as General", () => {
  expect(folderNames([note(undefined), note(""), note("Games")], [])).toEqual([GENERAL, "Games"]);
});

test("custom (empty) folders are included and de-duplicated", () => {
  expect(folderNames([note("Games")], ["Ideas", "Games"])).toEqual([GENERAL, "Ideas", "Games"]);
});

test("General is always there, even with no notes", () => {
  expect(folderNames([], [])).toEqual([GENERAL]);
  expect(folderNames([], [GENERAL, "Work"])).toEqual([GENERAL, "Work"]);
});

test("notes list tabs: All, then General right after it, then the rest", () => {
  expect(folderTabs([note("Games"), note("General"), note("Work")], [])).toEqual([
    "All",
    GENERAL,
    "Games",
    "Work",
  ]);
});
