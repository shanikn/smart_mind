// The "New note" home-screen / lock-screen widget. Colors match src/theme.ts
// (light and dark palettes). No App Group: the widget shows no app data.
/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "widget",
  icon: "../../assets/icon.png",
  deploymentTarget: "17.0",
  colors: {
    $accent: { light: "#1F7A3A", dark: "#6CC48A" }, // primary
    widgetBackground: { light: "#DCEEDD", dark: "#1F3A28" }, // primarySoft
    widgetText: { light: "#145C2A", dark: "#A9E2B9" }, // primaryDark
  },
  images: {
    appIcon: "../../assets/icon.png",
  },
});
