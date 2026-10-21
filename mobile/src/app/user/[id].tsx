import { Stack, useLocalSearchParams } from 'expo-router';
import { Body, Button, ErrorText, Loading, Screen, Section } from '@/components/ui';
import { api } from '@/lib/api';
import { attempt, useLoader } from '@/lib/hooks';

const relationLabel = {
  self: 'This is you',
  friend: 'Friend',
  request_sent: 'Friend request sent',
  request_received: 'Wants to be your friend',
  none: '',
};

export default function UserScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: profile, error, reload } = useLoader(() => api.users.get(id), [id]);

  if (error && !profile) return <Screen><ErrorText>{error}</ErrorText></Screen>;
  if (!profile) return <Loading />;

  return (
    <Screen>
      <Stack.Screen options={{ title: profile.displayName }} />
      <Body muted>{relationLabel[profile.relation]}</Body>
      {profile.relation === 'none' || profile.relation === 'request_received' ? (
        <Button
          title={profile.relation === 'none' ? 'Add as friend' : 'Accept'}
          onPress={() => attempt(() => api.friends.request(id)).then(reload)}
        />
      ) : null}
      <Section title="About">
        <Body>{profile.bio || '—'}</Body>
      </Section>
      <Section title="Music">
        <Body>{profile.musicPreferences.join(', ') || '—'}</Body>
      </Section>
      <Section title="For friends">
        <Body muted={profile.friendsInfo === null}>{profile.friendsInfo ?? 'Only visible to friends'}</Body>
      </Section>
      {profile.relation === 'self' ? (
        <Section title="Private">
          <Body>{profile.privateInfo || '—'}</Body>
        </Section>
      ) : null}
    </Screen>
  );
}
