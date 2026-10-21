import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Body, Button, Card, Choice, Empty, ErrorText, Loading, Row, Screen, Title, colors } from '@/components/ui';
import { api } from '@/lib/api';
import { useLoader } from '@/lib/hooks';

type Filter = 'all' | 'mine' | 'invited';

export default function PlaylistsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error, loading } = useLoader(() => api.playlists.list(filter), [filter]);

  return (
    <Screen>
      <Title>Music Playlist Editor</Title>
      <Body muted>Build playlists in real time with your friends.</Body>
      <Button title="New playlist" onPress={() => router.push('/playlist/form')} />
      <Choice
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: 'All' },
          { value: 'mine', label: 'Mine' },
          { value: 'invited', label: 'Invited' },
        ]}
      />
      <ErrorText>{error}</ErrorText>
      {loading && !data ? <Loading /> : null}
      {data?.length === 0 ? <Empty text="No playlist yet" /> : null}
      {data?.map((p) => (
        <Card key={p.id} onPress={() => router.push(`/playlist/${p.id}`)}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{p.name}</Text>
          {p.description ? <Body muted>{p.description}</Body> : null}
          <Row style={{ marginTop: 6 }}>
            <Badge text={p.visibility.toLowerCase()} color={p.visibility === 'PUBLIC' ? colors.accent : colors.warning} />
            <Badge text={p.license === 'EVERYONE' ? 'everyone edits' : 'invited editors'} />
            <Body muted>
              {p.trackCount} tracks · {p.isOwner ? 'mine' : `by ${p.owner.displayName}`}
            </Body>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
