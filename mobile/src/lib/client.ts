import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { preferences } from './storage';

// Identity of this installation, sent with every request so that the back-end logs the
// platform, the device and the application version of each action.

const DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? (Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000');

let apiUrl = DEFAULT_API_URL;

export const getApiUrl = () => apiUrl;

export async function loadApiUrl(): Promise<string> {
  apiUrl = (await preferences.get('apiUrl')) ?? DEFAULT_API_URL;
  return apiUrl;
}

/** The back-end address is configurable from the app, for tests. */
export async function setApiUrl(url: string): Promise<void> {
  apiUrl = url.trim().replace(/\/+$/, '');
  await preferences.set('apiUrl', apiUrl);
}

export const appVersion =
  Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? 'unknown';

export const clientHeaders: Record<string, string> = {
  'X-Client-Platform': `${Platform.OS} ${Device.osVersion ?? Platform.Version ?? ''}`.trim(),
  'X-Client-Device': [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || 'unknown',
  'X-Client-Version': appVersion,
};

export const deviceName = Device.deviceName ?? Device.modelName ?? `${Platform.OS} device`;

/** Random id generated once per installation (not a secret, not a hardware id). */
export async function installationId(): Promise<string> {
  const existing = await preferences.get('installationId');
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await preferences.set('installationId', id);
  return id;
}
