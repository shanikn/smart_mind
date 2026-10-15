import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { auth } from "../config/firebase";
import { connectApiToFirebase } from "./apiAuth";
import { combineRegions, isStoreRegionId } from "../lib/storeAlerts";
import {
  GeofenceRegion,
  locationAfterGeofenceEvent,
  regionsChanged,
  regionsFromPlaces,
  shouldGeofence,
  shouldNotifyArrival,
} from "../lib/geofenceLogic";
import { getAllCoords } from "../lib/userPlaces";
import { loadPlaces } from "./placesStore";
import {
  getNotificationsEnabled,
  getReminderLocation,
  setReminderLocation,
} from "../lib/reminderPrefs";
import { getGrantedPermissions } from "./locationPermissions";
import { checkAndNotifyReminders } from "./reminderNotifier";
import { getStoreRegions, handleStoreGeofenceEvent } from "./storeAlerts";
import { onPlaceGeofenceEvent } from "./placeTimeReminders";

import {
  GEOFENCE_REGIONS_KEY as REGISTERED_REGIONS_KEY,
  GEOFENCE_REGISTERED_AT_KEY as REGISTERED_AT_KEY,
  GEOFENCE_TASK,
} from "./geofenceKeys";

export { GEOFENCE_TASK };

async function getRegisteredAt(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(REGISTERED_AT_KEY);
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

async function getRegisteredRegions(): Promise<GeofenceRegion[] | null> {
  try {
    const raw = await AsyncStorage.getItem(REGISTERED_REGIONS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// When Android wakes the app in the background for a geofence event, no
// screen has mounted, so AuthContext hasn't connected the API client to Firebase yet.
async function ensureAuthToken(): Promise<boolean> {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) {
    return false;
  }
  connectApiToFirebase();
  return true;
}

// Defined at module top level (imported from index.ts) so the task exists
// even when the app is started in the background just to handle an event.
TaskManager.defineTask<{
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.log("Geofence task error", error.message);
    return;
  }
  try {
    const event = data.eventType === Location.GeofencingEventType.Enter ? "enter" : "exit";
    const regionId = data.region.identifier ?? "";
    // a store near an errand, or the 1 km fence that refreshes the stores
    if (isStoreRegionId(regionId)) {
      await ensureAuthToken();
      await handleStoreGeofenceEvent(event, regionId);
      return;
    }
    const current = await getReminderLocation();
    // regions are only registered for places with coordinates on this phone
    const knownPlaceIds = new Set(Object.keys(await getAllCoords()));
    const { location, arrived } = locationAfterGeofenceEvent(
      event,
      regionId,
      current,
      knownPlaceIds
    );
    if (location !== current) {
      await setReminderLocation(location);
    }
    // the ENTER Android fires right after (re-)registering, for a place
    // you're already at, updates the place above but isn't an arrival
    const notify = arrived && shouldNotifyArrival(event, Date.now(), await getRegisteredAt());
    const signedIn = await ensureAuthToken();
    if (notify && signedIn) {
      // per-slot de-dupe in checkAndNotifyReminders stops re-entry spam
      await checkAndNotifyReminders({ onArrival: true });
    }
    // a saved place: notes with a time and this place (missed while away?
    // alert now) and their alarms, re-planned for being here or not
    if (signedIn && knownPlaceIds.has(regionId)) {
      await onPlaceGeofenceEvent(event, regionId, notify);
    }
  } catch (e) {
    console.log("Geofence task failed", e);
  }
});

// Start geofencing for the saved places (and the stores near open errands,
// see storeAlerts.ts) when automatic location and notifications are on;
// otherwise stop it. Call whenever places, location permissions or the
// notifications switch change. Never prompts.
export async function syncGeofencing(): Promise<void> {
  try {
    const [permissions, notificationsEnabled, places, storeFences] = await Promise.all([
      getGrantedPermissions(),
      getNotificationsEnabled(),
      loadPlaces(),
      getStoreRegions(),
    ]);
    // saved places first; stores get what's left, well under Android's 100
    const regions = combineRegions(regionsFromPlaces(places), storeFences.stores, storeFences.refresh);
    const active = shouldGeofence({
      foreground: permissions.foreground,
      background: permissions.background,
      notificationsEnabled,
      notificationsGranted: permissions.notifications,
      placeCount: regions.length,
    });
    const started = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (active) {
      // re-registering fires an ENTER for every place you're inside, so only
      // do it when the regions changed (new place, moved, new radius)
      if (!started || regionsChanged(await getRegisteredRegions(), regions)) {
        await AsyncStorage.setItem(REGISTERED_AT_KEY, String(Date.now()));
        await Location.startGeofencingAsync(GEOFENCE_TASK, regions);
        await AsyncStorage.setItem(REGISTERED_REGIONS_KEY, JSON.stringify(regions));
      }
    } else if (started) {
      await Location.stopGeofencingAsync(GEOFENCE_TASK);
      await AsyncStorage.removeItem(REGISTERED_REGIONS_KEY);
    }
  } catch (e) {
    console.log("Geofence sync failed", e);
  }
}
