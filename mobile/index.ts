import { registerRootComponent } from 'expo';
import { I18nManager } from 'react-native';

// The UI is English and left-to-right. Android would mirror it on a Hebrew
// phone; app.json turns that off natively (expo-localization supportsRTL:
// false), and this is the fallback. Takes effect from the next app start.
I18nManager.allowRTL(false);
I18nManager.forceRTL(false);

// registers the geofence background task before anything else, so it also
// exists when Android starts the app in the background for a geofence event
import './src/services/geofence';
// the same for Done / Later / Not useful on a notification
import './src/services/notificationActions';
import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
