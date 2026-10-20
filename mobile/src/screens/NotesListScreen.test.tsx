import React from "react";
import { Alert, AppState, StyleSheet, Text, TextInput, TouchableOpacity } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import NotesListScreen from "./NotesListScreen";
import { setCategorySelection, setFolderTab, setPlaceSelection } from "../lib/notesListSelection";
import { DEFAULT_CATEGORY_COLORS } from "../lib/categoryColors";
import { deleteWithUndo, finishPendingDelete } from "../services/pendingDelete";
import { getNotes } from "../api/notes";
import { Note } from "../types/notes";

// created b (oldest), c, a (newest); a is due today, the others are smart alerts
const NOTES = [
  {
    _id: "a",
    content: "Buy milk",
    category: "errand",
    list_name: "General",
    contexts: ["18:00"],
    reminders_enabled: true,
    created_at: "2026-10-04T09:00:00",
  },
  {
    _id: "b",
    content: "Study for the exam",
    category: "task",
    list_name: "Uni",
    contexts: [],
    reminders_enabled: true,
    created_at: "2026-09-01T09:00:00",
  },
  {
    _id: "c",
    content: "לקנות חלב",
    category: "errand",
    list_name: "Uni",
    contexts: [],
    reminders_enabled: true,
    created_at: "2026-10-01T09:00:00",
  },
] as unknown as Note[];

// the last focus callback, so a test can "come back" to the screen
let mockRefocus: () => void = () => {};
jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    useNavigation: () => ({ navigate: jest.fn(), getParent: () => ({ navigate: jest.fn() }) }),
    useFocusEffect: (cb: () => void) => {
      mockRefocus = cb;
      React.useEffect(() => cb(), []);
    },
  };
});
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: View };
});
jest.mock("../api/notes", () => ({
  getNotes: jest.fn(async () => NOTES),
  deleteNote: jest.fn(),
}));
jest.mock("../services/foldersStore", () => ({
  loadFolders: jest.fn().mockResolvedValue([]),
  addFolder: jest.fn(),
  removeFolder: jest.fn(),
  reorderFolders: jest.fn(),
}));
jest.mock("../services/scheduledReminders", () => ({ syncScheduledReminders: jest.fn() }));
jest.mock("../services/storeAlerts", () => ({ syncStoreAlerts: jest.fn() }));
jest.mock("../services/placesStore", () => ({ loadPlaces: jest.fn().mockResolvedValue([]) }));
jest.mock("../lib/reminderPrefs", () => ({ getReminderLocation: jest.fn().mockResolvedValue("unknown") }));
// the card's swipe needs native gesture handling; show just the text, and
// long-press stands for a confirmed delete (swipe -> Delete -> Delete)
jest.mock("../components/NoteCard", () => {
  const { Text } = require("react-native");
  return ({ note, onDelete, onDone }: { note: { content: string }; onDelete: () => void; onDone?: () => void }) => (
    <>
      <Text testID="note-card" onLongPress={onDelete}>
        {note.content}
      </Text>
      {onDone && (
        <Text testID="note-done" onPress={onDone}>
          {note.content}
        </Text>
      )}
    </>
  );
});

// the folder tab and checked categories are remembered while the app runs; start each test fresh
beforeEach(() => {
  setFolderTab("All");
  setCategorySelection([]);
  setPlaceSelection("all");
});

function shownNotes(tree: ReactTestRenderer): string[] {
  // host (native) elements only; findAllByProps also returns the composite Text wrapper
  return tree.root
    .findAll((n) => n.props.testID === "note-card" && typeof n.type === "string")
    .map((n) => n.props.children as string);
}

function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === label);
  if (!found) {
    throw new Error(`nothing labelled "${label}"`);
  }
  return found;
}

function allText(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(""))
    .join(" | ");
}

// Every screen a test renders is unmounted after it. A screen left mounted
// keeps its list's timers: they fire during later tests (act() warnings,
// "Cannot log after tests are done"), and a later wait() with fake timers
// runs all of them, so tests got slower as the file went on and could pass
// the 5 s timeout in a busy full run.
const mounted: ReactTestRenderer[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((tree) => tree.unmount());
  });
});

async function renderScreen() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<NotesListScreen />);
  });
  mounted.push(tree);
  return tree;
}

const searchField = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(TextInput).find((t) => t.props.accessibilityLabel === "Search notes")!;

async function type(tree: ReactTestRenderer, text: string) {
  await act(async () => searchField(tree).props.onChangeText(text));
}

test("search filters as you type, case-insensitive and in Hebrew", async () => {
  const tree = await renderScreen();
  expect(shownNotes(tree)).toHaveLength(3);
  await type(tree, "MILK");
  expect(shownNotes(tree)).toEqual(["Buy milk"]);
  await type(tree, "חלב");
  expect(shownNotes(tree)).toEqual(["לקנות חלב"]);
}, 15000);

