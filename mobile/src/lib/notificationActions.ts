// What a tap or a button press on a note's notification should do. The
// buttons come from the "note-reminder" category set in
// services/notificationActions.ts; every single-note notification uses it.

export const NOTE_REMINDER_CATEGORY = "note-reminder";
export const ACTION_DONE = "done";
export const ACTION_LATER = "later";
export const ACTION_NOT_USEFUL = "not-useful";
// expo-notifications' identifier for a tap on the notification itself
export const DEFAULT_ACTION = "expo.modules.notifications.actions.DEFAULT";

export const SNOOZE_SECONDS = 60 * 60;
export const SNOOZE_ID_PREFIX = "snooze-";

export type NotificationPlan =
  | { kind: "open"; noteId: string }
  | { kind: "done"; noteId: string }
  | { kind: "later"; noteId: string }
  | { kind: "not-useful"; noteId: string };

// the parts of a NotificationResponse used here
export interface ResponseLike {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> | null } } };
}

const KINDS: Record<string, NotificationPlan["kind"]> = {
  [DEFAULT_ACTION]: "open",
  [ACTION_DONE]: "done",
  [ACTION_LATER]: "later",
  [ACTION_NOT_USEFUL]: "not-useful",
};

// null: nothing note-specific to do (a store alert lists several notes, or an unknown button)
export function planNotificationResponse(response: ResponseLike): NotificationPlan | null {
  const kind = KINDS[response.actionIdentifier];
  const noteId = response.notification.request.content.data?.noteId;
  if (!kind || typeof noteId !== "string" || !noteId) {
    return null;
  }
  return { kind, noteId };
}

// Android delivers a press to both the listener and the background task when
// the app is in the background; this key lets the second one be skipped.
export function responseKey(response: ResponseLike): string {
  return `${response.notification.request.identifier}|${response.actionIdentifier}`;
}
