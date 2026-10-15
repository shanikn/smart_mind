import React, { useState, useCallback } from "react";
import {
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Text,
  StyleSheet,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateTimePicker, { DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { useNavigation, useRoute, useFocusEffect, RouteProp } from "@react-navigation/native";
import { apiErrorMessage } from "../api/client";
import { createNote, updateNote, getNotes } from "../api/notes";
import { NotesStackParamList } from "../../App";
import { loadFolders } from "../services/foldersStore";
import { folderNames, GENERAL } from "../lib/folderOrder";
import { syncScheduledReminders } from "../services/scheduledReminders";
import { syncStoreAlerts } from "../services/storeAlerts";
import { deleteWithUndo } from "../services/pendingDelete";
import { loadPlaces } from "../services/placesStore";
import { ServerPlace } from "../lib/userPlaces";
import { CATEGORIES, categoryLabel, normalizeCategory } from "../lib/categoryColors";
import { Card, Chip, ChipRow, PrimaryButton, TextButton, ToggleRow } from "../components/ui";
import { MIN_TOUCH_TARGET, Theme, fonts, spacing } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

// the server rejects longer notes (api/main.py MAX_NOTE_CHARS)
const MAX_NOTE_CHARS = 5000;

type RouteParams = RouteProp<NotesStackParamList, "AddEditNote">;


function formatDateValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatTimeValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parseDateValue(value?: string | null): Date | null {
  if (!value) {
    return null;
  }

  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function parseTimeValue(hour?: number | null, minute?: number | null): Date | null {
  if (hour === null || hour === undefined) {
    return null;
  }

  const date = new Date();
  date.setHours(hour, minute ?? 0, 0, 0);
  return date;
}

// One of the two "Date" / "Time" tiles in the Phone alert card.
function AlertTile({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string;
  value: string | null; // null = Smart
  onPress: () => void;
  disabled: boolean;
}) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity
      style={styles.tile}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? "Smart"}`}
      accessibilityState={{ disabled }}
    >
      <Text style={type.caption}>{label}</Text>
      {value ? (
        <Text style={[type.body, styles.tileValue]}>{value}</Text>
      ) : (
        <View style={styles.smartValue}>
          <Ionicons name="sparkles-outline" size={16} color={colors.primaryDark} />
          <Text style={[type.body, styles.smartText]}>Smart</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function AddEditNoteScreen() {
  const { colors, type, dark } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const route = useRoute<RouteParams>();
  const existingNote = route.params?.note;
  const initialListName = route.params?.initialListName;

  const isEditing = !!existingNote?._id;
  const [content, setContent] = useState(existingNote?.content || "");
  const [listName, setListName] = useState(existingNote?.list_name || initialListName || GENERAL);
  const [categoryExplicit, setCategoryExplicit] = useState(existingNote?.category_explicit ?? false);
  const [selectedCategory, setSelectedCategory] = useState<string>(normalizeCategory(existingNote?.category));
  const [locationExplicit, setLocationExplicit] = useState(existingNote?.location_explicit ?? false);
  // place id of the hand-picked location
  const [selectedLocation, setSelectedLocation] = useState(existingNote?.location_value || "");
  const [places, setPlaces] = useState<ServerPlace[]>([]);
  const [remindersEnabled, setRemindersEnabled] = useState(existingNote?.reminders_enabled ?? true);
  const [dateOverrideEnabled, setDateOverrideEnabled] = useState(
    existingNote?.remind_date_explicit ?? false
  );
  const [timeOverrideEnabled, setTimeOverrideEnabled] = useState(
    existingNote?.remind_time_explicit ?? (existingNote?.remind_at_hour !== null && existingNote?.remind_at_hour !== undefined)
  );
  const [selectedDate, setSelectedDate] = useState<Date | null>(
    existingNote?.remind_date_explicit ? parseDateValue(existingNote?.remind_on_date) : null
  );
  const [selectedTime, setSelectedTime] = useState<Date | null>(
    (existingNote?.remind_time_explicit ?? false)
      ? parseTimeValue(existingNote?.remind_at_hour, existingNote?.remind_at_minute)
      : null
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [existingLists, setExistingLists] = useState<string[]>([GENERAL]);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      Promise.all([getNotes(), loadFolders().catch(() => [])])
        .then(([notes, customLists]) => {
          // General first, then the user's folder order (lib/folderOrder.ts)
          setExistingLists(folderNames(notes, customLists));
        })
        .catch(() => {});
      loadPlaces().then(setPlaces).catch(() => {});
    }, [])
  );

  // The Save button is part of this screen (not a navigation header set up
  // once), so it always calls the latest handleSave with the current values.
  const handleSave = async () => {
    const trimmed = content.trim();
    const trimmedListName = listName.trim() || GENERAL;
    const reminderDate = dateOverrideEnabled && selectedDate ? formatDateValue(selectedDate) : "";
    const reminderHour = timeOverrideEnabled && selectedTime ? selectedTime.getHours() : null;
    const reminderMinute = timeOverrideEnabled && selectedTime ? selectedTime.getMinutes() : null;

    if (!trimmed) {
      Alert.alert("Error", "Note content cannot be empty");
      return;
    }

    setSaving(true);
    try {
      if (isEditing) {
        await updateNote(existingNote!._id, {
          content: trimmed,
          list_name: trimmedListName,
          category: selectedCategory,
          category_explicit: categoryExplicit,
          location_explicit: locationExplicit,
          location_value: locationExplicit && selectedLocation ? selectedLocation : "",
          remind_date_explicit: dateOverrideEnabled,
          remind_time_explicit: timeOverrideEnabled,
          remind_on_date: reminderDate,
          remind_at_hour: reminderHour === null ? "" : String(reminderHour),
          remind_at_minute: reminderMinute === null ? "" : String(reminderMinute),
          reminders_enabled: remindersEnabled,
        });
      } else {
        await createNote(
          trimmed,
          trimmedListName,
          remindersEnabled,
          categoryExplicit,
          selectedCategory,
          locationExplicit,
          locationExplicit && selectedLocation ? selectedLocation : undefined,
          dateOverrideEnabled,
          timeOverrideEnabled,
          reminderHour ?? undefined,
          reminderMinute ?? undefined,
          reminderDate || undefined
        );
      }
      // reschedule exact alarms with the new time/date; not awaited so
      // the screen closes right away
      syncScheduledReminders();
      syncStoreAlerts();
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Error", apiErrorMessage(err, err?.message || "Failed to save note"));
    } finally {
      setSaving(false);
    }
  };

  // the list hides the note with an Undo bar; the server delete waits
  const handleDelete = () => {
    deleteWithUndo(existingNote!);
    navigation.goBack();
  };

  const handleDateChange = (_event: DateTimePickerEvent, nextDate?: Date) => {
    if (Platform.OS !== "ios") {
      setShowDatePicker(false);
    }
    if (nextDate) {
      setDateOverrideEnabled(true);
      setSelectedDate(nextDate);
    }
  };

  const handleTimeChange = (_event: DateTimePickerEvent, nextTime?: Date) => {
    if (Platform.OS !== "ios") {
      setShowTimePicker(false);
    }
    if (nextTime) {
      setTimeOverrideEnabled(true);
      setSelectedTime(nextTime);
    }
  };

  const resetToSmart = () => {
    setDateOverrideEnabled(false);
    setSelectedDate(null);
    setTimeOverrideEnabled(false);
    setSelectedTime(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
  };

  const dateValue = dateOverrideEnabled && selectedDate ? formatDateValue(selectedDate) : null;
  const timeValue = timeOverrideEnabled && selectedTime ? formatTimeValue(selectedTime) : null;
  const folders = existingLists.includes(listName) ? existingLists : [...existingLists, listName];

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {isEditing ? "Edit note" : "New note"}
        </Text>
        <PrimaryButton label="Save" onPress={handleSave} loading={saving} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Card>
          <Text style={type.caption}>Note</Text>
          <TextInput
            style={styles.input}
            placeholder="What's on your mind?"
            placeholderTextColor={colors.textMuted}
            value={content}
            onChangeText={setContent}
            maxLength={MAX_NOTE_CHARS}
            multiline
            autoFocus
            textAlignVertical="top"
          />
        </Card>

        <Card>
          <ToggleRow
            title="Phone alert"
            caption="Turn off for notes that should stay silent."
            value={remindersEnabled}
            onValueChange={setRemindersEnabled}
          />
          <View style={[styles.tiles, !remindersEnabled && styles.dimmed]}>
            <AlertTile
              label="Date"
              value={dateValue}
              disabled={!remindersEnabled}
              onPress={() => setShowDatePicker((current) => !current)}
            />
            <AlertTile
              label="Time"
              value={timeValue}
              disabled={!remindersEnabled}
              onPress={() => setShowTimePicker((current) => !current)}
            />
          </View>
          {showDatePicker && remindersEnabled && (
            <DateTimePicker
              value={selectedDate ?? new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "inline" : "default"}
              themeVariant={dark ? "dark" : "light"}
              onChange={handleDateChange}
            />
          )}
          {showTimePicker && remindersEnabled && (
            <DateTimePicker
              value={selectedTime ?? new Date()}
              mode="time"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              themeVariant={dark ? "dark" : "light"}
              onChange={handleTimeChange}
            />
          )}
          <View style={styles.resetRow}>
            <Text style={[type.caption, styles.resetCaption]}>
              Smart uses the date and time found in your note.
            </Text>
            <TextButton label="Reset to Smart" onPress={resetToSmart} />
          </View>
        </Card>

        <Card title="Category">
          <ChipRow style={styles.chips}>
            <Chip
              label="Smart"
              icon="sparkles-outline"
              selected={!categoryExplicit}
              onPress={() => setCategoryExplicit(false)}
            />
            {CATEGORIES.map((category) => (
              <Chip
                key={category}
                label={categoryLabel(category)}
                selected={categoryExplicit && selectedCategory === category}
                onPress={() => {
                  setSelectedCategory(category);
                  setCategoryExplicit(true);
                }}
              />
            ))}
          </ChipRow>
        </Card>

        <Card title="Place">
          <ChipRow style={styles.chips}>
            <Chip
              label="Smart"
              icon="sparkles-outline"
              selected={!locationExplicit}
              onPress={() => setLocationExplicit(false)}
            />
            {places.map((place) => (
              <Chip
                key={place.id}
                label={place.name}
                selected={locationExplicit && selectedLocation === place.id}
                onPress={() => {
                  setSelectedLocation(place.id);
                  setLocationExplicit(true);
                }}
              />
            ))}
          </ChipRow>
        </Card>

        <Card title="Folder">
          <ChipRow style={styles.chips}>
            {folders.map((name) => (
              <Chip key={name} label={name} selected={listName === name} onPress={() => setListName(name)} />
            ))}
          </ChipRow>
        </Card>

        {isEditing && (
          <TextButton label="Delete note" destructive onPress={handleDelete} style={styles.deleteButton} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, type }: Theme) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.screen,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { flex: 1, fontFamily: fonts.display, fontSize: 22, color: colors.text },
  content: { padding: spacing.screen, gap: spacing.cardGap },
  input: {
    fontFamily: fonts.bodySemi,
    fontSize: 22,
    lineHeight: 30,
    color: colors.text,
    minHeight: 60,
    padding: 0,
    marginTop: 4,
    writingDirection: "auto",
  },
  tiles: { flexDirection: "row", gap: 8, marginTop: 12 },
  dimmed: { opacity: 0.45 },
  tile: {
    flex: 1,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: MIN_TOUCH_TARGET,
  },
  tileValue: { marginTop: 2 },
  smartValue: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  smartText: { color: colors.primaryDark },
  resetRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  resetCaption: { flex: 1 },
  chips: { marginTop: 10 },
  deleteButton: { alignSelf: "center" },
});
