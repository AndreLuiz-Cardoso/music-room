import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Body, Button, Choice, Cover, Empty, ErrorText, Input, Loading, Row, Screen, Section, TrackLine } from '@/components/ui';
import { TrackPicker, UserPicker } from '@/components/pickers';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { attempt, confirm, notify, useLoader } from '@/lib/hooks';
import { newer, useRealtime } from '@/lib/realtime';
import type { DeviceAction, DeviceDetail, DeviceState } from '@/lib/types';

type Duration = 'forever' | '1h' | '1d' | '1w';
const durations: Record<Duration, number | null> = { forever: null, '1h': 3600_000, '1d': 86_400_000, '1w': 7 * 86_400_000 };

/** Remote control of a device: the owner's, or one a friend delegated to me. */
export default function DeviceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { deviceId } = useAuth();
  const { data: device, setData, error } = useLoader(() => api.devices.get(id), [id]);
  const [picking, setPicking] = useState(false);
  const [delegating, setDelegating] = useState(false);
  const [duration, setDuration] = useState<Duration>('forever');
  const [name, setName] = useState<string | null>(null);

  const apply = (next: DeviceDetail) => setData((c) => (newer(c, next) ? next : c));
  useRealtime<DeviceState>(`device:${id}`, 'device:state', (s) => setData((c) => (c && newer(c, s) ? { ...c, ...s } : c)));
  useRealtime(`device:${id}`, 'device:deleted', () => router.back());

  if (error && !device) return <Screen><ErrorText>{error}</ErrorText></Screen>;
  if (!device) return <Loading />;

  const send = (action: DeviceAction, extra?: Parameters<typeof api.devices.command>[2]) =>
    api.devices.command(id, action, extra).then(apply).catch((err) => notify('Error', errorMessage(err)));
  const { playback } = device;
  const track = playback.queue[playback.index];

  async function delegate(userId: string) {
    setDelegating(false);
    const ms = durations[duration];
    const res = await attempt(() => api.devices.delegate(id, userId, ms ? new Date(Date.now() + ms).toISOString() : null));
    if (res) apply(res);
  }

  async function remove() {
    if (!(await confirm('Detach this device?', 'Its delegations will be revoked.'))) return;
    try {
      await api.devices.remove(id);
      router.back();
    } catch (err) {
      notify('Error', errorMessage(err));
    }
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: device.name }} />
      <Body muted>
        {[device.platform, device.model, device.appVersion && `v${device.appVersion}`].filter(Boolean).join(' · ')}
        {device.isOwner ? '' : ` · shared by ${device.owner.displayName}`}
        {device.id === deviceId ? ' · this device' : ''}
      </Body>

      <Section title="Now playing">
        {track ? (
          <Row>
            <Cover uri={track.coverUrl} size={72} />
            <Body style={{ flex: 1 }}>
              {track.title}
              {'\n'}
              <Body muted>{track.artist}</Body>
            </Body>
          </Row>
        ) : (
          <Empty text="Nothing loaded: pick a track or play a playlist" />
        )}
        <Row style={{ marginTop: 12 }}>
          <Button small variant="secondary" title="⏮" onPress={() => send('PREVIOUS')} />
          <Button small title={playback.isPlaying ? '❚❚ Pause' : '▶ Play'} onPress={() => send(playback.isPlaying ? 'PAUSE' : 'PLAY')} />
          <Button small variant="secondary" title="⏭" onPress={() => send('NEXT')} />
        </Row>
        <Row style={{ marginTop: 12 }}>
          <Body>Volume {playback.volume}%</Body>
          <Button small variant="secondary" title="−" onPress={() => send('SET_VOLUME', { volume: Math.max(0, playback.volume - 10) })} />
          <Button small variant="secondary" title="+" onPress={() => send('SET_VOLUME', { volume: Math.min(100, playback.volume + 10) })} />
        </Row>
        <Button title="Play a track" variant="secondary" onPress={() => setPicking(true)} />
      </Section>

      {playback.queue.length > 1 ? (
        <Section title="Queue">
          {playback.queue.map((t, i) => (
            <TrackLine key={`${t.id}-${i}`} title={t.title} artist={t.artist} coverUrl={t.coverUrl} highlight={i === playback.index} />
          ))}
        </Section>
      ) : null}

      {device.isOwner ? (
        <>
          <Section title="Friends who can control this device">
            {device.delegations.length === 0 ? <Empty text="Nobody but you" /> : null}
            {device.delegations.map((d) => (
              <Row key={d.user.id} style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <Body>
                  {d.user.displayName}
                  <Body muted>{d.expiresAt ? ` until ${new Date(d.expiresAt).toLocaleString()}` : ' (no limit)'}</Body>
                </Body>
                <Button small variant="secondary" title="Revoke" onPress={() => attempt(() => api.devices.revoke(id, d.user.id)).then((r) => r && apply(r))} />
              </Row>
            ))}
            <Choice
              label="Duration of the delegation"
              value={duration}
              onChange={setDuration}
              options={[
                { value: 'forever', label: 'Until revoked' },
                { value: '1h', label: '1 hour' },
                { value: '1d', label: '1 day' },
                { value: '1w', label: '1 week' },
              ]}
            />
            <Button title="Give control to a friend" onPress={() => setDelegating(true)} />
          </Section>
          <Section title="Device">
            <Input placeholder={device.name} value={name ?? ''} onChangeText={setName} autoCapitalize="sentences" />
            <Button small variant="secondary" title="Rename" disabled={!name?.trim()} onPress={() => attempt(() => api.devices.rename(id, name!.trim())).then((r) => r && apply(r))} />
            <Button title="Detach from my account" variant="danger" onPress={remove} />
          </Section>
        </>
      ) : null}

      <TrackPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(t) => {
          setPicking(false);
          void send('PLAY_TRACK', { trackId: t.id });
        }}
      />
      <UserPicker
        visible={delegating}
        friendsOnly
        title="Give control to"
        exclude={device.delegations.map((d) => d.user.id)}
        onClose={() => setDelegating(false)}
        onPick={(u) => delegate(u.id)}
      />
    </Screen>
  );
}
