import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { TrackPicker, UserPicker } from '@/components/pickers';
import { Badge, Body, Button, Card, Empty, ErrorText, Loading, Row, Screen, Section, TrackLine, colors, styles } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { attempt, notify, useLoader } from '@/lib/hooks';
import { newer, useRealtime } from '@/lib/realtime';
import type { DeviceState, PlaylistDetail, PlaylistState } from '@/lib/types';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: playlist, setData, error, reload } = useLoader(() => api.playlists.get(id), [id]);
  const [picking, setPicking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [devices, setDevices] = useState<DeviceState[] | null>(null);

  const apply = (next: PlaylistDetail) => setData((c) => (newer(c, next) ? next : c));
  useRealtime<PlaylistState>(`playlist:${id}`, 'playlist:state', (s) => setData((c) => (c && newer(c, s) ? { ...c, ...s } : c)));
  useRealtime(`playlist:${id}`, 'playlist:deleted', () => {
    notify('This playlist was deleted');
    router.back();
  });

  if (error && !playlist) return <Screen><ErrorText>{error}</ErrorText></Screen>;
  if (!playlist) return <Loading />;

  async function act(action: () => Promise<PlaylistDetail>) {
    try {
      apply(await action());
    } catch (err) {
      // someone changed the playlist meanwhile: show the fresh order
      if (err instanceof ApiError && err.status === 409) void reload();
      notify('Error', errorMessage(err));
    }
  }

  const tracks = playlist.tracks;
  const moveUp = (i: number) => act(() => api.playlists.moveTrack(id, tracks[i].id, i >= 2 ? tracks[i - 2].id : null));
  const moveDown = (i: number) => act(() => api.playlists.moveTrack(id, tracks[i].id, tracks[i + 1].id));

  async function chooseDevice() {
    const list = await attempt(() => api.devices.list());
    if (list) setDevices([...list.owned, ...list.delegated]);
  }

  async function playOn(device: DeviceState) {
    setDevices(null);
    await attempt(() => api.devices.command(device.id, 'PLAY_PLAYLIST', { playlistId: id }));
  }

  return (
    <Screen>
      <Stack.Screen options={{ title: playlist.name }} />
      {playlist.description ? <Body muted>{playlist.description}</Body> : null}
      <Row style={{ marginVertical: 8 }}>
        <Badge text={playlist.visibility.toLowerCase()} color={playlist.visibility === 'PUBLIC' ? colors.accent : colors.warning} />
        <Badge text={playlist.license === 'EVERYONE' ? 'everyone edits' : 'invited editors'} />
        <Body muted>by {playlist.owner.displayName}</Body>
      </Row>
      {!playlist.canEdit ? <Text style={{ color: colors.warning }}>Read only: only invited users can edit this playlist.</Text> : null}

      <Row style={{ marginTop: 8 }}>
        {playlist.canEdit ? <Button small title="Add a track" onPress={() => setPicking(true)} /> : null}
        <Button small variant="secondary" title="Play on a device" onPress={chooseDevice} disabled={tracks.length === 0} />
        {playlist.isOwner ? (
          <>
            <Button small variant="secondary" title="Settings" onPress={() => router.push({ pathname: '/playlist/form', params: { id } })} />
            <Button small variant="secondary" title="Invite" onPress={() => setInviting(true)} />
          </>
        ) : null}
      </Row>

      <Section title={`${tracks.length} tracks`}>
        {tracks.length === 0 ? <Empty text="Empty playlist" /> : null}
        {tracks.map((t, i) => (
          <TrackLine
            key={t.id}
            title={`${i + 1}. ${t.title}`}
            artist={t.artist}
            coverUrl={t.coverUrl}
            right={
              playlist.canEdit ? (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  <Arrow label="↑" disabled={i === 0} onPress={() => moveUp(i)} />
                  <Arrow label="↓" disabled={i === tracks.length - 1} onPress={() => moveDown(i)} />
                  <Arrow label="✕" onPress={() => act(() => api.playlists.removeTrack(id, t.id))} />
                </View>
              ) : null
            }
          />
        ))}
      </Section>

      {playlist.isOwner ? <InviteList playlistId={id} /> : null}

      <TrackPicker
        visible={picking}
        onClose={() => setPicking(false)}
        onPick={(t) => {
          setPicking(false);
          void act(() => api.playlists.addTrack(id, t.id));
        }}
      />
      <UserPicker
        visible={inviting}
        title="Invite"
        onClose={() => setInviting(false)}
        onPick={(u) => {
          setInviting(false);
          void act(() => api.playlists.invite(id, u.id));
        }}
      />
      <Modal visible={!!devices} transparent animationType="fade" onRequestClose={() => setDevices(null)}>
        <View style={{ flex: 1, backgroundColor: '#000a', justifyContent: 'center', padding: 24 }}>
          <View style={[styles.card, { padding: 16 }]}>
            <Text style={styles.sectionTitle}>Play on...</Text>
            {devices?.length === 0 ? <Empty text="No device available" /> : null}
            {devices?.map((d) => (
              <Card key={d.id} onPress={() => playOn(d)}>
                <Body>{d.name}</Body>
                <Body muted>{d.owner.displayName}</Body>
              </Card>
            ))}
            <Button variant="secondary" title="Cancel" onPress={() => setDevices(null)} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

function Arrow({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}>
      <Text style={{ color: colors.text, fontSize: 18 }}>{label}</Text>
    </Pressable>
  );
}

function InviteList({ playlistId }: { playlistId: string }) {
  const { data, reload } = useLoader(() => api.playlists.invites(playlistId), [playlistId]);
  if (!data) return null;
  return (
    <Section title={`Invited (${data.length})`} right={<Button small variant="secondary" title="Refresh" onPress={reload} />}>
      {data.map((u) => (
        <Row key={u.id} style={{ justifyContent: 'space-between', marginBottom: 6 }}>
          <Body>{u.displayName}</Body>
          <Button small variant="secondary" title="Remove" onPress={() => attempt(() => api.playlists.uninvite(playlistId, u.id)).then(reload)} />
        </Row>
      ))}
    </Section>
  );
}
