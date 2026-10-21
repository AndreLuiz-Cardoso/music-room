import * as Location from 'expo-location';
import type { Geo } from './api';

/** Current position, or null when the user refuses the permission. */
export async function currentPosition(): Promise<Geo | null> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}
