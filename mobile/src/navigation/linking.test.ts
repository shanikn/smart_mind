import { getStateFromPath } from "@react-navigation/native";
import { linking, linkingFor } from "./linking";

// jest has no app manifest, so expo-linking can't read the scheme from app.json
jest.mock("expo-linking", () => ({ createURL: (path: string) => `smartmind://${path.replace(/^\//, "")}` }));

// the route names from the top of the state down to the focused screen
function focusedPath(path: string): string[] {
  const names: string[] = [];
  let state = getStateFromPath(path, linking.config) as any;
  while (state) {
    const route = state.routes[state.index ?? state.routes.length - 1];
    names.push(route.name);
    state = route.state;
  }
  return names;
}

test("the app's scheme is a prefix", () => {
  expect(linking.prefixes).toContain("smartmind://");
});

test("smartmind://new-note opens an empty new note in the Notes tab", () => {
  expect(focusedPath("new-note")).toEqual(["Notes", "AddEditNote"]);
  const state = getStateFromPath("new-note", linking.config) as any;
  const notes = state.routes[0].state;
  // NotesList sits under it, so Back goes to the list
  expect(notes.routes.map((r: any) => r.name)).toEqual(["NotesList", "AddEditNote"]);
  expect(notes.routes[1].params).toBeUndefined();
});

test("smartmind:// opens the notes list", () => {
  expect(focusedPath("")).toEqual(["Notes", "NotesList"]);
});

test("links are ignored while signed out, so the login screen shows as normal", () => {
  expect(linkingFor(false).enabled).toBe(false);
  expect(linkingFor(true).enabled).toBe(true);
  expect(linkingFor(true).config).toBe(linking.config);
});
