import type { AudioPlayer } from 'expo-audio';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { errorMessage } from './api';
import type { ListFilter } from './types';

/** Loads on screen focus, and again when one of `deps` (plain values: ids, filters) changes. */
export function useLoader<T>(load: () => Promise<T>, deps: (string | number | undefined)[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const loader = useRef(load);
  useLayoutEffect(() => {
    loader.current = load;
  });
  const key = deps.join('|');
  const latest = useRef(0);

  // Only the last request counts: a late, older answer (search typed letter by letter) is dropped.
  const reload = useCallback(async () => {
    const request = ++latest.current;
    setLoading(true);
    try {
      const result = await loader.current();
      if (request !== latest.current) return;
      setData(result);
      setError(null);
    } catch (err) {
      if (request === latest.current) setError(errorMessage(err));
    } finally {
      if (request === latest.current) setLoading(false);
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

/** Filter, debounced name search and list; the API returns the 100 latest, others by name. */
export function useListSearch<T>(load: (filter: ListFilter, q?: string) => Promise<T[]>) {
  const [filter, setFilter] = useState<ListFilter>('all');
  const [query, setQuery] = useState('');
  const q = useDebounced(query.trim());
  return { filter, setFilter, query, setQuery, q, ...useLoader(() => load(filter, q || undefined), [filter, q]) };
}

/** Skips unplayable tracks; waits on a 2nd failed load in a row, so an outage can't drain the queue. */
export function useSkipUnplayable(player: AudioPlayer, key: string | null, playable: boolean, enabled: boolean, onSkip: () => void) {
  const skipped = useRef<string | null>(null);
  const failedInARow = useRef(0);
  const skip = useEffectEvent((failed: boolean) => {
    if (!enabled || !key || skipped.current === key) return;
    if (failed && failedInARow.current++ > 0) return;
    skipped.current = key;
    onSkip();
  });
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.error) skip(true);
      // the sound moved forward: the links work again
      else if (s.currentTime > 0) failedInARow.current = 0;
    });
    return () => sub.remove();
  }, [player]);
  useEffect(() => {
    if (key && !playable) skip(false);
  }, [key, playable, enabled]);
}

/** `value`, once it stopped changing for `ms` (a search typed letter by letter). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function notify(title: string, message?: string) {
  if (Platform.OS === 'web') window.alert(message ? `${title}\n${message}` : title);
  else Alert.alert(title, message);
}

/** Confirms, deletes an event or a playlist, then goes back to the list; resolves with the error. */
export async function confirmDelete(what: 'event' | 'playlist', remove: () => Promise<unknown>): Promise<string | null> {
  if (!(await confirm(`Delete this ${what}?`, 'This cannot be undone.'))) return null;
  try {
    await remove();
    router.dismissAll();
    return null;
  } catch (err) {
    return errorMessage(err);
  }
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
