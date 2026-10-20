import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import { getNotes } from "../api/notes";
import { nearbyStores } from "../api/places";
import { setNotificationsEnabled, setStoreAlertMode, setStoreAlertsEnabled } from "../lib/reminderPrefs";
import { DWELL_MS, REFRESH_REGION_ID } from "../lib/storeAlerts";
import { getGrantedPermissions } from "./locationPermissions";
import { syncGeofencing } from "./geofence";
import { getStoreRegions, handleStoreGeofenceEvent, syncStoreAlerts } from "./storeAlerts";
import { Note } from "../types/notes";

jest.mock("expo-location", () => ({
  getLastKnownPositionAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(async (request: { identifier?: string }) => request.identifier ?? "id"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
jest.mock("../api/notes", () => ({ getNotes: jest.fn() }));
jest.mock("../api/places", () => ({ nearbyStores: jest.fn() }));
jest.mock("./locationPermissions", () => ({ getGrantedPermissions: jest.fn() }));
jest.mock("./geofence", () => ({ syncGeofencing: jest.fn().mockResolvedValue(undefined) }));

const HERE = { latitude: 32.1, longitude: 34.8 };
const position = (p: { latitude: number; longitude: number }) => ({
  coords: { ...p, accuracy: 20 },
  timestamp: Date.now(),
});

const errand = (id: string, content: string, store_type: string, fields: Partial<Note> = {}) =>
  ({
    _id: id,
    content,
    category: "errand",
    store_type,
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    ...fields,
  }) as unknown as Note;

const MILK = errand("milk", "buy milk", "supermarket");
const CARROTS = errand("carrots", "get carrots", "supermarket");
const PILLS = errand("pills", "buy vitamins", "pharmacy");
const IDEA = { ...errand("idea", "idea: a post office app", "post_office"), category: "idea" } as Note;

const STORES: Record<string, { id: string; name: string; lat: number; lon: number }[]> = {
  supermarket: [{ id: "node/1", name: "Shufersal", lat: 32.1001, lon: 34.8 }],
  pharmacy: [{ id: "node/2", name: "Super-Pharm", lat: 32.1002, lon: 34.8 }],
  post_office: [{ id: "node/3", name: "Israel Post", lat: 32.1003, lon: 34.8 }],
};

const mockedNotes = getNotes as jest.Mock;
const mockedNearby = nearbyStores as jest.Mock;
const notify = Notifications.scheduleNotificationAsync as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (getGrantedPermissions as jest.Mock).mockResolvedValue({ foreground: true, background: true, notifications: true });
  (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(position(HERE));
  (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(position(HERE));
  mockedNotes.mockResolvedValue([MILK, CARROTS, PILLS, IDEA]);
  mockedNearby.mockImplementation(async (type: string) => STORES[type]);
});

const storeIds = async () => (await getStoreRegions()).stores.map((r) => r.identifier);

describe("syncStoreAlerts", () => {
  test("watches the nearest stores only for store types with open errands", async () => {
    await syncStoreAlerts();
    expect(mockedNearby.mock.calls.map((c) => c[0]).sort()).toEqual(["pharmacy", "supermarket"]);
    expect(mockedNearby).toHaveBeenCalledWith("supermarket", HERE.latitude, HERE.longitude, 2000);
    expect(await storeIds()).toEqual(["store:supermarket:node/1", "store:pharmacy:node/2"]);
    expect((await getStoreRegions()).refresh?.identifier).toBe(REFRESH_REGION_ID);
    expect(syncGeofencing).toHaveBeenCalled();
  });

  test("uses the last known position when it's recent, without waking the GPS", async () => {
    await syncStoreAlerts();
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  test("no open errands: no store fences and no request", async () => {
    mockedNotes.mockResolvedValue([IDEA, errand("x", "call mom", "", { category: "todo" })]);
    await syncStoreAlerts();
    expect(mockedNearby).not.toHaveBeenCalled();
    expect(await getStoreRegions()).toEqual({ stores: [], refresh: null });
    expect(syncGeofencing).toHaveBeenCalled();
  });

  test("the last errand done or deleted: its fences go away", async () => {
    await syncStoreAlerts();
    mockedNotes.mockResolvedValue([MILK]);
    await syncStoreAlerts();
    expect(await storeIds()).toEqual(["store:supermarket:node/1"]);
    mockedNotes.mockResolvedValue([]);
    await syncStoreAlerts();
    expect(await storeIds()).toEqual([]);
  });

  test("turned off in Settings: nothing watched, nothing asked", async () => {
    await syncStoreAlerts();
    await setStoreAlertsEnabled(false);
    mockedNearby.mockClear();
    await syncStoreAlerts();
    expect(mockedNearby).not.toHaveBeenCalled();
    expect(await getStoreRegions()).toEqual({ stores: [], refresh: null });
  });

  test("phone notifications off or no background location: nothing watched", async () => {
    await setNotificationsEnabled(false);
    await syncStoreAlerts();
    expect(await storeIds()).toEqual([]);
    await setNotificationsEnabled(true);
    (getGrantedPermissions as jest.Mock).mockResolvedValue({ foreground: true, background: false, notifications: true });
    await syncStoreAlerts();
    expect(await storeIds()).toEqual([]);
    expect(mockedNearby).not.toHaveBeenCalled();
  });

  test("same area again: reuses the stores it has, no new request", async () => {
    await syncStoreAlerts();
    mockedNearby.mockClear();
    await syncStoreAlerts();
    expect(mockedNearby).not.toHaveBeenCalled();
    expect(await storeIds()).toHaveLength(2);
  });

  test("a new store type: asks only for that type", async () => {
    mockedNotes.mockResolvedValue([MILK]);
    await syncStoreAlerts();
    mockedNearby.mockClear();
    mockedNotes.mockResolvedValue([MILK, errand("parcel", "send the parcel", "post_office")]);
    await syncStoreAlerts();
    expect(mockedNearby.mock.calls.map((c) => c[0])).toEqual(["post_office"]);
    expect(await storeIds()).toEqual(["store:supermarket:node/1", "store:post_office:node/3"]);
  });

  test("the store search failing keeps the stores it had", async () => {
    await syncStoreAlerts();
    const moved = { latitude: 32.111, longitude: 34.8 };
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(position(moved));
    mockedNearby.mockRejectedValue(new Error("504"));
    await syncStoreAlerts();
    expect(await storeIds()).toEqual(["store:supermarket:node/1", "store:pharmacy:node/2"]);
  });

  test("notes can't be loaded: keeps what it has", async () => {
    await syncStoreAlerts();
    mockedNotes.mockRejectedValue(new Error("offline"));
    await syncStoreAlerts();
    expect(await storeIds()).toHaveLength(2);
  });
});

describe("arriving at a store (Alert when passing by)", () => {
  beforeEach(async () => {
    await setStoreAlertMode("pass");
    await syncStoreAlerts();
  });

  test("notifies with the errands for that kind of store", async () => {
    await handleStoreGeofenceEvent("enter", "store:supermarket:node/1");
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].content).toMatchObject({
      title: "Shopping nearby",
      body: "You're at Shufersal – on your list: buy milk, get carrots",
    });
    expect(notify.mock.calls[0][0].trigger).toBeNull();
  });

  test("at most once per visit", async () => {
    await handleStoreGeofenceEvent("enter", "store:supermarket:node/1");
    await handleStoreGeofenceEvent("enter", "store:supermarket:node/1");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("an errand done or deleted since: not listed; none left: no alert", async () => {
    mockedNotes.mockResolvedValue([CARROTS, PILLS]);
    await handleStoreGeofenceEvent("enter", "store:supermarket:node/1");
    expect(notify.mock.calls[0][0].content.body).toBe("You're at Shufersal – on your list: get carrots");
    mockedNotes.mockResolvedValue([CARROTS]);
    await handleStoreGeofenceEvent("enter", "store:pharmacy:node/2");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  test("ideas never alert", async () => {
    mockedNotes.mockResolvedValue([IDEA]);
    await handleStoreGeofenceEvent("enter", "store:post_office:node/3");
    expect(notify).not.toHaveBeenCalled();
  });

  test("offline at the store: uses the errands saved at the last sync", async () => {
    mockedNotes.mockRejectedValue(new Error("offline"));
    await handleStoreGeofenceEvent("enter", "store:pharmacy:node/2");
    expect(notify.mock.calls[0][0].content.body).toBe("You're at Super-Pharm – on your list: buy vitamins");
  });

  test("turned off in Settings or phone notifications off: no alert", async () => {
    await setStoreAlertsEnabled(false);
    await handleStoreGeofenceEvent("enter", "store:supermarket:node/1");
    await setStoreAlertsEnabled(true);
    await setNotificationsEnabled(false);
    await handleStoreGeofenceEvent("enter", "store:supermarket:node/1");
    expect(notify).not.toHaveBeenCalled();
  });

  test("leaving the refresh fence (moved ~1 km) looks for stores around the new spot", async () => {
    const moved = { latitude: 32.111, longitude: 34.8 };
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(position(moved));
    mockedNearby.mockClear();
    await handleStoreGeofenceEvent("exit", REFRESH_REGION_ID);
    expect(mockedNearby).toHaveBeenCalledWith("supermarket", moved.latitude, moved.longitude, 2000);
    expect((await getStoreRegions()).refresh).toMatchObject({ latitude: moved.latitude });
  });
});

describe("Alert when I stop there (the default)", () => {
  const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
  const STORE = "store:supermarket:node/1"; // Shufersal, ~11 m from HERE
  let wait: jest.Mock;

  beforeEach(async () => {
    wait = jest.fn(async () => {});
    await syncStoreAlerts();
  });

  const slow = () => {
    let finish!: () => void;
    const fn = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    return { fn, finish: () => finish() };
  };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test("on enter: the alert is set for 2 minutes later, not shown right away", async () => {
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    expect(notify).toHaveBeenCalledTimes(1);
    const request = notify.mock.calls[0][0];
    expect(request.content.body).toBe("You're at Shufersal – on your list: buy milk, get carrots");
    expect(request.trigger.type).toBe("date");
    const delay = request.trigger.date.getTime() - Date.now();
    expect(delay).toBeGreaterThan(DWELL_MS - 5000);
    expect(delay).toBeLessThanOrEqual(DWELL_MS);
    expect(wait).toHaveBeenCalledWith(DWELL_MS);
  });

  test("still within ~60 m after 2 minutes: the alert stays", async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(position(HERE));
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    expect(cancel).not.toHaveBeenCalled();
  });

  test("walked on (150 m away after 2 minutes): cancelled, and the next real visit can alert", async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(position({ latitude: 32.1015, longitude: 34.8 }));
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    expect(cancel).toHaveBeenCalledWith(notify.mock.calls[0][0].identifier);
    (Location.getCurrentPositionAsync as jest.Mock).mockResolvedValue(position(HERE));
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  test("left the store before 2 minutes: cancelled", async () => {
    const waiting = slow();
    const entering = handleStoreGeofenceEvent("enter", STORE, { wait: waiting.fn });
    await tick();
    await handleStoreGeofenceEvent("exit", STORE);
    expect(cancel).toHaveBeenCalledWith(notify.mock.calls[0][0].identifier);
    waiting.finish();
    await entering;
    expect(Location.getCurrentPositionAsync).not.toHaveBeenCalled(); // nothing left to check
  });

  test("leaving after the alert was shown doesn't cancel anything", async () => {
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    const realNow = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(realNow + DWELL_MS + 1000);
    await handleStoreGeofenceEvent("exit", STORE);
    spy.mockRestore();
    expect(cancel).not.toHaveBeenCalled();
  });

  test("no fix at the check: the alert stays (Android's exit event still cancels it)", async () => {
    (Location.getCurrentPositionAsync as jest.Mock).mockRejectedValue(new Error("no fix"));
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    expect(cancel).not.toHaveBeenCalled();
  });

  test("Android repeating ENTER while waiting doesn't set a second alert", async () => {
    const waiting = slow();
    const entering = handleStoreGeofenceEvent("enter", STORE, { wait: waiting.fn });
    await tick();
    await handleStoreGeofenceEvent("enter", STORE, { wait });
    expect(notify).toHaveBeenCalledTimes(1);
    waiting.finish();
    await entering;
  });
});
