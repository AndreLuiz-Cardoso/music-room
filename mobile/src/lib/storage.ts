import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Secrets (the refresh token) go to the OS keystore (Keychain / Android Keystore) through
// SecureStore. The web has no equivalent, so it falls back to AsyncStorage (localStorage).
const secureAvailable = Platform.OS !== 'web';

export const secureStorage = {
  async get(key: string): Promise<string | null> {
    return secureAvailable ? SecureStore.getItemAsync(key) : AsyncStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (secureAvailable) await SecureStore.setItemAsync(key, value);
    else await AsyncStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    if (secureAvailable) await SecureStore.deleteItemAsync(key);
    else await AsyncStorage.removeItem(key);
  },
};

export const preferences = {
  get: (key: string) => AsyncStorage.getItem(key),
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
};
