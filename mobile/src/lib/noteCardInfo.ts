import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Note } from "../types/notes";
import { lightColors, Palette } from "../theme";
import { canAlert } from "./alertRules";
import {
  Category,
  categoryLabel,
  CategoryColors,
  colorFor,
  normalizeCategory,
  readableOn,
  textColorFor,
} from "./categoryColors";
import { GENERAL } from "./folderOrder";
import { locationLabel, noteTime } from "./noteLabels";
import { dayDiff, MONTHS, parseDay, WEEKDAYS } from "./noteSections";
import { resolveCurrentLocation, ServerPlace, UNKNOWN } from "./userPlaces";

// What a note card on the notes list shows (redesign step 4).

type IconName = React.ComponentProps<typeof Ionicons>["name"];

const CATEGORY_ICONS: Record<Category, IconName> = {
  todo: "checkbox-outline",
  errand: "bag-outline",
  idea: "bulb-outline",
  event: "calendar-outline",
};

// smart: Smart picked the time (from the note's text or the place's default),
// not the user in the Time picker, so the card shows it in green with sparkles.
// day: null today (or a note without a date: it repeats daily), else
// "Tomorrow", a weekday within 6 days ("Thu"), or a short date ("23 Oct",
// also for overdue ones); label is what the card shows ("Tomorrow 09:25").
export type Trailing =
  | { kind: "time"; time: string; day: string | null; label: string; accessibilityLabel: string; smart: boolean }
  | { kind: "smart" }
  | { kind: "off" };

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// the day on the card ("Thu") and how a screen reader says it ("on Thursday")
function alertDay(remindOnDate: string | null | undefined, now: Date): { day: string; spoken: string } | null {
  const date = parseDay(remindOnDate);
  if (!date) {
    return null;
  }
  const diff = dayDiff(now, date);
  if (diff === 0) {
    return null;
  }
  if (diff === 1) {
    return { day: "Tomorrow", spoken: "tomorrow" };
  }
  if (diff > 1 && diff <= 6) {
    return { day: WEEKDAYS[date.getDay()], spoken: `on ${WEEKDAY_NAMES[date.getDay()]}` };
  }
  return {
    day: `${date.getDate()} ${MONTHS[date.getMonth()]}`,
    spoken: `on ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}`,
  };
}

export interface NoteCardInfo {
  icon: IconName;
  tileColor: string; // the user's category color
  tileIconColor: string; // black or white, whichever reads better on it
  categoryLabel: string;
  categoryTextColor: string; // the category color, or a shade of it that's readable on the card
  placeName: string | null;
  folderName: string | null; // only when not General
  trailing: Trailing;
}

export function noteCardInfo(
  note: Note,
  places: ServerPlace[],
  categoryColors: CategoryColors,
  palette: Palette = lightColors,
  now: Date = new Date()
): NoteCardInfo {
  const color = colorFor(note.category, categoryColors);
  const category = normalizeCategory(note.category);
  const time = noteTime(note);
  let trailing: Trailing;
  // alerts off (or an idea) wins: a time would look like an alarm that won't ring
  if (!canAlert(note)) {
    trailing = { kind: "off" };
  } else if (time) {
    const userSet = note.remind_time_explicit === true && note.remind_at_hour != null;
    const day = alertDay(note.remind_on_date, now);
    const spoken = [userSet ? "Alert" : "Smart alert", day?.spoken, `at ${time}`].filter(Boolean).join(" ");
    trailing = {
      kind: "time",
      time,
      day: day?.day ?? null,
      label: day ? `${day.day} ${time}` : time,
      accessibilityLabel: spoken,
      smart: !userSet,
    };
  } else {
    // no time at all (a place-only note): it alerts on arrival
    trailing = { kind: "smart" };
  }
  return {
    icon: CATEGORY_ICONS[category],
    tileColor: color,
    tileIconColor: textColorFor(color),
    categoryLabel: categoryLabel(category),
    // readable on this theme's card (white in light mode, dark green-grey in
    // dark mode): a too-light or too-dark color is shaded, never swapped for grey
    categoryTextColor: readableOn(color, palette.surface),
    placeName: locationLabel(note, places),
    folderName: note.list_name && note.list_name !== GENERAL ? note.list_name : null,
    trailing,
  };
}

// "At Home" / "No place" for the chip at the top of the notes list.
export function currentPlaceLabel(stored: string | null, places: ServerPlace[]): string {
  const id = resolveCurrentLocation(stored, places);
  const place = id === UNKNOWN ? undefined : places.find((p) => p.id === id);
  return place ? `At ${place.name}` : "No place";
}
