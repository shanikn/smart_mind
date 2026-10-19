import React from "react";
import { Alert, StyleSheet, Text, TouchableOpacity } from "react-native";
import TestRenderer, { act, ReactTestRenderer } from "react-test-renderer";
import NoteCard from "./NoteCard";
import { CATEGORIES, categoryLabel, DEFAULT_CATEGORY_COLORS, hueOf } from "../lib/categoryColors";
import { lightColors } from "../theme";
import { Note } from "../types/notes";

// the swipe needs native gestures: render the card and its swipe action side by side
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  return {
    Swipeable: ({ children, renderRightActions }: { children: React.ReactNode; renderRightActions: () => React.ReactNode }) => (
      <View>
        {children}
        {renderRightActions()}
      </View>
    ),
  };
});

const NOTE = {
  _id: "a",
  content: "Buy milk",
  category: "errand",
  list_name: "General",
  contexts: [],
  reminders_enabled: true,
  created_at: "2026-10-04T09:00:00",
} as unknown as Note;

async function renderCard(onDelete: jest.Mock, note: Note = NOTE, onDone?: jest.Mock) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <NoteCard
        note={note}
        onPress={jest.fn()}
        onDelete={onDelete}
        onDone={onDone}
        places={[]}
        categoryColors={DEFAULT_CATEGORY_COLORS}
      />
    );
  });
  return tree;
}

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alertSpy.mockRestore());

test("swipe -> Delete deletes at once, no confirmation (Undo covers it)", async () => {
  const onDelete = jest.fn();
  const tree = await renderCard(onDelete);
  const action = tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === "Delete note")!;
  await act(async () => action.props.onPress());
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(alertSpy).not.toHaveBeenCalled();
});

test("long-press deletes the same way, with no confirmation", async () => {
  const onDelete = jest.fn();
  const tree = await renderCard(onDelete);
  const card = tree.root.findAllByType(TouchableOpacity).find((t) => typeof t.props.onLongPress === "function")!;
  await act(async () => card.props.onLongPress());
  expect(onDelete).toHaveBeenCalledTimes(1);
  expect(alertSpy).not.toHaveBeenCalled();
});

describe("the done checkbox on to-do notes", () => {
  const checkbox = (tree: ReactTestRenderer) =>
    tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === "Mark done");

  test("a to-do note has an empty checkbox; tapping it marks the note done (not a plain delete)", async () => {
    const onDelete = jest.fn();
    const onDone = jest.fn();
    const tree = await renderCard(onDelete, { ...NOTE, category: "todo" } as Note, onDone);
    const box = checkbox(tree)!;
    expect(box.props.accessibilityRole).toBe("checkbox");
    expect(box.props.accessibilityState).toEqual({ checked: false });
    expect(box.findAll((n) => n.props.name === "ellipse-outline").length).toBeGreaterThan(0);
    await act(async () => box.props.onPress());
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDelete).not.toHaveBeenCalled();
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("old kinds that count as To-do (task, no category) get the checkbox too", async () => {
    for (const category of ["task", undefined]) {
      const tree = await renderCard(jest.fn(), { ...NOTE, category } as Note, jest.fn());
      expect(checkbox(tree)).toBeDefined();
    }
  });

  test.each(["errand", "idea", "event"])("a %s note has no checkbox", async (category) => {
    const tree = await renderCard(jest.fn(), { ...NOTE, category } as Note, jest.fn());
    expect(checkbox(tree)).toBeUndefined();
  });

  test("no checkbox when the screen doesn't handle done", async () => {
    const tree = await renderCard(jest.fn(), { ...NOTE, category: "todo" } as Note);
    expect(checkbox(tree)).toBeUndefined();
  });
});

