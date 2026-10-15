import React, { useCallback, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  AlertButton,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { signOut } from "firebase/auth";
import { GoogleSignin } from "@react-native-google-signin/google-signin";
import { auth } from "../config/firebase";
import { useAuth } from "../context/AuthContext";
import {
  getNotificationsEnabled,
  getReminderLocation,
  getStoreAlertMode,
  getStoreAlertsEnabled,
  setNotificationsEnabled,
  setReminderLocation,
  setStoreAlertMode,
  setStoreAlertsEnabled,
} from "../lib/reminderPrefs";
import { syncStoreAlerts } from "../services/storeAlerts";
import { checkAndNotifyReminders, ensureNotificationPermissions } from "../services/reminderNotifier";
import {
  getAllCoords,
  removePlaceCoords,
  resolveCurrentLocation,
  placeSubtitle,
  RADIUS_CHOICES,
  setPlaceRadius,
  setPlaceCoords,
  UNKNOWN,
  UserPlace,
} from "../lib/userPlaces";
import { createPlace, deletePlace, updatePlace } from "../api/places";
import { loadPlaces } from "../services/placesStore";
import { Fix, freshFix, quickFix, recentFix } from "../services/currentPosition";
import { locationAfterPlaceChange } from "../lib/geofenceLogic";
import { distanceMeters } from "../lib/geo";

// a fresh fix this close to the quick one isn't worth re-saving
const REFINE_MIN_MOVE_M = 25;
import { AddressResult } from "../lib/nominatim";
import PlaceEditorModal from "../components/PlaceEditorModal";
import MapPickerModal from "../components/MapPickerModal";
import PasteLocationModal from "../components/PasteLocationModal";
import DeleteAccountModal from "../components/DeleteAccountModal";
import { deleteAccountAndSignOut } from "../services/accountDeletion";
import { signOutCleanup } from "../services/signOutCleanup";
import { finishPendingDelete } from "../services/pendingDelete";
import LocationWaysSheet, { LocationWay } from "../components/LocationWaysSheet";
import { initialMapView, MapView } from "../lib/mapPick";
import { LatLon } from "../lib/geo";
import { fillPickedAddress, savePickedPoint } from "../services/mapPick";
import AddressSearchModal from "../components/AddressSearchModal";
import CategoryColorModal from "../components/CategoryColorModal";
import {
  Category,
  CATEGORIES,
  categoryLabel,
  CategoryColors,
  DEFAULT_CATEGORY_COLORS,
  getCategoryColors,
  resetCategoryColor,
  setCategoryColor,
} from "../lib/categoryColors";
import { Card, Chip, ChipRow, TextButton, ToggleRow } from "../components/ui";
import { MIN_TOUCH_TARGET, Theme, fonts, radius, spacing } from "../theme";
import { useTheme, useThemedStyles } from "../ThemeContext";
import { APPEARANCE_OPTIONS, AppearancePref } from "../lib/appearance";

const APPEARANCE_ICONS: Record<AppearancePref, "phone-portrait-outline" | "sunny-outline" | "moon-outline"> = {
  system: "phone-portrait-outline",
  light: "sunny-outline",
  dark: "moon-outline",
};
import { GrantedPermissions, locationStatus } from "../lib/locationPermissionFlow";
import { getGrantedPermissions } from "../services/locationPermissions";
import { syncGeofencing } from "../services/geofence";
import { syncScheduledReminders } from "../services/scheduledReminders";
import {
  LocationPermissionModal,
  useLocationPermissionFlow,
} from "../components/LocationPermissionFlow";

export default function SettingsScreen() {
  const { colors, type, appearance, setAppearancePref } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const [notificationsEnabled, setNotificationsEnabledState] = useState(true);
  const [storeAlertsEnabled, setStoreAlertsEnabledState] = useState(true);
  const [storeAlertMode, setStoreAlertModeState] = useState<"stop" | "pass">("stop");
  const [location, setLocation] = useState<string>(UNKNOWN);
  const [checkingNow, setCheckingNow] = useState(false);
  const [places, setPlaces] = useState<UserPlace[]>([]);
  const [permissions, setPermissions] = useState<GrantedPermissions | null>(null);
  // the place waiting for a location fix ("Locating…"); doesn't block the others
  const [locatingPlaceId, setLocatingPlaceId] = useState<string | null>(null);
  // place the user tapped "Use current location" for before the permission
  // flow; saved once the flow finishes
  const pendingPlaceId = useRef<string | null>(null);
  // place editor: null = closed, { place: null } = add, { place } = rename
  const [editor, setEditor] = useState<{ place: UserPlace | null } | null>(null);
  const [addressFor, setAddressFor] = useState<UserPlace | null>(null);
  const [mapFor, setMapFor] = useState<{ place: UserPlace; view: MapView } | null>(null);
  const [waysFor, setWaysFor] = useState<UserPlace | null>(null);
  const [pasteFor, setPasteFor] = useState<UserPlace | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [categoryColors, setCategoryColors] = useState<CategoryColors>(DEFAULT_CATEGORY_COLORS);
  const [colorFor, setColorFor] = useState<Category | null>(null);

  const refreshPlaces = useCallback(async () => {
    const loaded = await loadPlaces();
    setPlaces(loaded);
    // map an old stored value ("home", "errands", a deleted place) to a place id
    const stored = await getReminderLocation();
    const resolved = resolveCurrentLocation(stored, loaded);
    if (loaded.length > 0 && resolved !== stored) {
      await setReminderLocation(resolved);
    }
    setLocation(loaded.length > 0 ? resolved : stored);
  }, []);

  useFocusEffect(
    useCallback(() => {
      getNotificationsEnabled().then(setNotificationsEnabledState).catch(() => {});
      getStoreAlertsEnabled().then(setStoreAlertsEnabledState).catch(() => {});
      getStoreAlertMode().then(setStoreAlertModeState).catch(() => {});
      refreshPlaces().catch(() => {});
      getCategoryColors().then(setCategoryColors).catch(() => {});
      // read-only: never prompts
      getGrantedPermissions().then(setPermissions).catch(() => {});
    }, [refreshPlaces])
  );

  const afterPlacesChanged = useCallback(async () => {
    await refreshPlaces();
    await syncGeofencing();
  }, [refreshPlaces]);

  // After a place's location or radius changes, re-check "Where you are now"
  // against where the phone is (a fix we already have, or a quick one).
  // Never prompts for permission.
  const recheckWhereIAm = useCallback(async (placeId: string, known?: Fix) => {
    try {
      const granted = await getGrantedPermissions();
      if (!granted.foreground) {
        return;
      }
      const position = known ?? (await quickFix());
      const coords = (await getAllCoords())[placeId] ?? null;
      const current = await getReminderLocation();
      const next = locationAfterPlaceChange(current, { id: placeId, coords }, position);
      if (next !== current) {
        await setReminderLocation(next);
        setLocation(next);
      }
    } catch {
      // best effort: geofences will catch up
    }
  }, []);

  const saveFixFor = useCallback(
    async (placeId: string, fix: Fix) => {
      await setPlaceCoords(placeId, fix, undefined, { source: "current" });
      await afterPlacesChanged();
      await recheckWhereIAm(placeId, fix);
    },
    [afterPlacesChanged, recheckWhereIAm]
  );

  // A recent position the phone already has saves instantly, and a fresh fix
  // refines it in the background. Without one, the place shows "Locating…"
  // until a fresh fix arrives (or 10 s pass).
  const saveCurrentLocationFor = useCallback(
    async (placeId: string) => {
      const quick = await recentFix();
      if (quick) {
        await saveFixFor(placeId, quick);
        freshFix().then((better) => {
          if (better && distanceMeters(quick, better) > REFINE_MIN_MOVE_M) {
            saveFixFor(placeId, better).catch(() => {});
          }
        });
        return;
      }
      setLocatingPlaceId(placeId);
      try {
        const fix = await freshFix();
        if (!fix) {
          Alert.alert("Couldn't get your location", "Check that location is on, or search the address instead.");
          return;
        }
        await saveFixFor(placeId, fix);
      } catch {
        Alert.alert("Couldn't save the location", "Try again.");
      } finally {
        setLocatingPlaceId(null);
      }
    },
    [saveFixFor]
  );

  const handlePermissionFlowDone = useCallback(
    (granted: GrantedPermissions) => {
      setPermissions(granted);
      syncGeofencing();
      const placeId = pendingPlaceId.current;
      pendingPlaceId.current = null;
      if (!placeId) {
        return;
      }
      if (granted.foreground) {
        saveCurrentLocationFor(placeId);
      } else {
        Alert.alert(
          "Location not allowed",
          "Without location access, find the place by address or set your current context with the picker."
        );
      }
    },
    [saveCurrentLocationFor]
  );

  const permissionFlow = useLocationPermissionFlow(handlePermissionFlowDone);

  const handleUseCurrentLocation = async (place: UserPlace) => {
    const granted = await getGrantedPermissions();
    setPermissions(granted);
    if (granted.foreground) {
      await saveCurrentLocationFor(place.id);
      return;
    }
    pendingPlaceId.current = place.id;
    await permissionFlow.start();
  };

  // "Save as <place>" in the address dialog. Errors propagate so the dialog
  // stays open and shows them; on success it closes and confirms.
  const handleAddressSave = async (result: AddressResult) => {
    const place = addressFor;
    if (!place) {
      return;
    }
    await setPlaceCoords(place.id, result, undefined, { source: "address", address: result.label });
    setAddressFor(null);
    Alert.alert("Location saved", `${place.name}: ${result.label}`);
    await afterPlacesChanged();
    await recheckWhereIAm(place.id);
  };

  // Opens on the place's saved location, else where the phone is (any recent
  // position will do for centering a map), else a default view.
  const handlePickOnMap = async (place: UserPlace) => {
    let position: LatLon | null = null;
    if (!place.coords) {
      const granted = await getGrantedPermissions().catch(() => null);
      if (granted?.foreground) {
        position = await recentFix({ maxAgeMs: 30 * 60 * 1000, maxAccuracyM: 2000 });
        if (!position) {
          setLocatingPlaceId(place.id);
          position = await freshFix();
          setLocatingPlaceId(null);
        }
      }
    }
    setMapFor({ place, view: initialMapView(place, position) });
  };

  // "Save here": the point is saved right away; the address follows when the
  // backend's reverse lookup answers
  const handleMapSave = async (point: LatLon) => {
    const place = mapFor?.place;
    setMapFor(null);
    if (!place) {
      return;
    }
    try {
      await savePickedPoint(place.id, point);
      await afterPlacesChanged();
      await recheckWhereIAm(place.id);
    } catch {
      Alert.alert("Couldn't save the location", "Try again.");
      return;
    }
    if (await fillPickedAddress(place.id, point)) {
      await refreshPlaces();
    }
  };

  const handleEditorSave = async (name: string, keywords: string[]) => {
    const target = editor?.place ?? null;
    setEditor(null);
    try {
      if (target) {
        await updatePlace(target.id, { name, keywords });
      } else {
        await createPlace(name, keywords);
      }
      await afterPlacesChanged();
    } catch (e: any) {
      const taken = String(e?.message ?? "").includes("409");
      Alert.alert(
        "Couldn't save the place",
        taken ? `You already have a place named "${name}".` : "Check your connection and try again."
      );
    }
  };

  // a new radius re-registers the geofences (afterPlacesChanged -> syncGeofencing)
  const handleSetRadius = async (place: UserPlace, radius: number) => {
    if (place.coords?.radius === radius) {
      return;
    }
    try {
      await setPlaceRadius(place.id, radius);
      await afterPlacesChanged();
      await recheckWhereIAm(place.id);
    } catch {
      Alert.alert("Couldn't change the radius", "Try again.");
    }
  };

  // clears the address and radius on this phone and re-registers the geofences
  // without it ("Where you are now" goes to "Not at a place" if it was this place);
  // the place itself (and the notes tagged with it) stays
  const handleRemovePlace = (place: UserPlace) => {
    Alert.alert(
      "Clear location",
      `Clear ${place.name}'s address and radius from this phone? Arrival alerts for ${place.name} stop. ` +
        `Your notes keep their text and stay linked to ${place.name}, and you can set a new location any time.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: async () => {
            await removePlaceCoords(place.id);
            // without a location you can't be detected there any more
            if (location === place.id) {
              await setReminderLocation(UNKNOWN);
            }
            await afterPlacesChanged();
          },
        },
      ]
    );
  };

  const handleDeletePlace = (place: UserPlace) => {
    Alert.alert(
      "Delete place",
      `Delete ${place.name}? Notes tagged with it lose that tag.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deletePlace(place.id);
              await removePlaceCoords(place.id);
              if (location === place.id) {
                await setReminderLocation(UNKNOWN);
              }
              await afterPlacesChanged();
            } catch {
              Alert.alert("Couldn't delete the place", "Check your connection and try again.");
            }
          },
        },
      ]
    );
  };

  const status = permissions ? locationStatus(permissions) : null;

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          const usedGoogle = auth.currentUser?.providerData.some(
            (p) => p.providerId === "google.com"
          );
          // a note delete waiting for Undo needs this user's sign-in to reach the server
          await finishPendingDelete();
          await signOut(auth);
          // the next person on this phone mustn't get this user's geofences,
          // alarms or offline notes
          await signOutCleanup();
          if (!usedGoogle) {
            return;
          }
          // clear the cached Google account so the picker shows next time.
          // Not awaited: with outdated Play services this promise never
          // settles, and it must never block the Firebase sign-out above.
          try {
            GoogleSignin.signOut().catch(() => {});
          } catch {
            // native module unavailable — nothing to clear
          }
        },
      },
    ]);
  };

  const handleToggleNotifications = async (value: boolean) => {
    setNotificationsEnabledState(value);
    await setNotificationsEnabled(value);

    if (value) {
      const granted = await ensureNotificationPermissions();
      if (!granted) {
        Alert.alert(
          "Notifications disabled",
          "Permission was not granted, so reminders cannot appear as phone notifications."
        );
      }
    }
    // turning notifications off stops geofencing and exact alarms; on restarts them
    await syncGeofencing();
    await syncScheduledReminders();
    await syncStoreAlerts();
  };

  const handleStoreAlertMode = async (mode: "stop" | "pass") => {
    setStoreAlertModeState(mode);
    await setStoreAlertMode(mode);
  };

  const handleToggleStoreAlerts = async (value: boolean) => {
    setStoreAlertsEnabledState(value);
    await setStoreAlertsEnabled(value);
    // registers or removes the store geofences
    await syncStoreAlerts();
  };

  const handleSaveCategoryColor = async (hex: string) => {
    const category = colorFor;
    setColorFor(null);
    if (!category) {
      return;
    }
    await setCategoryColor(category, hex);
    setCategoryColors(await getCategoryColors());
  };

  const handleResetCategoryColor = async () => {
    const category = colorFor;
    setColorFor(null);
    if (!category) {
      return;
    }
    await resetCategoryColor(category);
    setCategoryColors(await getCategoryColors());
  };

  const handleSelectLocation = async (nextLocation: string) => {
    setLocation(nextLocation);
    await setReminderLocation(nextLocation);
  };

  const handleCheckNow = async () => {
    setCheckingNow(true);
    try {
      const result = await checkAndNotifyReminders({ force: true });
      if (!result.notificationsEnabled) {
        Alert.alert("Notifications off", "Enable phone notifications first.");
      } else if (!result.permissionGranted) {
        Alert.alert("Permission needed", "Allow notifications on this device to receive alerts.");
      } else if (result.notifiedCount === 0) {
        Alert.alert("No alerts sent", "No notes are due at the current time and context.");
      } else {
        Alert.alert("Alerts sent", `Sent ${result.notifiedCount} phone notification(s).`);
      }
    } catch {
      Alert.alert("Error", "Failed to check reminders");
    } finally {
      setCheckingNow(false);
    }
  };

  // "Set location" (no location yet): the two ways to set one
  // a sheet with the ways to set it (an Alert can't hold four on Android)
  const openSetLocation = (place: UserPlace) => setWaysFor(place);

  const handleLocationWay = (way: LocationWay) => {
    const place = waysFor;
    setWaysFor(null);
    if (!place) {
      return;
    }
    if (way === "current") {
      return handleUseCurrentLocation(place);
    }
    if (way === "address") {
      return setAddressFor(place);
    }
    if (way === "map") {
      return handlePickOnMap(place);
    }
    return setPasteFor(place);
  };

  // pasted coordinates or a Google Maps link: saved right away, then the
  // address follows when the backend's reverse lookup answers
  const handlePasteSave = async (point: LatLon) => {
    const place = pasteFor;
    setPasteFor(null);
    if (!place) {
      return;
    }
    try {
      await savePickedPoint(place.id, point, "pasted");
      await afterPlacesChanged();
      await recheckWhereIAm(place.id);
    } catch {
      Alert.alert("Couldn't save the location", "Try again.");
      return;
    }
    if (await fillPickedAddress(place.id, point, undefined, "pasted")) {
      await refreshPlaces();
    }
  };

  // ⋯ menu: every action for a place, in Android's 3-button limit (more
  // buttons were silently dropped there); the location ways are one step in
  const openPlaceMenu = (place: UserPlace) => {
    const buttons: AlertButton[] = [
      { text: "Change location", onPress: () => openSetLocation(place) },
      { text: "Rename", onPress: () => setEditor({ place }) },
      { text: "Delete", style: "destructive", onPress: () => handleDeletePlace(place) },
    ];
    Alert.alert(place.name, undefined, buttons, { cancelable: true });
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[type.screenTitle, styles.title]}>Settings</Text>

        <Card
          title="Where you are now"
          helper="Set automatically when you arrive at a saved place. Tap to override."
        >
          <ChipRow style={styles.chips}>
            {[...places, { id: UNKNOWN, name: "Not at a place" }].map((option) => {
              const selected = location === option.id;
              return (
                <Chip
                  key={option.id}
                  label={option.name}
                  selected={selected}
                  icon={selected ? "location-outline" : undefined}
                  onPress={() => handleSelectLocation(option.id)}
                />
              );
            })}
          </ChipRow>
        </Card>

        <Card title="Saved places" helper="Names sync to your account. Locations stay on this phone.">
          {status && (
            <Text style={[type.caption, status.mode === "manual" && styles.statusManual]}>{status.message}</Text>
          )}
          {status?.mode === "manual" && (
            <TextButton label="Turn on automatic location" onPress={() => permissionFlow.start()} />
          )}
          {places.map((place) => {
            const isSet = place.coords !== null;
            const locating = locatingPlaceId === place.id;
            return (
              <View key={place.id} style={styles.placeRow}>
                <View style={styles.placeTop}>
                  <View
                    style={[
                      styles.placeIcon,
                      { backgroundColor: isSet ? colors.primarySoft : colors.chip },
                    ]}
                  >
                    <Ionicons
                      name="location-outline"
                      size={20}
                      color={isSet ? colors.primaryDark : colors.textMuted}
                    />
                  </View>
                  <View style={styles.placeText}>
                    <Text style={type.body} numberOfLines={1}>
                      {place.name}
                    </Text>
                    {locating ? (
                      <View style={styles.locating}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={type.caption}>Locating…</Text>
                      </View>
                    ) : (
                      <Text style={type.caption} numberOfLines={2}>
                        {placeSubtitle(place)}
                      </Text>
                    )}
                  </View>
                  {!isSet && (
                    <TouchableOpacity
                      style={styles.setLocation}
                      onPress={() => openSetLocation(place)}
                      disabled={locating}
                      accessibilityRole="button"
                      accessibilityLabel={`Set location for ${place.name}`}
                    >
                      <Text style={styles.setLocationText}>Set location</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.menuButton}
                    onPress={() => openPlaceMenu(place)}
                    disabled={locating}
                    accessibilityRole="button"
                    accessibilityLabel={`${place.name} options`}
                  >
                    <Ionicons name="ellipsis-vertical" size={20} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>
                {place.coords && (
                  <View style={styles.radiusRow}>
                    <Text style={type.caption}>Radius</Text>
                    <ChipRow>
                      {RADIUS_CHOICES.map((r) => (
                        <Chip
                          key={r}
                          label={`${r} m`}
                          selected={place.coords?.radius === r}
                          onPress={() => handleSetRadius(place, r)}
                          accessibilityLabel={`${place.name} radius ${r} m`}
                        />
                      ))}
                    </ChipRow>
                    <TouchableOpacity
                      style={styles.removePlace}
                      onPress={() => handleRemovePlace(place)}
                      disabled={locating}
                      accessibilityRole="button"
                      accessibilityLabel={`Clear location ${place.name}`}
                    >
                      <Ionicons name="trash-outline" size={18} color={colors.danger} />
                      <Text style={styles.removePlaceText}>Clear location</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })}
          <View style={styles.addPlaceRow}>
            <TextButton label="+ Add place" onPress={() => setEditor({ place: null })} />
          </View>
        </Card>

        <Card title="Appearance" helper="System follows your phone's light or dark setting.">
          <ChipRow style={styles.chips}>
            {APPEARANCE_OPTIONS.map((option) => {
              const label = option.charAt(0).toUpperCase() + option.slice(1);
              return (
                <Chip
                  key={option}
                  label={label}
                  icon={APPEARANCE_ICONS[option]}
                  selected={appearance === option}
                  onPress={() => setAppearancePref(option)}
                  accessibilityLabel={`Appearance: ${label}`}
                />
              );
            })}
          </ChipRow>
        </Card>

        <Card title="Category colors">
          {CATEGORIES.map((category, i) => {
            const color = categoryColors[category];
            return (
              <TouchableOpacity
                key={category}
                style={[styles.colorRow, i > 0 && styles.rowDivider]}
                onPress={() => setColorFor(category)}
                accessibilityRole="button"
                accessibilityLabel={`${categoryLabel(category)} color`}
              >
                <View style={[styles.swatch, { backgroundColor: color }]} />
                <Text style={[type.body, styles.colorName]}>
                  {categoryLabel(category)}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </Card>

        <Card>
          <ToggleRow
            title="Phone notifications"
            caption="Show reminders on this phone."
            value={notificationsEnabled}
            onValueChange={handleToggleNotifications}
          />
          <ToggleRow
            title="Errand alerts near stores"
            caption="When you have errands and walk into any supermarket, pharmacy or post office nearby."
            value={storeAlertsEnabled}
            onValueChange={handleToggleStoreAlerts}
          />
          {storeAlertsEnabled && (
            <ChipRow style={styles.chips}>
              <Chip
                label="Alert when I stop there"
                icon="hourglass-outline"
                selected={storeAlertMode === "stop"}
                onPress={() => handleStoreAlertMode("stop")}
              />
              <Chip
                label="Alert when passing by"
                icon="walk-outline"
                selected={storeAlertMode === "pass"}
                onPress={() => handleStoreAlertMode("pass")}
              />
            </ChipRow>
          )}
          <TouchableOpacity
            style={[styles.checkRow, checkingNow && styles.dimmed]}
            onPress={handleCheckNow}
            disabled={checkingNow}
            accessibilityRole="button"
            accessibilityLabel="Check alerts now"
          >
            <Ionicons name="refresh-outline" size={20} color={colors.primaryDark} />
            <Text style={[type.body, styles.checkText]}>
              {checkingNow ? "Checking…" : "Check alerts now"}
            </Text>
          </TouchableOpacity>
        </Card>

        <Card>
          <Text style={type.caption}>Signed in as</Text>
          <Text style={type.body} numberOfLines={1} ellipsizeMode="tail">
            {/* Apple may share a relay address, or none at all */}
            {user?.email || "your Apple ID"}
          </Text>
          <View style={styles.signOutRow}>
            <TextButton label="Sign out" destructive onPress={handleSignOut} />
            <TextButton label="Delete account" destructive onPress={() => setDeletingAccount(true)} />
          </View>
        </Card>
      </ScrollView>

      <CategoryColorModal
        visible={colorFor !== null}
        category={colorFor ? categoryLabel(colorFor) : ""}
        color={colorFor ? categoryColors[colorFor] : "#000000"}
        isDefault={colorFor ? categoryColors[colorFor] === DEFAULT_CATEGORY_COLORS[colorFor] : true}
        onSave={handleSaveCategoryColor}
        onReset={handleResetCategoryColor}
        onCancel={() => setColorFor(null)}
      />
      <PlaceEditorModal
        visible={editor !== null}
        title={editor?.place ? `Rename ${editor.place.name}` : "Add place"}
        initialName={editor?.place?.name ?? ""}
        initialKeywords={editor?.place?.keywords ?? []}
        onSave={handleEditorSave}
        onCancel={() => setEditor(null)}
      />
      {mapFor && (
        <MapPickerModal
          visible
          placeName={mapFor.place.name}
          initialView={mapFor.view}
          onSave={handleMapSave}
          onCancel={() => setMapFor(null)}
        />
      )}
      <DeleteAccountModal
        visible={deletingAccount}
        email={user?.email ?? null}
        confirmWithApple={user?.providerData?.some((p) => p.providerId === "apple.com") ?? false}
        onConfirm={deleteAccountAndSignOut}
        onCancel={() => setDeletingAccount(false)}
      />
      <LocationWaysSheet placeName={waysFor?.name ?? null} onChoose={handleLocationWay} onClose={() => setWaysFor(null)} />
      <PasteLocationModal
        visible={pasteFor !== null}
        placeName={pasteFor?.name ?? ""}
        onSave={handlePasteSave}
        onCancel={() => setPasteFor(null)}
      />
      <AddressSearchModal
        visible={addressFor !== null}
        placeName={addressFor?.name ?? ""}
        onSave={handleAddressSave}
        onCancel={() => setAddressFor(null)}
      />
      <LocationPermissionModal
        screen={permissionFlow.screen}
        onContinue={permissionFlow.proceed}
        onSkip={permissionFlow.skip}
      />
    </SafeAreaView>
  );
}

const makeStyles = ({ colors, type }: Theme) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.screen, gap: spacing.cardGap },
  title: { marginBottom: 4 },
  chips: { marginTop: 10 },
  statusManual: { color: colors.danger, marginTop: 4 },
  placeRow: {
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  placeTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  placeIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  placeText: { flex: 1 },
  setLocation: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: colors.primarySoft,
    justifyContent: "center",
  },
  setLocationText: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.primaryDark },
  menuButton: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radiusRow: { marginTop: 10, marginLeft: 52, gap: 6 },
  locating: { flexDirection: "row", alignItems: "center", gap: 6 },
  removePlace: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: MIN_TOUCH_TARGET,
    paddingHorizontal: 14,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  removePlaceText: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.danger },
  addPlaceRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 4 },
  colorRow: { flexDirection: "row", alignItems: "center", gap: 12, minHeight: MIN_TOUCH_TARGET + 4 },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  colorName: { flex: 1 },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: MIN_TOUCH_TARGET + 4,
    marginTop: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
  },
  checkText: { color: colors.primaryDark },
  dimmed: { opacity: 0.5 },
  signOutRow: { marginTop: 4, alignItems: "flex-start" },
});
