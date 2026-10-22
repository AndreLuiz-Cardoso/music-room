import { router } from 'expo-router';
import { Text } from 'react-native';
import { AccessBadges, ListControls } from '@/components/shared';
import { Badge, Body, Button, Card, Row, Screen, Title, space, styles } from '@/components/ui';
import { api } from '@/lib/api';
import { useListSearch } from '@/lib/hooks';

export default function EventsScreen() {
  const search = useListSearch(api.events.list);

  return (
    <Screen>
      <Title
        subtitle="Suggest tracks and vote: the most voted one plays next."
        right={<Button small title="New event" onPress={() => router.push('/event/form')} />}
      >
        Events
      </Title>
      <ListControls noun="event" search={search} />
      {search.data?.map((e) => (
        <Card key={e.id} onPress={() => router.push(`/event/${e.id}`)}>
          <Text style={styles.itemTitle}>{e.name}</Text>
          {e.description ? <Body muted>{e.description}</Body> : null}
          <Row style={{ marginTop: space.sm }}>
            <AccessBadges kind="events" visibility={e.visibility} license={e.license} />
            {e.isOwner ? <Badge text="owner" /> : <Body muted>by {e.owner.displayName}</Body>}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
