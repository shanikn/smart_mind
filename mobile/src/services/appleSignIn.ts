import { Platform } from "react-native";
import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import { OAuthProvider, revokeAccessToken, signInWithCredential } from "firebase/auth";
import { auth } from "../config/firebase";

// Sign in with Apple (iPhone only; App Store Guideline 4.8). Apple may give
// a hidden relay email (…@privaterelay.appleid.com), and the name only on
// the first sign-in; the app needs neither, only the Firebase uid.

export async function appleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") {
    return false;
  }
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

// Apple signs a SHA-256 of a one-time nonce into its token; Firebase checks
// it against the raw nonce, so a stolen token can't be replayed.
export async function signInWithApple(): Promise<void> {
  const rawNonce = Crypto.randomUUID();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  const apple = await AppleAuthentication.signInAsync({
    requestedScopes: [
      AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
      AppleAuthentication.AppleAuthenticationScope.EMAIL,
    ],
    nonce: hashedNonce,
  });
  if (!apple.identityToken) {
    throw new Error("Apple didn't return an identity token");
  }
  const credential = new OAuthProvider("apple.com").credential({ idToken: apple.identityToken, rawNonce });
  await signInWithCredential(auth, credential);
}

export function signedInWithApple(): boolean {
  return auth.currentUser?.providerData.some((p) => p.providerId === "apple.com") ?? false;
}

// Before deleting the account: Apple asks the user to confirm once more and
// gives a fresh authorization code, which revokes the app's Apple tokens.
// Rejects (isAppleCancel in lib/authErrors) if the user closes the sheet.
export async function revokeAppleSignIn(): Promise<void> {
  const apple = await AppleAuthentication.signInAsync({ requestedScopes: [] });
  if (!apple.authorizationCode) {
    throw new Error("Apple didn't return an authorization code");
  }
  await revokeAccessToken(auth, apple.authorizationCode);
}
