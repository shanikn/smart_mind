import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, AppState, View } from "react-native";
import {
  createNavigationContainerRef,
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
} from "@react-navigation/native";
import * as Notifications from "expo-notifications";
import { StatusBar } from "expo-status-bar";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import { useFonts } from "expo-font";
import { BricolageGrotesque_700Bold } from "@expo-google-fonts/bricolage-grotesque/700Bold";
import { Figtree_400Regular } from "@expo-google-fonts/figtree/400Regular";
import { Figtree_500Medium } from "@expo-google-fonts/figtree/500Medium";
import { Figtree_600SemiBold } from "@expo-google-fonts/figtree/600SemiBold";
import { Figtree_700Bold } from "@expo-google-fonts/figtree/700Bold";

import AuthProvider, { useAuth } from "./src/context/AuthContext";
import LoginScreen from "./src/screens/LoginScreen";
import NotesListScreen from "./src/screens/NotesListScreen";
import AddEditNoteScreen from "./src/screens/AddEditNoteScreen";
import SettingsScreen from "./src/screens/SettingsScreen";
import { checkAndNotifyReminders } from "./src/services/reminderNotifier";
import { syncGeofencing } from "./src/services/geofence";
import { syncScheduledReminders } from "./src/services/scheduledReminders";
import { syncStoreAlerts } from "./src/services/storeAlerts";
import { Note } from "./src/types/notes";
import { fonts } from "./src/theme";
import { ThemeProvider, useTheme } from "./src/ThemeContext";
import { linkingFor, MainTabsParamList } from "./src/navigation/linking";
import { isTap, noteToOpen } from "./src/services/notificationActions";

export type NotesStackParamList = {
  NotesList: undefined;
  AddEditNote: { note?: Note; initialListName?: string } | undefined;
};

const Stack = createNativeStackNavigator<NotesStackParamList>();
const Tab = createBottomTabNavigator();
const REMINDER_POLL_MS = 60 * 1000;
const navigationRef = createNavigationContainerRef<MainTabsParamList>();

function openNote(note: Note) {
  navigationRef.navigate("Notes", { screen: "AddEditNote", params: { note } });
}

function NotesStack() {
  return (
    <Stack.Navigator>
      <Stack.Screen
        name="NotesList"
        component={NotesListScreen}
        options={{ title: "My Notes", headerShown: false }}
      />
      <Stack.Screen
        name="AddEditNote"
        component={AddEditNoteScreen}
        options={({ route }) => ({
          title: route.params?.note?._id ? "Edit note" : "New note",
          // the screen draws its own header (back, title, Save)
          headerShown: false,
        })}
      />
    </Stack.Navigator>
  );
}

const TAB_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Notes: "document-text-outline",
  Settings: "options-outline",
};

function MainTabs() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        // active tab: a light green pill behind the icon
        tabBarIcon: ({ focused, color }) => (
          <View
            style={{
              width: 60,
              height: 30,
              borderRadius: 15,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: focused ? colors.primarySoft : "transparent",
            }}
          >
            <Ionicons name={TAB_ICONS[route.name] ?? "ellipse-outline"} size={22} color={color} />
          </View>
        ),
        tabBarActiveTintColor: colors.primaryDark,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 12 },
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 76 + insets.bottom,
          paddingTop: 8,
          paddingBottom: 8 + insets.bottom,
        },
      })}
    >
      <Tab.Screen
        name="Notes"
        component={NotesStack}
        options={{ headerShown: false }}
      />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const { user, loading } = useAuth();
  const [fontsLoaded] = useFonts({
    BricolageGrotesque_700Bold,
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold,
  });
  const isCheckingRef = useRef(false);

  useEffect(() => {
    if (!user) {
      return;
    }

    let mounted = true;

    const runReminderCheck = async () => {
      if (!mounted || isCheckingRef.current) {
        return;
      }

      isCheckingRef.current = true;
      try {
        await checkAndNotifyReminders();
      } catch (error) {
        console.log("Reminder check failed", error);
      } finally {
        isCheckingRef.current = false;
      }
    };

    runReminderCheck();
    // re-register geofences on start, and stop them if location access was
    // revoked in system settings while the app was in the background
    syncGeofencing();
    syncScheduledReminders();
    syncStoreAlerts();

    const interval = setInterval(runReminderCheck, REMINDER_POLL_MS);
    const appStateSubscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        runReminderCheck();
        syncGeofencing();
        syncScheduledReminders();
        syncStoreAlerts();
      }
    });

    return () => {
      mounted = false;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, [user]);

  // a tap on a note's notification opens that note (also when the tap started the app)
  const lastResponse = Notifications.useLastNotificationResponse();
  const openedResponseRef = useRef<string | null>(null);
  const pendingNoteRef = useRef<Note | null>(null);
  useEffect(() => {
    if (!user || !lastResponse || !isTap(lastResponse)) {
      return;
    }
    const id = lastResponse.notification.request.identifier;
    if (openedResponseRef.current === id) {
      return;
    }
    openedResponseRef.current = id;
    noteToOpen(lastResponse).then((note) => {
      if (!note) {
        return;
      }
      if (navigationRef.isReady()) {
        openNote(note);
      } else {
        // the app is still loading (fonts); onReady opens it
        pendingNoteRef.current = note;
      }
    });
  }, [user, lastResponse]);

  const { colors, dark } = useTheme();
  // screen backgrounds behind transitions, so nothing flashes white in dark mode
  const navigationTheme = useMemo(() => {
    const base = dark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
      },
    };
  }, [dark, colors]);
  // deep links (the iPhone widget's smartmind://new-note) only when signed in
  const linking = useMemo(() => linkingFor(!!user), [user]);

  if (loading || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.background }}>
        <StatusBar style={dark ? "light" : "dark"} />
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      linking={linking}
      onReady={() => {
        if (pendingNoteRef.current) {
          openNote(pendingNoteRef.current);
          pendingNoteRef.current = null;
        }
      }}
    >
      <StatusBar style={dark ? "light" : "dark"} />
      {user ? <MainTabs /> : <LoginScreen />}
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <RootNavigator />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
