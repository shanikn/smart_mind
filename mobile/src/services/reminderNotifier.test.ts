import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { getReminders } from "../api/reminders";
import { saveAlertNotes } from "./alertNotesCache";
import { checkAndNotifyReminders } from "./reminderNotifier";
import { setReminderLocation } from "../lib/reminderPrefs";
import { Note } from "../types/notes";

jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  getPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("id"),
}));
jest.mock("../api/reminders", () => ({ getReminders: jest.fn() }));
jest.mock("./scheduledReminders", () => ({ getScheduledNoteIds: jest.fn().mockResolvedValue(new Set()) }));
jest.mock("./placeState", () => ({ trackedPlaceIds: jest.fn().mockResolvedValue([]) }));
jest.mock("../api/client", () => ({ ...jest.requireActual("../api/client"), currentUserId: () => "uid-a" }));

const notify = Notifications.scheduleNotificationAsync as jest.Mock;
const fromServer = getReminders as jest.Mock;

const note = (id: string, content: string, fields: Partial<Note> = {}) =>
  ({
    _id: id,
    content,
    category: "todo",
    contexts: ["id-home"],
    list_name: "General",
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    remind_on_date: null,
    useful_count: 0,
    dismissed_count: 0,
    ...fields,
  }) as Note;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await setReminderLocation("id-home");
});

test("online: the server's choice is shown", async () => {
  fromServer.mockResolvedValue([note("s1", "from the server")]);
  const result = await checkAndNotifyReminders({ onArrival: true });
  expect(result.notifiedCount).toBe(1);
  expect(notify.mock.calls[0][0].content.body).toBe("from the server");
  expect(result.offline).toBe(false);
});

test("offline: the notes saved at the last sync for this place are shown", async () => {
  await saveAlertNotes([note("c1", "water the plants"), note("c2", "gym bag", { contexts: ["id-gym"] })], "uid-a");
  fromServer.mockRejectedValue(new TypeError("Network request failed"));
  const result = await checkAndNotifyReminders({ onArrival: true });
  expect(result.offline).toBe(true);
  expect(result.notifiedCount).toBe(1);
  expect(notify.mock.calls[0][0].content.body).toBe("water the plants");
});

test("offline with nothing saved: no notification, no crash", async () => {
  fromServer.mockRejectedValue(new TypeError("Network request failed"));
  const result = await checkAndNotifyReminders({ onArrival: true });
  expect(result).toMatchObject({ notifiedCount: 0, reminders: [], offline: true });
  expect(notify).not.toHaveBeenCalled();
});

test("offline, the once-per-visit rule still holds", async () => {
  await saveAlertNotes([note("c1", "water the plants")], "uid-a");
  fromServer.mockRejectedValue(new TypeError("Network request failed"));
  await checkAndNotifyReminders({ onArrival: true });
  await checkAndNotifyReminders({ onArrival: true });
  expect(notify).toHaveBeenCalledTimes(1);
});

test("offline, a timed note still waits for its alarm unless it's about arriving", async () => {
  await saveAlertNotes(
    [
      note("t1", "call mom at 20:00", { contexts: ["id-home", "20:00"], reminder_time_source: "text" }),
      note("t2", "when I get home at 20:00 feed the cat", {
        contexts: ["id-home", "20:00"],
        reminder_time_source: "text",
      }),
    ],
    "uid-a"
  );
  fromServer.mockRejectedValue(new TypeError("Network request failed"));
  await checkAndNotifyReminders({ onArrival: true });
  expect(notify.mock.calls.map((c) => c[0].content.body)).toEqual(["when I get home at 20:00 feed the cat"]);
});

test("another user's saved notes are never shown", async () => {
  await saveAlertNotes([note("c1", "someone else's note")], "uid-b");
  fromServer.mockRejectedValue(new TypeError("Network request failed"));
  const result = await checkAndNotifyReminders({ onArrival: true });
  expect(result.notifiedCount).toBe(0);
});

describe("Check now at a note's time", () => {
  const { trackedPlaceIds } = jest.requireMock("./placeState");
  const homeAt1754 = note("p1", "remind me at home at 17:54", {
    contexts: ["id-home", "17:54"],
    reminder_time_source: "text",
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date(2026, 9, 2, 17, 55), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    fromServer.mockResolvedValue([homeAt1754]);
  });
  afterEach(() => {
    jest.useRealTimers();
    trackedPlaceIds.mockResolvedValue([]);
  });

  test("a time + place note doesn't alert when you're somewhere else", async () => {
    trackedPlaceIds.mockResolvedValue(["id-home", "id-gym"]);
    await setReminderLocation("id-gym");
    await checkAndNotifyReminders({ force: true });
    expect(notify).not.toHaveBeenCalled();
  });

  test("...and does when you're there", async () => {
    trackedPlaceIds.mockResolvedValue(["id-home", "id-gym"]);
    await checkAndNotifyReminders({ force: true });
    expect(notify.mock.calls.map((c) => c[0].content.body)).toEqual(["remind me at home at 17:54"]);
  });

  test("location unavailable (the place isn't watched): it alerts, as before", async () => {
    await setReminderLocation("unknown");
    await checkAndNotifyReminders({ force: true });
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
