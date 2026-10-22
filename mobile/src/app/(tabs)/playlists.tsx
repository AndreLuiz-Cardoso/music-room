import { router } from 'expo-router';
import { Text } from 'react-native';
import { AccessBadges, ListControls } from '@/components/shared';
import { Body, Button, Card, Row, Screen, Title, space, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { useListSearch } from '@/lib/hooks';

export default function PlaylistsScreen() {
  const search = useListSearch(api.playlists.list);

  return (
    <Screen>
      <Title
        subtitle="Build playlists in real time with your friends."
        right={<Button small title="New playlist" onPress={() => router.push('/playlist/form')} />}
      >
        Playlists
      </Title>
      <ListControls noun="playlist" search={search} />
      {search.data?.map((p) => (
        <Card key={p.id} onPress={() => router.push(`/playlist/${p.id}`)}>
          <Text style={styles.itemTitle}>{p.name}</Text>
          {p.description ? <Body muted>{p.description}</Body> : null}
          <Row style={{ marginTop: space.sm }}>
            <AccessBadges kind="playlists" visibility={p.visibility} license={p.license} />
            <Body muted>
              {p.trackCount} tracks · {p.isOwner ? 'mine' : `by ${p.owner.displayName}`}
            </Body>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