test("the clear (x) button appears with text and empties the search", async () => {
  const tree = await renderScreen();
  expect(tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === "Clear search")).toBe(
    false
  );
  await type(tree, "milk");
  await act(async () => byLabel(tree, "Clear search").props.onPress());
  expect(searchField(tree).props.value).toBe("");
  expect(shownNotes(tree)).toHaveLength(3);
});

// the category filter: a sheet with a checkbox per category
const categoryOption = (tree: ReactTestRenderer, label: string) =>
  tree.root
    .findAllByType(TouchableOpacity)
    .find((t) => t.props.testID === "category-option" && t.props.accessibilityLabel === label)!;

async function checkCategories(tree: ReactTestRenderer, ...labels: string[]) {
  await act(async () => byLabel(tree, "Filter").props.onPress());
  for (const label of labels) {
    await act(async () => categoryOption(tree, label).props.onPress());
  }
  await act(async () => byLabel(tree, "Done").props.onPress());
}

const pressTab = async (tree: ReactTestRenderer, name: string) => act(async () => byLabel(tree, name).props.onPress());

test("the folder tab, the checked categories and the search combine", async () => {
  const tree = await renderScreen();
  await checkCategories(tree, "Shopping");
  expect(shownNotes(tree).sort()).toEqual(["Buy milk", "לקנות חלב"].sort());
  await pressTab(tree, "Uni");
  expect(shownNotes(tree)).toEqual(["לקנות חלב"]);
  await type(tree, "milk");
  expect(shownNotes(tree)).toEqual([]);
  await type(tree, "");
  // Uni AND (Shopping or To-do); the old "task" kind counts as To-do
  await checkCategories(tree, "To-do");
  expect(shownNotes(tree).sort()).toEqual(["Study for the exam", "לקנות חלב"].sort());
});

test("no matches: 'No matching notes' and a way to clear the search and filter", async () => {
  const tree = await renderScreen();
  await checkCategories(tree, "Idea");
  await type(tree, "zzz");
  expect(shownNotes(tree)).toEqual([]);
  expect(allText(tree)).toContain("No matching notes");
  await act(async () => byLabel(tree, "Clear search and filter").props.onPress());
  expect(shownNotes(tree)).toHaveLength(3);
});

describe("Recent / Upcoming toggle", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  const headers = (tree: ReactTestRenderer) =>
    tree.root
      .findAll((n) => n.props.accessibilityRole === "header" && typeof n.type === "string")
      .map((n) => [n.props.children].flat().join(""));

  test("Recent by default: one list, newest created first, no section headers", async () => {
    const tree = await renderScreen();
    expect(byLabel(tree, "Recent").props.accessibilityState).toEqual({ selected: true });
    expect(byLabel(tree, "Upcoming").props.accessibilityState).toEqual({ selected: false });
    expect(shownNotes(tree)).toEqual(["Buy milk", "לקנות חלב", "Study for the exam"]);
    expect(headers(tree)).toEqual([]);
  });

  test("Upcoming shows the date sections", async () => {
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Upcoming").props.onPress());
    expect(byLabel(tree, "Upcoming").props.accessibilityState).toEqual({ selected: true });
    expect(headers(tree)).toEqual(["Today", "Smart alerts"]);
    expect(shownNotes(tree)).toEqual(["Buy milk", "Study for the exam", "לקנות חלב"]);
  });

  test("the choice is remembered on the phone", async () => {
    const first = await renderScreen();
    await act(async () => byLabel(first, "Upcoming").props.onPress());
    expect(await AsyncStorage.getItem("smartmind.notesView")).toBe("upcoming");
    await act(async () => first.unmount());
    const again = await renderScreen();
    expect(byLabel(again, "Upcoming").props.accessibilityState).toEqual({ selected: true });
    expect(headers(again)).toEqual(["Today", "Smart alerts"]);
  });

  test("search, the folder tabs and the category filter work in both views", async () => {
    for (const view of ["Recent", "Upcoming"]) {
      const tree = await renderScreen();
      await act(async () => byLabel(tree, view).props.onPress());
      await checkCategories(tree, "Shopping");
      expect(shownNotes(tree)).toEqual(["Buy milk", "לקנות חלב"]);
      await pressTab(tree, "Uni");
      expect(shownNotes(tree)).toEqual(["לקנות חלב"]);
      await pressTab(tree, "All");
      await act(async () => byLabel(tree, "Filter").props.onPress());
      await act(async () => byLabel(tree, "Clear").props.onPress());
      await act(async () => byLabel(tree, "Done").props.onPress());
      await type(tree, "milk");
      expect(shownNotes(tree)).toEqual(["Buy milk"]);
      await act(async () => tree.unmount());
    }
  });
});

