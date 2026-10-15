import React, { useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth, GOOGLE_WEB_CLIENT_ID } from "../config/firebase";
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithCredential,
  sendPasswordResetEmail,
} from "firebase/auth";
import {
  GoogleSignin,
  isErrorWithCode,
  isSuccessResponse,
  statusCodes,
} from "@react-native-google-signin/google-signin";
import { authErrorMessage, resetErrorMessage } from "../lib/authErrors";
import { Card, PrimaryButton, TextButton } from "../components/ui";
import { MIN_TOUCH_TARGET, Theme, fonts, radius, spacing } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";

GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

const RESET_SENT = "If an account exists for this email, we sent a reset link.";

export default function LoginScreen() {
  const { colors, type } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // a non-error message, e.g. "we sent a reset link"
  const [notice, setNotice] = useState<string | null>(null);
  const [focused, setFocused] = useState<"email" | "password" | null>(null);
  const passwordRef = useRef<TextInput>(null);

  // same Firebase project as the web app, so the same Google account
  // gets the same uid (and the same notes)
  const handleGoogleSignIn = async () => {
    setSubmitting(true);
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) {
        return; // user closed the account picker
      }
      const { idToken } = response.data;
      if (!idToken) {
        throw new Error("Google didn't return an idToken");
      }
      await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
    } catch (e: any) {
      if (isErrorWithCode(e) && e.code === statusCodes.IN_PROGRESS) {
        return;
      }
      // rare, and the message comes from Google
      Alert.alert("Google sign-in failed", e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      if (isSignUp) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleMode = () => {
    setIsSignUp((current) => !current);
    setError(null);
    setNotice(null);
  };

  // uses the email typed above; doesn't say whether it has an account
  const handleForgotPassword = async () => {
    const address = email.trim();
    setError(null);
    setNotice(null);
    if (!address) {
      setError("Type your email above, then tap Forgot password? again.");
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, address);
      setNotice(RESET_SENT);
    } catch (e) {
      const message = resetErrorMessage(e);
      if (message) {
        setError(message);
      } else {
        setNotice(RESET_SENT);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Smart Mind</Text>
          <Text style={[type.body, styles.subtitle]} numberOfLines={2}>
            Write a note once. It comes back when you get to the place or time it's for.
          </Text>

          <Card>
            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleSignIn}
              disabled={submitting}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Ionicons name="logo-google" size={18} color={colors.text} />
              <Text style={styles.googleText}>Continue with Google</Text>
            </TouchableOpacity>

            <Text style={[type.caption, styles.label]}>Email</Text>
            <TextInput
              style={[styles.input, focused === "email" && styles.inputFocused]}
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                setError(null);
                setNotice(null);
              }}
              onFocus={() => setFocused("email")}
              onBlur={() => setFocused(null)}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              accessibilityLabel="Email"
            />

            <Text style={[type.caption, styles.label]}>Password</Text>
            <TextInput
              ref={passwordRef}
              style={[styles.input, focused === "password" && styles.inputFocused]}
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setError(null);
              }}
              onFocus={() => setFocused("password")}
              onBlur={() => setFocused(null)}
              secureTextEntry
              autoComplete={isSignUp ? "new-password" : "password"}
              returnKeyType="go"
              onSubmitEditing={handleSubmit}
              accessibilityLabel="Password"
            />

            {!isSignUp && (
              <View style={styles.forgotRow}>
                <TextButton label="Forgot password?" onPress={handleForgotPassword} />
              </View>
            )}

            {notice && (
              <View style={styles.errorRow} accessibilityLiveRegion="polite">
                <Ionicons name="mail-outline" size={16} color={colors.primaryDark} />
                <Text style={styles.noticeText}>{notice}</Text>
              </View>
            )}

            {error && (
              <View style={styles.errorRow} accessibilityLiveRegion="polite">
                <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <PrimaryButton
              label={isSignUp ? "Create account" : "Sign in"}
              onPress={handleSubmit}
              loading={submitting}
              style={styles.submit}
            />
          </Card>

          <View style={styles.switchRow}>
            <TextButton
              label={isSignUp ? "Have an account? Sign in" : "New here? Create an account"}
              onPress={toggleMode}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, type }: Theme) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.screen, paddingTop: 32, gap: spacing.cardGap },
  title: { fontFamily: fonts.display, fontSize: 34, lineHeight: 44, color: colors.text },
  subtitle: { fontFamily: fonts.body, color: colors.textMuted, marginBottom: 4 },
  googleButton: {
    height: 48,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  googleText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  label: { marginTop: 14, marginBottom: 6 },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.surface,
  },
  inputFocused: { borderColor: colors.primary },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 10 },
  forgotRow: { alignItems: "flex-end", marginTop: -4 },
  noticeText: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: colors.primaryDark },
  errorText: { flex: 1, fontFamily: fonts.bodyMedium, fontSize: 14, color: colors.danger },
  submit: { marginTop: 16, minHeight: MIN_TOUCH_TARGET },
  switchRow: { alignItems: "center" },
});
