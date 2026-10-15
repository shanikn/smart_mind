import AsyncStorage from "@react-native-async-storage/async-storage";
import { ApiError } from "../api/client";
import { createFolder, deleteFolder, listFolders, saveFolderOrder } from "../api/folders";
import { addFolder, FOLDERS_CACHE_KEY, loadFolders, removeFolder, reorderFolders } from "./foldersStore";

jest.mock("../api/folders", () => ({
  listFolders: jest.fn(),
  createFolder: jest.fn(),
  deleteFolder: jest.fn(),
  saveFolderOrder: jest.fn(),
}));

const LEGACY_KEY = "focusedcontext.customLists";
const list = listFolders as jest.Mock;
const create = createFolder as jest.Mock;
const remove = deleteFolder as jest.Mock;
const saveOrder = saveFolderOrder as jest.Mock;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  list.mockResolvedValue(["Games", "Work"]);
  saveOrder.mockImplementation(async (names: string[]) => names);
  create.mockImplementation(async (name: string) => name);
  remove.mockResolvedValue({ deleted: true, moved: 0 });
});

test("kept under focusedcontext.*", () => {
  expect(FOLDERS_CACHE_KEY).toBe("focusedcontext.folders");
});

test("the server's folders, also saved for offline", async () => {
  expect(await loadFolders()).toEqual(["Games", "Work"]);
  expect(JSON.parse((await AsyncStorage.getItem(FOLDERS_CACHE_KEY)) as string)).toEqual(["Games", "Work"]);
});

test("folders kept only on this phone before are uploaded once, then the old list is dropped", async () => {
  await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(["Trips", "games"]));
  expect(await loadFolders()).toEqual(["Games", "Work", "Trips"]);
  expect(create.mock.calls).toEqual([["Trips"]]); // "games" is already on the server as "Games"
  expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
  create.mockClear();
  await loadFolders();
  expect(create).not.toHaveBeenCalled();
});

test("an upload that fails keeps the old list for next time", async () => {
  await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(["Trips"]));
  create.mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await loadFolders()).toEqual(["Games", "Work", "Trips"]);
  expect(await AsyncStorage.getItem(LEGACY_KEY)).not.toBeNull();
});

test("a folder that already exists on the server (409) counts as uploaded", async () => {
  await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(["Trips"]));
  create.mockRejectedValueOnce(new ApiError(409, '{"detail":"exists"}'));
  await loadFolders();
  expect(await AsyncStorage.getItem(LEGACY_KEY)).toBeNull();
});

test("offline: the saved folders (and any old phone ones)", async () => {
  await loadFolders();
  await AsyncStorage.setItem(LEGACY_KEY, JSON.stringify(["Trips"]));
  list.mockRejectedValue(new TypeError("Network request failed"));
  expect(await loadFolders()).toEqual(["Games", "Work", "Trips"]);
});

test("adding and removing update the saved list", async () => {
  await loadFolders();
  // a new folder goes at the end, like on the server
  expect(await addFolder(" Art ")).toEqual(["Games", "Work", "Art"]);
  expect(create).toHaveBeenCalledWith("Art");
  remove.mockResolvedValueOnce({ deleted: true, moved: 3 });
  expect(await removeFolder("Games")).toEqual({ folders: ["Work", "Art"], moved: 3 });
  expect(remove).toHaveBeenCalledWith("Games");
  expect(JSON.parse((await AsyncStorage.getItem(FOLDERS_CACHE_KEY)) as string)).toEqual(["Work", "Art"]);
});

test("the server's order is kept as it is (not A to Z)", async () => {
  list.mockResolvedValue(["Work", "art", "Games"]);
  expect(await loadFolders()).toEqual(["Work", "art", "Games"]);
});

describe("reorderFolders", () => {
  test("saves on the server and keeps the order on the phone for offline", async () => {
    await loadFolders();
    expect(await reorderFolders(["Work", "Games"])).toEqual(["Work", "Games"]);
    expect(saveOrder).toHaveBeenCalledWith(["Work", "Games"]);
    expect(JSON.parse((await AsyncStorage.getItem(FOLDERS_CACHE_KEY)) as string)).toEqual(["Work", "Games"]);
    list.mockRejectedValue(new TypeError("Network request failed"));
    expect(await loadFolders()).toEqual(["Work", "Games"]);
  });

  test("the server's answer wins (e.g. a folder added on another phone)", async () => {
    saveOrder.mockResolvedValueOnce(["Work", "Games", "Trips"]);
    expect(await reorderFolders(["Work", "Games"])).toEqual(["Work", "Games", "Trips"]);
    expect(JSON.parse((await AsyncStorage.getItem(FOLDERS_CACHE_KEY)) as string)).toEqual(["Work", "Games", "Trips"]);
  });

  test("a failed save keeps the old order on the phone and throws", async () => {
    await loadFolders();
    saveOrder.mockRejectedValueOnce(new TypeError("Network request failed"));
    await expect(reorderFolders(["Work", "Games"])).rejects.toThrow("Network request failed");
    expect(JSON.parse((await AsyncStorage.getItem(FOLDERS_CACHE_KEY)) as string)).toEqual(["Games", "Work"]);
  });
});
