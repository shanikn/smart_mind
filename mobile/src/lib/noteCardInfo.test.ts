import { currentPlaceLabel, noteCardInfo } from "./noteCardInfo";
import { CATEGORIES, contrastRatio, DEFAULT_CATEGORY_COLORS, hueOf } from "./categoryColors";
import { darkColors, lightColors as colors } from "../theme";
import { Note } from "../types/notes";

const PLACES = [
  { id: "id-home", name: "Home", keywords: [], kind: "home" as const },
  { id: "id-gym", name: "Gym", keywords: [], kind: null },
];

function note(fields: Partial<Note>): Note {
  return {
    _id: "n1",
    content: "note",
    category: "todo",
    contexts: [],
    list_name: "General",
    reminders_enabled: true,
    remind_at_hour: null,
    remind_at_minute: null,
    remind_on_date: null,
    ...fields,
  } as Note;
}

describe("icon tile", () => {
  test.each([
    ["todo", "checkbox-outline"],
    ["errand", "bag-outline"],
    ["idea", "bulb-outline"],
    ["event", "calendar-outline"],
    ["scheduled", "checkbox-outline"],
    ["reminder", "checkbox-outline"],
    ["uncategorized", "checkbox-outline"],
    ["task", "checkbox-outline"],
    ["something-new", "checkbox-outline"],
  ])("%s -> %s", (category, icon) => {
    expect(noteCardInfo(note({ category }), PLACES, DEFAULT_CATEGORY_COLORS).icon).toBe(icon);
  });

  test("background is the user's category color, icon black or white by contrast", () => {
    const custom = { ...DEFAULT_CATEGORY_COLORS, todo: "#FFEB3B" };
    const info = noteCardInfo(note({ category: "todo" }), PLACES, custom);
    expect(info.tileColor).toBe("#FFEB3B");
    expect(info.tileIconColor).toBe("#000000");
    const dflt = noteCardInfo(note({ category: "todo" }), PLACES, DEFAULT_CATEGORY_COLORS);
    expect(dflt.tileIconColor).toBe("#FFFFFF");
  });
});

