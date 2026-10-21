import { router } from 'expo-router';
import { useState } from 'react';
import { Body, Button, ErrorText, Input, Row, Screen, Section, Title } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { getApiUrl } from '@/lib/client';
import { attempt, notify } from '@/lib/hooks';
import { SocialCancelled, facebookAccessToken, googleIdToken, socialAvailability } from '@/lib/social';
import type { Me } from '@/lib/types';

export default function ProfileScreen() {
  const { user } = useAuth();
  return user ? <ProfileForm key={user.id} user={user} /> : null;
}

function ProfileForm({ user }: { user: Me }) {
  const { setUser, logout } = useAuth();
  const [form, setForm] = useState(() => ({
    displayName: user.displayName,
    bio: user.bio ?? '',
    friendsInfo: user.friendsInfo ?? '',
    privateInfo: user.privateInfo ?? '',
    genres: user.musicPreferences.join(', '),
  }));
  const [error, setError] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const field = (key: keyof typeof form) => ({ value: form[key], onChangeText: (v: string) => setForm({ ...form, [key]: v }) });

  async function save() {
    setError(null);
    try {
      const updated = await api.me.update({
        displayName: form.displayName.trim(),
        bio: form.bio.trim() || null,
        friendsInfo: form.friendsInfo.trim() || null,
        privateInfo: form.privateInfo.trim() || null,
        musicPreferences: form.genres.split(',').map((g) => g.trim()).filter(Boolean),
      });
      setUser(updated);
      notify('Profile saved');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function link(provider: 'google' | 'facebook') {
    try {
      const me: Me =
        provider === 'google'
          ? await api.me.linkGoogle(await googleIdToken())
          : await api.me.linkFacebook(await facebookAccessToken());
      setUser(me);
    } catch (err) {
      if (!(err instanceof SocialCancelled)) notify('Error', errorMessage(err));
    }
  }

  async function changePassword() {
    try {
      await api.me.changePassword(user.hasPassword ? currentPassword : undefined, newPassword);
      setCurrentPassword('');
      setNewPassword('');
      setUser(await api.me.get());
      notify('Password updated');
    } catch (err) {
      notify('Error', errorMessage(err));
    }
  }

  return (
    <Screen>
      <Title>My profile</Title>
      <Body muted>{user.email}</Body>

      <Section title="Public">
        <Input label="Name" {...field('displayName')} autoCapitalize="words" />
        <Input label="Bio" {...field('bio')} multiline />
        <Input label="Music preferences (comma separated)" {...field('genres')} />
      </Section>
      <Section title="Friends only">
        <Input label="Visible to my friends" {...field('friendsInfo')} multiline />
      </Section>
      <Section title="Private">
        <Input label="Only visible to me" {...field('privateInfo')} multiline />
      </Section>
      <ErrorText>{error}</ErrorText>
      <Button title="Save" onPress={save} />

      <Section title="Linked accounts">
        {(['google', 'facebook'] as const).map((p) => (
          <Row key={p} style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <Body>
              {p === 'google' ? 'Google' : 'Facebook'}: {user.linkedProviders[p] ? 'linked' : 'not linked'}
            </Body>
            {user.linkedProviders[p] ? (
              <Button small variant="secondary" title="Unlink" onPress={() => attempt(() => api.me.unlink(p)).then((me) => me && setUser(me))} />
            ) : socialAvailability[p] ? (
              <Button small title="Link" onPress={() => link(p)} />
            ) : (
              <Body muted>unavailable in this build</Body>
            )}
          </Row>
        ))}
      </Section>

      <Section title={user.hasPassword ? 'Change password' : 'Set a password'}>
        {user.hasPassword ? <Input label="Current password" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry /> : null}
        <Input label="New password" value={newPassword} onChangeText={setNewPassword} secureTextEntry />
        <Button title="Update password" variant="secondary" onPress={changePassword} disabled={newPassword.length < 8} />
      </Section>

      <Section title="App">
        <Body muted>Server: {getApiUrl()}</Body>
        <Button title="Change server address" variant="secondary" onPress={() => router.push('/server')} />
        <Button title="Log out" variant="danger" onPress={logout} />
      </Section>
    </Screen>
  );
}