describe("loading errors", () => {
  const mockedGetNotes = getNotes as jest.Mock;
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });
  afterEach(() => {
    alertSpy.mockRestore();
    mockedGetNotes.mockImplementation(async () => NOTES);
  });

  const refocus = async () => {
    await act(async () => mockRefocus());
  };

  test("coming back (e.g. from Settings) when the refetch fails: no error, the notes stay", async () => {
    const tree = await renderScreen();
    expect(shownNotes(tree)).toHaveLength(3);
    mockedGetNotes.mockRejectedValueOnce(new Error("API error 401"));
    await refocus();
    expect(alertSpy).not.toHaveBeenCalled();
    expect(allText(tree)).not.toMatch(/couldn't load|failed to load/i);
    expect(shownNotes(tree)).toHaveLength(3);
  });

  test("an older refetch that fails after a newer one succeeded is ignored", async () => {
    let failOld!: (e: Error) => void;
    const tree = await renderScreen();
    mockedGetNotes.mockImplementationOnce(() => new Promise((_, reject) => (failOld = reject)));
    await refocus(); // first refetch, still in flight
    await refocus(); // second refetch succeeds
    await act(async () => failOld(new Error("aborted")));
    expect(alertSpy).not.toHaveBeenCalled();
    expect(allText(tree)).not.toMatch(/couldn't load/i);
    expect(shownNotes(tree)).toHaveLength(3);
  });

  test("the first load fails with nothing to show: an error with Try again, cleared on success", async () => {
    mockedGetNotes.mockRejectedValueOnce(new Error("offline"));
    const tree = await renderScreen();
    expect(shownNotes(tree)).toEqual([]);
    expect(allText(tree)).toContain("Couldn't load your notes");
    expect(allText(tree)).not.toContain("No notes yet");
    await act(async () => byLabel(tree, "Try again").props.onPress());
    expect(allText(tree)).not.toContain("Couldn't load your notes");
    expect(shownNotes(tree)).toHaveLength(3);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("folder list failing to load doesn't hide the notes", async () => {
    const { loadFolders } = jest.requireMock("../services/foldersStore");
    loadFolders.mockRejectedValueOnce(new Error("storage"));
    const tree = await renderScreen();
    expect(shownNotes(tree)).toHaveLength(3);
    expect(alertSpy).not.toHaveBeenCalled();
  });
});

describe("folder tabs and the folder sheet", () => {
  const store = jest.requireMock("../services/foldersStore");
  const { deleteNote } = jest.requireMock("../api/notes");
  let alertSpy: jest.SpyInstance;
  const lastAlert = () => alertSpy.mock.calls.at(-1) as [string, string, { text: string; onPress?: () => unknown }[]];
  const press = async (text: string) => {
    const button = lastAlert()[2].find((b) => b.text === text)!;
    await act(async () => {
      await button.onPress?.();
    });
  };
  const tabs = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(TouchableOpacity)
      .filter((t) => t.props.testID === "folder-tab")
      .map((t) => t.props.accessibilityLabel);
  const selectedTab = (tree: ReactTestRenderer) =>
    tree.root
      .findAllByType(TouchableOpacity)
      .filter((t) => t.props.testID === "folder-tab" && t.props.accessibilityState?.selected)
      .map((t) => t.props.accessibilityLabel);
  const rows = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => n.props.testID === "folder-row" && typeof n.type === "string").map((n) => n.props.children);
  const hasLabel = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => n.props.accessibilityLabel === label).length > 0;
  const openEditor = async (tree: ReactTestRenderer) => act(async () => byLabel(tree, "Edit folders").props.onPress());

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    store.addFolder.mockReset();
    store.removeFolder.mockReset();
    deleteNote.mockClear();
    store.loadFolders.mockResolvedValue(["Games", "Trips"]);
  });
  afterEach(() => {
    alertSpy.mockRestore();
    store.loadFolders.mockResolvedValue([]);
  });

  test("tabs: All, General, then the saved order (folders only notes use come last); All selected", async () => {
    const tree = await renderScreen();
    expect(tabs(tree)).toEqual(["All", "General", "Games", "Trips", "Uni"]);
    expect(selectedTab(tree)).toEqual(["All"]);
  });

  test("tapping a tab shows only that folder's notes", async () => {
    const tree = await renderScreen();
    await pressTab(tree, "Uni");
    expect(selectedTab(tree)).toEqual(["Uni"]);
    expect(shownNotes(tree).sort()).toEqual(["Study for the exam", "לקנות חלב"].sort());
    await pressTab(tree, "General");
    expect(shownNotes(tree)).toEqual(["Buy milk"]);
    await pressTab(tree, "All");
    expect(shownNotes(tree)).toHaveLength(3);
  });

  test("an empty folder says so", async () => {
    const tree = await renderScreen();
    await pressTab(tree, "Games");
    expect(shownNotes(tree)).toEqual([]);
    expect(allText(tree)).toContain("This folder is empty");
  });

  test("the tab is remembered when you come back to the screen", async () => {
    const first = await renderScreen();
    await pressTab(first, "Uni");
    await act(async () => first.unmount());
    const again = await renderScreen();
    expect(selectedTab(again)).toEqual(["Uni"]);
    expect(shownNotes(again)).toHaveLength(2);
  });

  test("a new note starts in the selected folder", async () => {
    const navigate = jest.fn();
    const nav = jest.requireMock("@react-navigation/native");
    const original = nav.useNavigation;
    nav.useNavigation = () => ({ navigate, getParent: () => ({ navigate: jest.fn() }) });
    try {
      const tree = await renderScreen();
      await pressTab(tree, "Uni");
      await act(async () => byLabel(tree, "Add a note").props.onPress());
      expect(navigate).toHaveBeenLastCalledWith("AddEditNote", { initialListName: "Uni" });
      await pressTab(tree, "All");
      await act(async () => byLabel(tree, "Add a note").props.onPress());
      expect(navigate).toHaveBeenLastCalledWith("AddEditNote", { initialListName: undefined });
    } finally {
      nav.useNavigation = original;
    }
  });

  test("the new-folder icon and an edit icon are at the end of the tab row", async () => {
    const tree = await renderScreen();
    const row = tree.root.findAll((n) => n.props.testID === "folder-tabs-row")[0];
    const labels = row.findAllByType(TouchableOpacity).map((t) => t.props.accessibilityLabel);
    expect(labels.slice(-2)).toEqual(["Create a new folder", "Edit folders"]);
  });

  test("the edit icon opens the folder sheet: no checkboxes; General fixed first, no handle or delete", async () => {
    const tree = await renderScreen();
    await openEditor(tree);
    expect(rows(tree)).toEqual(["General", "Games", "Trips", "Uni"]);
    expect(tree.root.findAll((n) => n.props.accessibilityRole === "checkbox")).toHaveLength(0);
    expect(hasLabel(tree, "Delete folder General")).toBe(false);
    expect(hasLabel(tree, "Reorder General")).toBe(false);
    expect(hasLabel(tree, "Delete folder Games")).toBe(true);
    expect(hasLabel(tree, "Reorder Games")).toBe(true);
    await act(async () => byLabel(tree, "Done").props.onPress());
    expect(rows(tree)).toEqual([]);
  });

  test("long-press on a folder tab opens the same sheet", async () => {
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Trips").props.onLongPress());
    expect(rows(tree)).toEqual(["General", "Games", "Trips", "Uni"]);
  });

  test("delete a folder from the sheet: asks, moves its notes to General, never deletes them", async () => {
    store.removeFolder.mockResolvedValue({ folders: ["Games", "Trips"], moved: 2 });
    const tree = await renderScreen();
    await pressTab(tree, "Uni");
    await openEditor(tree);
    await act(async () => byLabel(tree, "Delete folder Uni").props.onPress());
    expect(lastAlert()[1]).toBe('"Uni" has 2 notes. Delete the folder and move them to General?');
    await press("Delete folder");
    expect(store.removeFolder).toHaveBeenCalledWith("Uni");
    expect(deleteNote).not.toHaveBeenCalled();
    expect(rows(tree)).toEqual(["General", "Games", "Trips"]);
    await act(async () => byLabel(tree, "Done").props.onPress());
    // the Uni tab was selected; it's gone, so All shows every note
    expect(tabs(tree)).toEqual(["All", "General", "Games", "Trips"]);
    expect(selectedTab(tree)).toEqual(["All"]);
    expect(shownNotes(tree)).toHaveLength(3);
  });

  test("deleting an empty folder asks a simpler question", async () => {
    store.removeFolder.mockResolvedValue({ folders: ["Trips"], moved: 0 });
    const tree = await renderScreen();
    await openEditor(tree);
    await act(async () => byLabel(tree, "Delete folder Games").props.onPress());
    expect(lastAlert()[1]).toBe('Delete the folder "Games"?');
    await press("Delete folder");
    expect(rows(tree)).toEqual(["General", "Trips", "Uni"]);
  });

  test("a failed delete says so and keeps the folder", async () => {
    store.removeFolder.mockRejectedValue(new TypeError("Network request failed"));
    const tree = await renderScreen();
    await openEditor(tree);
    await act(async () => byLabel(tree, "Delete folder Games").props.onPress());
    await press("Delete folder");
    expect(lastAlert()[0]).toBe("Couldn't delete the folder");
    expect(rows(tree)).toContain("Games");
  });

  test("creating a folder saves it on the server and opens its tab", async () => {
    store.addFolder.mockResolvedValue(["Games", "Trips", "Art"]);
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Create a new folder").props.onPress());
    expect(allText(tree)).toContain("Create New Folder");
    const input = tree.root.findAllByType(TextInput).find((t) => t.props.placeholder === "Folder name")!;
    await act(async () => input.props.onChangeText("Art"));
    await act(async () => byLabel(tree, "Create").props.onPress());
    expect(store.addFolder).toHaveBeenCalledWith("Art");
    expect(tabs(tree)).toEqual(["All", "General", "Games", "Trips", "Art", "Uni"]);
    expect(selectedTab(tree)).toEqual(["Art"]);
  });

  test("a folder that exists with other capitals isn't created again", async () => {
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Create a new folder").props.onPress());
    const input = tree.root.findAllByType(TextInput).find((t) => t.props.placeholder === "Folder name")!;
    for (const name of ["games", " TRIPS ", "uni", "general"]) {
      await act(async () => input.props.onChangeText(name));
      await act(async () => byLabel(tree, "Create").props.onPress());
      expect([name, lastAlert()[1]]).toEqual([name, "That list already exists"]);
    }
    expect(store.addFolder).not.toHaveBeenCalled();
  });
});

