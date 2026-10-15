import React from "react";
import { Alert, Text, TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import LoginScreen from "./LoginScreen";
import { createUserWithEmailAndPassword, sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";

jest.mock("../config/firebase", () => ({ auth: {}, GOOGLE_WEB_CLIENT_ID: "test-client" }));
jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
  signInWithCredential: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
}));
jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn() },
  isErrorWithCode: () => false,
  isSuccessResponse: () => false,
  statusCodes: { IN_PROGRESS: "IN_PROGRESS" },
}));

function allText(node: ReactTestInstance): string {
  return node
    .findAllByType(Text)
    .map((t) => [t.props.children].flat().join(""))
    .join(" | ");
}

function byLabel(tree: ReactTestRenderer, label: string): ReactTestInstance {
  const found = tree.root.findAllByType(TouchableOpacity).find((t) => t.props.accessibilityLabel === label);
  if (!found) {
    throw new Error(`nothing labelled "${label}"`);
  }
  return found;
}

async function renderScreen() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<LoginScreen />);
  });
  return tree;
}

const inputs = (tree: ReactTestRenderer) => tree.root.findAllByType(TextInput);

beforeEach(() => jest.clearAllMocks());

test("title, subtitle, Google first, then email and password", async () => {
  const tree = await renderScreen();
  const text = allText(tree.root);
  expect(text).toContain("Smart Mind");
  expect(text).not.toContain("FocusedContext");
  expect(text.indexOf("Continue with Google")).toBeLessThan(text.indexOf("Email"));
  expect(text.indexOf("Email")).toBeLessThan(text.indexOf("Password"));
});

test("empty fields: inline message, no Alert, no Firebase call", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  const tree = await renderScreen();
  await act(async () => byLabel(tree, "Sign in").props.onPress());
  expect(allText(tree.root)).toContain("Enter your email and password.");
  expect(alert).not.toHaveBeenCalled();
  expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  alert.mockRestore();
});

test("a Firebase error shows a plain sentence inline, and typing clears it", async () => {
  (signInWithEmailAndPassword as jest.Mock).mockRejectedValue(
    Object.assign(new Error("Firebase: Error (auth/invalid-credential)."), { code: "auth/invalid-credential" })
  );
  const tree = await renderScreen();
  await act(async () => inputs(tree)[0].props.onChangeText("me@example.com"));
  await act(async () => inputs(tree)[1].props.onChangeText("wrong"));
  await act(async () => byLabel(tree, "Sign in").props.onPress());
  expect(allText(tree.root)).toContain("That email and password don't match.");
  expect(allText(tree.root)).not.toContain("Firebase");
  await act(async () => inputs(tree)[1].props.onChangeText("wrong2"));
  expect(allText(tree.root)).not.toContain("don't match");
});

test("switching to Create account changes the button, clears the error, and signs up", async () => {
  const tree = await renderScreen();
  await act(async () => byLabel(tree, "Sign in").props.onPress());
  expect(allText(tree.root)).toContain("Enter your email and password.");
  await act(async () => byLabel(tree, "New here? Create an account").props.onPress());
  expect(allText(tree.root)).not.toContain("Enter your email and password.");
  expect(allText(tree.root)).toContain("Have an account? Sign in");
  await act(async () => inputs(tree)[0].props.onChangeText("new@example.com"));
  await act(async () => inputs(tree)[1].props.onChangeText("secret123"));
  await act(async () => byLabel(tree, "Create account").props.onPress());
  expect(createUserWithEmailAndPassword).toHaveBeenCalledWith({}, "new@example.com", "secret123");
});

test("password autofill hint follows the mode, and Enter on email moves to password", async () => {
  const tree = await renderScreen();
  const [emailInput, passwordInput] = inputs(tree);
  expect(emailInput.props.autoComplete).toBe("email");
  expect(emailInput.props.returnKeyType).toBe("next");
  expect(passwordInput.props.autoComplete).toBe("password");
  await act(async () => byLabel(tree, "New here? Create an account").props.onPress());
  expect(inputs(tree)[1].props.autoComplete).toBe("new-password");
});

test("no sample note card on the sign-in screen (it looked like a real note)", async () => {
  const tree = await renderScreen();
  expect(tree.root.findAllByProps({ testID: "sample-note" })).toHaveLength(0);
});

describe("Forgot password?", () => {
  const SENT = "If an account exists for this email, we sent a reset link.";
  const typeEmail = async (tree: ReactTestRenderer, value: string) =>
    act(async () => inputs(tree)[0].props.onChangeText(value));
  const forgot = async (tree: ReactTestRenderer) => act(async () => byLabel(tree, "Forgot password?").props.onPress());

  test("a link under the password field, only when signing in", async () => {
    const tree = await renderScreen();
    const text = allText(tree.root);
    expect(text.indexOf("Password")).toBeLessThan(text.indexOf("Forgot password?"));
    await act(async () => byLabel(tree, "New here? Create an account").props.onPress());
    expect(allText(tree.root)).not.toContain("Forgot password?");
  });

  test("no email typed: asks for it, nothing sent", async () => {
    const tree = await renderScreen();
    await forgot(tree);
    expect(sendPasswordResetEmail).not.toHaveBeenCalled();
    expect(allText(tree.root)).toContain("Type your email above, then tap Forgot password? again.");
  });

  test("sends the reset email to the typed address and says so without revealing if it exists", async () => {
    (sendPasswordResetEmail as jest.Mock).mockResolvedValue(undefined);
    const tree = await renderScreen();
    await typeEmail(tree, "  someone@example.com ");
    await forgot(tree);
    expect(sendPasswordResetEmail).toHaveBeenCalledWith({}, "someone@example.com");
    expect(allText(tree.root)).toContain(SENT);
  });

  test("no account for that email: the same message", async () => {
    (sendPasswordResetEmail as jest.Mock).mockRejectedValue({ code: "auth/user-not-found" });
    const tree = await renderScreen();
    await typeEmail(tree, "nobody@example.com");
    await forgot(tree);
    expect(allText(tree.root)).toContain(SENT);
  });

  test.each([
    ["auth/invalid-email", "That doesn't look like an email address."],
    ["auth/network-request-failed", "No connection. Check your internet and try again."],
    ["auth/too-many-requests", "Couldn't send the reset email. Try again later."],
  ])("%s: a friendly message", async (code, message) => {
    (sendPasswordResetEmail as jest.Mock).mockRejectedValue({ code });
    const tree = await renderScreen();
    await typeEmail(tree, "someone@example");
    await forgot(tree);
    const text = allText(tree.root);
    expect(text).toContain(message);
    expect(text).not.toContain(SENT);
  });
});
