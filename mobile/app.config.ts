import type { ExpoConfig } from 'expo/config';

// Values from mobile/.env (loaded by the Expo CLI); social modules only when their ids are set.
const env = process.env;

const plugins: ExpoConfig['plugins'] = [
  'expo-router',
  'expo-status-bar',
  'expo-secure-store',
  'expo-audio',
  [
    'expo-location',
    { locationWhenInUsePermission: 'Music Room uses your location to check that you are at the event when you vote.' },
  ],
];

if (env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
  plugins.push(
    env.GOOGLE_IOS_URL_SCHEME
      ? ['@react-native-google-signin/google-signin', { iosUrlScheme: env.GOOGLE_IOS_URL_SCHEME }]
      : '@react-native-google-signin/google-signin',
  );
}
if (env.EXPO_PUBLIC_FACEBOOK_APP_ID && env.FACEBOOK_CLIENT_TOKEN) {
  plugins.push([
    'react-native-fbsdk-next',
    {
      appID: env.EXPO_PUBLIC_FACEBOOK_APP_ID,
      clientToken: env.FACEBOOK_CLIENT_TOKEN,
      displayName: 'Music Room',
      scheme: `fb${env.EXPO_PUBLIC_FACEBOOK_APP_ID}`,
      advertiserIDCollectionEnabled: false,
      autoLogAppEventsEnabled: false,
      isAutoInitEnabled: true,
    },
  ]);
}

const config: ExpoConfig = {
  name: 'Music Room',
  slug: 'music-room',
  version: '1.0.0',
  scheme: 'musicroom',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  ios: {
    supportsTablet: true,
    bundleIdentifier: env.IOS_BUNDLE_ID ?? 'com.musicroom.app',
  },
  android: {
    package: env.ANDROID_PACKAGE ?? 'com.musicroom.app',
    adaptiveIcon: {
      backgroundColor: '#000000',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // the back-end address is configurable for tests, and is plain http on a LAN
    usesCleartextTraffic: true,
    predictiveBackGestureEnabled: false,
  } as ExpoConfig['android'],
  web: { favicon: './assets/favicon.png', bundler: 'metro' },
  plugins,
  experiments: { typedRoutes: false },
};

export default config;
