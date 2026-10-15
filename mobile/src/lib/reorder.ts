// Moving items in a list by dragging (the folder filter sheet).

// a copy with the item at `from` moved to `to` (clamped to the list)
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= list.length) {
    return next;
  }
  const target = Math.max(0, Math.min(list.length - 1, to));
  const [item] = next.splice(from, 1);
  next.splice(target, 0, item);
  return next;
}

// where a row dragged `dy` pixels from `from` lands: it moves once the
// finger passes half a row (rows are `rowHeight` tall)
export function dragTargetIndex(from: number, dy: number, rowHeight: number, count: number): number {
  return Math.max(0, Math.min(count - 1, from + Math.round(dy / rowHeight)));
}
