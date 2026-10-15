import React from "react";
import { Switch, Text, TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import AddEditNoteScreen from "./AddEditNoteScreen";
import { createNote, updateNote } from "../api/notes";
import { Note } from "../types/notes";

const mockNavigation = { goBack: jest.fn(), setOptions: jest.fn() };
let mockParams: Record<string, unknown> | undefined;

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return {
    useNavigation: () => mockNavigation,
    useRoute: () => ({ params: mockParams }),
    useFocusEffect: (cb: () => void) => React.useEffect(() => cb(), []),
  };
});
jest.mock("../api/notes", () => ({
  createNote: jest.fn().mockResolvedValue({}),
  updateNote: jest.fn().mockResolvedValue({}),
  getNotes: jest.fn().mockResolvedValue([{ list_name: "Games" }, { list_name: "General" }]),
}));
jest.mock("../services/pendingDelete", () => ({ deleteWithUndo: jest.fn() }));
jest.mock("../services/foldersStore", () => ({ loadFolders: jest.fn().mockResolvedValue(["Work", "Empty"]) }));
jest.mock("../services/scheduledReminders", () => ({ syncScheduledReminders: jest.fn() }));
jest.mock("../services/storeAlerts", () => ({ syncStoreAlerts: jest.fn() }));
jest.mock("../services/placesStore", () => ({
  loadPlaces: jest.fn().mockResolvedValue([
    { id: "id-home", name: "Home", keywords: [], kind: "home" },
    { id: "id-uni", name: "Uni", keywords: [], kind: "uni" },
  ]),
}));
// the native picker: render a stand-in we can drive through onChange
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  return { __esModule: true, default: (props: { mode: string }) => <View testID={`picker-${props.mode}`} {...props} /> };
});

const EXISTING = {
  _id: "note-1",
  content: "go for an evening jog",
  category: "todo",
  contexts: ["18:00"],
  list_name: "General",
  reminders_enabled: true,
  category_explicit: false,
  location_explicit: false,
  location_value: null,
  remind_date_explicit: false,
  remind_time_explicit: false,
  remind_at_hour: null,
  remind_at_minute: null,
  remind_on_date: null,
} as unknown as Note;

function allText(node: ReactTestInstance): string {
  return node
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(""))
    .join(" | ");
}

// the touchable whose own text is exactly `label`
function pressable(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const match = tree.root
    .findAllByType(TouchableOpacity)
    .filter((t) => t.findAllByType(Text).some((x) => [x.props.children].flat().join("") === label));
  if (match.length === 0) {
    throw new Error(`nothing pressable labelled "${label}"`);
  }
  return match[match.length - 1];
}

async function press(tree: ReactTestRenderer, label: string) {
  await act(async () => {
    await pressable(tree, label).props.onPress();
  });
}

async function renderScreen(params?: Record<string, unknown>) {
  mockParams = params;
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<AddEditNoteScreen />);
  });
  return tree;
}

beforeEach(() => jest.clearAllMocks());

test("editing: title 'Edit note'; Save sends the note unchanged and goes back", async () => {
  const tree = await renderScreen({ note: EXISTING });
  expect(allText(tree.root)).toContain("Edit note");
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith(
    "note-1",
    expect.objectContaining({
      content: "go for an evening jog",
      list_name: "General",
      category_explicit: false,
      location_explicit: false,
      remind_time_explicit: false,
      remind_at_hour: "",
      reminders_enabled: true,
    })
  );
  expect(mockNavigation.goBack).toHaveBeenCalled();
});

test("a time picked in the Time tile is saved (not a stale value)", async () => {
  const tree = await renderScreen({ note: EXISTING });
  await press(tree, "Time");
  const picker = tree.root.findByProps({ testID: "picker-time" });
  await act(async () => {
    picker.props.onChange({ type: "set" }, new Date(2026, 9, 4, 14, 30));
  });
  expect(allText(tree.root)).toContain("14:30");
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith(
    "note-1",
    expect.objectContaining({ remind_time_explicit: true, remind_at_hour: "14", remind_at_minute: "30" })
  );
});

test("a date picked in the Date tile is saved", async () => {
  const tree = await renderScreen({ note: EXISTING });
  await press(tree, "Date");
  await act(async () => {
    tree.root.findByProps({ testID: "picker-date" }).props.onChange({ type: "set" }, new Date(2026, 9, 7));
  });
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith(
    "note-1",
    expect.objectContaining({ remind_date_explicit: true, remind_on_date: "2026-10-07" })
  );
});

test("Reset to Smart clears the explicit date and time", async () => {
  const tree = await renderScreen({
    note: {
      ...EXISTING,
      remind_date_explicit: true,
      remind_on_date: "2026-10-07",
      remind_time_explicit: true,
      remind_at_hour: 9,
      remind_at_minute: 15,
    },
  });
  expect(allText(tree.root)).toContain("09:15");
  await press(tree, "Reset to Smart");
  expect(allText(tree.root)).not.toContain("09:15");
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith(
    "note-1",
    expect.objectContaining({
      remind_date_explicit: false,
      remind_on_date: "",
      remind_time_explicit: false,
      remind_at_hour: "",
    })
  );
});

