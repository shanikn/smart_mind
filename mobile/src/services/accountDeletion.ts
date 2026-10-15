import AsyncStorage from "@react-native-async-storage/async-storage";
import { signOut } from "firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { deleteAccount } from "../api/account";
import { auth } from "../config/firebase";
import { revokeAppleSignIn, signedInWithApple } from "./appleSignIn";
import { signOutCleanup } from "./signOutCleanup";

async function quietly(step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch {
    // one cleanup step failing mustn't stop the others or the sign-out
  }
}

// Delete the account on the server (notes, places, the Firebase user). Only
// if that worked: stop geofences and alarms, clear everything this app keeps
// on the phone, and sign out. If the server fails, nothing changes here.
// An Apple account first confirms with Apple once more and revokes the app's
// Apple tokens (Apple requires it); closing Apple's sheet deletes nothing.
export async function deleteAccountAndSignOut(): Promise<void> {
  if (signedInWithApple()) {
    await revokeAppleSignIn();
  }
  await deleteAccount();
  const usedGoogle = auth.currentUser?.providerData.some((p) => p.providerId === "google.com") ?? false;
  // what every sign-out does (geofences, alarms and scheduled notifications,
  // offline notes)...
  await quietly(signOutCleanup);
  // ...plus all app storage
  // place coordinates, preferences, caches, colors, the current place...
  await quietly(() => AsyncStorage.clear());
  await quietly(() => signOut(auth));
  if (usedGoogle) {
    // not awaited: with outdated Play services this never settles
    try {
      GoogleSignin.signOut().catch(() => {});
    } catch {
      // native module unavailable
    }
  }
}
