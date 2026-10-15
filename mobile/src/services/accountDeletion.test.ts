import AsyncStorage from "@react-native-async-storage/async-storage";
import { revokeAccessToken, signOut } from "firebase/auth";
import * as AppleAuthentication from "expo-apple-authentication";
import { deleteAccount } from "../api/account";
import { signOutCleanup } from "./signOutCleanup";
import { deleteAccountAndSignOut } from "./accountDeletion";

jest.mock("../api/account", () => ({ deleteAccount: jest.fn() }));
jest.mock("firebase/auth", () => ({ signOut: jest.fn().mockResolvedValue(undefined), revokeAccessToken: jest.fn() }));
jest.mock("../config/firebase", () => ({ auth: { currentUser: { providerData: [{ providerId: "google.com" }] } } }));
jest.mock("expo-apple-authentication", () => ({
  signInAsync: jest.fn(),
  AppleAuthenticationScope: { FULL_NAME: 0, EMAIL: 1 },
}));
jest.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  randomUUID: () => "raw-nonce",
  digestStringAsync: jest.fn(async (_algorithm: string, value: string) => `sha256(${value})`),
}));
jest.mock("@react-native-google-signin/google-signin", () => ({
  GoogleSignin: { signOut: jest.fn().mockResolvedValue(undefined) },
}));
jest.mock("./signOutCleanup", () => ({ signOutCleanup: jest.fn() }));

const order: string[] = [];

beforeEach(async () => {
  jest.clearAllMocks();
  order.length = 0;
  await AsyncStorage.clear();
  await AsyncStorage.multiSet([
    ["focusedcontext.placeCoords", "{}"],
    ["smartmind.storeAlerts.errands", "[]"],
    ["focusedcontext.alertNotes", '{"userId":"uid-a","notes":[]}'],
  ]);
  (deleteAccount as jest.Mock).mockImplementation(async () => {
    order.push("server");
    return { deleted: { notes: 3, places: 4, vectors: 3 }, firebase_user: "deleted" };
  });
  (signOut as jest.Mock).mockImplementation(async () => {
    order.push("signOut");
  });
  (signOutCleanup as jest.Mock).mockImplementation(async () => {
    order.push("cleanup");
  });
});

test("deletes on the server first, then clears the phone and signs out", async () => {
  await deleteAccountAndSignOut();
  // the same cleanup as Sign out (geofences, alarms, offline notes), then everything else
  expect(order).toEqual(["server", "cleanup", "signOut"]);
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
  const { GoogleSignin } = jest.requireMock("@react-native-google-signin/google-signin");
  expect(GoogleSignin.signOut).toHaveBeenCalled();
});

test("if the server fails, nothing on the phone changes and you stay signed in", async () => {
  (deleteAccount as jest.Mock).mockRejectedValue(new Error("API error 502"));
  await expect(deleteAccountAndSignOut()).rejects.toThrow("API error 502");
  expect(signOut).not.toHaveBeenCalled();
  expect([...(await AsyncStorage.getAllKeys())].sort()).toEqual([
    "focusedcontext.alertNotes",
    "focusedcontext.placeCoords",
    "smartmind.storeAlerts.errands",
  ]);
  expect(signOutCleanup).not.toHaveBeenCalled();
});

test("a cleanup step failing doesn't stop the rest or the sign-out", async () => {
  (signOutCleanup as jest.Mock).mockRejectedValue(new Error("boom"));
  await deleteAccountAndSignOut();
  expect(await AsyncStorage.getAllKeys()).toEqual([]);
  expect(signOut).toHaveBeenCalled();
});

describe("an account that signed in with Apple", () => {
  const { auth } = jest.requireMock("../config/firebase");
  const signInAsync = AppleAuthentication.signInAsync as jest.Mock;

  beforeEach(() => {
    auth.currentUser.providerData = [{ providerId: "apple.com" }];
    signInAsync.mockImplementation(async () => {
      order.push("apple");
      return { identityToken: "id", authorizationCode: "fresh-code" };
    });
    (revokeAccessToken as jest.Mock).mockImplementation(async () => {
      order.push("revoke");
    });
  });
  afterEach(() => {
    auth.currentUser.providerData = [{ providerId: "google.com" }];
  });

  test("confirms with Apple once more, revokes the Apple token, then deletes", async () => {
    await deleteAccountAndSignOut();
    expect(order).toEqual(["apple", "revoke", "server", "cleanup", "signOut"]);
    expect(revokeAccessToken).toHaveBeenCalledWith(auth, "fresh-code");
    const { GoogleSignin } = jest.requireMock("@react-native-google-signin/google-signin");
    expect(GoogleSignin.signOut).not.toHaveBeenCalled();
  });

  test("closing the Apple sheet deletes nothing", async () => {
    signInAsync.mockRejectedValue(Object.assign(new Error("canceled"), { code: "ERR_REQUEST_CANCELED" }));
    await expect(deleteAccountAndSignOut()).rejects.toMatchObject({ code: "ERR_REQUEST_CANCELED" });
    expect(revokeAccessToken).not.toHaveBeenCalled();
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  test("Google accounts keep today's flow: no Apple step", async () => {
    auth.currentUser.providerData = [{ providerId: "google.com" }];
    await deleteAccountAndSignOut();
    expect(signInAsync).not.toHaveBeenCalled();
    expect(revokeAccessToken).not.toHaveBeenCalled();
    expect(order).toEqual(["server", "cleanup", "signOut"]);
  });
});
