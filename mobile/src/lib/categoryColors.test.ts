import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  BASIC_SWATCHES,
  CATEGORIES,
  categoryLabel,
  colorFor,
  normalizeCategory,
  contrastRatio,
  DEFAULT_CATEGORY_COLORS,
  getCategoryColors,
  normalizeHex,
  resetCategoryColor,
  setCategoryColor,
  textColorFor,
} from "./categoryColors";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("defaults", () => {
  test("every category has a default color", () => {
    expect(CATEGORIES).toEqual(["todo", "errand", "idea", "event"]);
    for (const c of CATEGORIES) {
      expect(DEFAULT_CATEGORY_COLORS[c]).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  test("about 10 basic swatches, all valid and distinct", () => {
    expect(BASIC_SWATCHES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(BASIC_SWATCHES).size).toBe(BASIC_SWATCHES.length);
    for (const s of BASIC_SWATCHES) {
      expect(s).toMatch(/^#[0-9A-F]{6}$/);
    }
  });
});

describe("normalizeHex", () => {
  test.each([
    ["#1976d2", "#1976D2"],
    ["1976D2", "#1976D2"],
    ["#abc", "#AABBCC"],
    ["  #FfFfFf ", "#FFFFFF"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeHex(input)).toBe(expected);
  });

  test.each(["", "#12345", "#GGGGGG", "red", "#1234567", "rgb(0,0,0)"])("rejects %p", (input) => {
    expect(normalizeHex(input)).toBeNull();
  });
});

describe("contrast", () => {
  test("WCAG contrast ratio: black on white is 21, same color is 1", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#1976D2", "#1976D2")).toBeCloseTo(1, 5);
  });

  test.each([
    ["#FFFFFF", "#000000"], // white -> black text
    ["#000000", "#FFFFFF"],
    ["#FFEB3B", "#000000"], // yellow
    ["#1976D2", "#FFFFFF"], // the default task blue
    ["#757575", "#FFFFFF"],
    ["#4CAF50", "#000000"], // mid green reads better in black
    ["#00BCD4", "#000000"], // cyan
  ])("text on %s is %s", (bg, text) => {
    expect(textColorFor(bg)).toBe(text);
  });

  test("the chosen text color always has the higher contrast of the two", () => {
    for (const bg of [...BASIC_SWATCHES, ...Object.values(DEFAULT_CATEGORY_COLORS)]) {
      const chosen = textColorFor(bg);
      const other = chosen === "#000000" ? "#FFFFFF" : "#000000";
      expect(contrastRatio(chosen, bg)).toBeGreaterThanOrEqual(contrastRatio(other, bg));
    }
  });
});

describe("storage on the phone", () => {
  test("nothing saved: the defaults", async () => {
    expect(await getCategoryColors()).toEqual(DEFAULT_CATEGORY_COLORS);
  });

  test("setCategoryColor saves a normalized color for that category only", async () => {
    await setCategoryColor("todo", "#ff0000");
    const colors = await getCategoryColors();
    expect(colors.todo).toBe("#FF0000");
    expect(colors.idea).toBe(DEFAULT_CATEGORY_COLORS.idea);
  });

  test("survives a reload (stored in AsyncStorage)", async () => {
    await setCategoryColor("idea", "#00ff00");
    const raw = await AsyncStorage.getItem("focusedcontext.categoryColors");
    expect(JSON.parse(raw as string)).toEqual({ idea: "#00FF00" });
  });

  test("resetCategoryColor goes back to the default", async () => {
    await setCategoryColor("todo", "#FF0000");
    await setCategoryColor("idea", "#00FF00");
    await resetCategoryColor("todo");
    const colors = await getCategoryColors();
    expect(colors.todo).toBe(DEFAULT_CATEGORY_COLORS.todo);
    expect(colors.idea).toBe("#00FF00");
  });

  test("invalid color or unknown category is rejected and nothing is saved", async () => {
    await expect(setCategoryColor("todo", "blue")).rejects.toThrow();
    await expect(setCategoryColor("shopping" as never, "#FF0000")).rejects.toThrow();
    expect(await getCategoryColors()).toEqual(DEFAULT_CATEGORY_COLORS);
  });

  test("corrupt or invalid stored values fall back to the defaults", async () => {
    await AsyncStorage.setItem("focusedcontext.categoryColors", "not json");
    expect(await getCategoryColors()).toEqual(DEFAULT_CATEGORY_COLORS);
    await AsyncStorage.setItem(
      "focusedcontext.categoryColors",
      JSON.stringify({ todo: "nope", idea: "#123456", unknown: "#000000" })
    );
    const colors = await getCategoryColors();
    expect(colors.todo).toBe(DEFAULT_CATEGORY_COLORS.todo);
    expect(colors.idea).toBe("#123456");
    expect(Object.keys(colors)).toEqual([...CATEGORIES]);
  });
});

test("colorFor: a note's category color; old and unknown categories use To-do's", () => {
  const colors = { ...DEFAULT_CATEGORY_COLORS, todo: "#FF0000" };
  expect(colorFor("todo", colors)).toBe("#FF0000");
  expect(colorFor("scheduled", colors)).toBe("#FF0000");
  expect(colorFor("something-new", colors)).toBe("#FF0000");
  expect(colorFor("event", colors)).toBe(DEFAULT_CATEGORY_COLORS.event);
});

describe("the four kinds", () => {
  test("old values (scheduled, reminder, uncategorized, task) and unknown ones count as To-do", () => {
    for (const old of ["scheduled", "reminder", "uncategorized", "task", "weird", ""]) {
      expect(normalizeCategory(old)).toBe("todo");
    }
    for (const kind of ["todo", "errand", "idea", "event"]) {
      expect(normalizeCategory(kind)).toBe(kind);
    }
  });

  test("labels", () => {
    expect(CATEGORIES.map(categoryLabel)).toEqual(["To-do", "Errand", "Idea", "Event"]);
    expect(categoryLabel("scheduled")).toBe("To-do");
  });

  test("custom colors are kept for kinds that still exist; an old Task color moves to To-do", async () => {
    await AsyncStorage.setItem(
      "focusedcontext.categoryColors",
      JSON.stringify({ errand: "#111111", idea: "#222222", task: "#333333", scheduled: "#444444", reminder: "#555555" })
    );
    const colors = await getCategoryColors();
    expect(colors).toEqual({ todo: "#333333", errand: "#111111", idea: "#222222", event: DEFAULT_CATEGORY_COLORS.event });
  });

  test("a saved To-do color wins over an old Task one", async () => {
    await AsyncStorage.setItem("focusedcontext.categoryColors", JSON.stringify({ task: "#333333", todo: "#666666" }));
    expect((await getCategoryColors()).todo).toBe("#666666");
  });
});

describe("readableOn", () => {
  const { readableOn, hueOf } = jest.requireActual("./categoryColors");

  test("a color that's already readable is kept as is", () => {
    expect(readableOn("#1976D2", "#FFFFFF")).toBe("#1976D2");
  });

  test("too light on white: darkened just enough, same hue", () => {
    const shade = readableOn("#388E3C", "#FFFFFF");
    expect(contrastRatio(shade, "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(shade, "#FFFFFF")).toBeLessThan(5);
    expect(Math.abs(hueOf(shade) - hueOf("#388E3C"))).toBeLessThanOrEqual(2);
  });

  test("too dark on a dark card: lightened, same hue", () => {
    const shade = readableOn("#7B1FA2", "#182019");
    expect(contrastRatio(shade, "#182019")).toBeGreaterThanOrEqual(4.5);
    expect(Math.abs(hueOf(shade) - hueOf("#7B1FA2"))).toBeLessThanOrEqual(2);
  });

  test("hueOf: red 0, green 120, blue 240", () => {
    expect(hueOf("#FF0000")).toBeCloseTo(0);
    expect(hueOf("#00FF00")).toBeCloseTo(120);
    expect(hueOf("#0000FF")).toBeCloseTo(240);
  });
});
