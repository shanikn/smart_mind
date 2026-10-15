import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import {
  applyReminderSchedule,
  clearReminderSchedule,
  getScheduledNoteIds,
  REMINDER_CHANNEL_ID,
  syncScheduledReminders,
} from "./scheduledReminders";
import { notesForAlerts, whereAmI } from "./placeState";
import { Note } from "../types/notes";

jest.mock("expo-notifications", () => ({
  SchedulableTriggerInputTypes: { DAILY: "daily", DATE: "date" },
  AndroidImportance: { HIGH: 4 },
  getAllScheduledNotificationsAsync: jest.fn(),
  cancelScheduledNotificationAsync: jest.fn(),
  scheduleNotificationAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
}));
jest.mock("./placeState", () => ({ notesForAlerts: jest.fn(), whereAmI: jest.fn() }));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
    { identifier: "reminder-old-note" },
    { identifier: "some-other-notification" },
  ] as never);
});

const plan = [
  {
    identifier: "reminder-a",
    noteId: "a",
    body: "remind me at 17:53",
    trigger: { kind: "daily" as const, hour: 17, minute: 53 },
  },
  {
    identifier: "reminder-b",
    noteId: "b",
    body: "dentist",
    trigger: { kind: "date" as const, date: new Date(2026, 9, 5, 15, 0) },
  },
];

test("cancels only earlier reminder alarms, then schedules the plan", async () => {
  await applyReminderSchedule(plan);

  expect(mocked.cancelScheduledNotificationAsync.mock.calls).toEqual([["reminder-old-note"]]);
  expect(mocked.setNotificationChannelAsync).toHaveBeenCalledWith(
    REMINDER_CHANNEL_ID,
    expect.objectContaining({ importance: 4 })
  );
  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: "reminder-a",
    content: expect.objectContaining({ body: "remind me at 17:53", data: { noteId: "a" } }),
    trigger: { type: "daily", hour: 17, minute: 53, channelId: REMINDER_CHANNEL_ID },
  });
  expect(mocked.scheduleNotificationAsync).toHaveBeenCalledWith({
    identifier: "reminder-b",
    content: expect.objectContaining({ body: "dentist", data: { noteId: "b" } }),
    trigger: { type: "date", date: new Date(2026, 9, 5, 15, 0), channelId: REMINDER_CHANNEL_ID },
  });
});

test("remembers which notes have an alarm, so polling can skip them", async () => {
  await applyReminderSchedule(plan);
  expect(await getScheduledNoteIds()).toEqual(new Set(["a", "b"]));
});

test("rescheduling replaces the previous set", async () => {
  await applyReminderSchedule(plan);
  await applyReminderSchedule([plan[1]]);
  expect(await getScheduledNoteIds()).toEqual(new Set(["b"]));
});

test("clearReminderSchedule cancels reminder alarms and forgets them", async () => {
  await applyReminderSchedule(plan);
  jest.clearAllMocks();
  mocked.getAllScheduledNotificationsAsync.mockResolvedValue([
    { identifier: "reminder-a" },
    { identifier: "reminder-b" },
    { identifier: "some-other-notification" },
  ] as never);

  await clearReminderSchedule();

  expect(mocked.cancelScheduledNotificationAsync.mock.calls).toEqual([
    ["reminder-a"],
    ["reminder-b"],
  ]);
  expect(mocked.scheduleNotificationAsync).not.toHaveBeenCalled();
  expect(await getScheduledNoteIds()).toEqual(new Set());
});

describe("syncScheduledReminders: a time + place note's alarm only while you're there", () => {
  const homeAt1754 = {
    _id: "p1",
    content: "remind me at home at 17:54",
    category: "todo",
    contexts: ["id-home", "17:54"],
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    remind_time_explicit: false,
    remind_at_hour: null,
    remind_at_minute: null,
    remind_on_date: null,
    reminder_time_source: "text",
  } as unknown as Note;
  const scheduled = () => mocked.scheduleNotificationAsync.mock.calls.map((c) => c[0].identifier);

  beforeEach(() => {
    mocked.getPermissionsAsync.mockResolvedValue({ granted: true } as never);
    (notesForAlerts as jest.Mock).mockResolvedValue([homeAt1754]);
  });

  test("at home: scheduled", async () => {
    (whereAmI as jest.Mock).mockResolvedValue({ currentPlace: "id-home", trackedPlaceIds: ["id-home"] });
    await syncScheduledReminders();
    expect(scheduled()).toEqual(["reminder-p1"]);
  });

  test("away: not scheduled (and the old alarm is cancelled)", async () => {
    (whereAmI as jest.Mock).mockResolvedValue({ currentPlace: "unknown", trackedPlaceIds: ["id-home"] });
    await syncScheduledReminders();
    expect(scheduled()).toEqual([]);
    expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith("reminder-old-note");
  });

  test("location unavailable: scheduled as before", async () => {
    (whereAmI as jest.Mock).mockResolvedValue({ currentPlace: "unknown", trackedPlaceIds: [] });
    await syncScheduledReminders();
    expect(scheduled()).toEqual(["reminder-p1"]);
  });

  test("overlapping syncs: an older 'at home' sync can't re-add the alarm after a newer 'left home' one", async () => {
    // the phone's alarms, as the mocked expo-notifications keeps them
    const alarms = new Set<string>(["reminder-p1"]);
    mocked.getAllScheduledNotificationsAsync.mockImplementation(
      async () => [...alarms].map((identifier) => ({ identifier })) as never
    );
    mocked.cancelScheduledNotificationAsync.mockImplementation(async (id) => {
      alarms.delete(id);
    });
    mocked.scheduleNotificationAsync.mockImplementation(async (request) => {
      alarms.add(request.identifier!);
      return request.identifier!;
    });
    let arriveHome!: () => void;
    (whereAmI as jest.Mock)
      // sync A ("arrived home") reads the place slowly...
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            arriveHome = () => resolve({ currentPlace: "id-home", trackedPlaceIds: ["id-home"] });
          })
      )
      // ...sync B ("left home") quickly
      .mockResolvedValueOnce({ currentPlace: "unknown", trackedPlaceIds: ["id-home"] });

    const a = syncScheduledReminders();
    const b = syncScheduledReminders();
    await new Promise((resolve) => setTimeout(resolve, 0)); // let B get as far as it can
    arriveHome();
    await Promise.all([a, b]);

    expect([...alarms]).toEqual([]);
    expect(await getScheduledNoteIds()).toEqual(new Set());
  });
});
