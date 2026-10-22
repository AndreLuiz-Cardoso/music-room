import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { TrackPicker, UserPicker } from '@/components/pickers';
import { AccessBadges, InviteList } from '@/components/shared';
import { Body, Button, Empty, ErrorText, IconButton, Loading, Row, Screen, Section, TrackLine, colors, space, styles } from '@/components/ui';
import { api, errorMessage, type Geo } from '@/lib/api';
import { mediaUrl } from '@/lib/client';
import { notify, useLoader, useSkipUnplayable } from '@/lib/hooks';
import { currentPosition } from '@/lib/location';
import { newer, useRealtime } from '@/lib/realtime';
import type { EventDetail, EventState } from '@/lib/types';

const denial: Record<string, string> = {
  NOT_INVITED: 'Only invited users can vote in this event.',
  VOTE_NOT_STARTED: 'The vote has not started yet.',
  VOTE_ENDED: 'The vote is over.',
  OUTSIDE_AREA: 'You must be at the event location to vote.',
  LOCATION_REQUIRED: 'Allow the location access to vote in this event.',
};

/** Plays the current track of the event on the host's phone, and moves on when it ends. */
function HostPlayer({ event, onNext }: { event: EventDetail; onNext: () => void }) {
  const [on, setOn] = useState(false);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const url = mediaUrl(event.nowPlaying?.previewUrl);
  const entryId = event.nowPlaying?.id;

  useEffect(() => {
    if (on && url) {
      player.replace(url);
      player.play();
    } else player.pause();
  }, [player, on, url, entryId]);

  useEffect(() => {
    if (on && status.didJustFinish) onNext();
  }, [on, status.didJustFinish]); // eslint-disable-line react-hooks/exhaustive-deps

  useSkipUnplayable(player, entryId ?? null, !!url, on, onNext);

  // secondary: "Suggest" is the screen's one primary action
  return (
    <>
      <Button small variant="secondary" title={on ? 'Stop playing here' : 'Play here'} onPress={() => setOn(!on)} />
      <Button small variant="secondary" title="Next track" onPress={onNext} />
    </>
  );
}

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: event, setData: setEvent, error, reload } = useLoader(() => api.events.get(id), [id]);
  const [picking, setPicking] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const apply = (next: EventDetail) => setEvent((c) => (newer(c, next) ? next : c));

  // live queue: the broadcast state does not contain the per-user fields, keep ours
  useRealtime<EventState>(`event:${id}`, 'event:state', (s) => setEvent((c) => (c && newer(c, s) ? { ...c, ...s } : c)));
  useRealtime(`event:${id}`, 'event:deleted', () => {
    notify('This event was deleted');
    router.back();
  });

  // The vote window opens and closes without a request, and broadcasts lack canVote: refetch then.
  const startsAt = event?.voteWindow?.startsAt;
  const endsAt = event?.voteWindow?.endsAt;
  useEffect(() => {
    const timers = [startsAt, endsAt]
      .map((t) => (t ? new Date(t).getTime() - Date.now() + 1000 : -1))
      .filter((ms) => ms > 0 && ms < 2 ** 31 - 1)
      .map((ms) => setTimeout(reload, ms));
    return () => timers.forEach(clearTimeout);
  }, [startsAt, endsAt, reload]);

  if (error && !event) return <Screen><ErrorText>{error}</ErrorText></Screen>;
  if (!event) return <Loading />;

  async function position(): Promise<Geo | null> {
    if (!event!.requiresLocation) return null;
    const geo = await currentPosition();
    if (!geo) throw new Error(denial.LOCATION_REQUIRED);
    return geo;
  }

  async function act(key: string, action: () => Promise<EventDetail>) {
    setBusy(key);
    try {
      apply(await action());
    } catch (err) {
      notify('Error', errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const toggleVote = (entryId: string) =>
    act(entryId, async () =>
      event.myVotes.includes(entryId) ? api.events.unvote(id, entryId) : api.events.vote(id, entryId, await position()),
    );
  const suggest = (trackId: string) => {
    setPicking(false);
    return act('suggest', async () => api.events.suggest(id, trackId, await position()));
  };
  const next = () => act('next', () => api.events.next(id));

  return (
    <Screen>
      <Stack.Screen
        options={{
          title: event.name,
          headerRight: event.isOwner
            ? () => <IconButton icon="settings-outline" label="Settings" onPress={() => router.push({ pathname: '/event/form', params: { id } })} />
            : undefined,
        }}
      />
      {event.description ? <Body muted>{event.description}</Body> : null}
      <Row style={{ marginVertical: space.sm }}>
        <AccessBadges kind="events" visibility={event.visibility} license={event.license} />
        <Body muted>by {event.owner.displayName}</Body>
      </Row>
      {event.voteWindow ? (
        <Body muted>
          Vote from {new Date(event.voteWindow.startsAt).toLocaleString()} to {new Date(event.voteWindow.endsAt).toLocaleString()}
          {event.location ? `, within ${event.location.radiusMeters} m of the venue` : ''}
        </Body>
      ) : null}
      {!event.canVote && event.voteDeniedReason ? (
        <Text style={[styles.body, { color: colors.warning, marginVertical: space.sm }]}>{denial[event.voteDeniedReason] ?? event.voteDeniedReason}</Text>
      ) : null}

      {event.isOwner ? (
        <Section title="Host">
          <Row>
            <HostPlayer event={event} onNext={next} />
            <Button small variant="secondary" title="Invite" onPress={() => setInviting(true)} />
          </Row>
        </Section>
      ) : null}

      <Section title="Now playing">
        {event.nowPlaying ? (
          <TrackLine highlight title={event.nowPlaying.title} artist={event.nowPlaying.artist} coverUrl={event.nowPlaying.coverUrl} />
        ) : (
          <Empty text={event.isOwner ? 'Press "Next track" to start the most voted track' : 'Nothing yet'} />
        )}
      </Section>

      <Section
        title={`Queue (${event.queue.length})`}
        right={event.canVote ? <Button small title="Suggest" onPress={() => setPicking(true)} loading={busy === 'suggest'} /> : null}
      >
        {event.queue.length === 0 ? <Empty text="Suggest the first track!" /> : null}
        {event.queue.map((t, i) => {
          const voted = event.myVotes.includes(t.id);
          return (
            <TrackLine
              key={t.id}
              title={`${i + 1}. ${t.title}`}
              artist={t.artist}
              coverUrl={t.coverUrl}
              right={
                <Pressable
                  disabled={(!event.canVote && !voted) || busy === t.id}
                  onPress={() => toggleVote(t.id)}
                  style={{ alignItems: 'center', minWidth: 48, opacity: !event.canVote && !voted ? 0.4 : 1 }}
                >
                  <Text style={{ color: voted ? colors.accent : colors.muted, fontSize: 20 }}>▲</Text>
                  <Text style={[styles.body, styles.strong]}>{t.score}</Text>
                </Pressable>
              }
            />
          );
        })}
      </Section>

      {event.isOwner ? (
        <View style={{ marginTop: space.xl }}>
          <InviteList kind="events" id={id} />
        </View>
      ) : null}

      <TrackPicker visible={picking} onClose={() => setPicking(false)} onPick={(t) => suggest(t.id)} />
      <UserPicker
        visible={inviting}
        title="Invite"
        onClose={() => setInviting(false)}
        onPick={(u) => {
          setInviting(false);
          void act('invite', () => api.events.invite(id, u.id));
        }}
      />
    </Screen>
  );
}
