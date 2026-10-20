import React, { useCallback, useRef, useState } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Theme } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";
import {
  GrantedPermissions,
  nextStep,
  PermissionStep,
  startStep,
} from "../lib/locationPermissionFlow";
import { getGrantedPermissions, requestPermissionFor } from "../services/locationPermissions";

type Screen = "explain" | "disclosure";

const SCREENS: Record<Screen, { title: string; body: string; continueText: string }> = {
  explain: {
    title: "Use your location?",
    body:
      "Smart Mind can save your places (home, uni, the gym...) and show the " +
      "right notes when you're there. Next, Android will ask for location access.",
    continueText: "Continue",
  },
  disclosure: {
    title: "Background location",
    // Google Play's prominent disclosure: what, why, and that it happens
    // when the app is closed or not in use
    body:
      "Smart Mind collects location data to alert you when you arrive at your saved places or are near " +
      "stores for your shopping notes, even when the app is closed or not in use. Your places' coordinates stay " +
      "on your phone. An approximate position is sent to the server only to find nearby stores and to " +
      'rank address search results, and is not stored. On the next screen, choose "Allow all the time".',
    continueText: "Continue",
  },
};

// Drives the permission flow. Call start() only from a user tap.
export function useLocationPermissionFlow(onDone: (perms: GrantedPermissions) => void) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const perms = useRef<GrantedPermissions | null>(null);

  const run = useCallback(
    async (step: PermissionStep) => {
      let current = step;
      // permission requests run back to back; screens wait for the user
      while (current === "foreground" || current === "background" || current === "notifications") {
        await requestPermissionFor(current);
        perms.current = await getGrantedPermissions();
        current = nextStep(current, perms.current);
      }
      if (current === "done") {
        setScreen(null);
        onDone(perms.current ?? (await getGrantedPermissions()));
      } else {
        setScreen(current);
      }
    },
    [onDone]
  );

  const start = useCallback(async () => {
    perms.current = await getGrantedPermissions();
    await run(startStep(perms.current));
  }, [run]);

  const proceed = useCallback(async () => {
    if (screen && perms.current) {
      setScreen(null);
      await run(nextStep(screen, perms.current));
    }
  }, [screen, run]);

  // "Not now": on the explain screen stop; on the disclosure screen skip
  // background location (treated like a denial) but still offer notifications
  const skip = useCallback(async () => {
    if (screen === "disclosure" && perms.current) {
      setScreen(null);
      await run(nextStep("background", perms.current));
    } else {
      setScreen(null);
      onDone(perms.current ?? (await getGrantedPermissions()));
    }
  }, [screen, run, onDone]);

  return { screen, start, proceed, skip };
}

export function LocationPermissionModal({
  screen,
  onContinue,
  onSkip,
}: {
  screen: Screen | null;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const content = screen ? SCREENS[screen] : null;
  return (
    <Modal visible={content !== null} transparent animationType="fade" onRequestClose={onSkip}>
      <View style={styles.backdrop}>
        {content && (
          <View style={styles.card}>
            <Text style={styles.title}>{content.title}</Text>
            <Text style={styles.body}>{content.body}</Text>
            <TouchableOpacity style={styles.primary} onPress={onContinue}>
              <Text style={styles.primaryText}>{content.continueText}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondary} onPress={onSkip}>
              <Text style={styles.secondaryText}>Not now</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: colors.text,
    marginBottom: 8,
  },
  body: {
    fontSize: 14,
    color: colors.textMuted,
    lineHeight: 20,
    marginBottom: 20,
  },
  primary: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryText: {
    color: colors.onPrimary,
    fontSize: 15,
    fontWeight: "600",
  },
  secondary: {
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryText: {
    color: colors.textMuted,
    fontSize: 14,
  },
});
