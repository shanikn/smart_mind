// Order of note folders (lists) everywhere they're shown: General first,
// then the user's folders in the order they arranged (kept on the server),
// then any folder only notes use so far, A to Z. The notes list used to add
// "All" in front (folderTabs).

export const GENERAL = "General";
export const ALL = "All";

export function folderNames(
  notes: { list_name?: string | null }[],
  customLists: string[]
): string[] {
  const ordered = new Set<string>();
  for (const name of customLists) {
    if (name && name !== GENERAL && name !== ALL) {
      ordered.add(name);
    }
  }
  const others = new Set<string>();
  for (const note of notes) {
    const name = note.list_name || GENERAL;
    if (name !== GENERAL && name !== ALL && !ordered.has(name)) {
      others.add(name);
    }
  }
  return [GENERAL, ...ordered, ...[...others].sort()];
}

export function folderTabs(notes: { list_name?: string | null }[], customLists: string[]): string[] {
  return [ALL, ...folderNames(notes, customLists)];
}
