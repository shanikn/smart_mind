import React from "react";
import { Text, TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { act, ReactTestRenderer } from "react-test-renderer";
import DeleteAccountModal from "./DeleteAccountModal";

async function render(onConfirm = jest.fn().mockResolvedValue(undefined), onCancel = jest.fn(), withApple = false) {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(
      <DeleteAccountModal
        visible
        email="someone@example.com"
        confirmWithApple={withApple}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />
    );
  });
  return tree;
}

const button = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === label)!;
const textOf = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(""))
    .join(" | ");
const type = async (tree: ReactTestRenderer, text: string) =>
  act(async () => tree.root.findByType(TextInput).props.onChangeText(text));

test("says clearly what is deleted and that it can't be undone", async () => {
  const tree = await render();
  const text = textOf(tree);
  expect(text).toContain("someone@example.com");
  expect(text).toMatch(/notes/i);
  expect(text).toMatch(/places/i);
  expect(text).toMatch(/can't be undone/i);
  expect(text).toContain("DELETE");
});

test("the delete button works only after typing DELETE exactly", async () => {
  const onConfirm = jest.fn().mockResolvedValue(undefined);
  const tree = await render(onConfirm);
  const del = () => button(tree, "Delete my account");
  expect(del().props.disabled).toBe(true);
  await type(tree, "delete");
  expect(del().props.disabled).toBe(true);
  await type(tree, "DELET");
  expect(del().props.disabled).toBe(true);
  await type(tree, " DELETE ");
  expect(del().props.disabled).toBe(false);
  await act(async () => del().props.onPress());
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

test("the field doesn't autocorrect or auto-capitalize", async () => {
  const tree = await render();
  const input = tree.root.findByType(TextInput);
  expect(input.props.autoCorrect).toBe(false);
  expect(input.props.autoCapitalize).toBe("characters");
});

test("a failure is shown and the dialog stays", async () => {
  const onConfirm = jest.fn().mockRejectedValue(new Error("API error 502"));
  const tree = await render(onConfirm);
  await type(tree, "DELETE");
  await act(async () => button(tree, "Delete my account").props.onPress());
  expect(textOf(tree)).toContain("Couldn't delete your account");
  expect(button(tree, "Delete my account")).toBeTruthy();
});

test("Cancel cancels", async () => {
  const onCancel = jest.fn();
  const tree = await render(jest.fn(), onCancel);
  await act(async () => button(tree, "Cancel").props.onPress());
  expect(onCancel).toHaveBeenCalled();
});

describe("an account that signed in with Apple", () => {
  test("says Apple will ask to confirm once more; Google accounts don't see it", async () => {
    expect(textOf(await render(undefined, undefined, true))).toMatch(/confirm with Apple/);
    expect(textOf(await render())).not.toMatch(/Apple/);
  });

  test("closing the Apple sheet: no error, and you can try again", async () => {
    const onConfirm = jest
      .fn()
      .mockRejectedValue(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }));
    const tree = await render(onConfirm, undefined, true);
    await type(tree, "DELETE");
    await act(async () => button(tree, "Delete my account").props.onPress());
    expect(textOf(tree)).not.toMatch(/Couldn't delete/);
    expect(button(tree, "Delete my account").props.disabled).toBe(false);
  });
});
