import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import { MIN_TOUCH_TARGET, Theme, fonts, radius } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

// A bar at the bottom of the screen: what just happened, and Undo.
export default function UndoBar({
  message,
  onUndo,
  style,
}: {
  message: string;
  onUndo: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={[styles.bar, style]} accessibilityLiveRegion="polite">
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <TouchableOpacity style={styles.undo} onPress={onUndo} accessibilityRole="button" accessibilityLabel="Undo">
        <Ionicons name="arrow-undo-circle-outline" size={22} color={colors.primary} />
        <Text style={styles.undoText}>Undo</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: "row",
      alignItems: "center",
      minHeight: 52,
      paddingLeft: 16,
      paddingRight: 4,
      borderRadius: radius.card,
      backgroundColor: colors.text,
      elevation: 6,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.2,
      shadowRadius: 6,
    },
    message: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.background },
    undo: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: MIN_TOUCH_TARGET,
      paddingHorizontal: 12,
    },
    undoText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.primary },
  });
