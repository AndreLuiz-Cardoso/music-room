import { Link } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { GoogleButton } from '@/components/GoogleButton';
import { Body, Button, ErrorText, Input, Screen, Title, colors, space, styles } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { notify } from '@/lib/hooks';
import { SocialCancelled, facebookAccessToken, socialAvailability } from '@/lib/social';

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
  const google = (idToken: () => Promise<string>) => run(async () => startSession(await api.auth.google(await idToken())));
  const facebook = () => run(async () => startSession(await api.auth.facebook(await facebookAccessToken())));
  const resend = () =>
    run(async () => {
      await api.auth.resendVerification(email.trim());
      notify('Email sent', 'Open the link we sent you, then log in.');
    });

  const social = socialAvailability.google || socialAvailability.facebook;

  return (
    <Screen>
      <View style={{ marginTop: space.xxl, marginBottom: space.xl }}>
        <Text style={styles.display}>Music Room</Text>
        <Body muted>Vote, edit playlists and pass the aux, together.</Body>
      </View>
      <Title>Log in</Title>
      {social ? (
        <>
          {socialAvailability.google ? <GoogleButton purpose="login" onPress={google} /> : null}
          {socialAvailability.facebook ? <Button title="Continue with Facebook" variant="secondary" onPress={facebook} /> : null}
          <Divider label="or continue with email" />
        </>
      ) : null}
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" />
      <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="password" />
      <Link href="/forgot" style={[styles.link, { alignSelf: 'flex-end', fontSize: 13, marginBottom: space.sm }]}>
        Forgot your password?
      </Link>
      <ErrorText>{error}</ErrorText>
      {unverified ? <Button title="Send the confirmation email again" variant="secondary" onPress={resend} /> : null}
      <Button title="Log in" onPress={login} loading={busy} disabled={!email || !password} />
      <Divider label="or" />
      <Body muted style={{ textAlign: 'center' }}>
        {"Don't have an account? "}
        <Link href="/register" style={styles.link}>
          Create an account
        </Link>
      </Body>
    </Screen>
  );
}

function Divider({ label }: { label: string }) {
  const line = { flex: 1, height: 1, backgroundColor: colors.raised };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginVertical: space.lg }}>
      <View style={line} />
      <Text style={[styles.body, styles.muted, { fontSize: 13 }]}>{label}</Text>
      <View style={line} />
    </View>
  );
}
