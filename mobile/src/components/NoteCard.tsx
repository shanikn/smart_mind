import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Swipeable } from "react-native-gesture-handler";
import { Note } from "../types/notes";
import { ServerPlace } from "../lib/userPlaces";
import { CategoryColors, normalizeCategory } from "../lib/categoryColors";
import { noteCardInfo } from "../lib/noteCardInfo";
import { IconTile } from "./ui";
import { MIN_TOUCH_TARGET, Theme, fonts, radius } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

interface NoteCardProps {
  note: Note;
  onPress: () => void;
  onDelete: () => void;
  // ticking a to-do's checkbox: the list deletes it with a "Marked done" Undo bar
  onDone?: () => void;
  places: ServerPlace[];
  categoryColors: CategoryColors;
}

export default function NoteCard({ note, onPress, onDelete, onDone, places, categoryColors }: NoteCardProps) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // the palette decides whether the category name is readable on the card
  const info = noteCardInfo(note, places, categoryColors, colors);
  const showCheckbox = onDone !== undefined && normalizeCategory(note.category) === "todo";

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.deleteAction}
      // no confirmation: the list shows Undo for 5 seconds instead
      onPress={onDelete}
      accessibilityRole="button"
      accessibilityLabel="Delete note"
    >
      <Ionicons name="trash-outline" size={22} color={colors.onPrimary} />
      <Text style={styles.deleteActionText}>Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false} rightThreshold={40}>
      <TouchableOpacity style={styles.card} onPress={onPress} onLongPress={onDelete}>
        {showCheckbox && (
          <TouchableOpacity
            style={styles.checkbox}
            onPress={onDone}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: false }}
            accessibilityLabel="Mark done"
          >
            <Ionicons name="ellipse-outline" size={26} color={colors.textMuted} />
          </TouchableOpacity>
        )}
        <IconTile icon={info.icon} backgroundColor={info.tileColor} iconColor={info.tileIconColor} />

        <View style={styles.body}>
          {/* writingDirection auto: Hebrew notes read right-to-left inside the LTR layout */}
          <Text style={[type.body, styles.content]} numberOfLines={2}>
            {note.content}
          </Text>
          <View style={styles.meta}>
            <Text style={[type.caption, styles.category, { color: info.categoryTextColor }]}>
              {info.categoryLabel}
            </Text>
            {info.placeName && (
              <>
                <Text style={type.caption}> · </Text>
                <Ionicons name="location-outline" size={13} color={colors.textMuted} />
                <Text style={type.caption} numberOfLines={1}>
                  {" "}
                  {info.placeName}
                </Text>
              </>
            )}
            {info.folderName && (
              <Text style={type.caption} numberOfLines={1}>
                {" · "}
                {info.folderName}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.trailing}>
          {info.trailing.kind === "time" &&
            (info.trailing.smart ? (
              <View style={styles.smartTime} accessible accessibilityLabel={info.trailing.accessibilityLabel}>
                <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                <Text style={[styles.time, styles.smartTimeText]}>{info.trailing.label}</Text>
              </View>
            ) : (
              <Text style={styles.time} accessibilityLabel={info.trailing.accessibilityLabel}>
                {info.trailing.label}
              </Text>
            ))}
          {info.trailing.kind === "smart" && (
            <Ionicons name="sparkles-outline" size={20} color={colors.primary} accessibilityLabel="Smart alerts" />
          )}
          {info.trailing.kind === "off" && (
            <Ionicons
              name="notifications-off-outline"
              size={20}
              color={colors.textMuted}
              accessibilityLabel="Alerts off"
            />
          )}
        </View>
      </TouchableOpacity>
    </Swipeable>
  );
}

const makeStyles = ({ colors, type }: Theme) =>
  StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.noteCard,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  // a 44pt target; the negative margin keeps the card's left padding visually the same
  checkbox: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    marginLeft: -9,
    marginRight: -6,
    alignItems: "center",
    justifyContent: "center",
  },
  body: { flex: 1 },
  content: { writingDirection: "auto" },
  meta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", marginTop: 2 },
  category: { fontFamily: fonts.bodySemi },
  trailing: { minWidth: 44, alignItems: "flex-end", justifyContent: "center" },
  time: {
    fontFamily: fonts.bodyBold,
    fontSize: 17,
    color: colors.text,
    fontVariant: ["tabular-nums"],
  },
  smartTime: { flexDirection: "row", alignItems: "center", gap: 4 },
  smartTimeText: { color: colors.primary },
  deleteAction: {
    width: 96,
    borderRadius: radius.noteCard,
    backgroundColor: colors.danger,
    justifyContent: "center",
    alignItems: "center",
    gap: 4,
    marginLeft: 8,
  },
  deleteActionText: { color: colors.onPrimary, fontFamily: fonts.bodySemi, fontSize: 12 },
});
