import { router } from 'expo-router';
import { Text } from 'react-native';
import { Badge, Body, Card, Empty, ErrorText, Loading, Row, Screen, Section, Title, colors } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useLoader } from '@/lib/hooks';
import { useUserEvent } from '@/lib/realtime';
import type { DeviceState } from '@/lib/types';

function DeviceCard({ d, thisDevice }: { d: DeviceState; thisDevice?: boolean }) {
  const track = d.playback.queue[d.playback.index];
  return (
    <Card onPress={() => router.push(`/device/${d.id}`)}>
      <Row>
        <Text style={{ color: colors.text, fontSize: 16, fontWeight: '700' }}>{d.name}</Text>
        {thisDevice ? <Badge text="this device" color={colors.accent} /> : null}
      </Row>
      <Body muted>
        {[d.platform, d.model].filter(Boolean).join(' · ') || 'unknown device'}
        {d.owner ? ` · ${d.owner.displayName}` : ''}
      </Body>
      <Body muted>{track ? `${d.playback.isPlaying ? '▶' : '❚❚'} ${track.title} - ${track.artist}` : 'Nothing playing'}</Body>
    </Card>
  );
}

export default function DevicesScreen() {
  const { deviceId } = useAuth();
  const { data, error, loading, reload } = useLoader(() => api.devices.list());
  // a friend gave or revoked a delegation
  useUserEvent('devices:changed', () => void reload());

  return (
    <Screen>
      <Title>Music Control Delegation</Title>
      <Body muted>Control your devices, and let friends control them, device by device.</Body>
      <ErrorText>{error}</ErrorText>
      {loading && !data ? <Loading /> : null}
      <Section title="My devices">
        {data?.owned.length === 0 ? <Empty text="No device" /> : null}
        {data?.owned.map((d) => <DeviceCard key={d.id} d={d} thisDevice={d.id === deviceId} />)}
      </Section>
      <Section title="Shared with me">
        {data?.delegated.length === 0 ? <Empty text="No friend shared a device with you" /> : null}
        {data?.delegated.map((d) => <DeviceCard key={d.id} d={d} />)}
      </Section>
    </Screen>
  );
}