test.each(CATEGORIES.map((c) => [c]))("the %s label on the card is drawn in its category color", async (category) => {
  const tree = await renderCard(jest.fn(), { ...NOTE, category } as Note);
  const label = tree.root.findAllByType(Text).find((t) => t.props.children === categoryLabel(category))!;
  const color = StyleSheet.flatten(label.props.style).color as string;
  expect(color).not.toBe(lightColors.textMuted);
  expect(Math.abs(hueOf(color) - hueOf(DEFAULT_CATEGORY_COLORS[category]))).toBeLessThanOrEqual(2);
});

describe("the alert time on the right", () => {
  const timeText = (tree: ReactTestRenderer, time: string) =>
    tree.root.findAllByType(Text).find((t) => t.props.children === time);
  const sparkles = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => n.props.name === "sparkles-outline" && typeof n.type !== "string");

  test("a time Smart picked shows in green with the Smart sparkles next to it", async () => {
    const tree = await renderCard(jest.fn(), { ...NOTE, contexts: ["18:00"] } as Note);
    const time = timeText(tree, "18:00")!;
    expect(time).toBeDefined();
    expect(StyleSheet.flatten(time.props.style).color).toBe(lightColors.primary);
    expect(sparkles(tree).length).toBeGreaterThan(0);
  });

  test("a time the user set shows plain, without sparkles", async () => {
    const set = { ...NOTE, remind_time_explicit: true, remind_at_hour: 18, remind_at_minute: 0 } as Note;
    const tree = await renderCard(jest.fn(), set);
    const time = timeText(tree, "18:00")!;
    expect(StyleSheet.flatten(time.props.style).color).toBe(lightColors.text);
    expect(sparkles(tree)).toHaveLength(0);
  });

  // local "YYYY-MM-DD" for today + n days
  const dayIn = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const labelled = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.type !== "string");

  test("a Smart time tomorrow shows the day, still green with sparkles, and says the day", async () => {
    const tree = await renderCard(jest.fn(), { ...NOTE, contexts: ["09:25"], remind_on_date: dayIn(1) } as Note);
    const time = timeText(tree, "Tomorrow 09:25")!;
    expect(time).toBeDefined();
    expect(StyleSheet.flatten(time.props.style).color).toBe(lightColors.primary);
    expect(sparkles(tree).length).toBeGreaterThan(0);
    expect(labelled(tree, "Smart alert tomorrow at 09:25").length).toBeGreaterThan(0);
  });

  test("a time the user set for a later day shows the date, plain, and says it", async () => {
    // a fixed "now" (the card has no now prop, so the clock is set): 9 days
    // later is in September, which en-GB shortens to "Sept"; the card says "Sep"
    jest.useFakeTimers({ now: new Date(2026, 8, 15, 12, 0), doNotFake: ["queueMicrotask", "nextTick", "setImmediate"] });
    try {
      const set = {
        ...NOTE,
        remind_time_explicit: true,
        remind_at_hour: 9,
        remind_at_minute: 25,
        remind_on_date: "2026-09-24",
      } as Note;
      const tree = await renderCard(jest.fn(), set);
      const time = timeText(tree, "24 Sep 09:25")!;
      expect(time).toBeDefined();
      expect(StyleSheet.flatten(time.props.style).color).toBe(lightColors.text);
      expect(sparkles(tree)).toHaveLength(0);
      expect(labelled(tree, "Alert on 24 September at 09:25").length).toBeGreaterThan(0);
    } finally {
      jest.useRealTimers();
    }
  });

  test("a Smart time today shows just the time", async () => {
    const tree = await renderCard(jest.fn(), { ...NOTE, contexts: ["09:25"], remind_on_date: dayIn(0) } as Note);
    expect(timeText(tree, "09:25")).toBeDefined();
    expect(labelled(tree, "Smart alert at 09:25").length).toBeGreaterThan(0);
  });

  test("no time at all (place only): just the sparkles", async () => {
    const tree = await renderCard(jest.fn(), NOTE);
    expect(tree.root.findAllByType(Text).some((t) => /^\d{2}:\d{2}$/.test(String(t.props.children)))).toBe(false);
    expect(sparkles(tree).length).toBeGreaterThan(0);
  });
});
