import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

import { getNotificationsEnabled } from "../lib/reminderPrefs";
import {
  MAX_SCHEDULED_REMINDERS,
  planReminderSchedule,
  PlannedReminder,
  REMINDER_ID_PREFIX,
} from "../lib/reminderSchedule";
import { notesForAlerts, whereAmI } from "./placeState";

// Exact local alarms for reminder times, scheduled ahead with
// expo-notifications. A note with a time and a place gets its alarm only while
// you're at that place (lib/placeTimeReminders.ts); the geofence task re-plans
// on every enter/exit. Android's AlarmManager fires them with the app closed
// (exact and allowed in Doze before Android 12) and expo-notifications
// re-schedules them after a reboot. Polling stays as the fallback for notes
// without an exact time.

export const REMINDER_CHANNEL_ID = "reminders";
const SCHEDULED_IDS_KEY = "focusedcontext.reminder.scheduledNoteIds";

async function cancelReminderAlarms(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of scheduled) {
    if (request.identifier.startsWith(REMINDER_ID_PREFIX)) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
}

function toTrigger(reminder: PlannedReminder): Notifications.NotificationTriggerInput {
  if (reminder.trigger.kind === "daily") {
    return {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: reminder.trigger.hour,
      minute: reminder.trigger.minute,
      channelId: REMINDER_CHANNEL_ID,
    };
  }
  return {
    type: Notifications.SchedulableTriggerInputTypes.DATE,
    date: reminder.trigger.date,
    channelId: REMINDER_CHANNEL_ID,
  };
}

// Cancel the previous reminder alarms and schedule this plan instead.
export async function applyReminderSchedule(plan: PlannedReminder[]): Promise<void> {
  await cancelReminderAlarms();
  await Notifications.setNotificationChannelAsync(REMINDER_CHANNEL_ID, {
    name: "Reminders",
    importance: Notifications.AndroidImportance.HIGH,
    sound: "default",
  });
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      identifier: reminder.identifier,
      content: {
        title: "Smart Mind reminder",
        body: reminder.body,
        sound: "default",
        data: { noteId: reminder.noteId },
      },
      trigger: toTrigger(reminder),
    });
  }
  await AsyncStorage.setItem(
    SCHEDULED_IDS_KEY,
    JSON.stringify(plan.map((r) => r.noteId))
  );
}

export async function clearReminderSchedule(): Promise<void> {
  await cancelReminderAlarms();
  await AsyncStorage.setItem(SCHEDULED_IDS_KEY, JSON.stringify([]));
}

// notes that already have an exact alarm; the poller skips them
export async function getScheduledNoteIds(): Promise<Set<string>> {
  const raw = await AsyncStorage.getItem(SCHEDULED_IDS_KEY);
  try {
    const ids = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

// Syncs run one at a time, in the order they were asked for: otherwise an
// older "arrived home" sync still reading the notes could finish after a
// newer "left home" one and put the home alarms back.
let syncQueue: Promise<void> = Promise.resolve();

// Re-plan from the current notes (the ones saved on the phone when offline).
// Call on app start/foreground, after a note is created, edited or deleted,
// and when you enter or leave a place. Never prompts for permission.
export function syncScheduledReminders(): Promise<void> {
  syncQueue = syncQueue.then(syncNow);
  return syncQueue;
}

async function syncNow(): Promise<void> {
  try {
    const enabled = await getNotificationsEnabled();
    const permission = await Notifications.getPermissionsAsync();
    if (!enabled || !permission.granted) {
      await clearReminderSchedule();
      return;
    }
    const [notes, where] = await Promise.all([notesForAlerts(), whereAmI()]);
    await applyReminderSchedule(planReminderSchedule(notes, new Date(), MAX_SCHEDULED_REMINDERS, where));
  } catch (e) {
    console.log("Scheduling reminders failed", e);
  }
}
