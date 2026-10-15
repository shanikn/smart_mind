import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  View,
  SectionList,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";
import { getNotes } from "../api/notes";
import { Note } from "../types/notes";
import NoteCard from "../components/NoteCard";
import { NotesStackParamList } from "../../App";
import { addFolder, loadFolders, removeFolder, reorderFolders } from "../services/foldersStore";
import { ALL, GENERAL, folderNames, folderTabs } from "../lib/folderOrder";
import { getCategorySelection, getFolderTab, setCategorySelection, setFolderTab } from "../lib/notesListSelection";
import FolderEditSheet from "../components/FolderEditSheet";
import CategoryFilterSheet from "../components/CategoryFilterSheet";
import UndoBar from "../components/UndoBar";
import { deleteWithUndo, hiddenNoteIds, pendingNote, subscribe, undoDelete } from "../services/pendingDelete";
import { getNotesView, NotesView, notesViewSections, setNotesView } from "../lib/notesView";
import { currentPlaceLabel } from "../lib/noteCardInfo";
import { getReminderLocation } from "../lib/reminderPrefs";
import { loadPlaces } from "../services/placesStore";
import { ServerPlace } from "../lib/userPlaces";
import { Category, CategoryColors, DEFAULT_CATEGORY_COLORS, getCategoryColors } from "../lib/categoryColors";
import { filterNotes, hasActiveFilters } from "../lib/noteFilter";
import { Chip, ChipRow, SectionLabel, TextButton } from "../components/ui";
import { MIN_TOUCH_TARGET, Theme, fonts, radius, spacing } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

type Nav = NativeStackNavigationProp<NotesStackParamList, "NotesList">;

const FAB_SIZE = 56;
const FAB_MARGIN = 16;

