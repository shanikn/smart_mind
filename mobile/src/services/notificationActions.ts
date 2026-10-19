import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";

import { getNotes, updateNote } from "../api/notes";
import { sendFeedback } from "../api/reminders";
import {
  ACTION_DONE,
  ACTION_LATER,
  ACTION_NOT_USEFUL,
  DEFAULT_ACTION,
  NOTE_REMINDER_CATEGORY,
  planNotificationResponse,
  responseKey,
  SNOOZE_ID_PREFIX,
  SNOOZE_SECONDS,
} from "../lib/notificationActions";
import { Note } from "../types/notes";
import { removeAlertNote } from "./alertNotesCache";
import { ensureSignedIn } from "./apiAuth";
import { syncScheduledReminders } from "./scheduledReminders";

// Done / Later / Not useful on a note's notification, handled without opening
// the app. A press reaches JS in two ways: the response listener (app running,
// and iOS, which wakes the app in the background for it) and, on Android with
// the app in the background or closed, the background task below. Both are
// set up at module top level (imported from index.ts) so they exist when the
// app is started just for the press.

export const NOTIFICATION_ACTION_TASK = "smartmind-notification-action";

export async function setupNotificationCategories(): Promise<void> {
  const quiet = { opensAppToForeground: false };
  await Notifications.setNotificationCategoryAsync(NOTE_REMINDER_CATEGORY, [
    { identifier: ACTION_DONE, buttonTitle: "Done", options: quiet },
    { identifier: ACTION_LATER, buttonTitle: "Later", options: quiet },
    { identifier: ACTION_NOT_USEFUL, buttonTitle: "Not useful", options: quiet },
  ]);
}

const handled = new Set<string>();

// Runs the pressed button once. A plain tap is left to the app (App.tsx opens the note).
export async function handleNotificationAction(response: Notifications.NotificationResponse): Promise<void> {
  const plan = planNotificationResponse(response);
  if (!plan || plan.kind === "open") {
    return;
  }
  const key = responseKey(response);
  if (handled.has(key)) {
    return;
  }
  handled.add(key);

  const { request } = response.notification;
  try {
    // Done and Not useful need the server: signed out, the notification stays
    if (plan.kind !== "later" && !(await ensureSignedIn())) {
      handled.delete(key);
      return;
    }
    // Android leaves the notification up after a button press
    await Notifications.dismissNotificationAsync(request.identifier).catch(() => {});
    if (plan.kind === "later") {
      await Notifications.scheduleNotificationAsync({
        identifier: SNOOZE_ID_PREFIX + plan.noteId,
        content: {
          title: request.content.title ?? "Smart Mind reminder",
          body: request.content.body,
          sound: "default",
          data: request.content.data,
          categoryIdentifier: NOTE_REMINDER_CATEGORY,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: SNOOZE_SECONDS },
      });
      return;
    }
    if (plan.kind === "not-useful") {
      await sendFeedback(plan.noteId, "dismiss");
      return;
    }
    // done: the note stays (under "Alerts off") and stops alerting
    await Notifications.cancelScheduledNotificationAsync(SNOOZE_ID_PREFIX + plan.noteId).catch(() => {});
    await sendFeedback(plan.noteId, "useful");
    await updateNote(plan.noteId, { reminders_enabled: false });
    await removeAlertNote(plan.noteId).catch(() => {});
    await syncScheduledReminders();
  } catch (e) {
    handled.delete(key); // a second delivery of the same press can retry
    console.log("Notification action failed", e);
  }
}

// For a tap: the note to open, or null (a store alert, a deleted note, no
// signal), in which case the notes list is shown.
export async function noteToOpen(response: Notifications.NotificationResponse): Promise<Note | null> {
  const plan = planNotificationResponse(response);
  if (!plan || plan.kind !== "open") {
    return null;
  }
  try {
    const notes = await getNotes();
    return notes.find((n) => n._id === plan.noteId) ?? null;
  } catch {
    return null;
  }
}

export function isTap(response: Notifications.NotificationResponse): boolean {
  return response.actionIdentifier === DEFAULT_ACTION;
}

TaskManager.defineTask<Notifications.NotificationTaskPayload>(NOTIFICATION_ACTION_TASK, async ({ data, error }) => {
  if (error || !data || !("actionIdentifier" in data)) {
    return;
  }
  await handleNotificationAction(data);
});

Notifications.addNotificationResponseReceivedListener((response) => {
  handleNotificationAction(response);
});

setupNotificationCategories().catch((e) => console.log("Notification buttons not set up", e));
// iOS needs no task: it delivers the press to the listener above
if (Platform.OS === "android") {
  Notifications.registerTaskAsync(NOTIFICATION_ACTION_TASK).catch((e) =>
    console.log("Notification action task not registered", e)
  );
}