test("turning the phone alert off is saved", async () => {
  const tree = await renderScreen({ note: EXISTING });
  await act(async () => {
    tree.root.findByType(Switch).props.onValueChange(false);
  });
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith("note-1", expect.objectContaining({ reminders_enabled: false }));
});

test("category: a chip sets it explicitly, Smart goes back to smart", async () => {
  const tree = await renderScreen({ note: EXISTING });
  await press(tree, "Errand");
  await press(tree, "Save");
  expect(updateNote).toHaveBeenLastCalledWith(
    "note-1",
    expect.objectContaining({ category: "errand", category_explicit: true })
  );
  // "Smart" chips (labelled "Smart"; the Date/Time tiles are "Date: Smart"); the first is Category's
  const smartChips = tree.root
    .findAllByType(TouchableOpacity)
    .filter((t) => t.props.accessibilityLabel === "Smart");
  await act(async () => smartChips[0].props.onPress());
  await press(tree, "Save");
  expect(updateNote).toHaveBeenLastCalledWith("note-1", expect.objectContaining({ category_explicit: false }));
});

test("place: a chip sets the place id explicitly", async () => {
  const tree = await renderScreen({ note: EXISTING });
  await press(tree, "Uni");
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith(
    "note-1",
    expect.objectContaining({ location_explicit: true, location_value: "id-uni" })
  );
});

test("folder: chips start with General, then the user's folder order; picking one is saved", async () => {
  const tree = await renderScreen({ note: EXISTING });
  const text = allText(tree.root);
  // the saved order is Work, Empty; Games is only used by a note (not saved yet), so last
  expect(text.indexOf("General")).toBeLessThan(text.indexOf("Work"));
  expect(text.indexOf("Work")).toBeLessThan(text.indexOf("Empty"));
  expect(text.indexOf("Empty")).toBeLessThan(text.indexOf("Games"));
  await press(tree, "Games");
  await press(tree, "Save");
  expect(updateNote).toHaveBeenCalledWith("note-1", expect.objectContaining({ list_name: "Games" }));
});

test("new note: title 'New note', starts in the given folder, Save creates it", async () => {
  const tree = await renderScreen({ initialListName: "Work" });
  expect(allText(tree.root)).toContain("New note");
  await act(async () => {
    tree.root.findByType(TextInput).props.onChangeText("buy milk");
  });
  await press(tree, "Save");
  expect(createNote).toHaveBeenCalledWith(
    "buy milk",
    "Work",
    true,
    false,
    expect.any(String),
    false,
    undefined,
    false,
    false,
    undefined,
    undefined,
    undefined
  );
});

test("the back button goes back without saving", async () => {
  const tree = await renderScreen({ note: EXISTING });
  await act(async () => {
    tree.root.findByProps({ accessibilityLabel: "Back" }).props.onPress();
  });
  expect(mockNavigation.goBack).toHaveBeenCalled();
  expect(updateNote).not.toHaveBeenCalled();
});

test("category chips: the four kinds; an old kind shows as To-do", async () => {
  const tree = await renderScreen({ note: { ...EXISTING, category: "scheduled", category_explicit: true } });
  const chip = (label: string) =>
    tree.root.findAll((n) => typeof n.type !== "string" && n.props.accessibilityLabel === label && n.props.onPress)[0];
  for (const label of ["To-do", "Errand", "Idea", "Event"]) {
    expect(chip(label)).toBeTruthy();
  }
  expect(chip("Reminder")).toBeUndefined();
  expect(chip("Scheduled")).toBeUndefined();
  expect(chip("To-do").props.accessibilityState.selected).toBe(true);
  await press(tree, "Save");
  expect(updateNote).toHaveBeenLastCalledWith("note-1", expect.objectContaining({ category: "todo" }));
});

test("too many saves: the server's message is shown", async () => {
  const { Alert } = require("react-native");
  const { ApiError } = jest.requireActual("../api/client");
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  (updateNote as jest.Mock).mockRejectedValueOnce(
    new ApiError(429, JSON.stringify({ detail: { kind: "too_many_requests", message: "Too many changes, try again in a minute." } }))
  );
  const tree = await renderScreen({ note: EXISTING });
  await press(tree, "Save");
  expect(alert).toHaveBeenCalledWith("Error", "Too many changes, try again in a minute.");
  alert.mockRestore();
});

test("the note text is limited to 5000 characters, like the server", async () => {
  const tree = await renderScreen({ note: EXISTING });
  expect(tree.root.findByType(TextInput).props.maxLength).toBe(5000);
});

test("the folder picker shows empty folders too", async () => {
  const tree = await renderScreen({ note: EXISTING });
  expect(allText(tree.root)).toContain("Empty");
});

describe("Delete", () => {
  const { deleteWithUndo } = jest.requireMock("../services/pendingDelete");
  const hasDelete = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === "Delete note");

  test("editing: Delete hides the note with Undo on the list and goes back", async () => {
    const tree = await renderScreen({ note: EXISTING });
    const button = tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === "Delete note")!;
    await act(async () => button.props.onPress());
    expect(deleteWithUndo).toHaveBeenCalledWith(EXISTING);
    expect(mockNavigation.goBack).toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
  });

  test("a new note has no Delete button", async () => {
    const tree = await renderScreen();
    expect(hasDelete(tree)).toBe(false);
  });
});
