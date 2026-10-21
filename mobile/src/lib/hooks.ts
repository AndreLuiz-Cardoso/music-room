import { useFocusEffect } from 'expo-router';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { errorMessage } from './api';

/**
 * Loads data each time the screen gets the focus, and again when one of `deps` changes.
 * `deps` are the plain values the loader depends on (ids, filters).
 */
export function useLoader<T>(load: () => Promise<T>, deps: (string | number | undefined)[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loader = useRef(load);
  useLayoutEffect(() => {
    loader.current = load;
  });
  const key = deps.join('|');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loader.current());
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
      // `key` is not read inside: it is there to reload when the loader inputs change
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reload, key]),
  );
  return { data, setData, error, loading, reload };
}

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
}

/** Runs an action and shows its error, if any. */
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
  try {
    return await action();
  } catch (err) {
    notify('Error', errorMessage(err));
    return undefined;
  }
}

export function confirm(title: string, message: string): Promise<boolean> {
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(`${title}\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: 'OK', style: 'destructive', onPress: () => resolve(true) },
    ]),
  );
}
