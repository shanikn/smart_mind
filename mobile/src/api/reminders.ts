import { apiRequest } from "./client";
import { Note } from "../types/notes";

export async function getReminders(
  location: string = "unknown",
  hour?: number,
  minute?: number
): Promise<Note[]> {
  const params = new URLSearchParams({ location });
  if (hour !== undefined) params.append("hour", String(hour));
  if (minute !== undefined) params.append("minute", String(minute));
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
