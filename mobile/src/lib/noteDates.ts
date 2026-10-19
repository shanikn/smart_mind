// "Created … · Edited …" for the edit screen

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// the server stores times in UTC and may send them without a zone
function serverTime(value: string): number {
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(value);
  return new Date(hasZone ? value : `${value}Z`).getTime();
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// "today, 09:05", "yesterday, 22:30", "4 Mar, 08:00", "31 Dec 2025, 23:59"
export function formatNoteTime(time: Date, now: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(time.getHours())}:${pad(time.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(time, now)) {
    return `today, ${clock}`;
  }
  if (sameDay(time, yesterday)) {
    return `yesterday, ${clock}`;
  }
  const year = time.getFullYear() === now.getFullYear() ? "" : ` ${time.getFullYear()}`;
  return `${time.getDate()} ${MONTHS[time.getMonth()]}${year}, ${clock}`;
}

// the edit time shows only when it's more than a minute after creating;
// null when the created time is missing or not a date
export function noteDatesLine(
  note: { created_at?: string | null; edited_at?: string | null },
  now: Date = new Date()
): string | null {
  const created = note.created_at ? serverTime(note.created_at) : NaN;
  if (Number.isNaN(created)) {
    return null;
  }
  let line = `Created ${formatNoteTime(new Date(created), now)}`;
  const edited = note.edited_at ? serverTime(note.edited_at) : NaN;
  if (!Number.isNaN(edited) && edited - created > 60_000) {
    line += ` · Edited ${formatNoteTime(new Date(edited), now)}`;
  }
  return line;
}
