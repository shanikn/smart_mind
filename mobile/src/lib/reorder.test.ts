import { dragTargetIndex, moveItem } from "./reorder";

describe("moveItem", () => {
  test("moves an item down or up, the others keep their order", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  test("same place, or out of range: an unchanged copy", () => {
    const list = ["a", "b"];
    expect(moveItem(list, 1, 1)).toEqual(["a", "b"]);
    expect(moveItem(list, 1, 1)).not.toBe(list);
    expect(moveItem(list, 5, 0)).toEqual(["a", "b"]);
  });

  test("a target past either end goes to that end", () => {
    expect(moveItem(["a", "b", "c"], 0, 9)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, -3)).toEqual(["c", "a", "b"]);
  });
});

describe("dragTargetIndex", () => {
  test("a row moves once the finger passes half a row", () => {
    expect(dragTargetIndex(1, 20, 52, 4)).toBe(1);
    expect(dragTargetIndex(1, 27, 52, 4)).toBe(2);
    expect(dragTargetIndex(1, -27, 52, 4)).toBe(0);
    expect(dragTargetIndex(0, 52 * 2, 52, 4)).toBe(2);
  });

  test("stays within the list", () => {
    expect(dragTargetIndex(1, -500, 52, 4)).toBe(0);
    expect(dragTargetIndex(1, 500, 52, 4)).toBe(3);
  });
});
