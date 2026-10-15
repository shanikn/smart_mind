// App Store review settings in app.json
const { expo } = require("../app.json");

function locationPlugin() {
  const entry = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === "expo-location");
  return entry[1];
}

test("the store ids never change", () => {
  expect(expo.ios.bundleIdentifier).toBe("com.shanini.smartmind");
  expect(expo.android.package).toBe("com.shanini.mobile");
});

test("Sign in with Apple is enabled on iOS", () => {
  expect(expo.ios.usesAppleSignIn).toBe(true);
});

test("iPhone only, no iPad", () => {
  expect(expo.ios.supportsTablet).toBe(false);
});

test("the location texts say what the app does: arrivals, stores for errands, while closed", () => {
  const plugin = locationPlugin();
  const always = plugin.locationAlwaysAndWhenInUsePermission;
  expect(always).toMatch(/arrive at your saved places/);
  expect(always).toMatch(/store for an errand/);
  expect(always).toMatch(/even when the app is closed/);
  const whenInUse = plugin.locationWhenInUsePermission;
  expect(whenInUse).toMatch(/saved places/);
  expect(whenInUse).toMatch(/store/);
});

// expo-location's startGeofencingAsync throws on iOS without the "location"
// background mode, which this flag adds
test("iOS keeps the location background mode that geofencing needs", () => {
  expect(locationPlugin().isIosBackgroundLocationEnabled).toBe(true);
});
