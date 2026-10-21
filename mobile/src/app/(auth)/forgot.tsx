import { router } from 'expo-router';
import { useState } from 'react';
import { Body, Button, ErrorText, Input, Screen } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { notify } from '@/lib/hooks';

export default function ForgotScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    try {
      await api.auth.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function reset() {
    setError(null);
    try {
      // the code is the "token" parameter of the link received by email
      const code = token.includes('token=') ? token.split('token=')[1].split('&')[0] : token.trim();
      await api.auth.resetPassword(code, password);
      notify('Password changed', 'You can now log in.');
      router.back();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <Screen>
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Button title="Send me a reset link" onPress={send} disabled={!email} />
      {sent ? (
        <>
          <Body muted style={{ marginVertical: 12 }}>
            If an account exists for this address, an email was sent. Open its link to choose a new password, or paste the
            link here.
          </Body>
          <Input label="Link or code from the email" value={token} onChangeText={setToken} />
          <Input label="New password" value={password} onChangeText={setPassword} secureTextEntry />
          <Button title="Change password" onPress={reset} disabled={!token || password.length < 8} />
        </>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
