import React from "react";
import { Ionicons } from "@expo/vector-icons";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { CATEGORIES, Category, categoryLabel, CategoryColors } from "../lib/categoryColors";
import { ANY_PLACE, NO_PLACE } from "../lib/noteFilter";
import { TextButton } from "./ui";
import { MIN_TOUCH_TARGET, Theme, fonts, radius, spacing } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

// The notes list's filter: the four kinds, each in its color with a checkbox
// (none checked shows every kind), then one place: All places, the user's
// places as they named them, or No place. Choices apply right away.
export default function CategoryFilterSheet({
  visible,
  colors: categoryColors,
  checked,
  onToggle,
  places,
  place,
  onPickPlace,
  onClear,
  onClose,
}: {
  visible: boolean;
  colors: CategoryColors;
  checked: string[];
  onToggle: (category: Category) => void;
  places: { id: string; name: string }[];
  place: string; // ANY_PLACE, NO_PLACE or a place id
  onPickPlace: (place: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // many places: the rows scroll, the header and Done stay
  const { height } = useWindowDimensions();
  const placeOptions = [
    { value: ANY_PLACE, label: "All places" },
    ...places.map((p) => ({ value: p.id, label: p.name })),
    { value: NO_PLACE, label: "No place" },
  ];
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={[type.cardTitle, styles.title]}>Filter</Text>
            <TextButton label="Clear" onPress={onClear} disabled={checked.length === 0 && place === ANY_PLACE} />
          </View>
          <ScrollView style={{ maxHeight: height * 0.6 }}>
            <Text style={[type.caption, styles.heading]} accessibilityRole="header">
              Categories
            </Text>
            {CATEGORIES.map((category) => {
              const isChecked = checked.includes(category);
              return (
                <TouchableOpacity
                  key={category}
                  testID="category-option"
                  style={styles.option}
                  onPress={() => onToggle(category)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: isChecked }}
                  accessibilityLabel={categoryLabel(category)}
                >
                  <Ionicons
                    name={isChecked ? "checkbox" : "square-outline"}
                    size={22}
                    color={isChecked ? colors.primary : colors.textMuted}
                  />
                  <View testID="category-dot" style={[styles.dot, { backgroundColor: categoryColors[category] }]} />
                  <Text style={type.body}>{categoryLabel(category)}</Text>
                </TouchableOpacity>
              );
            })}
            <Text style={[type.caption, styles.heading, styles.placeHeading]} accessibilityRole="header">
              Place
            </Text>
            {placeOptions.map(({ value, label }) => {
              const isPicked = place === value;
              return (
                <TouchableOpacity
                  key={value}
                  testID="place-option"
                  style={styles.option}
                  onPress={() => onPickPlace(value)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isPicked }}
                  accessibilityLabel={label}
                >
                  <Ionicons
                    name={isPicked ? "radio-button-on" : "radio-button-off"}
                    size={22}
                    color={isPicked ? colors.primary : colors.textMuted}
                  />
                  <Text style={[type.body, styles.placeName]} numberOfLines={1}>
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity style={styles.done} onPress={onClose} accessibilityRole="button" accessibilityLabel="Done">
            <Text style={styles.doneText}>Done</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: spacing.screen,
      paddingBottom: spacing.screen + 8,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
    title: { flex: 1 },
    heading: { color: colors.textMuted, marginTop: 4 },
    placeHeading: { marginTop: 12 },
    placeName: { flex: 1 },
    option: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TOUCH_TARGET + 4 },
    dot: { width: 14, height: 14, borderRadius: 7 },
    done: {
      marginTop: 12,
      height: MIN_TOUCH_TARGET,
      borderRadius: radius.chip,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    doneText: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.onPrimary },
  });