describe("meta line", () => {
  test("category name capitalized", () => {
    expect(noteCardInfo(note({ category: "errand" }), PLACES, DEFAULT_CATEGORY_COLORS).categoryLabel).toBe("Shopping");
  });

  test("category text uses its color when readable on white (contrast >= 4.5)", () => {
    expect(noteCardInfo(note({ category: "todo" }), PLACES, DEFAULT_CATEGORY_COLORS).categoryTextColor).toBe(
      DEFAULT_CATEGORY_COLORS.todo
    );
  });

  // every kind shows in its own color: as is when readable, else a darker
  // (light mode) or lighter (dark mode) shade of it, never the grey textMuted
  describe.each([
    ["light", colors],
    ["dark", darkColors],
  ])("each category gets its color on the %s card", (_mode, palette) => {
    test.each(CATEGORIES.map((c) => [c]))("%s", (category) => {
      const color = DEFAULT_CATEGORY_COLORS[category];
      const shown = noteCardInfo(note({ category }), PLACES, DEFAULT_CATEGORY_COLORS, palette).categoryTextColor;
      expect(shown).not.toBe(palette.textMuted);
      expect(contrastRatio(shown, palette.surface)).toBeGreaterThanOrEqual(4.5);
      expect(Math.abs(hueOf(shown) - hueOf(color))).toBeLessThanOrEqual(2);
    });
  });

  test("Shopping's green (contrast 4.1 on white) shows as a slightly darker green, not grey", () => {
    const shown = noteCardInfo(note({ category: "errand" }), PLACES, DEFAULT_CATEGORY_COLORS).categoryTextColor;
    expect(shown).not.toBe(DEFAULT_CATEGORY_COLORS.errand);
    expect(shown).not.toBe(colors.textMuted);
    expect(contrastRatio(shown, colors.surface)).toBeGreaterThanOrEqual(4.5);
    // only as dark as needed
    expect(contrastRatio(shown, colors.surface)).toBeLessThan(5);
  });

  test("a light custom color (yellow) is darkened until readable on white", () => {
    const custom = { ...DEFAULT_CATEGORY_COLORS, idea: "#FFEB3B" };
    const shown = noteCardInfo(note({ category: "idea" }), PLACES, custom).categoryTextColor;
    expect(shown).not.toBe(colors.textMuted);
    expect(contrastRatio(shown, colors.surface)).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hueOf(shown) - hueOf("#FFEB3B"))).toBeLessThanOrEqual(2);
  });

  test("dark mode: category text must be readable on the dark card", () => {
    // the default to-do blue is too dark on a dark card -> a lighter blue
    const todo = noteCardInfo(note({ category: "todo" }), PLACES, DEFAULT_CATEGORY_COLORS, darkColors).categoryTextColor;
    expect(todo).not.toBe(darkColors.textMuted);
    expect(contrastRatio(todo, darkColors.surface)).toBeGreaterThanOrEqual(4.5);
    // a light yellow reads fine on a dark card
    const custom = { ...DEFAULT_CATEGORY_COLORS, idea: "#FFEB3B" };
    expect(noteCardInfo(note({ category: "idea" }), PLACES, custom, darkColors).categoryTextColor).toBe("#FFEB3B");
    // the icon tile keeps black/white by contrast with the category color itself
    expect(noteCardInfo(note({ category: "idea" }), PLACES, custom, darkColors).tileIconColor).toBe("#000000");
  });

  test("place name when the note has a place, otherwise none", () => {
    expect(noteCardInfo(note({ contexts: ["id-gym", "18:00"] }), PLACES, DEFAULT_CATEGORY_COLORS).placeName).toBe("Gym");
    expect(noteCardInfo(note({ contexts: ["18:00"] }), PLACES, DEFAULT_CATEGORY_COLORS).placeName).toBeNull();
  });

  test("folder name only when it isn't General", () => {
    expect(noteCardInfo(note({ list_name: "Games" }), PLACES, DEFAULT_CATEGORY_COLORS).folderName).toBe("Games");
    expect(noteCardInfo(note({ list_name: "General" }), PLACES, DEFAULT_CATEGORY_COLORS).folderName).toBeNull();
    expect(noteCardInfo(note({ list_name: "" }), PLACES, DEFAULT_CATEGORY_COLORS).folderName).toBeNull();
  });
});

describe("right side", () => {
  test("a time the user set: plain time", () => {
    const set = note({ remind_time_explicit: true, remind_at_hour: 8, remind_at_minute: 5 });
    expect(noteCardInfo(set, PLACES, DEFAULT_CATEGORY_COLORS).trailing).toMatchObject({
      kind: "time",
      time: "08:05",
      smart: false,
    });
  });

  test("a time Smart picked (from the note text or a place default): the time, marked smart", () => {
    expect(noteCardInfo(note({ contexts: ["17:54"] }), PLACES, DEFAULT_CATEGORY_COLORS).trailing).toMatchObject({
      kind: "time",
      time: "17:54",
      smart: true,
    });
    expect(
      noteCardInfo(note({ contexts: ["id-home", "09:00"], reminder_time_source: "default" }), PLACES, DEFAULT_CATEGORY_COLORS)
        .trailing
    ).toMatchObject({ kind: "time", time: "09:00", smart: true });
  });

  test("a leftover hour without the 'set by me' flag still counts as Smart", () => {
    const leftover = note({ remind_time_explicit: false, remind_at_hour: 14, remind_at_minute: 0 });
    expect(noteCardInfo(leftover, PLACES, DEFAULT_CATEGORY_COLORS).trailing).toMatchObject({
      kind: "time",
      time: "14:00",
      smart: true,
    });
  });

  test("smart alerts with no time at all (place only): just sparkles", () => {
    expect(noteCardInfo(note({}), PLACES, DEFAULT_CATEGORY_COLORS).trailing).toEqual({ kind: "smart" });
  });

  test("alerts off: bell-off", () => {
    expect(noteCardInfo(note({ reminders_enabled: false }), PLACES, DEFAULT_CATEGORY_COLORS).trailing).toEqual({
      kind: "off",
    });
  });

  test("alerts off wins over a time: bell-off, not a time that won't ring", () => {
    expect(
      noteCardInfo(note({ reminders_enabled: false, contexts: ["17:54"] }), PLACES, DEFAULT_CATEGORY_COLORS).trailing
    ).toEqual({ kind: "off" });
  });
});

