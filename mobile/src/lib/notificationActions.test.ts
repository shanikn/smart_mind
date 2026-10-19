import {
  ACTION_DONE,
  ACTION_LATER,
  ACTION_NOT_USEFUL,
  DEFAULT_ACTION,
  planNotificationResponse,
  responseKey,
  SNOOZE_SECONDS,
} from "./notificationActions";

const response = (actionIdentifier: string, data: Record<string, unknown> = { noteId: "n1" }) => ({
  actionIdentifier,
  notification: { request: { identifier: "req-1", content: { title: "t", body: "b", data } } },
});

test("a tap on a note's notification opens that note", () => {
  expect(planNotificationResponse(response(DEFAULT_ACTION))).toEqual({ kind: "open", noteId: "n1" });
});

test("a tap on a notification without a note (a store alert) opens nothing specific", () => {
  expect(planNotificationResponse(response(DEFAULT_ACTION, { kind: "store", noteIds: ["a", "b"] }))).toBeNull();
});

test("the three buttons", () => {
  expect(planNotificationResponse(response(ACTION_DONE))).toEqual({ kind: "done", noteId: "n1" });
  expect(planNotificationResponse(response(ACTION_LATER))).toEqual({ kind: "later", noteId: "n1" });
  expect(planNotificationResponse(response(ACTION_NOT_USEFUL))).toEqual({ kind: "not-useful", noteId: "n1" });
});

test("an unknown button, or no noteId, does nothing", () => {
  expect(planNotificationResponse(response("something-else"))).toBeNull();
  expect(planNotificationResponse(response(ACTION_DONE, {}))).toBeNull();
  expect(planNotificationResponse(response(ACTION_DONE, { noteId: 7 }))).toBeNull();
});

test("Later snoozes for an hour", () => {
  expect(SNOOZE_SECONDS).toBe(60 * 60);
});

test("one key per notification and button, so a press handled twice runs once", () => {
  expect(responseKey(response(ACTION_DONE))).toBe("req-1|done");
  expect(responseKey(response(ACTION_LATER))).toBe("req-1|later");
});
