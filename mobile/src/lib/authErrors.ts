// Plain-language messages for Firebase Auth errors, shown inline on the
// login screen instead of the raw "Firebase: Error (auth/...)" text.

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": "That email and password don't match.",
  "auth/wrong-password": "That email and password don't match.",
  "auth/email-already-in-use": "That email already has an account. Sign in instead.",
  "auth/weak-password": "Use at least 6 characters.",
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
};

const FALLBACK = "Couldn't sign in. Try again.";

export function authErrorMessage(error: unknown): string {
  const code =
    error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined;
  return (typeof code === "string" && MESSAGES[code]) || FALLBACK;
}

const RESET_MESSAGES: Record<string, string> = {
  "auth/invalid-email": "That doesn't look like an email address.",
  "auth/missing-email": "That doesn't look like an email address.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
};

// For "Forgot password?". null means show the usual "if an account
// exists..." message: whether an email has an account isn't revealed.
export function resetErrorMessage(error: unknown): string | null {
  const code =
    error && typeof error === "object" && "code" in error ? (error as { code: unknown }).code : undefined;
  if (code === "auth/user-not-found") {
    return null;
  }
  return (typeof code === "string" && RESET_MESSAGES[code]) || "Couldn't send the reset email. Try again later.";
}

// the user closed Apple's sign-in sheet (expo-apple-authentication): not an error
export function isAppleCancel(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "ERR_REQUEST_CANCELED";
}
