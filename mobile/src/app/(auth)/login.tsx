import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Body, Button, ErrorText, Input, Screen, Title, space, styles } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/lib/hooks';
import { SocialCancelled, facebookAccessToken, googleIdToken, socialAvailability } from '@/lib/social';

export default function LoginScreen() {
  const { startSession } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      await action();
    } catch (err) {
      if (err instanceof SocialCancelled) return;
      if (err instanceof ApiError && err.code === 'EMAIL_NOT_VERIFIED') setUnverified(true);
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const login = () => run(async () => startSession(await api.auth.login(email.trim(), password)));
  const google = () => run(async () => startSession(await api.auth.google(await googleIdToken())));
  const facebook = () => run(async () => startSession(await api.auth.facebook(await facebookAccessToken())));
  const resend = () =>
    run(async () => {
      await api.auth.resendVerification(email.trim());
      notify('Email sent', 'Open the link we sent you, then log in.');
    });

  return (
    <Screen>
      <View style={{ marginTop: space.xxl, marginBottom: space.xl }}>
        <Text style={styles.display}>Music Room</Text>
        <Body muted>Vote, edit playlists and pass the aux, together.</Body>
      </View>
      <Title>Log in</Title>
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <ErrorText>{error}</ErrorText>
      {unverified ? <Button title="Send the confirmation email again" variant="secondary" onPress={resend} /> : null}
      <Button title="Log in" onPress={login} loading={busy} disabled={!email || !password} />
      {socialAvailability.google ? <Button title="Continue with Google" variant="secondary" onPress={google} /> : null}
      {socialAvailability.facebook ? <Button title="Continue with Facebook" variant="secondary" onPress={facebook} /> : null}
      <View style={{ marginTop: space.lg, gap: space.md }}>
        <Link href="/register" style={styles.link}>
          Create an account
        </Link>
        <Link href="/forgot" style={styles.link}>
          Forgot your password?
        </Link>
      </View>
    </Screen>
  );
}
