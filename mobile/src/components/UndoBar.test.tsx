import React from "react";
import { View } from "react-native";
import TestRenderer, { act, ReactTestRenderer } from "react-test-renderer";
import UndoBar from "./UndoBar";

function render(): ReactTestRenderer {
  let tree!: ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<UndoBar message="Note deleted" onUndo={() => {}} />);
  });
  return tree;
}

test("the bar is announced on iOS (alert role) and Android (live region)", () => {
  const tree = render();
  const bar = tree.root.findAllByType(View).find((v) => v.props.accessibilityLiveRegion === "polite")!;
  expect(bar).toBeDefined();
  expect(bar.props.accessibilityRole).toBe("alert");
  act(() => tree.unmount());
});
