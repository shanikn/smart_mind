import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { sendFeedback } from "../api/reminders";
import { getNotes, updateNote } from "../api/notes";
import { removeAlertNote } from "./alertNotesCache";
import { ensureSignedIn } from "./apiAuth";
import { syncScheduledReminders } from "./scheduledReminders";
import {
  handleNotificationAction,
  noteToOpen,
  setupNotificationCategories,
} from "./notificationActions";
import {
  ACTION_DONE,
  ACTION_LATER,
  ACTION_NOT_USEFUL,
  DEFAULT_ACTION,
  NOTE_REMINDER_CATEGORY,
} from "../lib/notificationActions";

jest.mock("expo-notifications", () => ({
  DEFAULT_ACTION_IDENTIFIER: "expo.modules.notifications.actions.DEFAULT",
  SchedulableTriggerInputTypes: { TIME_INTERVAL: "timeInterval" },
  setNotificationCategoryAsync: jest.fn().mockResolvedValue(null),
  scheduleNotificationAsync: jest.fn().mockResolvedValue("id"),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  dismissNotificationAsync: jest.fn().mockResolvedValue(undefined),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  registerTaskAsync: jest.fn().mockResolvedValue(null),
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("../api/reminders", () => ({ sendFeedback: jest.fn().mockResolvedValue({ message: "ok" }) }));
jest.mock("../api/notes", () => ({
  getNotes: jest.fn(),
  updateNote: jest.fn().mockResolvedValue({ message: "ok" }),
}));
jest.mock("./alertNotesCache", () => ({ removeAlertNote: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./scheduledReminders", () => ({ syncScheduledReminders: jest.fn().mockResolvedValue(undefined) }));
jest.mock("./apiAuth", () => ({ ensureSignedIn: jest.fn().mockResolvedValue(true) }));

const mocked = Notifications as jest.Mocked<typeof Notifications>;

let requestId = 0;
const response = (actionIdentifier: string, data: Record<string, unknown> = { noteId: "n1" }) =>
  ({
    actionIdentifier,
    notification: {
      request: {
        identifier: `req-${++requestId}`,
        content: { title: "Smart Mind reminder", body: "buy milk", data },
      },
    },
  }) as unknown as Notifications.NotificationResponse;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

test("the category has Done, Later and Not useful, none of which opens the app", async () => {
  await setupNotificationCategories();
  const [id, actions] = mocked.setNotificationCategoryAsync.mock.calls[0];
  expect(id).toBe(NOTE_REMINDER_CATEGORY);
  expect(actions.map((a) => [a.identifier, a.buttonTitle])).toEqual([
    [ACTION_DONE, "Done"],
    [ACTION_LATER, "Later"],
    [ACTION_NOT_USEFUL, "Not useful"],
  ]);
  expect(actions.every((a) => a.options?.opensAppToForeground === false)).toBe(true);
});

test("Done: counts as useful, turns the note's alerts off and drops its alarms", async () => {
  await handleNotificationAction(response(ACTION_DONE));
  expect(sendFeedback).toHaveBeenCalledWith("n1", "useful");
  expect(updateNote).toHaveBeenCalledWith("n1", { reminders_enabled: false });
  expect(removeAlertNote).toHaveBeenCalledWith("n1");
  expect(mocked.cancelScheduledNotificationAsync).toHaveBeenCalledWith("snooze-n1");
  expect(syncScheduledReminders).toHaveBeenCalled();
  expect(mocked.dismissNotificationAsync).toHaveBeenCalled();
});

test("Later: the same reminder comes back in an hour, nothing is sent to the server", async () => {
  await handleNotificationAction(response(ACTION_LATER));
  const request = mocked.scheduleNotificationAsync.mock.calls[0][0];
  expect(request.identifier).toBe("snooze-n1");
  expect(request.content).toMatchObject({
    body: "buy milk",
    data: { noteId: "n1" },
    categoryIdentifier: NOTE_REMINDER_CATEGORY,
  });
  expect(request.trigger).toMatchObject({ type: "timeInterval", seconds: 3600 });
  expect(sendFeedback).not.toHaveBeenCalled();
  expect(mocked.dismissNotificationAsync).toHaveBeenCalled();
});

test("Not useful: recorded as a dismissal, alerts stay on", async () => {
  await handleNotificationAction(response(ACTION_NOT_USEFUL));
  expect(sendFeedback).toHaveBeenCalledWith("n1", "dismiss");
  expect(updateNote).not.toHaveBeenCalled();
  expect(mocked.dismissNotificationAsync).toHaveBeenCalled();
});

test("a press delivered twice (listener and background task) is handled once", async () => {
  const press = response(ACTION_NOT_USEFUL);
  await Promise.all([handleNotificationAction(press), handleNotificationAction(press)]);
  await handleNotificationAction(press);
  expect(sendFeedback).toHaveBeenCalledTimes(1);
});

test("a plain tap is left to the app (it opens the note)", async () => {
  await handleNotificationAction(response(DEFAULT_ACTION));
  expect(sendFeedback).not.toHaveBeenCalled();
  expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
});

test("no signal: the notification still goes away and nothing throws", async () => {
  (sendFeedback as jest.Mock).mockRejectedValueOnce(new TypeError("Network request failed"));
  await expect(handleNotificationAction(response(ACTION_NOT_USEFUL))).resolves.toBeUndefined();
  expect(mocked.dismissNotificationAsync).toHaveBeenCalled();
});

test("a press that failed can be retried by its second delivery", async () => {
  const press = response(ACTION_NOT_USEFUL);
  (sendFeedback as jest.Mock).mockRejectedValueOnce(new TypeError("Network request failed"));
  await handleNotificationAction(press);
  await handleNotificationAction(press);
  expect(sendFeedback).toHaveBeenCalledTimes(2);
});

test("signed out: Done and Not useful leave the notification up and do nothing", async () => {
  (ensureSignedIn as jest.Mock).mockResolvedValue(false);
  try {
    await handleNotificationAction(response(ACTION_DONE));
    await handleNotificationAction(response(ACTION_NOT_USEFUL));
    expect(mocked.dismissNotificationAsync).not.toHaveBeenCalled();
    expect(sendFeedback).not.toHaveBeenCalled();
    expect(updateNote).not.toHaveBeenCalled();
    // Later needs no sign-in
    await handleNotificationAction(response(ACTION_LATER));
    expect(mocked.scheduleNotificationAsync).toHaveBeenCalled();
    expect(mocked.dismissNotificationAsync).toHaveBeenCalledTimes(1);
  } finally {
    (ensureSignedIn as jest.Mock).mockResolvedValue(true);
  }
});

describe("noteToOpen", () => {
  const note = { _id: "n1", content: "buy milk" };

  test("a tap finds the note", async () => {
    (getNotes as jest.Mock).mockResolvedValue([{ _id: "other" }, note]);
    await expect(noteToOpen(response(DEFAULT_ACTION))).resolves.toEqual(note);
  });

  test("a deleted note, or no signal: null (the notes list opens)", async () => {
    (getNotes as jest.Mock).mockResolvedValue([{ _id: "other" }]);
    await expect(noteToOpen(response(DEFAULT_ACTION))).resolves.toBeNull();
    (getNotes as jest.Mock).mockRejectedValue(new TypeError("Network request failed"));
    await expect(noteToOpen(response(DEFAULT_ACTION))).resolves.toBeNull();
  });

  test("a button press isn't a tap", async () => {
    await expect(noteToOpen(response(ACTION_DONE))).resolves.toBeNull();
    expect(getNotes).not.toHaveBeenCalled();
  });
});
