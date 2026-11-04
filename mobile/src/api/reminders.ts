import { apiRequest } from "./client";
import { Note, PlaceTrigger } from "../types/notes";

// event: just arrived at the place, or just left it (the server then sends
// only the notes for that moment); left out, every note for the place
export async function getReminders(
  location: string = "unknown",
  hour?: number,
  minute?: number,
  event?: PlaceTrigger
): Promise<Note[]> {
  const params = new URLSearchParams({ location });
  if (hour !== undefined) params.append("hour", String(hour));
  if (minute !== undefined) params.append("minute", String(minute));
  if (event !== undefined) params.append("event", event);
  return apiRequest(`/reminders/?${params.toString()}`);
}

export async function sendFeedback(
  noteId: string,
  action: "useful" | "dismiss" | "later" | "annoying"
): Promise<{ message: string }> {
  return apiRequest(`/notes/${noteId}/feedback?action=${action}`, {
    method: "POST",
  });
}
