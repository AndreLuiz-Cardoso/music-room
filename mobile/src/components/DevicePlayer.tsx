import { useAudioPlayer, useAudioPlayerStatus, type AudioPlayer } from 'expo-audio';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { newer, useRealtime } from '@/lib/realtime';
import type { DeviceState } from '@/lib/types';
import { Button, Cover, colors } from './ui';

/** expo-audio exposes the volume as a writable property of the native player object. */
function setVolume(player: AudioPlayer, volume: number) {
  player.volume = volume;
}

/**
 * Plays what the back-end says this device should play. Commands (from this phone or from a
 * friend holding a delegation) change the state on the server, which pushes it here.
 */
export function DevicePlayer() {
  const { deviceId } = useAuth();
  const [state, setState] = useState<DeviceState | null>(null);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    if (deviceId) api.devices.get(deviceId).then(setState).catch(() => {});
  }, [deviceId]);
  useRealtime<DeviceState>(deviceId ? `device:${deviceId}` : null, 'device:state', (s) =>
    setState((current) => (newer(current, s) ? s : current)),
  );

  const playback = state?.playback;
  const track = playback ? playback.queue[playback.index] : undefined;
  const url = track?.previewUrl ?? null;
  const index = playback?.index ?? 0;

  useEffect(() => {
    if (url) player.replace(url);
  }, [player, url, index]);

  useEffect(() => {
    setVolume(player, (playback?.volume ?? 80) / 100);
  }, [player, playback?.volume]);

  useEffect(() => {
    if (playback?.isPlaying && url) player.play();
    else player.pause();
  }, [player, playback?.isPlaying, url, index]);

  useEffect(() => {
    if (status.didJustFinish && deviceId) api.devices.command(deviceId, 'NEXT').catch(() => {});
  }, [status.didJustFinish, deviceId]);

  if (!deviceId || !track) return null;
  const send = (action: 'PLAY' | 'PAUSE' | 'NEXT') => api.devices.command(deviceId, action).then(setState).catch(() => {});

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.card,
        borderTopColor: colors.border,
        borderTopWidth: 1,
        padding: 8,
        gap: 8,
      }}
    >
      <Cover uri={track.coverUrl} size={36} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: colors.text, fontWeight: '600' }}>
          {track.title}
        </Text>
        <Text numberOfLines={1} style={{ color: colors.muted, fontSize: 12 }}>
          {track.artist} · {url ? 'preview 30s' : 'no preview available'}
        </Text>
      </View>
      <Button small variant="secondary" title={playback?.isPlaying ? 'Pause' : 'Play'} onPress={() => send(playback?.isPlaying ? 'PAUSE' : 'PLAY')} />
      <Button small variant="secondary" title="Next" onPress={() => send('NEXT')} />
    </View>
  );
}
