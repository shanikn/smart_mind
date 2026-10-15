import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  ALERT_NOTES_KEY,
  clearOfflineData,
  readAlertNotes,
  removeAlertNote,
  saveAlertNotes,
} from "./alertNotesCache";
import { Note } from "../types/notes";

const note = (id: string, fields: Partial<Note> = {}) =>
  ({
    _id: id,
    content: `note ${id}`,
    category: "todo",
    contexts: ["id-home", "09:00"],
    list_name: "Uni",
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    remind_on_date: null,
    useful_count: 1,
    dismissed_count: 0,
    shown_count: 7,
    user_id: "uid-a",
    created_at: "2026-10-01T10:00:00",
    ...fields,
  }) as Note;

beforeEach(async () => {
  await AsyncStorage.clear();
});

test("kept under focusedcontext.*", () => {
  expect(ALERT_NOTES_KEY).toBe("focusedcontext.alertNotes");
});

test("keeps only notes that can alert, with what the arrival check needs", async () => {
  await saveAlertNotes(
    [
      note("a"),
      note("off", { reminders_enabled: false }),
      note("idea", { category: "idea" }),
      note("never", { never_show: true }),
      note("errand", { category: "errand", store_type: "pharmacy" }),
    ],
    "uid-a"
  );
  const cached = await readAlertNotes("uid-a");
  expect(cached.map((x) => x._id)).toEqual(["a", "errand"]);
  expect(cached[0]).toEqual({
    _id: "a",
    content: "note a",
    category: "todo",
    contexts: ["id-home", "09:00"],
    list_name: "Uni",
    reminders_enabled: true,
    never_show: false,
    cooldown_until: null,
    remind_on_date: null,
    remind_time_explicit: false,
    remind_at_hour: null,
    remind_at_minute: null,
    reminder_time_source: null,
    store_type: null,
    useful_count: 1,
    dismissed_count: 0,
    created_at: "2026-10-01T10:00:00", // offline ranking: newest first on ties
  });
  expect(cached[1].store_type).toBe("pharmacy");
});

test("another user's cache is never used", async () => {
  await saveAlertNotes([note("a")], "uid-a");
  expect(await readAlertNotes("uid-b")).toEqual([]);
  expect(await readAlertNotes(null)).toEqual([]);
});

test("a corrupt cache reads as empty", async () => {
  await AsyncStorage.setItem(ALERT_NOTES_KEY, "not json");
  expect(await readAlertNotes("uid-a")).toEqual([]);
});

test("a deleted note leaves the cache at once", async () => {
  await saveAlertNotes([note("a"), note("b")], "uid-a");
  await removeAlertNote("a");
  expect((await readAlertNotes("uid-a")).map((x) => x._id)).toEqual(["b"]);
});

test("sign-out clears note text kept for offline alerts, but not preferences", async () => {
  await saveAlertNotes([note("a")], "uid-a");
  await AsyncStorage.multiSet([
    ["smartmind.storeAlerts.errands", "[]"],
    ["smartmind.storeAlerts.cache", "{}"],
    ["smartmind.storeAlerts.regions", "{}"],
    ["smartmind.storeAlerts.storeInfo", "{}"],
    ["smartmind.storeAlerts.visits", "{}"],
    ["smartmind.storeAlerts.pending", "{}"],
    ["smartmind.storeAlerts.enabled", "true"],
    ["focusedcontext.appearance", "dark"],
    ["focusedcontext.folders", '["Games"]'],
    ["focusedcontext.customLists", '["Trips"]'],
  ]);
  await clearOfflineData();
  expect((await AsyncStorage.getAllKeys()).slice().sort()).toEqual([
    "focusedcontext.appearance",
    "smartmind.storeAlerts.enabled",
  ]);
});
