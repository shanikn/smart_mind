import * as Linking from "expo-linking";
import type { LinkingOptions, NavigatorScreenParams } from "@react-navigation/native";
import type { NotesStackParamList } from "../../App";

export type MainTabsParamList = {
  Notes: NavigatorScreenParams<NotesStackParamList> | undefined;
  Settings: undefined;
};

// Deep links: smartmind://new-note (the iPhone widget) opens an empty new
// note with the notes list under it; smartmind:// opens the notes list.
export const linking: LinkingOptions<MainTabsParamList> = {
  prefixes: [Linking.createURL("/"), "smartmind://"],
  config: {
    screens: {
      Notes: {
        initialRouteName: "NotesList",
        screens: {
          NotesList: "",
          AddEditNote: "new-note",
        },
      },
      Settings: "settings",
    },
  },
};

// Signed out, the login screen isn't a navigator, so links are ignored.
export function linkingFor(signedIn: boolean): LinkingOptions<MainTabsParamList> {
  return { ...linking, enabled: signedIn };
}
