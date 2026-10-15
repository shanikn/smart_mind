import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { onPlaceGeofenceEvent } from "./placeTimeReminders";
import { syncScheduledReminders } from "./scheduledReminders";
import { notesForAlerts } from "./placeState";
import { setNotificationsEnabled } from "../lib/reminderPrefs";
import { Note } from "../types/notes";

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("id"),
}));
jest.mock("./scheduledReminders", () => ({ syncScheduledReminders: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./placeState", () => ({ notesForAlerts: jest.fn() }));

const HOME = "id-home";
const at = (hour: number, minute = 0, day = 2) => new Date(2026, 9, day, hour, minute, 0, 0);
const notify = Notifications.scheduleNotificationAsync as jest.Mock;
const resync = syncScheduledReminders as jest.Mock;

const homeAt1754 = (fields: Partial<Note> = {}) =>
  ({
    _id: "n1",
    content: "remind me at home at 17:54",
    category: "todo",
    contexts: [HOME, "17:54"],
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    remind_time_explicit: false,
    remind_at_hour: null,
    remind_at_minute: null,
    remind_on_date: null,
    reminder_time_source: "text",
    ...fields,
  }) as Note;

const bodies = () => notify.mock.calls.map((c) => c[0].content.body);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  (notesForAlerts as jest.Mock).mockResolvedValue([homeAt1754()]);
});

test("away at the time, arriving later that day: it alerts on arrival, once", async () => {
  await onPlaceGeofenceEvent("exit", HOME, false, at(8));
  await onPlaceGeofenceEvent("enter", HOME, true, at(19));
  expect(bodies()).toEqual(["remind me at home at 17:54"]);
  expect(notify.mock.calls[0][0].trigger).toBeNull();
  // another arrival the same day (e.g. Android repeating the event): no repeat
  await onPlaceGeofenceEvent("enter", HOME, true, at(20));
  expect(notify).toHaveBeenCalledTimes(1);
});

test("at the place at the time (left after it): coming back doesn't alert again", async () => {
  await onPlaceGeofenceEvent("exit", HOME, false, at(18, 30));
  await onPlaceGeofenceEvent("enter", HOME, true, at(19));
  expect(notify).not.toHaveBeenCalled();
});

test("away and not arriving that day: arriving the next day doesn't bring it back", async () => {
  (notesForAlerts as jest.Mock).mockResolvedValue([homeAt1754({ remind_on_date: "2026-10-02" })]);
  await onPlaceGeofenceEvent("exit", HOME, false, at(8));
  await onPlaceGeofenceEvent("enter", HOME, true, at(9, 0, 3));
  expect(notify).not.toHaveBeenCalled();
});

test("arriving before the time: no alert now (the alarm is planned instead)", async () => {
  await onPlaceGeofenceEvent("exit", HOME, false, at(8));
  await onPlaceGeofenceEvent("enter", HOME, true, at(16));
  expect(notify).not.toHaveBeenCalled();
  expect(resync).toHaveBeenCalled();
});

test("every enter and exit re-plans the alarms (an alarm rings only while you're there)", async () => {
  await onPlaceGeofenceEvent("exit", HOME, false, at(8));
  expect(resync).toHaveBeenCalledTimes(1);
  await onPlaceGeofenceEvent("enter", HOME, false, at(9));
  expect(resync).toHaveBeenCalledTimes(2);
});

test("the ENTER Android sends right after registering isn't an arrival: no alert", async () => {
  await onPlaceGeofenceEvent("exit", HOME, false, at(8));
  await onPlaceGeofenceEvent("enter", HOME, false, at(19));
  expect(notify).not.toHaveBeenCalled();
});

test("notifications turned off: no alert", async () => {
  await setNotificationsEnabled(false);
  await onPlaceGeofenceEvent("exit", HOME, false, at(8));
  await onPlaceGeofenceEvent("enter", HOME, true, at(19));
  expect(notify).not.toHaveBeenCalled();
});
