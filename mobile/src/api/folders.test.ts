import { apiRequest } from "./client";
import { createFolder, deleteFolder, listFolders, saveFolderOrder } from "./folders";

jest.mock("./client", () => ({ apiRequest: jest.fn() }));
const request = apiRequest as jest.Mock;

beforeEach(() => request.mockReset());

test("lists the folder names", async () => {
  request.mockResolvedValue([{ name: "Games" }, { name: "Work" }]);
  expect(await listFolders()).toEqual(["Games", "Work"]);
  expect(request).toHaveBeenCalledWith("/folders/");
});

test("creates a folder with a JSON body", async () => {
  request.mockResolvedValue({ name: "Games" });
  expect(await createFolder("Games")).toBe("Games");
  expect(request).toHaveBeenCalledWith("/folders/", { method: "POST", body: JSON.stringify({ name: "Games" }) });
});

test("deletes a folder, its name encoded in the URL (spaces, Hebrew)", async () => {
  request.mockResolvedValue({ deleted: true, moved: 2 });
  expect(await deleteFolder("משחקים לילדים")).toEqual({ deleted: true, moved: 2 });
  expect(request).toHaveBeenCalledWith(`/folders/${encodeURIComponent("משחקים לילדים")}`, { method: "DELETE" });
});

test("saves the folder order with a JSON body and returns the server's order", async () => {
  request.mockResolvedValue([{ name: "Trips" }, { name: "Games" }]);
  expect(await saveFolderOrder(["Trips", "Games"])).toEqual(["Trips", "Games"]);
  expect(request).toHaveBeenCalledWith("/folders/order", {
    method: "PUT",
    body: JSON.stringify({ names: ["Trips", "Games"] }),
  });
});
