import { useState } from 'react';
import { Body, Button, ErrorText, Input, Screen, space } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function ForgotScreen() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
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

  // the link in the email opens the back-end's own page, where the new password is chosen
  return (
    <Screen>
      <Input label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
      <Button title="Send me a reset link" variant={sent ? 'secondary' : 'primary'} onPress={send} disabled={!email} />
      {sent ? (
        <Body muted style={{ marginVertical: space.md }}>
          If an account exists for this address, we sent it an email. Open the link inside to choose a new password.
        </Body>
      ) : null}
      <ErrorText>{error}</ErrorText>
    </Screen>
  );
}
