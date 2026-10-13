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
// not the user in the Time picker, so the card shows it in green with sparkles
export type Trailing = { kind: "time"; time: string; smart: boolean } | { kind: "smart" } | { kind: "off" };

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
  palette: Palette = lightColors
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
    trailing = { kind: "time", time, smart: !userSet };
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
