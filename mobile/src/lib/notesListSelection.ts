// The notes list's folder tab, and the categories and place picked in its filter.
// Kept in memory, so they stay while the app is open and reset when it
// restarts.

let folderTab = "All";
let categories: string[] = [];
let place = "all";

export function getFolderTab(): string {
  return folderTab;
}

export function setFolderTab(name: string): void {
  folderTab = name;
}

export function getCategorySelection(): string[] {
  return [...categories];
}

export function setCategorySelection(names: string[]): void {
  categories = [...names];
}

// "all", "none" or a place id (lib/noteFilter.ts)
export function getPlaceSelection(): string {
  return place;
}

export function setPlaceSelection(value: string): void {
  place = value;
}
