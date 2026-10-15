import React, { useEffect, useState } from "react";
import { Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { TextButton } from "./ui";
import { isAppleCancel } from "../lib/authErrors";
import { MIN_TOUCH_TARGET, Theme, fonts, radius } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

const CONFIRM_WORD = "DELETE";

// Permanently delete the account: says what goes, and needs DELETE typed.
// An Apple account then confirms with Apple once more (services/accountDeletion.ts).
export default function DeleteAccountModal({
  visible,
  email,
  confirmWithApple = false,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  email: string | null;
  confirmWithApple?: boolean;
  onConfirm: () => Promise<void>;
  onCancel: () => void;
}) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setTyped("");
      setBusy(false);
      setError(null);
    }
  }, [visible]);

  const ready = typed.trim() === CONFIRM_WORD && !busy;

  const confirm = async () => {
    if (!ready) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
    } catch (e) {
      // closing Apple's sheet just stops; nothing was deleted
      if (!isAppleCancel(e)) {
        setError("Couldn't delete your account. Check your connection and try again.");
      }
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={[type.cardTitle, styles.title]}>Delete account</Text>
          <Text style={type.body}>
            This permanently deletes {email ?? "your account"} and everything in it: all your notes, your saved
            places, and your settings on this phone. It can&apos;t be undone.
          </Text>
          <Text style={type.caption}>
            Type {CONFIRM_WORD} to confirm.{confirmWithApple ? " Then confirm with Apple once more." : ""}
          </Text>
          <TextInput
            style={styles.input}
            value={typed}
            onChangeText={setTyped}
            placeholder={CONFIRM_WORD}
            placeholderTextColor={colors.textMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            editable={!busy}
            accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
          />
          {error && <Text style={[type.caption, styles.error]}>{error}</Text>}
          <View style={styles.actions}>
            <TextButton label="Cancel" onPress={onCancel} />
            <TouchableOpacity
              style={[styles.delete, !ready && styles.disabled]}
              onPress={confirm}
              disabled={!ready}
              accessibilityRole="button"
              accessibilityLabel="Delete my account"
              accessibilityState={{ disabled: !ready, busy }}
            >
              <Text style={styles.deleteText}>{busy ? "Deleting…" : "Delete my account"}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "center", padding: 24 },
    card: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 18, gap: 10 },
    title: { color: colors.danger },
    input: {
      height: MIN_TOUCH_TARGET,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 14,
      paddingHorizontal: 12,
      fontFamily: fonts.bodySemi,
      fontSize: 16,
      letterSpacing: 2,
      color: colors.text,
    },
    error: { color: colors.danger },
    actions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
    delete: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: 16,
      borderRadius: radius.chip,
      backgroundColor: colors.danger,
      alignItems: "center",
      justifyContent: "center",
    },
    disabled: { opacity: 0.4 },
    deleteText: { fontFamily: fonts.bodySemi, fontSize: 15, color: "#FFFFFF" },
  });
