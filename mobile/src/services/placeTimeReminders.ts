import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import { GeofenceEvent } from "../lib/geofenceLogic";
import { dayKey, missedPlaceTimeNotes } from "../lib/placeTimeReminders";
import { getNotificationsEnabled } from "../lib/reminderPrefs";
import { notesForAlerts } from "./placeState";
import { syncScheduledReminders } from "./scheduledReminders";

// The geofence side of notes with a time and a place (lib/placeTimeReminders.ts):
// every enter/exit of a place re-plans the alarms (a note's alarm only while
// you're there), exits are remembered, and arriving after a note's time that
// you missed today alerts it.

// when you last left each place (ms), and the day each missed note was alerted
export const PLACE_EXITS_KEY = "focusedcontext.placeExits";
export const MISSED_ALERTED_KEY = "focusedcontext.placeTimeAlerted";

async function readMap<T>(key: string): Promise<Record<string, T>> {
  try {
    const raw = await AsyncStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : {};
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

async function alertMissedNotes(placeId: string, now: Date): Promise<void> {
  const [enabled, permission] = await Promise.all([getNotificationsEnabled(), Notifications.getPermissionsAsync()]);
  if (!enabled || !permission.granted) {
    return;
  }
  const [notes, exits, alerted] = await Promise.all([
    notesForAlerts(),
    readMap<number>(PLACE_EXITS_KEY),
    readMap<string>(MISSED_ALERTED_KEY),
  ]);
  const missed = missedPlaceTimeNotes(notes, placeId, now, exits[placeId] ?? null, alerted);
  if (missed.length === 0) {
    return;
  }
  const today = dayKey(now);
  for (const note of missed) {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Smart Mind reminder",
        body: note.content,
        sound: "default",
        data: { noteId: note._id },
      },
      trigger: null,
    });
  }
  // only today's matter
  const keep = Object.fromEntries(Object.entries(alerted).filter(([, day]) => day === today));
  for (const note of missed) {
    keep[note._id] = today;
  }
  await AsyncStorage.setItem(MISSED_ALERTED_KEY, JSON.stringify(keep));
}

// Called by the geofence task for a saved place. `arrived`: a real arrival
// (not the ENTER Android sends right after registering).
export async function onPlaceGeofenceEvent(
  event: GeofenceEvent,
  placeId: string,
  arrived: boolean,
  now: Date = new Date()
): Promise<void> {
  try {
    if (event === "exit") {
      const exits = await readMap<number>(PLACE_EXITS_KEY);
      exits[placeId] = now.getTime();
      await AsyncStorage.setItem(PLACE_EXITS_KEY, JSON.stringify(exits));
    } else if (arrived) {
      await alertMissedNotes(placeId, now);
    }
  } catch (e) {
    console.log("Missed place reminders failed", e);
  }
  await syncScheduledReminders();
}
