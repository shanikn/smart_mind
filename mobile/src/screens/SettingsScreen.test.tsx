import React from "react";
import { Alert, AlertButton, Switch, Text, TouchableOpacity } from "react-native";
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import SettingsScreen from "./SettingsScreen";
import { setReminderLocation } from "../lib/reminderPrefs";
import { syncGeofencing } from "../services/geofence";
import { checkAndNotifyReminders } from "../services/reminderNotifier";
import { getAllCoords, setPlaceCoords } from "../lib/userPlaces";

jest.mock("@react-navigation/native", () => {
  const React = require("react");
  return { useFocusEffect: (cb: () => void) => React.useEffect(() => cb(), []) };
});
jest.mock("expo-location", () => ({
  getCurrentPositionAsync: jest.fn(),
  getLastKnownPositionAsync: jest.fn().mockResolvedValue(null),
  Accuracy: { Balanced: 3 },
}));
jest.mock("firebase/auth", () => ({ signOut: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@react-native-google-signin/google-signin", () => ({ GoogleSignin: { signOut: jest.fn() } }));
jest.mock("../config/firebase", () => ({ auth: { currentUser: null } }));
jest.mock("../context/AuthContext", () => ({ useAuth: () => ({ user: { email: "shani@example.com" } }) }));
jest.mock("../lib/reminderPrefs", () => ({
  getNotificationsEnabled: jest.fn().mockResolvedValue(true),
  setNotificationsEnabled: jest.fn().mockResolvedValue(undefined),
  getReminderLocation: jest.fn().mockResolvedValue("id-home"),
  setReminderLocation: jest.fn().mockResolvedValue(undefined),
  getStoreAlertsEnabled: jest.fn().mockResolvedValue(true),
  setStoreAlertsEnabled: jest.fn().mockResolvedValue(undefined),
  getStoreAlertMode: jest.fn().mockResolvedValue("stop"),
  setStoreAlertMode: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../services/reminderNotifier", () => ({
  checkAndNotifyReminders: jest.fn().mockResolvedValue({
    notificationsEnabled: true,
    permissionGranted: true,
    notifiedCount: 0,
  }),
  ensureNotificationPermissions: jest.fn().mockResolvedValue(true),
}));
jest.mock("../api/places", () => ({ createPlace: jest.fn(), deletePlace: jest.fn(), updatePlace: jest.fn() }));
jest.mock("../services/placesStore", () => {
  const { getAllCoords, mergePlaces } = jest.requireActual("../lib/userPlaces");
  const server = [
    { id: "id-home", name: "Home", keywords: [], kind: "home" },
    { id: "id-gym", name: "Gym", keywords: [], kind: null },
  ];
  return { loadPlaces: jest.fn(async () => mergePlaces(server, await getAllCoords())) };
});
jest.mock("../services/locationPermissions", () => ({
  getGrantedPermissions: jest.fn().mockResolvedValue({ foreground: true, background: true, notifications: true }),
}));
jest.mock("../services/geofence", () => ({ syncGeofencing: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/storeAlerts", () => ({ syncStoreAlerts: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/scheduledReminders", () => ({
  clearReminderSchedule: jest.fn().mockResolvedValue(undefined),
  syncScheduledReminders: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../components/LocationPermissionFlow", () => ({
  useLocationPermissionFlow: () => ({ screen: null, start: jest.fn(), proceed: jest.fn(), skip: jest.fn() }),
  LocationPermissionModal: () => null,
}));
jest.mock("../components/MapPickerModal", () => {
  const { View } = require("react-native");
  return (props: { visible: boolean; placeName: string; initialView: unknown; onSave: unknown }) =>
    props.visible ? (
      <View testID="map-picker" accessibilityLabel={props.placeName} initialView={props.initialView} onSave={props.onSave} />
    ) : null;
});
jest.mock("../services/addressSearch", () => ({ findAddress: jest.fn().mockResolvedValue([]) }));
jest.mock("../components/DeleteAccountModal", () => {
  const { View } = require("react-native");
  return (props: { visible: boolean; email: string; onConfirm: unknown }) =>
    props.visible ? <View testID="delete-account" accessibilityLabel={props.email} onConfirm={props.onConfirm} /> : null;
});
jest.mock("../services/accountDeletion", () => ({ deleteAccountAndSignOut: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/alertNotesCache", () => ({ clearOfflineData: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/signOutCleanup", () => ({ signOutCleanup: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../services/pendingDelete", () => ({ finishPendingDelete: jest.fn().mockResolvedValue(undefined) }));
jest.mock("../components/PasteLocationModal", () => {
  const { View } = require("react-native");
  return (props: { visible: boolean; placeName: string; onSave: unknown }) =>
    props.visible ? <View testID="paste-location" accessibilityLabel={props.placeName} onSave={props.onSave} /> : null;
});

const LOCATION_WAYS = ["Use current location", "Search address", "Pick on map", "Paste coordinates or Google Maps link"];

// the "Set location" sheet's options (not an Alert: Android shows at most 3 buttons)
function locationWays(tree: ReactTestRenderer): string[] {
  return tree.root
    .findAll((n) => n.props.testID === "location-way" && typeof n.type === "string")
    .map((n) => n.props.accessibilityLabel as string);
}

async function chooseLocationWay(tree: ReactTestRenderer, label: string) {
  const option = tree.root.findAll((n) => n.props.testID === "location-way" && n.props.accessibilityLabel === label)[0];
  if (!option) {
    throw new Error(`no location option "${label}"`);
  }
  await act(async () => {
    await option.props.onPress();
  });
}
// the color wheel needs native Reanimated; not under test here
jest.mock("../components/CategoryColorModal", () => () => null);
jest.mock("../components/AddressSearchModal", () => {
  const { View } = require("react-native");
  return (props: { visible: boolean; placeName: string; onSave: unknown }) =>
    props.visible ? <View testID="address-search" accessibilityLabel={props.placeName} onSave={props.onSave} /> : null;
});

function allText(node: ReactTestInstance): string {
  return node
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(""))
    .join(" | ");
}

function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAllByType(TouchableOpacity).filter((t) => t.props.accessibilityLabel === label);
  if (found.length === 0) {
    throw new Error(`nothing with accessibilityLabel "${label}"`);
  }
  return found[0];
}

let alertSpy: jest.SpyInstance;
const lastAlertButtons = (): string[] =>
  ((alertSpy.mock.calls.at(-1)?.[2] ?? []) as AlertButton[]).map((b) => b.text ?? "");

async function pressAlertButton(text: string) {
  const button = ((alertSpy.mock.calls.at(-1)?.[2] ?? []) as AlertButton[]).find((b) => b.text === text);
  if (!button?.onPress) {
    throw new Error(`no alert button "${text}"`);
  }
  await act(async () => {
    await button.onPress!();
  });
}

async function renderScreen() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
  return tree;
}

beforeEach(async () => {
  jest.clearAllMocks();
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  await AsyncStorage.clear();
  alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

test("cards in order: Where you are now, Saved places, Category colors, Phone notifications, account", async () => {
  const tree = await renderScreen();
  const text = allText(tree.root);
  const order = ["Settings", "Where you are now", "Saved places", "Category colors", "Phone notifications", "Signed in as"];
  const positions = order.map((t) => text.indexOf(t));
  expect(positions.every((p) => p >= 0)).toBe(true);
  expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  expect(text).toContain("shani@example.com");
});

test("Where you are now: places plus 'Not at a place'; tapping one sets it", async () => {
  const tree = await renderScreen();
  expect(byLabel(tree, "Home").props.accessibilityState.selected).toBe(true);
  await act(async () => byLabel(tree, "Gym").props.onPress());
  expect(setReminderLocation).toHaveBeenCalledWith("id-gym");
  await act(async () => byLabel(tree, "Not at a place").props.onPress());
  expect(setReminderLocation).toHaveBeenLastCalledWith("unknown");
});

test("a place without a location: 'No location set', no radius chips, 'Set location' offers three ways", async () => {
  const tree = await renderScreen();
  expect(allText(tree.root)).toContain("No location set");
  expect(tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === "Gym radius 400 m")).toBe(
    false
  );
  await act(async () => byLabel(tree, "Set location for Gym").props.onPress());
  expect(locationWays(tree)).toEqual(LOCATION_WAYS);
  await chooseLocationWay(tree, "Search address");
  expect(tree.root.findByProps({ testID: "address-search" }).props.accessibilityLabel).toBe("Gym");
});

test("a place with a location: subtitle with address and radius, radius chips re-register geofences", async () => {
  await setPlaceCoords("id-home", { latitude: 1, longitude: 2 }, 200, { source: "address", address: "Herzl 1, Herzliya" });
  const tree = await renderScreen();
  expect(allText(tree.root)).toContain("Herzl 1, Herzliya · 200 m");
  expect(byLabel(tree, "Home radius 200 m").props.accessibilityState.selected).toBe(true);
  await act(async () => byLabel(tree, "Home radius 400 m").props.onPress());
  expect((await getAllCoords())["id-home"].radius).toBe(400);
  expect(syncGeofencing).toHaveBeenCalled();
});

test("the ⋯ menu fits Android's 3 alert buttons: Change location, Rename, Delete", async () => {
  await setPlaceCoords("id-home", { latitude: 1, longitude: 2 });
  const tree = await renderScreen();
  await act(async () => byLabel(tree, "Home options").props.onPress());
  expect(lastAlertButtons()).toEqual(["Change location", "Rename", "Delete"]);
  expect(alertSpy.mock.calls.at(-1)?.[3]).toEqual({ cancelable: true });
  await pressAlertButton("Change location");
  expect(locationWays(tree)).toEqual(LOCATION_WAYS);
  await act(async () => byLabel(tree, "Gym options").props.onPress());
  expect(lastAlertButtons()).toEqual(["Change location", "Rename", "Delete"]);
});

test("phone notifications switch and Check alerts now still work", async () => {
  const tree = await renderScreen();
  const notifications = tree.root.findAllByType(Switch).find((s) => s.props.accessibilityLabel === "Phone notifications")!;
  expect(notifications.props.value).toBe(true);
  await act(async () => byLabel(tree, "Check alerts now").props.onPress());
  expect(checkAndNotifyReminders).toHaveBeenCalledWith({ force: true });
});

test("Sign out asks to confirm", async () => {
  const tree = await renderScreen();
  await act(async () => byLabel(tree, "Sign out").props.onPress());
  expect(lastAlertButtons()).toEqual(["Cancel", "Sign Out"]);
});

test("signing out runs the shared cleanup (geofences, alarms, offline notes)", async () => {
  const { signOutCleanup } = jest.requireMock("../services/signOutCleanup");
  const { signOut } = jest.requireMock("firebase/auth");
  const tree = await renderScreen();
  await act(async () => byLabel(tree, "Sign out").props.onPress());
  await pressAlertButton("Sign Out");
  expect(signOut).toHaveBeenCalled();
  expect(signOutCleanup).toHaveBeenCalled();
});

test("signing out first sends a note delete still waiting for Undo (while still signed in)", async () => {
  const { finishPendingDelete } = jest.requireMock("../services/pendingDelete");
  const { signOut } = jest.requireMock("firebase/auth");
  const tree = await renderScreen();
  await act(async () => byLabel(tree, "Sign out").props.onPress());
  await pressAlertButton("Sign Out");
  expect(finishPendingDelete).toHaveBeenCalled();
  expect(finishPendingDelete.mock.invocationCallOrder[0]).toBeLessThan(signOut.mock.invocationCallOrder[0]);
});

test("Appearance: System / Light / Dark, default System, saved on the phone", async () => {
  const { ThemeProvider } = require("../ThemeContext");
  const AsyncStorage = require("@react-native-async-storage/async-storage");
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>
    );
  });
  expect(allText(tree.root)).toContain("Appearance");
  expect(byLabel(tree, "Appearance: System").props.accessibilityState.selected).toBe(true);
  await act(async () => byLabel(tree, "Appearance: Dark").props.onPress());
  expect(byLabel(tree, "Appearance: Dark").props.accessibilityState.selected).toBe(true);
  expect(await AsyncStorage.getItem("focusedcontext.appearance")).toBe("dark");
});

describe("Clear location", () => {
  const hasLabel = (tree: ReactTestRenderer, label: string) =>
    tree.root.findAllByType(TouchableOpacity).some((t) => t.props.accessibilityLabel === label);

  beforeEach(async () => {
    await setPlaceCoords("id-home", { latitude: 1, longitude: 2 }, 400, { source: "address", address: "Herzl 1" });
  });

  test("a visible button on each place with a location, none on places without one", async () => {
    const tree = await renderScreen();
    expect(byLabel(tree, "Clear location Home")).toBeTruthy();
    expect(allText(byLabel(tree, "Clear location Home"))).toContain("Clear location");
    expect(hasLabel(tree, "Clear location Gym")).toBe(false);
  });

  test("asks to confirm; Cancel keeps everything", async () => {
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Clear location Home").props.onPress());
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Clear location");
    expect(alertSpy.mock.calls.at(-1)?.[1]).toMatch(/^Clear Home's address and radius.*arrival alerts.*notes/is);
    expect(lastAlertButtons()).toEqual(["Cancel", "Clear"]);
    await pressAlertButton("Cancel").catch(() => {}); // Cancel has no handler
    expect((await getAllCoords())["id-home"]).toBeDefined();
  });

  test("Remove clears the address and radius and stops arrival alerts; the place and its notes stay", async () => {
    const { deletePlace } = jest.requireMock("../api/places");
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Clear location Home").props.onPress());
    (syncGeofencing as jest.Mock).mockClear();
    await pressAlertButton("Clear");
    expect((await getAllCoords())["id-home"]).toBeUndefined();
    expect(syncGeofencing).toHaveBeenCalled(); // geofences re-registered without Home
    expect(deletePlace).not.toHaveBeenCalled(); // the place and its note tags stay
    const text = allText(tree.root);
    expect(text).toContain("Home");
    expect(text).toContain("No location set");
    expect(hasLabel(tree, "Home radius 400 m")).toBe(false);
    expect(hasLabel(tree, "Clear location Home")).toBe(false);
  });
});

describe("Clear location and Where you are now", () => {
  const { getReminderLocation } = jest.requireMock("../lib/reminderPrefs");
  let stored: string;

  beforeEach(async () => {
    await setPlaceCoords("id-home", { latitude: 1, longitude: 2 });
    await setPlaceCoords("id-gym", { latitude: 3, longitude: 4 });
    // remember what the screen saves, so a reload reads it back
    (getReminderLocation as jest.Mock).mockImplementation(async () => stored);
    (setReminderLocation as jest.Mock).mockImplementation(async (value: string) => {
      stored = value;
    });
  });

  afterEach(() => {
    (getReminderLocation as jest.Mock).mockResolvedValue("id-home");
    (setReminderLocation as jest.Mock).mockResolvedValue(undefined);
  });

  async function removePlace(tree: ReactTestRenderer, name: string) {
    await act(async () => byLabel(tree, `Clear location ${name}`).props.onPress());
    await pressAlertButton("Clear");
  }

  test("removing the current place sets 'Not at a place'", async () => {
    stored = "id-home";
    const tree = await renderScreen();
    await removePlace(tree, "Home");
    expect(setReminderLocation).toHaveBeenLastCalledWith("unknown");
    expect(byLabel(tree, "Not at a place").props.accessibilityState.selected).toBe(true);
    expect(byLabel(tree, "Home").props.accessibilityState.selected).toBe(false);
  });

  test("removing another place leaves the current place alone", async () => {
    stored = "id-gym";
    const tree = await renderScreen();
    await removePlace(tree, "Home");
    expect(setReminderLocation).not.toHaveBeenCalledWith("unknown");
    expect(stored).toBe("id-gym");
    expect(byLabel(tree, "Gym").props.accessibilityState.selected).toBe(true);
    // Gym keeps its location
    expect((await getAllCoords())["id-gym"]).toBeDefined();
    expect(byLabel(tree, "Clear location Gym")).toBeTruthy();
  });
});

test("Store alerts for errands: on by default; turning it off saves and re-syncs", async () => {
  const { setStoreAlertsEnabled } = jest.requireMock("../lib/reminderPrefs");
  const { syncStoreAlerts } = jest.requireMock("../services/storeAlerts");
  const tree = await renderScreen();
  const toggle = () =>
    tree.root.findAllByType(Switch).find((s) => s.props.accessibilityLabel === "Errand alerts near stores")!;
  expect(toggle().props.value).toBe(true);
  await act(async () => toggle().props.onValueChange(false));
  expect(setStoreAlertsEnabled).toHaveBeenCalledWith(false);
  expect(syncStoreAlerts).toHaveBeenCalled();
  expect(toggle().props.value).toBe(false);
});

describe("current location: fast, and Where you are now follows place changes", () => {
  const Location = require("expo-location");
  const { getReminderLocation } = jest.requireMock("../lib/reminderPrefs");
  const lastKnown = Location.getLastKnownPositionAsync as jest.Mock;
  const current = Location.getCurrentPositionAsync as jest.Mock;
  const A = { latitude: 32.1, longitude: 34.8 };
  // ~111 m per 0.001 degrees of latitude
  const near = (dLat: number) => ({ latitude: A.latitude + dLat, longitude: A.longitude });
  const fix = (p: { latitude: number; longitude: number }, accuracy = 15) => ({
    coords: { ...p, accuracy },
    timestamp: Date.now(),
  });
  let stored: string;

  beforeEach(() => {
    stored = "unknown";
    (getReminderLocation as jest.Mock).mockImplementation(async () => stored);
    (setReminderLocation as jest.Mock).mockImplementation(async (value: string) => {
      stored = value;
    });
    lastKnown.mockResolvedValue(null);
    current.mockReset();
  });

  afterEach(() => {
    (getReminderLocation as jest.Mock).mockResolvedValue("id-home");
    (setReminderLocation as jest.Mock).mockResolvedValue(undefined);
    lastKnown.mockResolvedValue(null);
  });

  async function useCurrentLocationFor(tree: ReactTestRenderer, name: string) {
    await act(async () => byLabel(tree, `Set location for ${name}`).props.onPress());
    await chooseLocationWay(tree, "Use current location");
  }

  // starts it without waiting for the fix, to see the screen meanwhile
  // (returns { done } so awaiting this doesn't wait for the fix)
  async function startUsingCurrentLocationFor(tree: ReactTestRenderer, name: string) {
    await act(async () => byLabel(tree, `Set location for ${name}`).props.onPress());
    const button = tree.root.findAll(
      (n) => n.props.testID === "location-way" && n.props.accessibilityLabel === "Use current location"
    )[0].props;
    const done = Promise.resolve(button.onPress!() as unknown as Promise<void>);
    // let it get as far as waiting for the fix
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return { done };
  }

  const coordsOf = async (id: string) => (await getAllCoords())[id];
  const selected = (tree: ReactTestRenderer, label: string) => byLabel(tree, label).props.accessibilityState.selected;

  test("a recent last known position saves instantly, then a fresh fix refines it", async () => {
    lastKnown.mockResolvedValue(fix(A));
    let refine!: (value: unknown) => void;
    current.mockReturnValue(new Promise((resolve) => (refine = resolve)));
    const tree = await renderScreen();
    await useCurrentLocationFor(tree, "Gym");
    // saved before the fresh fix arrived
    expect(await coordsOf("id-gym")).toMatchObject(A);
    expect(selected(tree, "Gym")).toBe(true);
    await act(async () => refine(fix(near(0.0005)))); // ~55 m away: better fix
    expect((await coordsOf("id-gym")).latitude).toBeCloseTo(A.latitude + 0.0005, 6);
  });

  test("a refined fix within a few meters doesn't re-save", async () => {
    lastKnown.mockResolvedValue(fix(A));
    current.mockResolvedValue(fix(near(0.0001))); // ~11 m
    const tree = await renderScreen();
    (syncGeofencing as jest.Mock).mockClear();
    await useCurrentLocationFor(tree, "Gym");
    expect(await coordsOf("id-gym")).toMatchObject(A);
    expect(syncGeofencing).toHaveBeenCalledTimes(1);
  });

  test("no recent position: a small 'Locating…' state that doesn't block the other places", async () => {
    let resolveFix!: (value: unknown) => void;
    current.mockReturnValue(new Promise((resolve) => (resolveFix = resolve)));
    const tree = await renderScreen();
    const { done } = await startUsingCurrentLocationFor(tree, "Gym");
    expect(allText(tree.root)).toContain("Locating…");
    expect(byLabel(tree, "Set location for Home").props.disabled).toBeFalsy();
    expect(byLabel(tree, "Home options").props.disabled).toBeFalsy();
    await act(async () => {
      resolveFix(fix(A));
      await done;
    });
    expect(allText(tree.root)).not.toContain("Locating…");
    expect(await coordsOf("id-gym")).toMatchObject(A);
  });

  test("no position at all: a message, nothing saved", async () => {
    current.mockRejectedValue(new Error("location off"));
    const tree = await renderScreen();
    await useCurrentLocationFor(tree, "Gym");
    expect(alertSpy.mock.calls.at(-1)?.[0]).toBe("Couldn't get your location");
    expect(await coordsOf("id-gym")).toBeUndefined();
    expect(allText(tree.root)).not.toContain("Locating…");
  });

  test("remove Home -> Not at a place; set Home again at my current location -> Home again", async () => {
    await setPlaceCoords("id-home", A);
    stored = "id-home";
    lastKnown.mockResolvedValue(fix(A));
    current.mockResolvedValue(fix(A));
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Clear location Home").props.onPress());
    await pressAlertButton("Clear");
    expect(selected(tree, "Not at a place")).toBe(true);
    await useCurrentLocationFor(tree, "Home");
    expect(selected(tree, "Home")).toBe(true);
    expect(stored).toBe("id-home");
  });

  test("an address that includes where I am selects that place; one far away doesn't", async () => {
    lastKnown.mockResolvedValue(fix(A));
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Set location for Gym").props.onPress());
    await chooseLocationWay(tree, "Search address");
    await act(async () =>
      tree.root.findByProps({ testID: "address-search" }).props.onSave({ ...near(0.001), label: "Gym St 1" })
    );
    expect(selected(tree, "Gym")).toBe(true); // ~110 m, inside 200 m

    await act(async () => byLabel(tree, "Set location for Home").props.onPress());
    await chooseLocationWay(tree, "Search address");
    await act(async () =>
      tree.root.findByProps({ testID: "address-search" }).props.onSave({ ...near(0.02), label: "Far 9" })
    );
    expect(selected(tree, "Gym")).toBe(true); // Home is ~2 km away
  });

  test("a bigger radius that now includes me selects the place; a smaller one that leaves me out unselects it", async () => {
    await setPlaceCoords("id-home", A, 200);
    lastKnown.mockResolvedValue(fix(near(0.0027))); // ~300 m from Home
    const tree = await renderScreen();
    expect(selected(tree, "Home")).toBe(false);
    await act(async () => byLabel(tree, "Home radius 400 m").props.onPress());
    expect(selected(tree, "Home")).toBe(true);
    await act(async () => byLabel(tree, "Home radius 200 m").props.onPress());
    expect(selected(tree, "Not at a place")).toBe(true);
  });
});

test("store alerts: 'Alert when I stop there' by default, or 'Alert when passing by'", async () => {
  const { setStoreAlertMode } = jest.requireMock("../lib/reminderPrefs");
  const tree = await renderScreen();
  expect(byLabel(tree, "Alert when I stop there").props.accessibilityState.selected).toBe(true);
  expect(byLabel(tree, "Alert when passing by").props.accessibilityState.selected).toBe(false);
  await act(async () => byLabel(tree, "Alert when passing by").props.onPress());
  expect(setStoreAlertMode).toHaveBeenCalledWith("pass");
  expect(byLabel(tree, "Alert when passing by").props.accessibilityState.selected).toBe(true);
});

test("the store alert choice is hidden while store alerts are off", async () => {
  const { getStoreAlertsEnabled } = jest.requireMock("../lib/reminderPrefs");
  (getStoreAlertsEnabled as jest.Mock).mockResolvedValueOnce(false);
  const tree = await renderScreen();
  const labels = tree.root.findAllByType(TouchableOpacity).map((t) => t.props.accessibilityLabel);
  expect(labels).not.toContain("Alert when passing by");
});

describe("Pick on map", () => {
  const Location = require("expo-location");
  const { findAddress } = jest.requireMock("../services/addressSearch");

  afterEach(() => {
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue(null);
  });

  async function openMapFor(tree: ReactTestRenderer, name: string) {
    await act(async () => byLabel(tree, `Set location for ${name}`).props.onPress());
    await chooseLocationWay(tree, "Pick on map");
    return tree.root.findByProps({ testID: "map-picker" });
  }

  test("opens centered on where I am when the place has no location yet", async () => {
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValue({
      coords: { latitude: 32.17, longitude: 34.84, accuracy: 20 },
      timestamp: Date.now(),
    });
    const tree = await renderScreen();
    const map = await openMapFor(tree, "Gym");
    expect(map.props.accessibilityLabel).toBe("Gym");
    expect(map.props.initialView).toMatchObject({ latitude: 32.17, longitude: 34.84, radius: 200, from: "current" });
  });

  test("opens on the place's saved location from the place menu", async () => {
    await setPlaceCoords("id-home", { latitude: 32.1, longitude: 34.8 }, 400);
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Home options").props.onPress());
    await pressAlertButton("Change location");
    await chooseLocationWay(tree, "Pick on map");
    expect(tree.root.findByProps({ testID: "map-picker" }).props.initialView).toMatchObject({
      latitude: 32.1,
      longitude: 34.8,
      radius: 400,
      from: "place",
    });
  });

  test("Save here stores the point, closes the map, then fills the address", async () => {
    (findAddress as jest.Mock).mockResolvedValue([{ label: "5 Sirkin St, Herzliya", latitude: 32.1666, longitude: 34.8439 }]);
    const tree = await renderScreen();
    const map = await openMapFor(tree, "Gym");
    await act(async () => map.props.onSave({ latitude: 32.1663, longitude: 34.8433 }));
    expect(tree.root.findAll((n) => n.props.testID === "map-picker")).toHaveLength(0);
    expect((await getAllCoords())["id-gym"]).toMatchObject({
      latitude: 32.1663,
      longitude: 34.8433,
      source: "map",
      address: "5 Sirkin St, Herzliya",
    });
    expect(syncGeofencing).toHaveBeenCalled();
    expect(allText(tree.root)).toContain("5 Sirkin St, Herzliya · 200 m");
  });
});

describe("Paste coordinates or Google Maps link", () => {
  const { findAddress } = jest.requireMock("../services/addressSearch");

  test("saves the point, re-checks Where you are now, then fills the address", async () => {
    const Location = require("expo-location");
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce({
      coords: { latitude: 32.0813, longitude: 34.8105, accuracy: 10 },
      timestamp: Date.now(),
    });
    (findAddress as jest.Mock).mockResolvedValue([{ label: "Begin Rd 1, Ramat Gan", latitude: 32.0811, longitude: 34.8104 }]);
    const tree = await renderScreen();
    await act(async () => byLabel(tree, "Set location for Gym").props.onPress());
    await chooseLocationWay(tree, "Paste coordinates or Google Maps link");
    const dialog = tree.root.findByProps({ testID: "paste-location" });
    expect(dialog.props.accessibilityLabel).toBe("Gym");
    await act(async () => dialog.props.onSave({ latitude: 32.0812, longitude: 34.8105 }));
    expect(tree.root.findAll((n) => n.props.testID === "paste-location")).toHaveLength(0);
    expect((await getAllCoords())["id-gym"]).toMatchObject({
      latitude: 32.0812,
      longitude: 34.8105,
      source: "pasted",
      address: "Begin Rd 1, Ramat Gan",
    });
    expect(syncGeofencing).toHaveBeenCalled();
    expect(setReminderLocation).toHaveBeenCalledWith("id-gym"); // I'm right there
    expect(allText(tree.root)).toContain("Begin Rd 1, Ramat Gan · 200 m");
  });
});

test("Delete account: opens the confirm dialog, which deletes and signs out", async () => {
  const { deleteAccountAndSignOut } = jest.requireMock("../services/accountDeletion");
  const tree = await renderScreen();
  expect(tree.root.findAll((n) => n.props.testID === "delete-account")).toHaveLength(0);
  await act(async () => byLabel(tree, "Delete account").props.onPress());
  const dialog = tree.root.findByProps({ testID: "delete-account" });
  expect(dialog.props.accessibilityLabel).toBe("shani@example.com");
  await act(async () => dialog.props.onConfirm());
  expect(deleteAccountAndSignOut).toHaveBeenCalledTimes(1);
});
