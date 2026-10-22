import { api } from '@/lib/api';
import { attempt, useLoader, type useListSearch } from '@/lib/hooks';
import type { EventLicense, ListFilter, PlaylistLicense, Visibility } from '@/lib/types';
import { Badge, Body, Button, Choice, Empty, ErrorText, Input, Loading, Row, Section, space } from './ui';

// Shared by events and playlists (visibility, license, invites, list search): labels live here only.

type Kind = 'events' | 'playlists';

export const visibilityOptions: { value: Visibility; label: string }[] = [
  { value: 'PUBLIC', label: 'Everyone (public)' },
  { value: 'PRIVATE', label: 'Invited only (private)' },
];

export const playlistLicenseOptions: { value: PlaylistLicense; label: string }[] = [
  { value: 'EVERYONE', label: 'Everyone' },
  { value: 'INVITED_ONLY', label: 'Invited only' },
];

export const eventLicenseOptions: { value: EventLicense; label: string }[] = [
  ...playlistLicenseOptions,
  { value: 'LOCATION_TIME', label: 'On site, on time' },
];

const licenseBadge: { events: Record<EventLicense, string>; playlists: Record<PlaylistLicense, string> } = {
  events: { EVERYONE: 'everyone votes', INVITED_ONLY: 'invited voters', LOCATION_TIME: 'on site & on time' },
  playlists: { EVERYONE: 'everyone edits', INVITED_ONLY: 'invited editors' },
};

/** Who sees it, who votes or edits it: the same badges on the lists and on the detail screens. */
export function AccessBadges(
  props:
    | { kind: 'events'; visibility: Visibility; license: EventLicense }
    | { kind: 'playlists'; visibility: Visibility; license: PlaylistLicense },
) {
  const license = props.kind === 'events' ? licenseBadge.events[props.license] : licenseBadge.playlists[props.license];
  return (
    <>
      {/* public is the normal case: only the restriction gets a colour */}
      <Badge text={props.visibility.toLowerCase()} tone={props.visibility === 'PUBLIC' ? 'neutral' : 'warning'} />
      <Badge text={license} />
    </>
  );
}

/** The invited users of an event or a playlist, shown to its owner. */
export function InviteList({ kind, id }: { kind: Kind; id: string }) {
  const { data, reload } = useLoader(() => api[kind].invites(id), [kind, id]);
  if (!data) return null;
  return (
    <Section title={`Invited (${data.length})`} right={<Button small variant="secondary" title="Refresh" onPress={reload} />}>
      {data.map((u) => (
        <Row key={u.id} style={{ justifyContent: 'space-between', marginBottom: space.sm }}>
          <Body>{u.displayName}</Body>
          <Button small variant="secondary" title="Remove" onPress={() => attempt<unknown>(() => api[kind].uninvite(id, u.id)).then(reload)} />
        </Row>
      ))}
    </Section>
  );
}

const filterOptions: { value: ListFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'invited', label: 'Invited' },
];

type ListSearch = Pick<
  ReturnType<typeof useListSearch<unknown>>,
  'filter' | 'setFilter' | 'query' | 'setQuery' | 'q' | 'data' | 'error' | 'loading'
>;

/** The filter, the name search and the loading / empty states above a list of events or playlists. */
export function ListControls({ noun, search }: { noun: 'event' | 'playlist'; search: ListSearch }) {
  return (
    <>
      <Choice value={search.filter} onChange={search.setFilter} options={filterOptions} />
      <Input placeholder={`Search ${noun}s by name`} value={search.query} onChangeText={search.setQuery} />
      <ErrorText>{search.error}</ErrorText>
      {search.loading && !search.data ? <Loading /> : null}
      {search.data?.length === 0 ? <Empty text={search.q ? `No ${noun} with this name` : `No ${noun} yet`} /> : null}
    </>
  );
}
