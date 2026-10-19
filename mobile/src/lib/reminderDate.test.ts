import { pastReminder, startOfToday } from "./reminderDate";

// Saturday 2026-10-17, 14:30 local time
const NOW = new Date(2026, 9, 17, 14, 30, 0);

test("startOfToday is midnight of the current day", () => {
  expect(startOfToday(NOW)).toEqual(new Date(2026, 9, 17, 0, 0, 0, 0));
});

test("a day before today is refused", () => {
  expect(pastReminder(new Date(2026, 9, 16), null, null, NOW)?.message).toMatch(/date has already passed/);
});

test("today and later days are fine", () => {
  expect(pastReminder(new Date(2026, 9, 17), null, null, NOW)).toBeNull();
  expect(pastReminder(new Date(2026, 9, 18), 9, 0, NOW)).toBeNull();
});

test("today at a time that has already passed is refused", () => {
  expect(pastReminder(new Date(2026, 9, 17), 14, 29, NOW)?.message).toMatch(/time has already passed/);
  expect(pastReminder(new Date(2026, 9, 17), 9, 0, NOW)?.message).toMatch(/time has already passed/);
});

test("today at the current minute or later is fine", () => {
  expect(pastReminder(new Date(2026, 9, 17), 14, 30, NOW)).toBeNull();
  expect(pastReminder(new Date(2026, 9, 17), 18, 0, NOW)).toBeNull();
});

test("a time with no date repeats daily, so it is never in the past", () => {
  expect(pastReminder(null, 9, 0, NOW)).toBeNull();
});
