import AsyncStorage from "@react-native-async-storage/async-storage";
import { canAlert } from "../lib/alertRules";
import { Note } from "../types/notes";

// The notes that can alert, saved on the phone at every successful sync, so
// arriving at a place still shows them when the server can't be reached.
// Tagged with the user, so one account never sees another's notes.

export const ALERT_NOTES_KEY = "focusedcontext.alertNotes";

// the user's folder names (services/foldersStore.ts; the old phone-only list),
// and errand text and store data kept by the store alerts (services/storeAlerts.ts)
const STORE_ALERT_DATA_KEYS = [
  "focusedcontext.folders",
  "focusedcontext.customLists",
  "smartmind.storeAlerts.errands",
  "smartmind.storeAlerts.cache",
  "smartmind.storeAlerts.regions",
  "smartmind.storeAlerts.storeInfo",
  "smartmind.storeAlerts.names",
  "smartmind.storeAlerts.visits",
  "smartmind.storeAlerts.pending",
  // when you left each place, and which missed time + place notes were alerted (placeTimeReminders.ts)
  "focusedcontext.placeExits",
  "focusedcontext.placeTimeAlerted",
];

interface Saved {
  userId: string;
  savedAt: string;
  notes: Note[];
}

// only what the arrival check and its notification need
function slim(n: Note): Note {
  return {
    _id: n._id,
    content: n.content,
    category: n.category,
    contexts: n.contexts ?? [],
    list_name: n.list_name,
    reminders_enabled: n.reminders_enabled,
    never_show: n.never_show ?? false,
    cooldown_until: n.cooldown_until ?? null,
    remind_on_date: n.remind_on_date ?? null,
    remind_time_explicit: n.remind_time_explicit ?? false,
    remind_at_hour: n.remind_at_hour ?? null,
    remind_at_minute: n.remind_at_minute ?? null,
    reminder_time_source: n.reminder_time_source ?? null,
    store_type: n.store_type ?? null,
    useful_count: n.useful_count ?? 0,
    dismissed_count: n.dismissed_count ?? 0,
    created_at: n.created_at, // offline ranking: newest first on equal scores
  } as Note;
}

export async function saveAlertNotes(notes: Note[], userId: string): Promise<void> {
  const saved: Saved = {
    userId,
    savedAt: new Date().toISOString(),
    notes: notes.filter((n) => canAlert(n) && !n.never_show).map(slim),
  };
  await AsyncStorage.setItem(ALERT_NOTES_KEY, JSON.stringify(saved));
}

async function readSaved(): Promise<Saved | null> {
  try {
    const raw = await AsyncStorage.getItem(ALERT_NOTES_KEY);
    const saved = raw ? (JSON.parse(raw) as Saved) : null;
    return saved && Array.isArray(saved.notes) ? saved : null;
  } catch {
    return null;
  }
}

export async function readAlertNotes(userId: string | null | undefined): Promise<Note[]> {
  const saved = await readSaved();
  return saved && userId && saved.userId === userId ? saved.notes : [];
}

export async function removeAlertNote(noteId: string): Promise<void> {
  const saved = await readSaved();
  if (saved) {
    saved.notes = saved.notes.filter((n) => n._id !== noteId);
    await AsyncStorage.setItem(ALERT_NOTES_KEY, JSON.stringify(saved));
  }
}

// On sign-out: the note text kept for offline alerts (this cache and the
// store alerts' errands). Preferences stay.
export async function clearOfflineData(): Promise<void> {
  await AsyncStorage.multiRemove([ALERT_NOTES_KEY, ...STORE_ALERT_DATA_KEYS]);
}
