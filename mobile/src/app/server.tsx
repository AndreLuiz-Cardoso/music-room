import { router } from 'expo-router';
import { useState } from 'react';
import { Body, Button, ErrorText, Input, Screen } from '@/components/ui';
import { getApiUrl, setApiUrl } from '@/lib/client';
import { disconnectRealtime } from '@/lib/realtime';

/** The back-end address is configurable in the app, for tests. */
export default function ServerScreen() {
  const [url, setUrl] = useState(getApiUrl());
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test() {
    setStatus(null);
    setError(null);
    try {
      const res = await fetch(`${url.trim().replace(/\/+$/, '')}/health`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('Server reachable');
    } catch (err) {
      setError(`Server unreachable: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function save() {
    await setApiUrl(url);
    disconnectRealtime();
    router.back();
  }

  return (
    <Screen>
      <Body muted>Address of the Music Room back-end, for instance http://192.168.1.20:3000</Body>
      <Input label="URL" value={url} onChangeText={setUrl} keyboardType="url" autoCorrect={false} />
      {status ? <Body>{status}</Body> : null}
      <ErrorText>{error}</ErrorText>
      <Button title="Test" variant="secondary" onPress={test} />
      <Button title="Save" onPress={save} />
    </Screen>
  );
}