describe("the category filter", () => {
  const badge = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => n.props.testID === "filter-count" && typeof n.type === "string")[0];
  const options = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(TouchableOpacity).filter((t) => t.props.testID === "category-option");
  const openSheet = async (tree: ReactTestRenderer) =>
    act(async () => byLabel(tree, "Filter").props.onPress());

  test("the filter button: no count while nothing is checked", async () => {
    const tree = await renderScreen();
    expect(byLabel(tree, "Filter")).toBeTruthy();
    expect(badge(tree)).toBeUndefined();
  });

  test("the sheet lists the four categories with their colors, each with a checkbox", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    expect(options(tree).map((o) => o.props.accessibilityLabel)).toEqual(["To-do", "Shopping", "Idea", "Event"]);
    expect(options(tree).every((o) => o.props.accessibilityRole === "checkbox")).toBe(true);
    expect(options(tree).every((o) => o.props.accessibilityState.checked === false)).toBe(true);
    const dots = options(tree).map((o) => {
      const dot = o.findAll((n) => n.props.testID === "category-dot" && typeof n.type === "string")[0];
      return StyleSheet.flatten(dot.props.style).backgroundColor;
    });
    expect(dots).toEqual([
      DEFAULT_CATEGORY_COLORS.todo,
      DEFAULT_CATEGORY_COLORS.errand,
      DEFAULT_CATEGORY_COLORS.idea,
      DEFAULT_CATEGORY_COLORS.event,
    ]);
  });

  test("check one or several: notes of any of them; the button shows how many", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    await act(async () => categoryOption(tree, "Shopping").props.onPress());
    expect(categoryOption(tree, "Shopping").props.accessibilityState.checked).toBe(true);
    await act(async () => byLabel(tree, "Done").props.onPress());
    expect(shownNotes(tree).sort()).toEqual(["Buy milk", "לקנות חלב"].sort());
    expect(badge(tree).props.children).toBe(1);
    expect(byLabel(tree, "Filter").props.accessibilityValue).toEqual({ text: "1 active" });
    await checkCategories(tree, "To-do");
    expect(shownNotes(tree)).toHaveLength(3);
    expect(badge(tree).props.children).toBe(2);
  });

  test("unchecking every category, or Clear, shows all notes again", async () => {
    const tree = await renderScreen();
    await checkCategories(tree, "Idea");
    expect(shownNotes(tree)).toEqual([]);
    await checkCategories(tree, "Idea");
    expect(shownNotes(tree)).toHaveLength(3);
    await openSheet(tree);
    await act(async () => categoryOption(tree, "Shopping").props.onPress());
    await act(async () => categoryOption(tree, "Event").props.onPress());
    await act(async () => byLabel(tree, "Clear").props.onPress());
    expect(options(tree).every((o) => o.props.accessibilityState.checked === false)).toBe(true);
    await act(async () => byLabel(tree, "Done").props.onPress());
    expect(shownNotes(tree)).toHaveLength(3);
    expect(badge(tree)).toBeUndefined();
  });

  test("the checked categories are remembered when you come back to the screen", async () => {
    const first = await renderScreen();
    await checkCategories(first, "Shopping");
    await act(async () => first.unmount());
    const again = await renderScreen();
    expect(shownNotes(again).sort()).toEqual(["Buy milk", "לקנות חלב"].sort());
    expect(badge(again).props.children).toBe(1);
  });

  test("the category chip row is gone (the sheet replaces it)", async () => {
    const tree = await renderScreen();
    expect(tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === "All categories")).toBe(
      false
    );
    expect(tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === "Shopping notes")).toBe(
      false
    );
  });
});

