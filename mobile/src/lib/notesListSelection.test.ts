import {
  getCategorySelection,
  getFolderTab,
  setCategorySelection,
  setFolderTab,
} from "./notesListSelection";

beforeEach(() => {
  setFolderTab("All");
  setCategorySelection([]);
});

test("at first: the All tab, no category checked", () => {
  expect(getFolderTab()).toBe("All");
  expect(getCategorySelection()).toEqual([]);
});

test("remembers the folder tab and the checked categories while the app runs", () => {
  setFolderTab("Uni");
  setCategorySelection(["errand", "idea"]);
  expect(getFolderTab()).toBe("Uni");
  expect(getCategorySelection()).toEqual(["errand", "idea"]);
});

test("callers can't change the remembered categories by accident", () => {
  setCategorySelection(["errand"]);
  getCategorySelection().push("idea");
  expect(getCategorySelection()).toEqual(["errand"]);
});
