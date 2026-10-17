// An alert date picked by hand can't be in the past: no earlier day, and
// no time today that has already gone by. A time with no date repeats
// daily (lib/reminderSchedule.ts), so it is never in the past.

export function startOfToday(now: Date = new Date()): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export type PastReminder = { title: string; message: string };

// why the date/time can't be used, or null when it's fine
export function pastReminder(
  date: Date | null,
  hour: number | null,
  minute: number | null,
  now: Date = new Date()
): PastReminder | null {
  if (!date) {
    return null;
  }
  const day = startOfToday(date).getTime();
  const today = startOfToday(now).getTime();
  if (day < today) {
    return { title: "Pick a later date", message: "That date has already passed. Pick today or a later day." };
  }
  if (day === today && hour !== null) {
    const picked = hour * 60 + (minute ?? 0);
    const current = now.getHours() * 60 + now.getMinutes();
    if (picked < current) {
      return { title: "Pick a later time", message: "That time has already passed today. Pick a later time." };
    }
  }
  return null;
}
