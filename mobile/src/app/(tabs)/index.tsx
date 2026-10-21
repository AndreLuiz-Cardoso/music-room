import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { Badge, Body, Button, Card, Choice, Empty, ErrorText, Loading, Row, Screen, Title, colors } from '@/components/ui';
import { api } from '@/lib/api';
import { useLoader } from '@/lib/hooks';

type Filter = 'all' | 'mine' | 'invited';

const licenseLabel = { EVERYONE: 'everyone votes', INVITED_ONLY: 'invited voters', LOCATION_TIME: 'on site & on time' };

export default function EventsScreen() {
  const [filter, setFilter] = useState<Filter>('all');
  const { data, error, loading } = useLoader(() => api.events.list(filter), [filter]);

  return (
    <Screen>
      <Title>Music Track Vote</Title>
      <Body muted>Suggest tracks and vote: the most voted one plays next.</Body>
      <Button title="New event" onPress={() => router.push('/event/form')} />
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
      {data?.length === 0 ? <Empty text="No event yet" /> : null}
      {data?.map((e) => (
        <Card key={e.id} onPress={() => router.push(`/event/${e.id}`)}>
          <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{e.name}</Text>
          {e.description ? <Body muted>{e.description}</Body> : null}
          <Row style={{ marginTop: 6 }}>
            <Badge text={e.visibility.toLowerCase()} color={e.visibility === 'PUBLIC' ? colors.accent : colors.warning} />
            <Badge text={licenseLabel[e.license]} />
            {e.isOwner ? <Badge text="owner" color={colors.text} /> : <Body muted>by {e.owner.displayName}</Body>}
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