describe("the place filter", () => {
  const notesMock = jest.requireMock("../api/notes").getNotes as jest.Mock;
  const placesMock = jest.requireMock("../services/placesStore").loadPlaces as jest.Mock;
  // Buy milk: no place (a time only); the exam: at Uni; לקנות חלב: a deleted place
  const PLACED = [
    NOTES[0],
    { ...NOTES[1], contexts: ["p-uni", "09:00"] },
    { ...NOTES[2], contexts: ["p-gone"] },
  ] as Note[];
  const PLACES = [
    { id: "p-home", name: "Home", keywords: [], kind: "home" },
    { id: "p-uni", name: "Uni", keywords: [], kind: "uni" },
    { id: "p-gym", name: "gym  on Dizengoff", keywords: [], kind: null },
  ];
  const placeOptions = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(TouchableOpacity).filter((t) => t.props.testID === "place-option");
  const pickPlace = async (tree: ReactTestRenderer, label: string) => {
    await act(async () => byLabel(tree, "Filter").props.onPress());
    await act(async () => placeOptions(tree).find((o) => o.props.accessibilityLabel === label)!.props.onPress());
    await act(async () => byLabel(tree, "Done").props.onPress());
  };
  const badge = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => n.props.testID === "filter-count" && typeof n.type === "string")[0];

  beforeEach(() => {
    notesMock.mockImplementation(async () => PLACED);
    placesMock.mockResolvedValue(PLACES);
  });
  afterEach(() => {
    notesMock.mockImplementation(async () => NOTES);
    placesMock.mockResolvedValue([]);
  });

  test("the sheet is 'Filter': Categories, then Place with All places, each place as named, No place", async () => {
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Filter").props.onPress());
    const text = allText(tree);
    expect(text).toContain("Filter");
    expect(text).not.toContain("Show categories");
    expect(text.indexOf("Categories")).toBeLessThan(text.indexOf("Place"));
    expect(placeOptions(tree).map((o) => o.props.accessibilityLabel)).toEqual([
      "All places",
      "Home",
      "Uni",
      "gym  on Dizengoff",
      "No place",
    ]);
    expect(placeOptions(tree).every((o) => o.props.accessibilityRole === "radio")).toBe(true);
    expect(placeOptions(tree).map((o) => o.props.accessibilityState.checked)).toEqual([true, false, false, false, false]);
  });

  test("picking a place shows only its notes; the badge counts it", async () => {
    const tree = await renderScreen();
    await pickPlace(tree, "Uni");
    expect(shownNotes(tree)).toEqual(["Study for the exam"]);
    expect(badge(tree).props.children).toBe(1);
    expect(byLabel(tree, "Filter").props.accessibilityValue).toEqual({ text: "1 active" });
    await pickPlace(tree, "Home");
    expect(shownNotes(tree)).toEqual([]);
  });

  test("No place: notes without a place and with a deleted one", async () => {
    const tree = await renderScreen();
    await pickPlace(tree, "No place");
    expect(shownNotes(tree).sort()).toEqual(["Buy milk", "לקנות חלב"].sort());
  });

  test("combines with the categories and the folder; the badge counts both", async () => {
    const tree = await renderScreen();
    await pickPlace(tree, "No place");
    await checkCategories(tree, "Shopping");
    expect(shownNotes(tree).sort()).toEqual(["Buy milk", "לקנות חלב"].sort());
    expect(badge(tree).props.children).toBe(2);
    await pressTab(tree, "Uni");
    expect(shownNotes(tree)).toEqual(["לקנות חלב"]);
  });

  test("Clear resets the categories and the place", async () => {
    const tree = await renderScreen();
    await checkCategories(tree, "Shopping");
    await pickPlace(tree, "Uni");
    await act(async () => byLabel(tree, "Filter").props.onPress());
    await act(async () => byLabel(tree, "Clear").props.onPress());
    expect(placeOptions(tree)[0].props.accessibilityState.checked).toBe(true);
    await act(async () => byLabel(tree, "Done").props.onPress());
    expect(shownNotes(tree)).toHaveLength(3);
    expect(badge(tree)).toBeUndefined();
  });

  test("'Clear search and filter' also resets the place", async () => {
    const tree = await renderScreen();
    await pickPlace(tree, "Home");
    expect(allText(tree)).toContain("No matching notes");
    await act(async () => byLabel(tree, "Clear search and filter").props.onPress());
    expect(shownNotes(tree)).toHaveLength(3);
  });

  test("the place is remembered; a place that's gone falls back to All places", async () => {
    const first = await renderScreen();
    await pickPlace(first, "Uni");
    await act(async () => first.unmount());
    const again = await renderScreen();
    expect(shownNotes(again)).toEqual(["Study for the exam"]);
    await act(async () => again.unmount());
    placesMock.mockResolvedValue(PLACES.filter((p) => p.id !== "p-uni"));
    const after = await renderScreen();
    expect(shownNotes(after)).toHaveLength(3);
    expect(badge(after)).toBeUndefined();
  });
});

