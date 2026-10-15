import React from "react";
import { Alert, Platform, Text, TextInput, TouchableOpacity } from "react-native";
import TestRenderer, { act, ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import LoginScreen from "./LoginScreen";
import {
  createUserWithEmailAndPassword,
  OAuthProvider,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
} from "firebase/auth";
import * as AppleAuthentication from "expo-apple-authentication";

jest.mock("../config/firebase", () => ({ auth: {}, GOOGLE_WEB_CLIENT_ID: "test-client" }));
jest.mock("firebase/auth", () => ({
  signInWithEmailAndPassword: jest.fn(),
  createUserWithEmailAndPassword: jest.fn(),
  GoogleAuthProvider: { credential: jest.fn() },
  signInWithCredential: jest.fn(),
  sendPasswordResetEmail: jest.fn(),
  // new OAuthProvider("apple.com").credential({...}) -> a recognizable credential
  OAuthProvider: jest.fn().mockImplementation((providerId: string) => ({
    credential: (options: object) => ({ providerId, ...options }),
  })),
  revokeAccessToken: jest.fn(),
}));
jest.mock("expo-apple-authentication", () => {
  const { TouchableOpacity } = require("react-native");
  return {
    isAvailableAsync: jest.fn(),
    signInAsync: jest.fn(),
    AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
    AppleAuthenticationButtonType: { SIGN_IN: 0 },
    AppleAuthenticationButtonStyle: { WHITE: 0, WHITE_OUTLINE: 1, BLACK: 2 },
    // the real one is a native view; a pressable stand-in keeps its props
    AppleAuthenticationButton: (props: { onPress: () => void }) => <TouchableOpacity testID="apple-button" {...props} />,
  };
});
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  randomUUID: () => "raw-nonce",
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `sha256(${value})`),
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

beforeEach(() => {
  jest.clearAllMocks();
  (AppleAuthentication.isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

describe("Sign in with Apple (iPhone only)", () => {
  const appleButton = (tree: ReactTestRenderer) =>
    tree.root.findAll((n) => n.props.testID === "apple-button" && typeof n.type !== "string")[0];
  const signInAsync = AppleAuthentication.signInAsync as jest.Mock;

  afterEach(() => jest.restoreAllMocks());

  test("on iOS: a Sign in with Apple button, with the Google button", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const tree = await renderScreen();
    expect(appleButton(tree)).toBeDefined();
    expect(appleButton(tree).props.buttonType).toBe(AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN);
    expect(allText(tree.root)).toContain("Continue with Google");
  });

  test("not on Android, and not where Apple says it isn't available", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    expect(appleButton(await renderScreen())).toBeUndefined();
    jest.replaceProperty(Platform, "OS", "ios");
    (AppleAuthentication.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    expect(appleButton(await renderScreen())).toBeUndefined();
  });

  test("signs in to Firebase as apple.com: Apple gets the hashed nonce, Firebase the raw one", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    signInAsync.mockResolvedValue({ identityToken: "apple-id-token", authorizationCode: "code", email: null });
    const tree = await renderScreen();
    await act(async () => appleButton(tree).props.onPress());
    expect(signInAsync).toHaveBeenCalledWith({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: "sha256(raw-nonce)",
    });
    expect(OAuthProvider).toHaveBeenCalledWith("apple.com");
    expect(signInWithCredential).toHaveBeenCalledWith(
      {},
      { providerId: "apple.com", idToken: "apple-id-token", rawNonce: "raw-nonce" }
    );
  });

  test("closing the Apple sheet shows no error", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    signInAsync.mockRejectedValue(Object.assign(new Error("The user canceled"), { code: "ERR_REQUEST_CANCELED" }));
    const tree = await renderScreen();
    await act(async () => appleButton(tree).props.onPress());
    expect(alert).not.toHaveBeenCalled();
    expect(signInWithCredential).not.toHaveBeenCalled();
    expect(allText(tree.root)).not.toMatch(/failed|error/i);
  });

  test("another Apple failure says so", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    signInAsync.mockRejectedValue(Object.assign(new Error("Something broke"), { code: "ERR_REQUEST_FAILED" }));
    const tree = await renderScreen();
    await act(async () => appleButton(tree).props.onPress());
    expect(alert).toHaveBeenCalledWith("Apple sign-in failed", "Something broke");
  });
});

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