export default function NotesListScreen() {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation<Nav>();
  const [notes, setNotes] = useState<Note[]>([]);
  const [places, setPlaces] = useState<ServerPlace[]>([]);
  const [currentLocation, setCurrentLocation] = useState<string | null>(null);
  const [categoryColors, setCategoryColors] = useState<CategoryColors>(DEFAULT_CATEGORY_COLORS);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // the last load failed; shown only when there are no notes to show
  const [loadFailed, setLoadFailed] = useState(false);
  // focus refetches can overlap: only the newest one may update the screen
  const latestFetch = useRef(0);
  // the folder tab and the checked categories; remembered while the app is open
  const [activeTab, setActiveTab] = useState<string>(getFolderTab);
  const [checkedCategories, setCheckedCategories] = useState<string[]>(getCategorySelection);
  const [showFolderEditor, setShowFolderEditor] = useState(false);
  const [showCategoryFilter, setShowCategoryFilter] = useState(false);
  const [customLists, setCustomLists] = useState<string[]>([]);
  const [showCreateListModal, setShowCreateListModal] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<NotesView>("recent");
  // a deleted note is hidden while its Undo bar shows (services/pendingDelete.ts)
  const [hiddenIds, setHiddenIds] = useState<string[]>(hiddenNoteIds);
  const [undoNote, setUndoNote] = useState<Note | null>(pendingNote);

  useEffect(
    () =>
      subscribe((outcome) => {
        setHiddenIds(hiddenNoteIds());
        setUndoNote(pendingNote());
        if (outcome?.kind === "deleted") {
          setNotes((prev) => prev.filter((n) => n._id !== outcome.id));
        } else if (outcome?.kind === "failed") {
          Alert.alert("Couldn't delete the note", "Check your connection and try again.");
        }
      }),
    []
  );

  // hiding (not removing) keeps the note's place for Undo
  const visibleNotes = useMemo(() => notes.filter((n) => !hiddenIds.includes(n._id)), [notes, hiddenIds]);

  useEffect(() => {
    getNotesView().then(setView);
  }, []);

  const chooseView = (next: NotesView) => {
    setView(next);
    setNotesView(next);
  };

  // General, then the user's folder order, empty folders included
  const listNames = useMemo(() => folderNames(notes, customLists), [notes, customLists]);
  // the tabs: All in front of them
  const tabNames = useMemo(() => folderTabs(notes, customLists), [notes, customLists]);

  // a tab whose folder no longer exists (deleted elsewhere) shows All
  const folder = tabNames.includes(activeTab) ? activeTab : ALL;

  const chooseTab = (name: string) => {
    setActiveTab(name);
    setFolderTab(name);
  };

  const chooseCategories = (names: string[]) => {
    setCheckedCategories(names);
    setCategorySelection(names);
  };

  const toggleCategory = (category: Category) =>
    chooseCategories(
      checkedCategories.includes(category)
        ? checkedCategories.filter((c) => c !== category)
        : [...checkedCategories, category]
    );

  // folder tab AND one of the checked categories AND the search (lib/noteFilter.ts)
  const filters = { folder, categories: checkedCategories, query };
  const filteredNotes = useMemo(
    () => filterNotes(visibleNotes, { folder, categories: checkedCategories, query }),
    [visibleNotes, folder, checkedCategories, query]
  );

  const clearSearchAndFilter = () => {
    setQuery("");
    chooseCategories([]);
  };

  // Recent: one list, newest first; Upcoming: the date sections
  const sections = useMemo(
    () => notesViewSections(view, filteredNotes, new Date()).map((s) => ({ ...s, data: s.notes })),
    [view, filteredNotes]
  );

  const fetchNotes = useCallback(async () => {
    const fetchId = ++latestFetch.current;
    const isLatest = () => fetchId === latestFetch.current;
    try {
      const [data, savedLists, userPlaces, colorsByCategory, location] = await Promise.all([
        getNotes(),
        loadFolders().catch(() => null),
        loadPlaces().catch(() => []),
        getCategoryColors().catch(() => DEFAULT_CATEGORY_COLORS),
        getReminderLocation().catch(() => null),
      ]);
      if (!isLatest()) {
        return;
      }
      setNotes(data);
      setPlaces(userPlaces);
      setCategoryColors(colorsByCategory);
      if (savedLists) {
        setCustomLists(savedLists);
      }
      setCurrentLocation(location);
      setLoadFailed(false);
    } catch {
      // a failed refetch keeps the notes already on screen; the error is
      // shown only when there's nothing to show (see below)
      if (isLatest()) {
        setLoadFailed(true);
      }
    } finally {
      if (isLatest()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  const handleRetry = () => {
    setLoading(true);
    fetchNotes();
  };

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      fetchNotes();
    }, [fetchNotes])
  );

  const handleRefresh = () => {
    setRefreshing(true);
    fetchNotes();
  };

  const handleDelete = (note: Note) => deleteWithUndo(note);

  // Deleting a folder never deletes notes: they move to General (on the
  // server). A folder with notes asks first, saying so.
  const handleDeleteFolder = (name: string) => {
    if (name === GENERAL) return;
    const count = notes.filter((n) => n.list_name === name).length;
    const message =
      count === 0
        ? `Delete the folder "${name}"?`
        : `"${name}" has ${count} ${count === 1 ? "note" : "notes"}. Delete the folder and move ${
            count === 1 ? "it" : "them"
          } to General?`;
    Alert.alert("Delete folder", message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete folder",
        style: "destructive",
        onPress: async () => {
          try {
            const { folders } = await removeFolder(name);
            setCustomLists(folders);
            setNotes((prev) => prev.map((n) => (n.list_name === name ? { ...n, list_name: GENERAL } : n)));
            if (getFolderTab() === name) {
              chooseTab(ALL);
            }
          } catch {
            Alert.alert("Couldn't delete the folder", "Check your connection and try again.");
          }
        },
      },
    ]);
  };

  // the folders under General, in the order just dragged; shown at once,
  // put back if the server can't save it
  const handleReorderFolders = async (names: string[]) => {
    const previous = customLists;
    setCustomLists(names);
    try {
      setCustomLists(await reorderFolders(names));
    } catch {
      setCustomLists(previous);
      Alert.alert("Couldn't save the folder order", "Check your connection and try again.");
    }
  };

  const handleCreateList = async () => {
    const trimmed = newListName.trim();
    if (!trimmed) {
      Alert.alert("Error", "List name cannot be empty");
      return;
    }

    // with any capitals, like the server ("games" when "Games" exists)
    if (listNames.some((name) => name.toLowerCase() === trimmed.toLowerCase())) {
      Alert.alert("Error", "That list already exists");
      return;
    }

    try {
      const nextLists = await addFolder(trimmed);
      setCustomLists(nextLists);
      chooseTab(trimmed);
      setNewListName("");
      setShowCreateListModal(false);
    } catch {
      Alert.alert("Error", "Failed to create list");
    }
  };

  const placeLabel = currentPlaceLabel(currentLocation, places);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <Text style={[type.screenTitle, styles.title]} numberOfLines={1}>
          My Notes
        </Text>
        <TouchableOpacity
          style={styles.placeChip}
          onPress={() => navigation.getParent()?.navigate("Settings")}
          accessibilityRole="button"
          accessibilityLabel={`${placeLabel}. Open Settings`}
        >
          <Ionicons name="location-outline" size={16} color={colors.primaryDark} />
          <Text style={styles.placeChipText} numberOfLines={1}>
            {placeLabel}
          </Text>
        </TouchableOpacity>
      </View>

      {visibleNotes.length > 0 && (
        <View style={styles.viewToggle} accessibilityRole="tablist">
          {(
            [
              ["recent", "Recent"],
              ["upcoming", "Upcoming"],
            ] as const
          ).map(([value, label]) => {
            const selected = view === value;
            return (
              <TouchableOpacity
                key={value}
                style={[styles.viewOption, selected && styles.viewOptionSelected]}
                onPress={() => chooseView(value)}
                accessibilityRole="tab"
                accessibilityLabel={label}
                accessibilityState={{ selected }}
              >
                <Text style={[styles.viewOptionText, selected && styles.viewOptionTextSelected]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {visibleNotes.length > 0 && (
        <View style={styles.searchWrap}>
          <View style={styles.search}>
            <Ionicons name="search-outline" size={18} color={colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search notes"
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
              autoCorrect={false}
              accessibilityLabel="Search notes"
            />
            {query.length > 0 && (
              <TouchableOpacity
                style={styles.clearButton}
                onPress={() => setQuery("")}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity
            style={[styles.filterButton, checkedCategories.length > 0 && styles.filterButtonActive]}
            onPress={() => setShowCategoryFilter(true)}
            accessibilityRole="button"
            accessibilityLabel="Filter by category"
            accessibilityValue={checkedCategories.length > 0 ? { text: `${checkedCategories.length} checked` } : undefined}
          >
            <Ionicons name="filter" size={22} color={checkedCategories.length > 0 ? colors.primaryDark : colors.text} />
            {checkedCategories.length > 0 && (
              <View style={styles.badge}>
                <Text testID="category-filter-count" style={styles.badgeText}>
                  {checkedCategories.length}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <>
          {/* the folder tabs; long-press a tab, or the edit icon, to reorder or delete folders */}
          <View style={styles.tabsRow} testID="folder-tabs-row">
            {/* the tabs scroll in the space the two icons leave */}
            <View style={styles.tabsScroll}>
              <ChipRow scroll style={styles.chipsContent}>
                {tabNames.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    testID="folder-tab"
                    selected={folder === name}
                    onPress={() => chooseTab(name)}
                    onLongPress={() => setShowFolderEditor(true)}
                  />
                ))}
              </ChipRow>
            </View>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setShowCreateListModal(true)}
              accessibilityRole="button"
              accessibilityLabel="Create a new folder"
            >
              <Ionicons name="folder-outline" size={22} color={colors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => setShowFolderEditor(true)}
              accessibilityRole="button"
              accessibilityLabel="Edit folders"
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
            </TouchableOpacity>
          </View>

          {visibleNotes.length === 0 && loadFailed && !undoNote ? (
            <View style={styles.center}>
              <Ionicons name="cloud-offline-outline" size={56} color={colors.border} />
              <Text style={[type.cardTitle, styles.emptyText]}>Couldn't load your notes</Text>
              <Text style={type.caption}>Check your connection and try again</Text>
              <TextButton label="Try again" onPress={handleRetry} />
            </View>
          ) : visibleNotes.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="document-text-outline" size={64} color={colors.border} />
              <Text style={[type.cardTitle, styles.emptyText]}>No notes yet</Text>
              <Text style={type.caption}>Tap + to create your first note</Text>
            </View>
          ) : filteredNotes.length === 0 ? (
            <View style={styles.center}>
              <Ionicons name="search-outline" size={56} color={colors.border} />
              <Text style={[type.cardTitle, styles.emptyText]}>No matching notes</Text>
              {hasActiveFilters(filters) ? (
                <TextButton label="Clear search and filter" onPress={clearSearchAndFilter} />
              ) : (
                <Text style={type.caption}>This folder is empty</Text>
              )}
            </View>
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item._id}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section }) =>
                section.title ? <SectionLabel title={section.title} style={styles.sectionLabel} /> : null
              }
              renderItem={({ item }) => (
                <NoteCard
                  note={item}
                  onPress={() => navigation.navigate("AddEditNote", { note: item })}
                  onDelete={() => handleDelete(item)}
                  places={places}
                  categoryColors={categoryColors}
                />
              )}
              ItemSeparatorComponent={() => <View style={{ height: spacing.noteGap }} />}
              contentContainerStyle={[styles.listContent, view === "recent" && styles.recentListContent]}
              refreshing={refreshing}
              onRefresh={handleRefresh}
            />
          )}
        </>
      )}

      <FolderEditSheet
        visible={showFolderEditor}
        folders={listNames}
        onDelete={handleDeleteFolder}
        onReorder={handleReorderFolders}
        onClose={() => setShowFolderEditor(false)}
      />

      <CategoryFilterSheet
        visible={showCategoryFilter}
        colors={categoryColors}
        checked={checkedCategories}
        onToggle={toggleCategory}
        onClear={() => chooseCategories([])}
        onClose={() => setShowCategoryFilter(false)}
      />

      <Modal
        visible={showCreateListModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowCreateListModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={[type.cardTitle, styles.modalTitle]}>Create New Folder</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="Folder name"
              placeholderTextColor={colors.textMuted}
              value={newListName}
              onChangeText={setNewListName}
              autoFocus
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalAction}
                onPress={() => setShowCreateListModal(false)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
              >
                <Text style={styles.modalActionSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalAction}
                onPress={handleCreateList}
                accessibilityRole="button"
                accessibilityLabel="Create"
              >
                <Text style={styles.modalActionPrimary}>Create</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {undoNote && (
        <UndoBar
          message="Note deleted"
          onUndo={undoDelete}
          style={[styles.undoBar, { right: FAB_SIZE + FAB_MARGIN * 2 }]}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        onPress={() =>
          navigation.navigate("AddEditNote", {
            initialListName: folder !== ALL ? folder : undefined,
          })
        }
        accessibilityRole="button"
        accessibilityLabel="Add a note"
      >
        <Ionicons name="add" size={28} color={colors.onPrimary} />
      </TouchableOpacity>
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
    paddingTop: 16,
    paddingRight: 16,
    paddingBottom: 8,
    paddingLeft: 20,
  },
  title: { flex: 1 },
  placeChip: {
    height: MIN_TOUCH_TARGET,
    borderRadius: radius.chip,
    paddingHorizontal: 14,
    backgroundColor: colors.primarySoft,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 170,
  },
  placeChipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.primaryDark, flexShrink: 1 },
  iconButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  viewToggle: {
    flexDirection: "row",
    marginHorizontal: spacing.screen,
    marginBottom: 10,
    padding: 4,
    borderRadius: radius.chip,
    backgroundColor: colors.primarySoft,
  },
  viewOption: {
    flex: 1,
    height: 40,
    borderRadius: radius.chip,
    alignItems: "center",
    justifyContent: "center",
  },
  viewOptionSelected: { backgroundColor: colors.primary },
  viewOptionText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.primaryDark },
  viewOptionTextSelected: { color: colors.onPrimary },
  tabsRow: { flexDirection: "row", alignItems: "center", paddingRight: 8, paddingBottom: 4 },
  tabsScroll: { flex: 1 },
  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: spacing.screen, paddingBottom: 10 },
  filterButton: {
    width: 48,
    height: 48,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  filterButtonActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 12, color: colors.onPrimary },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 48,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingLeft: 14,
    paddingRight: 4,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    // Hebrew searches read right-to-left inside the LTR layout
    writingDirection: "auto",
  },
  clearButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: "center",
    justifyContent: "center",
  },
  chipsContent: { paddingLeft: spacing.screen, paddingRight: 8 },
  center: { flex: 1, justifyContent: "center", alignItems: "center", gap: 4 },
  emptyText: { marginTop: 12 },
  sectionLabel: { marginTop: 12, marginRight: 4, marginBottom: 0, marginLeft: 4, paddingBottom: 8 },
  listContent: {
    paddingHorizontal: spacing.screen,
    // keep the last card clear of the FAB
    paddingBottom: FAB_SIZE + FAB_MARGIN * 2,
  },
  // no section header above the first card in Recent
  recentListContent: { paddingTop: 12 },
  // beside the + button, not over it
  undoBar: { position: "absolute", left: FAB_MARGIN, bottom: FAB_MARGIN + 2 },
  fab: {
    position: "absolute",
    right: FAB_MARGIN,
    bottom: FAB_MARGIN,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radius.fab,
    backgroundColor: colors.primary,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.card, padding: 18 },
  modalTitle: { marginBottom: 12 },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    height: 48,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
  },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 12 },
  modalAction: { height: MIN_TOUCH_TARGET, justifyContent: "center", paddingHorizontal: 8 },
  modalActionSecondary: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.textMuted },
  modalActionPrimary: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.primaryDark },
});
