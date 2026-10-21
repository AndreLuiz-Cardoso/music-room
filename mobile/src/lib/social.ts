import { Platform } from 'react-native';

// Native social sign-in. The SDKs return a provider credential that the back-end verifies
// itself with Google / Facebook. These modules contain native code: they are only present in
// a development or release build (npx expo run:android), not in Expo Go nor on the web, so
// they are loaded lazily and the buttons are hidden when unavailable.

const googleWebClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const facebookAppId = process.env.EXPO_PUBLIC_FACEBOOK_APP_ID;

function load<T>(name: () => T): T | null {
  if (Platform.OS === 'web') return null;
  try {
    return name();
  } catch {
    return null;
  }
}

// lazy require: importing these modules crashes where their native code is absent
/* eslint-disable @typescript-eslint/no-require-imports */
const google = load(() => (googleWebClientId ? require('@react-native-google-signin/google-signin') : null));
const facebook = load(() => (facebookAppId ? require('react-native-fbsdk-next') : null));
/* eslint-enable @typescript-eslint/no-require-imports */

if (google) google.GoogleSignin.configure({ webClientId: googleWebClientId });

export const socialAvailability = { google: !!google, facebook: !!facebook };

export class SocialCancelled extends Error {}

/** Returns a Google ID token, issued for our web client id (the back-end checks the audience). */
export async function googleIdToken(): Promise<string> {
  if (!google) throw new Error('Google sign-in is not available in this build');
  const { GoogleSignin, isSuccessResponse } = google;
  await GoogleSignin.hasPlayServices();
  // always show the account picker, so that the user can choose another account
  await GoogleSignin.signOut().catch(() => {});
  const response = await GoogleSignin.signIn();
  if (!isSuccessResponse(response)) throw new SocialCancelled();
  const idToken: string | null = response.data.idToken ?? (await GoogleSignin.getTokens()).idToken;
  if (!idToken) throw new Error('Google did not return an ID token (check EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID)');
  return idToken;
}

/** Returns a Facebook user access token. */
export async function facebookAccessToken(): Promise<string> {
  if (!facebook) throw new Error('Facebook login is not available in this build');
  const { LoginManager, AccessToken } = facebook;
  LoginManager.logOut();
  const result = await LoginManager.logInWithPermissions(['public_profile', 'email']);
  if (result.isCancelled) throw new SocialCancelled();
  const token = await AccessToken.getCurrentAccessToken();
  if (!token?.accessToken) throw new Error('Facebook did not return an access token');
  return token.accessToken;
}