describe("Undo after deleting a note", () => {
  const { deleteNote } = jest.requireMock("../api/notes");
  let alertSpy: jest.SpyInstance;
  let appStateHandler: ((state: string) => void) | null;

  const deleteCard = async (tree: ReactTestRenderer, content: string) => {
    const card = tree.root.findAll(
      (n) => n.props.testID === "note-card" && n.props.children === content && typeof n.props.onLongPress === "function"
    )[0];
    await act(async () => card.props.onLongPress());
  };
  const hasUndoBar = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === "Undo");
  const wait = async (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });

  beforeEach(async () => {
    // React's act needs real microtasks; only the clock is fake
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    deleteNote.mockReset();
    deleteNote.mockResolvedValue({ message: "ok" });
    await finishPendingDelete();
    deleteNote.mockClear();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    appStateHandler = null;
    jest.spyOn(AppState, "addEventListener").mockImplementation((_type, handler) => {
      appStateHandler = handler as (state: string) => void;
      return { remove: jest.fn() } as never;
    });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("the note disappears at once and a bar says so; the server delete waits 5 seconds", async () => {
    const tree = await renderScreen();
    await deleteCard(tree, "Study for the exam");
    expect(shownNotes(tree)).not.toContain("Study for the exam");
    expect(allText(tree)).toContain("Note deleted");
    expect(hasUndoBar(tree)).toBe(true);
    await wait(4999);
    expect(deleteNote).not.toHaveBeenCalled();
    await wait(1);
    expect(deleteNote).toHaveBeenCalledWith("b");
    expect(hasUndoBar(tree)).toBe(false);
    expect(allText(tree)).not.toContain("Note deleted");
    expect(shownNotes(tree)).not.toContain("Study for the exam");
  });

  test("the Undo button has the circular back-arrow icon", async () => {
    const tree = await renderScreen();
    await deleteCard(tree, "Buy milk");
    const undo = byLabel(tree, "Undo");
    expect(undo.findAll((n) => n.props.name === "arrow-undo-circle-outline").length).toBeGreaterThan(0);
  });

  test("Undo puts the note back where it was and nothing is deleted", async () => {
    const tree = await renderScreen();
    const before = shownNotes(tree);
    await deleteCard(tree, "לקנות חלב");
    expect(shownNotes(tree)).toHaveLength(2);
    await act(async () => byLabel(tree, "Undo").props.onPress());
    expect(shownNotes(tree)).toEqual(before);
    expect(hasUndoBar(tree)).toBe(false);
    await wait(10000);
    expect(deleteNote).not.toHaveBeenCalled();
    expect(shownNotes(tree)).toEqual(before);
  });

  test("deleting another note finishes the first delete; the bar is for the newest", async () => {
    const tree = await renderScreen();
    await deleteCard(tree, "Buy milk");
    await deleteCard(tree, "Study for the exam");
    expect(deleteNote).toHaveBeenCalledTimes(1);
    expect(deleteNote).toHaveBeenCalledWith("a");
    expect(shownNotes(tree)).toEqual(["לקנות חלב"]);
    await act(async () => byLabel(tree, "Undo").props.onPress());
    expect(shownNotes(tree).sort()).toEqual(["Study for the exam", "לקנות חלב"].sort());
  });

  test("going to the background finishes the delete right away", async () => {
    const tree = await renderScreen();
    await deleteCard(tree, "Buy milk");
    await act(async () => appStateHandler!("background"));
    expect(deleteNote).toHaveBeenCalledWith("a");
    expect(hasUndoBar(tree)).toBe(false);
    expect(shownNotes(tree)).not.toContain("Buy milk");
  });

  test("a failed server delete brings the note back and says so", async () => {
    deleteNote.mockRejectedValueOnce(new TypeError("Network request failed"));
    const tree = await renderScreen();
    await deleteCard(tree, "Buy milk");
    await wait(5000);
    expect(shownNotes(tree)).toContain("Buy milk");
    expect(alertSpy).toHaveBeenCalledWith("Couldn't delete the note", "Check your connection and try again.");
  });

  test("a note deleted on the edit screen is hidden here, with the bar", async () => {
    deleteWithUndo(NOTES[0]);
    const tree = await renderScreen();
    expect(shownNotes(tree)).not.toContain("Buy milk");
    expect(hasUndoBar(tree)).toBe(true);
    await act(async () => byLabel(tree, "Undo").props.onPress());
    expect(shownNotes(tree)).toContain("Buy milk");
  });

  test("deleting the only note shows the empty screen, and Undo brings it back", async () => {
    (getNotes as jest.Mock).mockResolvedValueOnce([NOTES[0]]);
    const tree = await renderScreen();
    await deleteCard(tree, "Buy milk");
    expect(allText(tree)).toContain("No notes yet");
    expect(hasUndoBar(tree)).toBe(true);
    await act(async () => byLabel(tree, "Undo").props.onPress());
    expect(shownNotes(tree)).toEqual(["Buy milk"]);
  });
});

