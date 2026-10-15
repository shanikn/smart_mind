import { AppState, NativeEventSubscription } from "react-native";
import { deleteNote } from "../api/notes";
import { Note } from "../types/notes";
import { syncScheduledReminders } from "./scheduledReminders";
import { syncStoreAlerts } from "./storeAlerts";

// Deleting a note with Undo: the note is hidden at once and the server
// delete waits UNDO_MS. Undo in that time puts it back untouched. Deleting
// another note, or the app going to the background, finishes the waiting
// delete first. Shared by the notes list and the edit screen.

export const UNDO_MS = 5000;

export type DeleteOutcome = { kind: "deleted"; id: string } | { kind: "failed"; note: Note };
type Listener = (outcome?: DeleteOutcome) => void;

let pending: { note: Note; timer: ReturnType<typeof setTimeout> } | null = null;
// deletes on their way to the server: still hidden until they finish
const inFlight = new Set<string>();
const listeners = new Set<Listener>();
let appStateWatch: NativeEventSubscription | null = null;

function notify(outcome?: DeleteOutcome) {
  for (const listener of listeners) {
    listener(outcome);
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// the note the Undo bar is for
export function pendingNote(): Note | null {
  return pending?.note ?? null;
}

// notes the list mustn't show: the waiting one and those being deleted
export function hiddenNoteIds(): string[] {
  return [...(pending ? [pending.note._id] : []), ...inFlight];
}

function stopWaiting(): Note | null {
  if (!pending) {
    return null;
  }
  const { note, timer } = pending;
  clearTimeout(timer);
  pending = null;
  appStateWatch?.remove();
  appStateWatch = null;
  return note;
}

async function commit(note: Note): Promise<void> {
  inFlight.add(note._id);
  notify();
  try {
    await deleteNote(note._id);
    inFlight.delete(note._id);
    notify({ kind: "deleted", id: note._id });
    syncScheduledReminders();
    syncStoreAlerts();
  } catch {
    inFlight.delete(note._id);
    notify({ kind: "failed", note });
  }
}

export function deleteWithUndo(note: Note): void {
  const previous = stopWaiting();
  pending = { note, timer: setTimeout(() => finishPendingDelete(), UNDO_MS) };
  appStateWatch = AppState.addEventListener("change", (state) => {
    if (state !== "active") {
      finishPendingDelete();
    }
  });
  notify();
  if (previous) {
    commit(previous);
  }
}

// Undo: the waiting note comes back as it was (null if nothing is waiting)
export function undoDelete(): Note | null {
  const note = stopWaiting();
  if (note) {
    notify();
  }
  return note;
}

// sends the waiting delete now (background, sign-out, another delete)
export async function finishPendingDelete(): Promise<void> {
  const note = stopWaiting();
  if (note) {
    await commit(note);
  }
}
