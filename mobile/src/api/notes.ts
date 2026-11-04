import { apiRequest, currentUserId } from "./client";
import { removeAlertNote, saveAlertNotes } from "../services/alertNotesCache";
import { Note, PlaceTrigger } from "../types/notes";

export async function createNote(
  content: string,
  listName: string = "General",
  remindersEnabled: boolean = true,
  categoryExplicit: boolean = false,
  category?: string,
  locationExplicit: boolean = false,
  locationValue?: string,
  remindDateExplicit: boolean = false,
  remindTimeExplicit: boolean = false,
  remindAtHour?: number,
  remindAtMinute?: number,
  remindOnDate?: string,
  placeTrigger?: PlaceTrigger // on arriving or on leaving the place; left out = Smart
): Promise<{ id: string; content: string; category: string }> {
  return apiRequest("/notes/", {
    method: "POST",
    body: JSON.stringify({
      content,
      list_name: listName,
      reminders_enabled: remindersEnabled,
      category_explicit: categoryExplicit,
      category: category ?? null,
      location_explicit: locationExplicit,
      location_value: locationValue ?? null,
      remind_date_explicit: remindDateExplicit,
      remind_time_explicit: remindTimeExplicit,
      remind_at_hour: remindAtHour ?? null,
      remind_at_minute: remindAtMinute ?? null,
      remind_on_date: remindOnDate ?? null,
      place_trigger: placeTrigger ?? null,
    }),
  });
}

// every successful load also refreshes the notes kept for offline arrival alerts
export async function getNotes(): Promise<Note[]> {
  const notes: Note[] = await apiRequest("/notes/");
  const userId = currentUserId();
  if (userId && Array.isArray(notes)) {
    try {
      await saveAlertNotes(notes, userId);
    } catch {
      // the cache is a convenience; loading the notes still worked
    }
  }
  return notes;
}

export async function updateNote(
  noteId: string,
  fields: {
    content?: string;
    list_name?: string;
    category?: string;
    category_explicit?: boolean;
    location_explicit?: boolean;
    location_value?: string;
    contexts?: string;
    remind_date_explicit?: boolean;
    remind_time_explicit?: boolean;
    remind_at_hour?: number | string;
    remind_at_minute?: number | string;
    remind_on_date?: string;
    reminders_enabled?: boolean;
    place_trigger?: PlaceTrigger | ""; // "" = back to Smart
  }
): Promise<{ message: string }> {
  // as a JSON body: the note text doesn't belong in the URL (servers and
  // proxies log URLs). Undefined fields aren't sent; "" clears a field.
  const body = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
  return apiRequest(`/notes/${noteId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteNote(noteId: string): Promise<{ message: string }> {
  const result = await apiRequest(`/notes/${noteId}`, {
    method: "DELETE",
  });
  // a deleted note mustn't show up in an offline arrival alert
  await removeAlertNote(noteId).catch(() => {});
  return result;
}
