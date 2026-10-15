import React from "react";
import {
  ActivityIndicator,
  StyleProp,
  StyleSheet,
  Text,
  TouchableOpacity,
  ViewStyle,
} from "react-native";
import { MIN_TOUCH_TARGET, Theme, fonts, radius } from "../../theme";
import { useTheme, useThemedStyles } from "../../ThemeContext";

// Filled green pill, e.g. "Save" or "Save as Uni" (disabled until an
// address is selected; `loading` while saving).
export function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  style,
  testID,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const off = disabled || loading;
  return (
    <TouchableOpacity
      style={[styles.primary, off && styles.disabled, style]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: loading }}
      accessibilityLabel={label}
      testID={testID}
    >
      {loading ? (
        <ActivityIndicator color={colors.onPrimary} />
      ) : (
        <Text style={styles.primaryText}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

// Text-only button in dark green (red for destructive actions like Sign out).
export function TextButton({
  label,
  onPress,
  disabled = false,
  destructive = false,
  style,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  destructive?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string; // when the visible label needs more context
}) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={[styles.text, disabled && styles.disabled, style]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <Text style={[styles.textLabel, destructive && styles.destructive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = ({ colors, type }: Theme) =>
  StyleSheet.create({
  primary: {
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.chip,
    paddingHorizontal: 20,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: { color: colors.onPrimary, fontFamily: fonts.bodyBold, fontSize: 15 },
  disabled: { opacity: 0.5 },
  text: { height: MIN_TOUCH_TARGET, justifyContent: "center", paddingHorizontal: 4 },
  textLabel: { color: colors.primaryDark, fontFamily: fonts.bodyBold, fontSize: 15 },
  destructive: { color: colors.danger },
});
