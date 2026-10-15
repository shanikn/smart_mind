import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { getNotes } from "../api/notes";
import { saveAlertNotes } from "./alertNotesCache";
import { getGrantedPermissions } from "./locationPermissions";
import { GEOFENCE_REGIONS_KEY } from "./geofenceKeys";
import { notesForAlerts, trackedPlaceIds, whereAmI } from "./placeState";
import { setReminderLocation } from "../lib/reminderPrefs";
import { REFRESH_REGION_ID, storeRegionId } from "../lib/storeAlerts";
import { Note } from "../types/notes";

jest.mock("expo-location", () => ({ hasStartedGeofencingAsync: jest.fn() }));
jest.mock("./locationPermissions", () => ({ getGrantedPermissions: jest.fn() }));
jest.mock("../api/notes", () => ({ getNotes: jest.fn() }));
jest.mock("../api/client", () => ({ currentUserId: () => "uid-a" }));

const started = Location.hasStartedGeofencingAsync as jest.Mock;
const permissions = getGrantedPermissions as jest.Mock;
const region = (identifier: string) => ({ identifier, latitude: 1, longitude: 2, radius: 100 });

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  started.mockResolvedValue(true);
  permissions.mockResolvedValue({ foreground: true, background: true, notifications: true });
  await AsyncStorage.setItem(
    GEOFENCE_REGIONS_KEY,
    JSON.stringify([region("id-home"), region("id-gym"), region(storeRegionId("supermarket", "osm-1")), region(REFRESH_REGION_ID)])
  );
});

describe("trackedPlaceIds: the places geofencing is watching", () => {
  test("the registered places, not the store fences", async () => {
    expect(await trackedPlaceIds()).toEqual(["id-home", "id-gym"]);
  });

  test("geofencing not running: none", async () => {
    started.mockResolvedValue(false);
    expect(await trackedPlaceIds()).toEqual([]);
  });

  test("no background location permission: none (events wouldn't arrive)", async () => {
    permissions.mockResolvedValue({ foreground: true, background: false, notifications: true });
    expect(await trackedPlaceIds()).toEqual([]);
  });

  test("an error asking: none, so alarms ring as before", async () => {
    started.mockRejectedValue(new Error("boom"));
    expect(await trackedPlaceIds()).toEqual([]);
  });
});

test("whereAmI: the current place and the watched places", async () => {
  await setReminderLocation("id-gym");
  expect(await whereAmI()).toEqual({ currentPlace: "id-gym", trackedPlaceIds: ["id-home", "id-gym"] });
});

describe("notesForAlerts", () => {
  const n = { _id: "a", content: "x", contexts: [], reminders_enabled: true, category: "todo" } as unknown as Note;

  test("online: the server's notes", async () => {
    (getNotes as jest.Mock).mockResolvedValue([n]);
    expect(await notesForAlerts()).toEqual([n]);
  });

  test("offline (e.g. a geofence event without signal): the notes saved at the last sync", async () => {
    await saveAlertNotes([n], "uid-a");
    (getNotes as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
    expect((await notesForAlerts()).map((x) => x._id)).toEqual(["a"]);
  });
});
