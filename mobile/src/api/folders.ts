import { apiRequest } from "./client";

// The user's note folders, kept on the server in the user's order (General is implicit).

export async function listFolders(): Promise<string[]> {
  const folders: { name: string }[] = await apiRequest("/folders/");
  return folders.map((f) => f.name);
}

export async function createFolder(name: string): Promise<string> {
  const created: { name: string } = await apiRequest("/folders/", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return created.name;
}

// the folder's notes move to General on the server
export async function deleteFolder(name: string): Promise<{ deleted: boolean; moved: number }> {
  return apiRequest(`/folders/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// the user's order (General stays first on the phone); returns the server's order
export async function saveFolderOrder(names: string[]): Promise<string[]> {
  const folders: { name: string }[] = await apiRequest("/folders/order", {
    method: "PUT",
    body: JSON.stringify({ names }),
  });
  return folders.map((f) => f.name);
}