describe("ticking a to-do as done", () => {
  const { deleteNote } = jest.requireMock("../api/notes");
  const tick = async (tree: ReactTestRenderer, content: string) => {
    const box = tree.root.findAll(
      (n) => n.props.testID === "note-done" && n.props.children === content && typeof n.props.onPress === "function"
    )[0];
    await act(async () => box.props.onPress());
  };
  const wait = async (ms: number) =>
    act(async () => {
      jest.advanceTimersByTime(ms);
    });

  beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    deleteNote.mockReset();
    deleteNote.mockResolvedValue({ message: "ok" });
    await finishPendingDelete();
    deleteNote.mockClear();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("the note goes away with a 'Marked done' bar, and is deleted after 5 seconds", async () => {
    const tree = await renderScreen();
    await tick(tree, "Study for the exam");
    expect(shownNotes(tree)).not.toContain("Study for the exam");
    expect(allText(tree)).toContain("Marked done");
    expect(allText(tree)).not.toContain("Note deleted");
    await wait(5000);
    expect(deleteNote).toHaveBeenCalledWith("b");
    expect(shownNotes(tree)).not.toContain("Study for the exam");
  });

  test("Undo brings the to-do back and nothing is deleted", async () => {
    const tree = await renderScreen();
    const before = shownNotes(tree);
    await tick(tree, "Study for the exam");
    await act(async () => byLabel(tree, "Undo").props.onPress());
    expect(shownNotes(tree)).toEqual(before);
    await wait(10000);
    expect(deleteNote).not.toHaveBeenCalled();
  });

  test("a plain delete after a done still says 'Note deleted'", async () => {
    const tree = await renderScreen();
    await tick(tree, "Study for the exam");
    const card = tree.root.findAll(
      (n) => n.props.testID === "note-card" && n.props.children === "Buy milk" && typeof n.props.onLongPress === "function"
    )[0];
    await act(async () => card.props.onLongPress());
    expect(allText(tree)).toContain("Note deleted");
    expect(allText(tree)).not.toContain("Marked done");
  });
});

