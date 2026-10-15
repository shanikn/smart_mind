import AsyncStorage from "@react-native-async-storage/async-storage";

// Note kinds and their colors, chosen by the user and stored on this phone only.

export const CATEGORIES = ["todo", "errand", "idea", "event"] as const;
export type Category = (typeof CATEGORIES)[number];
export type CategoryColors = Record<Category, string>;

export const DEFAULT_CATEGORY_COLORS: CategoryColors = {
  todo: "#1976D2",
  errand: "#388E3C",
  idea: "#7B1FA2",
  event: "#C2185B",
};

const LABELS: CategoryColors = { todo: "To-do", errand: "Errand", idea: "Idea", event: "Event" };

// basic colors offered before the custom color wheel
export const BASIC_SWATCHES = [
  "#F44336", // red
  "#E91E63", // pink
  "#9C27B0", // purple
  "#3F51B5", // indigo
  "#2196F3", // blue
  "#009688", // teal
  "#4CAF50", // green
  "#FFEB3B", // yellow
  "#FF9800", // orange
  "#795548", // brown
  "#9E9E9E", // grey
  "#212121", // black
];

const STORAGE_KEY = "focusedcontext.categoryColors";

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

// Old kinds (task, scheduled, reminder, uncategorized) and unknown values are To-dos.
export function normalizeCategory(value: string | null | undefined): Category {
  return value && isCategory(value) ? value : "todo";
}

export function categoryLabel(value: string | null | undefined): string {
  return LABELS[normalizeCategory(value)];
}

// "#abc", "abc", "#aabbcc" -> "#AABBCC"; anything else -> null
export function normalizeHex(input: string): string | null {
  const m = input.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) {
    return null;
  }
  const hex = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${hex.toUpperCase()}`;
}

// WCAG relative luminance
function luminance(hex: string): number {
  const h = normalizeHex(hex) ?? "#000000";
  const channel = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function channels(hex: string): [number, number, number] {
  const h = normalizeHex(hex) ?? "#000000";
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

// hue in degrees (0-360), e.g. to check a shade is still "the same color"
export function hueOf(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) {
    return 0;
  }
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

// The color itself if it reads on the background, else the nearest shade of
// it that does: mixed toward black on a light background, toward white on a
// dark one. Mixing keeps the hue, so green stays green.
export function readableOn(color: string, background: string, minContrast = 4.5): string {
  const start = normalizeHex(color) ?? "#000000";
  if (contrastRatio(start, background) >= minContrast) {
    return start;
  }
  const target = textColorFor(background) === "#000000" ? 0 : 255;
  const rgb = channels(start);
  let shade = start;
  for (let step = 1; step <= 20; step++) {
    const t = step / 20;
    shade =
      "#" +
      rgb
        .map((v) => Math.round(v + (target - v) * t).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
    if (contrastRatio(shade, background) >= minContrast) {
      break;
    }
  }
  return shade;
}

// black or white, whichever is more readable on the background
export function textColorFor(background: string): "#000000" | "#FFFFFF" {
  return contrastRatio("#000000", background) >= contrastRatio("#FFFFFF", background)
    ? "#000000"
    : "#FFFFFF";
}

async function readOverrides(): Promise<Partial<CategoryColors>> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const result: Partial<CategoryColors> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const hex = typeof value === "string" ? normalizeHex(value) : null;
      if (isCategory(key) && hex) {
        result[key] = hex;
      }
    }
    // a color picked for the old "Task" carries over to To-do
    const oldTask = typeof parsed.task === "string" ? normalizeHex(parsed.task) : null;
    if (!result.todo && oldTask) {
      result.todo = oldTask;
    }
    return result;
  } catch {
    return {};
  }
}

export async function getCategoryColors(): Promise<CategoryColors> {
  return { ...DEFAULT_CATEGORY_COLORS, ...(await readOverrides()) };
}

export async function setCategoryColor(category: Category, color: string): Promise<void> {
  const hex = normalizeHex(color);
  if (!isCategory(category) || !hex) {
    throw new Error(`invalid category color: ${category} ${color}`);
  }
  const overrides = await readOverrides();
  overrides[category] = hex;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export async function resetCategoryColor(category: Category): Promise<void> {
  const overrides = await readOverrides();
  delete overrides[category];
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
}

export function colorFor(category: string, colors: CategoryColors): string {
  return colors[normalizeCategory(category)];
}
