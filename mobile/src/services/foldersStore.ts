import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError } from "../api/client";
import { createFolder, deleteFolder, listFolders, saveFolderOrder } from "../api/folders";
import { getCustomLists } from "../lib/listPrefs";

// The user's folders, in the order they arranged: kept on the server so they
// stay until deleted (even when empty), with a copy on the phone for when it's
// offline. New folders go at the end. Folders that
// earlier versions kept only on this phone (focusedcontext.customLists) are
// uploaded once.

export const FOLDERS_CACHE_KEY = "focusedcontext.folders";
const LEGACY_LISTS_KEY = "focusedcontext.customLists";

// the lists one after another, without repeats (any capitals); order kept
function merged(...lists: string[][]): string[] {
  const seen = new Map<string, string>();
  for (const name of lists.flat()) {
    const key = name.trim().toLowerCase();
    if (key && !seen.has(key)) {
      seen.set(key, name.trim());
    }
  }
  return [...seen.values()];
}

async function readCache(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(FOLDERS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

async function writeCache(folders: string[]): Promise<void> {
  await AsyncStorage.setItem(FOLDERS_CACHE_KEY, JSON.stringify(folders));
}

// the old phone-only folders the server doesn't have yet; the old list is
// dropped once every one of them is on the server
async function uploadLegacy(serverFolders: string[]): Promise<string[]> {
  const legacy = await getCustomLists().catch(() => []);
  if (legacy.length === 0) {
    return [];
  }
  const known = new Set(serverFolders.map((f) => f.toLowerCase()));
  const uploaded: string[] = [];
  let allDone = true;
  for (const name of legacy) {
    if (known.has(name.toLowerCase())) {
      continue;
    }
    try {
      uploaded.push(await createFolder(name));
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        continue; // already there
      }
      allDone = false;
      uploaded.push(name); // still shown; uploaded next time
    }
  }
  if (allDone) {
    await AsyncStorage.removeItem(LEGACY_LISTS_KEY);
  }
  return uploaded;
}

export async function loadFolders(): Promise<string[]> {
  try {
    const server = await listFolders();
    const folders = merged(server, await uploadLegacy(server));
    await writeCache(folders);
    return folders;
  } catch {
    // offline: what we saw last, plus any old phone-only folders
    return merged(await readCache(), await getCustomLists().catch(() => []));
  }
}

export async function addFolder(name: string): Promise<string[]> {
  const created = await createFolder(name.trim());
  const folders = merged(await readCache(), [created]);
  await writeCache(folders);
  return folders;
}

// deletes the folder; its notes move to General on the server
export async function removeFolder(name: string): Promise<{ folders: string[]; moved: number }> {
  const { moved } = await deleteFolder(name);
  const folders = (await readCache()).filter((f) => f.toLowerCase() !== name.toLowerCase());
  await writeCache(folders);
  return { folders, moved };
}

// Saves a new order. The phone's copy changes at once (for offline) and goes
// back to the old order if the server can't save it; then this throws.
export async function reorderFolders(names: string[]): Promise<string[]> {
  const previous = await readCache();
  await writeCache(names);
  try {
    const folders = await saveFolderOrder(names);
    await writeCache(folders);
    return folders;
  } catch (e) {
    await writeCache(previous);
    throw e;
  }
}
