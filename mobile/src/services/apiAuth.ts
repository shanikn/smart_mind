import { signOut } from "firebase/auth";
import { auth } from "../config/firebase";
import { setAuthTokenProvider, setCurrentUserIdProvider, setOnAuthExpired } from "../api/client";
import { signOutCleanup } from "./signOutCleanup";

// Connects the API client to Firebase: a fresh ID token for every request,
// and sign-out when the backend still says 401 after a forced refresh.
export function connectApiToFirebase() {
  setAuthTokenProvider(async (forceRefresh) => {
    const user = auth.currentUser;
    return user ? user.getIdToken(forceRefresh) : null;
  });
  setCurrentUserIdProvider(() => auth.currentUser?.uid ?? null);
  setOnAuthExpired(() => {
    signOut(auth).catch(() => {});
    // the same cleanup as Sign out: geofences, alarms, offline notes
    signOutCleanup();
  });
}

// When Android wakes the app in the background (a geofence event, a
// notification button), no screen has mounted, so AuthContext hasn't
// connected the API client to Firebase yet.
export async function ensureSignedIn(): Promise<boolean> {
  await auth.authStateReady();
  if (!auth.currentUser) {
    return false;
  }
  connectApiToFirebase();
  return true;
}