describe("the day of an alert that isn't today", () => {
  // Wednesday 14 Oct 2026, 12:00
  const NOW = new Date(2026, 9, 14, 12, 0);
  const at = (remind_on_date: string | null, fields: Partial<Note> = {}) =>
    noteCardInfo(note({ contexts: ["09:25"], remind_on_date, ...fields }), PLACES, DEFAULT_CATEGORY_COLORS, colors, NOW)
      .trailing;

  test.each([
    ["no date (repeats daily)", null, null, "09:25", "Smart alert at 09:25"],
    ["today", "2026-10-14", null, "09:25", "Smart alert at 09:25"],
    ["tomorrow", "2026-10-15", "Tomorrow", "Tomorrow 09:25", "Smart alert tomorrow at 09:25"],
    ["in 2 days", "2026-10-16", "Fri", "Fri 09:25", "Smart alert on Friday at 09:25"],
    ["in 6 days", "2026-10-20", "Tue", "Tue 09:25", "Smart alert on Tuesday at 09:25"],
    ["in 7 days", "2026-10-21", "21 Oct", "21 Oct 09:25", "Smart alert on 21 October at 09:25"],
    ["further out", "2026-10-23", "23 Oct", "23 Oct 09:25", "Smart alert on 23 October at 09:25"],
    ["next month", "2026-11-02", "2 Nov", "2 Nov 09:25", "Smart alert on 2 November at 09:25"],
    ["yesterday (overdue)", "2026-10-13", "13 Oct", "13 Oct 09:25", "Smart alert on 13 October at 09:25"],
    ["last week (overdue)", "2026-10-05", "5 Oct", "5 Oct 09:25", "Smart alert on 5 October at 09:25"],
  ])("%s", (_name, date, day, label, spoken) => {
    expect(at(date)).toEqual({
      kind: "time",
      time: "09:25",
      day,
      label,
      accessibilityLabel: spoken,
      smart: true,
    });
  });

  test("a time the user set gets the day too, and stays not smart", () => {
    const set = at("2026-10-15", { remind_time_explicit: true, remind_at_hour: 9, remind_at_minute: 25 });
    expect(set).toEqual({
      kind: "time",
      time: "09:25",
      day: "Tomorrow",
      label: "Tomorrow 09:25",
      accessibilityLabel: "Alert tomorrow at 09:25",
      smart: false,
    });
  });

  test("a dated note with no time keeps just the sparkles", () => {
    expect(
      noteCardInfo(note({ remind_on_date: "2026-10-15" }), PLACES, DEFAULT_CATEGORY_COLORS, colors, NOW).trailing
    ).toEqual({ kind: "smart" });
  });
});

describe("currentPlaceLabel (the chip at the top of the list)", () => {
  test("a known place", () => {
    expect(currentPlaceLabel("id-home", PLACES)).toBe("At Home");
  });

  test("unknown, or a place that no longer exists", () => {
    expect(currentPlaceLabel("unknown", PLACES)).toBe("No place");
    expect(currentPlaceLabel("id-deleted", PLACES)).toBe("No place");
  });

  test("an old stored name like 'home' maps to the place of that kind", () => {
    expect(currentPlaceLabel("home", PLACES)).toBe("At Home");
  });
});

describe("kinds on the card", () => {
  test("labels: To-do, Shopping, Idea, Event; old values show as To-do", () => {
    expect(noteCardInfo(note({ category: "todo" }), PLACES, DEFAULT_CATEGORY_COLORS).categoryLabel).toBe("To-do");
    expect(noteCardInfo(note({ category: "event" }), PLACES, DEFAULT_CATEGORY_COLORS).categoryLabel).toBe("Event");
    expect(noteCardInfo(note({ category: "scheduled" }), PLACES, DEFAULT_CATEGORY_COLORS).categoryLabel).toBe("To-do");
  });

  test("an idea never alerts: bell-off even with a time", () => {
    expect(
      noteCardInfo(note({ category: "idea", contexts: ["18:00"] }), PLACES, DEFAULT_CATEGORY_COLORS).trailing
    ).toEqual({ kind: "off" });
  });
});
