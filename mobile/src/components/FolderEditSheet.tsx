import React, { useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import {
  AccessibilityActionEvent,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { GENERAL } from "../lib/folderOrder";
import { dragTargetIndex, moveItem } from "../lib/reorder";
import { MIN_TOUCH_TARGET, Theme, fonts, radius, spacing } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

// every row is this tall, so a drag distance tells which row it's over
const ROW_HEIGHT = MIN_TOUCH_TARGET + 4;

const MOVE_ACTIONS = [
  { name: "moveUp", label: "Move up" },
  { name: "moveDown", label: "Move down" },
];

// The drag handle on a folder row. It takes the touch from the list, so the
// sheet doesn't scroll while a folder is dragged. Screen readers get Move up /
// Move down instead.
function DragHandle({
  onStart,
  onMove,
  onEnd,
  accessibilityLabel,
  onAccessibilityAction,
  color,
  style,
}: {
  onStart: () => void;
  onMove: (dy: number) => void;
  onEnd: (dy: number) => void;
  accessibilityLabel: string;
  onAccessibilityAction: (event: AccessibilityActionEvent) => void;
  color: string;
  style: object;
}) {
  // the responder is made once; it calls the latest callbacks
  const latest = useRef({ onStart, onMove, onEnd });
  latest.current = { onStart, onMove, onEnd };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => latest.current.onStart(),
      onPanResponderMove: (_e, g) => latest.current.onMove(g.dy),
      onPanResponderRelease: (_e, g) => latest.current.onEnd(g.dy),
      onPanResponderTerminate: (_e, g) => latest.current.onEnd(g.dy),
    })
  ).current;
  return (
    <View
      {...responder.panHandlers}
      style={style}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Drag up or down to move this folder"
      accessibilityActions={MOVE_ACTIONS}
      onAccessibilityAction={onAccessibilityAction}
    >
      <Ionicons name="reorder-three-outline" size={24} color={color} />
    </View>
  );
}

// Editing the folders (from the notes list's folder tabs): every folder,
// empty ones too. General stays first; the others can be dragged into any
// order or deleted.
export default function FolderEditSheet({
  visible,
  folders,
  onDelete,
  onReorder,
  onClose,
}: {
  visible: boolean;
  folders: string[]; // General first, then the user's order (lib/folderOrder.ts)
  onDelete: (name: string) => void; // asks first; General can't be deleted
  onReorder: (names: string[]) => void; // the folders after General, in their new order
  onClose: () => void;
}) {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const movable = folders.filter((name) => name !== GENERAL);
  const [drag, setDrag] = useState<{ name: string; from: number; dy: number } | null>(null);
  const dragRef = useRef(drag);
  dragRef.current = drag;

  const target = drag ? dragTargetIndex(drag.from, drag.dy, ROW_HEIGHT, movable.length) : -1;
  // while dragging, the other rows make room where the folder would land
  const shown = drag ? moveItem(movable, drag.from, target) : movable;

  const startDrag = (name: string) => setDrag({ name, from: movable.indexOf(name), dy: 0 });
  const moveDrag = (dy: number) => setDrag((d) => (d ? { ...d, dy } : d));
  const endDrag = (dy: number) => {
    const d = dragRef.current;
    setDrag(null);
    if (!d) {
      return;
    }
    const to = dragTargetIndex(d.from, dy, ROW_HEIGHT, movable.length);
    if (to !== d.from) {
      onReorder(moveItem(movable, d.from, to));
    }
  };

  const moveBy = (name: string, step: number) => {
    const from = movable.indexOf(name);
    const to = from + step;
    if (from >= 0 && to >= 0 && to < movable.length) {
      onReorder(moveItem(movable, from, to));
    }
  };

  const renderRow = (name: string) => {
    const isDragged = drag?.name === name;
    return (
      <View
        key={name}
        style={[
          styles.row,
          isDragged && styles.dragged,
          isDragged && { transform: [{ translateY: drag!.dy - (target - drag!.from) * ROW_HEIGHT }] },
        ]}
      >
        <View style={styles.option}>
          <Ionicons name={name === GENERAL ? "folder-outline" : "folder-open-outline"} size={22} color={colors.textMuted} />
          <Text testID="folder-row" style={[type.body, styles.name]} numberOfLines={1}>
            {name}
          </Text>
        </View>
        {name !== GENERAL && (
          <>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => onDelete(name)}
              accessibilityRole="button"
              accessibilityLabel={`Delete folder ${name}`}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
            </TouchableOpacity>
            <DragHandle
              style={styles.iconButton}
              color={colors.textMuted}
              accessibilityLabel={`Reorder ${name}`}
              onAccessibilityAction={(e) => moveBy(name, e.nativeEvent.actionName === "moveUp" ? -1 : 1)}
              onStart={() => startDrag(name)}
              onMove={moveDrag}
              onEnd={endDrag}
            />
          </>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close">
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={[type.cardTitle, styles.title]}>Edit folders</Text>
          </View>
          <Text style={[type.caption, styles.hint]}>Drag ☰ to reorder. General stays first.</Text>
          <ScrollView style={styles.list} scrollEnabled={!drag}>
            {renderRow(GENERAL)}
            {shown.map(renderRow)}
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
      maxHeight: "75%",
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: spacing.screen,
      paddingBottom: spacing.screen + 8,
    },
    header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
    title: { flex: 1 },
    hint: { marginBottom: 4 },
    list: { flexGrow: 0 },
    row: { flexDirection: "row", alignItems: "center", height: ROW_HEIGHT, backgroundColor: colors.surface },
    // the folder being dragged floats above the others
    dragged: {
      zIndex: 1,
      elevation: 6,
      borderRadius: 12,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.2,
      shadowRadius: 4,
    },
    option: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12, height: ROW_HEIGHT },
    name: { flexShrink: 1 },
    iconButton: { width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET, alignItems: "center", justifyContent: "center" },
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
