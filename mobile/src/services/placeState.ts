import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import { getNotes } from "../api/notes";
import { currentUserId } from "../api/client";
import { isStoreRegionId } from "../lib/storeAlerts";
import { WhereAmI } from "../lib/notePlace";
import { getReminderLocation } from "../lib/reminderPrefs";
import { Note } from "../types/notes";
import { readAlertNotes } from "./alertNotesCache";
import { GEOFENCE_REGIONS_KEY, GEOFENCE_TASK } from "./geofenceKeys";
import { getGrantedPermissions } from "./locationPermissions";

// What the phone knows about where you are, for notes with a time and a place
// (lib/placeTimeReminders.ts). Kept apart from geofence.ts so the alarm code
// doesn't load the geofence task.

// The places geofencing is watching: registered regions that are places
// (not store fences), only while geofencing runs with background location.
// None when that can't be told, so alarms ring as before.
export async function trackedPlaceIds(): Promise<string[]> {
  try {
    const [started, permissions] = await Promise.all([
      Location.hasStartedGeofencingAsync(GEOFENCE_TASK),
      getGrantedPermissions(),
    ]);
    if (!started || !permissions.background) {
      return [];
    }
    const raw = await AsyncStorage.getItem(GEOFENCE_REGIONS_KEY);
    const regions: { identifier?: string }[] = raw ? JSON.parse(raw) : [];
    return regions.map((r) => r.identifier ?? "").filter((id) => id !== "" && !isStoreRegionId(id));
  } catch {
    return [];
  }
}

export async function whereAmI(): Promise<WhereAmI> {
  const [currentPlace, tracked] = await Promise.all([getReminderLocation(), trackedPlaceIds()]);
  return { currentPlace, trackedPlaceIds: tracked };
}

// The notes from the server, or the ones saved at the last sync when it can't
// be reached (e.g. a geofence event without signal).
export async function notesForAlerts(): Promise<Note[]> {
  try {
    return await getNotes();
  } catch {
    return readAlertNotes(currentUserId());
  }
}
