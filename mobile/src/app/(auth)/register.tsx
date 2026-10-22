import { router } from 'expo-router';
import { useState } from 'react';
import { Body, Button, ErrorText, Input, Screen, space } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function RegisterScreen() {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const weak = password.length > 0 && !/^(?=.*[A-Za-z])(?=.*\d).{8,}$/.test(password);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.auth.register(email.trim(), password, displayName.trim());
      setDone(res.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Screen>
        <Body>{done}</Body>
        <Body muted style={{ marginVertical: space.md }}>
          You need to confirm your email address before you can log in.
        </Body>
        <Button title="Back to login" onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Input label="Name" value={displayName} onChangeText={setDisplayName} autoCapitalize="words" />
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
      {weak ? <ErrorText>At least 8 characters, with a letter and a digit.</ErrorText> : null}
      <ErrorText>{error}</ErrorText>
      <Button title="Create my account" onPress={submit} loading={busy} disabled={!displayName || !email || !password || weak} />
    </Screen>
  );
}