describe("reordering folders", () => {
  const store = jest.requireMock("../services/foldersStore");
  let alertSpy: jest.SpyInstance;
  const options = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => n.props.testID === "folder-row" && typeof n.type === "string").map((n) => n.props.children);
  const handle = (tree: ReactTestRenderer, name: string) =>
    tree.root.findAll((n) => n.props.accessibilityLabel === `Reorder ${name}` && typeof n.type !== "string")[0];
  const hasHandle = (tree: ReactTestRenderer, name: string) =>
    tree.root.findAll((n) => n.props.accessibilityLabel === `Reorder ${name}`).length > 0;
  const move = async (tree: ReactTestRenderer, name: string, action: "moveUp" | "moveDown") =>
    act(async () => handle(tree, name).props.onAccessibilityAction({ nativeEvent: { actionName: action } }));
  const openSheet = async (tree: ReactTestRenderer) => act(async () => byLabel(tree, "Edit folders").props.onPress());

  beforeEach(() => {
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    store.loadFolders.mockResolvedValue(["Uni", "Games", "Trips"]);
    store.reorderFolders.mockReset();
    store.reorderFolders.mockImplementation(async (names: string[]) => names);
  });
  afterEach(() => {
    alertSpy.mockRestore();
    store.loadFolders.mockResolvedValue([]);
  });

  test("the sheet lists folders in the saved order, General fixed first", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    expect(options(tree)).toEqual(["General", "Uni", "Games", "Trips"]);
  });

  test("every folder but General has a drag handle, with move up / down for screen readers", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    expect(hasHandle(tree, "General")).toBe(false);
    for (const name of ["Uni", "Games", "Trips"]) {
      expect(hasHandle(tree, name)).toBe(true);
    }
    const games = tree.root.findAll(
      (n) => n.props.accessibilityLabel === "Reorder Games" && Array.isArray(n.props.accessibilityActions)
    )[0];
    expect(games.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      "moveUp",
      "moveDown",
    ]);
  });

  test("the folder tabs follow the new order", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    await move(tree, "Trips", "moveUp");
    const tabs = tree.root
      .findAllByType(TouchableOpacity)
      .filter((t) => t.props.testID === "folder-tab")
      .map((t) => t.props.accessibilityLabel);
    expect(tabs).toEqual(["All", "General", "Uni", "Trips", "Games"]);
  });

  test("moving a folder saves the new order and shows it right away", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    await move(tree, "Trips", "moveUp");
    expect(store.reorderFolders).toHaveBeenLastCalledWith(["Uni", "Trips", "Games"]);
    expect(options(tree)).toEqual(["General", "Uni", "Trips", "Games"]);
    await move(tree, "Uni", "moveDown");
    expect(store.reorderFolders).toHaveBeenLastCalledWith(["Trips", "Uni", "Games"]);
    expect(options(tree)).toEqual(["General", "Trips", "Uni", "Games"]);
  });

  test("the first folder can't go above General, the last can't go further down", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    await move(tree, "Uni", "moveUp");
    await move(tree, "Trips", "moveDown");
    expect(store.reorderFolders).not.toHaveBeenCalled();
    expect(options(tree)).toEqual(["General", "Uni", "Games", "Trips"]);
  });

  test("a drag that ends lower in the list saves that order", async () => {
    const tree = await renderScreen();
    await openSheet(tree);
    const sheet = tree.root.findAll((n) => typeof n.props.onReorder === "function")[0];
    await act(async () => sheet.props.onReorder(["Games", "Trips", "Uni"]));
    expect(store.reorderFolders).toHaveBeenLastCalledWith(["Games", "Trips", "Uni"]);
    expect(options(tree)).toEqual(["General", "Games", "Trips", "Uni"]);
  });

  test("a failed save puts the old order back and says so", async () => {
    store.reorderFolders.mockRejectedValueOnce(new TypeError("Network request failed"));
    const tree = await renderScreen();
    await openSheet(tree);
    await move(tree, "Trips", "moveUp");
    expect(options(tree)).toEqual(["General", "Uni", "Games", "Trips"]);
    expect(alertSpy).toHaveBeenCalledWith("Couldn't save the folder order", "Check your connection and try again.");
  });
});
