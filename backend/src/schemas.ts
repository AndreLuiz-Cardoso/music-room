import { Type, type TSchema, type Static } from '@sinclair/typebox';

// Validate inputs, filter outputs (undeclared fields are never sent) and generate the OpenAPI doc.

export const Nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);

export const Id = Type.String({ minLength: 1, maxLength: 64 });
export const IdParams = Type.Object({ id: Id });
/** Output dates: Prisma gives Date objects, serialized as ISO 8601 strings. */
export const DateTime = Type.Unsafe<Date | string>({ type: 'string', format: 'date-time' });
export const DateTimeInput = Type.String({ format: 'date-time' });

export const ErrorResponse = Type.Object(
  { error: Type.String({ description: 'Machine readable code' }), message: Type.String() },
  { description: 'Error' },
);

export const Message = Type.Object({ message: Type.String() });

export const Visibility = Type.Union([Type.Literal('PUBLIC'), Type.Literal('PRIVATE')]);
export const EventLicense = Type.Union([
  Type.Literal('EVERYONE'),
  Type.Literal('INVITED_ONLY'),
  Type.Literal('LOCATION_TIME'),
]);
export const PlaylistLicense = Type.Union([Type.Literal('EVERYONE'), Type.Literal('INVITED_ONLY')]);

export const Email = Type.String({ format: 'email', maxLength: 254 });
export const Password = Type.String({
  minLength: 8,
  maxLength: 128,
  pattern: '^(?=.*[A-Za-z])(?=.*[0-9]).+$',
  description: '8 to 128 characters, at least one letter and one digit',
});

export const GeoInput = Type.Object({
  latitude: Type.Number({ minimum: -90, maximum: 90 }),
  longitude: Type.Number({ minimum: -180, maximum: 180 }),
});

/** The lists of events and playlists. */
export const ListQuery = Type.Object({
  filter: Type.Optional(Type.Union([Type.Literal('all'), Type.Literal('mine'), Type.Literal('invited')], { default: 'all' })),
  q: Type.Optional(Type.String({ maxLength: 100, description: 'Name search' })),
});

export const UserSummary = Type.Object({
  id: Type.String(),
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
});
export type UserSummaryT = Static<typeof UserSummary>;

/** A user in search results and friend lists, which show their music taste. */
export const UserCard = Type.Object({ ...UserSummary.properties, musicPreferences: Type.Array(Type.String()) });

const ProfileFields = {
  displayName: Type.String(),
  avatarUrl: Nullable(Type.String()),
  bio: Nullable(Type.String()),
  musicPreferences: Type.Array(Type.String()),
  friendsInfo: Nullable(Type.String({ description: 'Only returned to friends and to the user' })),
  privateInfo: Nullable(Type.String({ description: 'Only returned to the user' })),
};

export const Me = Type.Object({
  id: Type.String(),
  email: Type.String(),
  emailVerified: Type.Boolean(),
  ...ProfileFields,
  hasPassword: Type.Boolean(),
  linkedProviders: Type.Object({ google: Type.Boolean(), facebook: Type.Boolean() }),
  createdAt: DateTime,
});

export const Relation = Type.Union([
  Type.Literal('self'),
  Type.Literal('friend'),
  Type.Literal('request_sent'),
  Type.Literal('request_received'),
  Type.Literal('none'),
]);

export const Profile = Type.Object({
  id: Type.String(),
  ...ProfileFields,
  relation: Relation,
});

export const SessionResponse = Type.Object({
  accessToken: Type.String(),
  refreshToken: Type.String(),
  expiresIn: Type.Integer({ description: 'Access token lifetime in seconds' }),
  user: Me,
});

const CatalogFields = {
  title: Type.String(),
  artist: Type.String(),
  album: Nullable(Type.String()),
  coverUrl: Nullable(Type.String()),
  previewUrl: Nullable(Type.String()),
  durationSec: Type.Integer(),
};

export const Track = Type.Object({
  id: Type.String({ description: 'Catalog id, e.g. deezer:3135556' }),
  ...CatalogFields,
});

/** A catalog track stored in an event queue or a playlist (its own id is the entry's). */
const TrackFields = { trackId: Type.String(), ...CatalogFields };

export const EventTrack = Type.Object({
  id: Type.String({ description: 'Queue entry id' }),
  ...TrackFields,
  score: Type.Integer(),
  status: Type.Union([Type.Literal('QUEUED'), Type.Literal('PLAYING'), Type.Literal('PLAYED')]),
  createdAt: DateTime,
});

/** Everyone sees the size of the vote area; only the owner gets its coordinates (for the edit form). */
export const EventLocation = Type.Object({
  latitude: Type.Optional(Type.Number({ description: 'Owner only' })),
  longitude: Type.Optional(Type.Number({ description: 'Owner only' })),
  radiusMeters: Type.Integer(),
});
export const VoteWindow = Type.Object({ startsAt: DateTime, endsAt: DateTime });

const EventCommon = {
  id: Type.String(),
  name: Type.String(),
  description: Nullable(Type.String()),
  owner: UserSummary,
  visibility: Visibility,
  license: EventLicense,
  voteWindow: Nullable(VoteWindow),
  createdAt: DateTime,
};

export const EventSummary = Type.Object({
  ...EventCommon,
  isOwner: Type.Boolean(),
  isInvited: Type.Boolean(),
});

export const EventState = Type.Object({
  ...EventCommon,
  location: Nullable(EventLocation),
  version: Type.Integer({ description: 'Incremented on every change, lets clients drop stale updates' }),
  nowPlaying: Nullable(EventTrack),
  queue: Type.Array(EventTrack, { description: 'Sorted by score desc, then suggestion time' }),
});

export const EventDetail = Type.Object({
  ...EventState.properties,
  isOwner: Type.Boolean(),
  isInvited: Type.Boolean(),
  myVotes: Type.Array(Type.String(), { description: 'Queue entry ids the user voted for' }),
  canVote: Type.Boolean(),
  voteDeniedReason: Nullable(Type.String()),
  requiresLocation: Type.Boolean(),
});

export const PlaylistTrack = Type.Object({
  id: Type.String({ description: 'Playlist entry id' }),
  position: Type.Integer(),
  ...TrackFields,
});

const PlaylistCommon = {
  id: Type.String(),
  name: Type.String(),
  description: Nullable(Type.String()),
  owner: UserSummary,
  visibility: Visibility,
  license: PlaylistLicense,
  version: Type.Integer(),
  updatedAt: DateTime,
};

export const PlaylistSummary = Type.Object({
  ...PlaylistCommon,
  trackCount: Type.Integer(),
  isOwner: Type.Boolean(),
  isInvited: Type.Boolean(),
});

export const PlaylistState = Type.Object({ ...PlaylistCommon, tracks: Type.Array(PlaylistTrack) });

export const PlaylistDetail = Type.Object({
  ...PlaylistState.properties,
  isOwner: Type.Boolean(),
  isInvited: Type.Boolean(),
  canEdit: Type.Boolean(),
});

export const PlaybackTrack = Type.Object({
  id: Type.String(),
  title: Type.String(),
  artist: Type.String(),
  coverUrl: Nullable(Type.String()),
  previewUrl: Nullable(Type.String()),
  durationSec: Type.Integer(),
});

export const Playback = Type.Object({
  queue: Type.Array(PlaybackTrack),
  index: Type.Integer(),
  isPlaying: Type.Boolean(),
  volume: Type.Integer({ minimum: 0, maximum: 100 }),
});

export const Delegation = Type.Object({
  user: UserSummary,
  expiresAt: Nullable(DateTime),
  createdAt: DateTime,
});

export const DeviceState = Type.Object({
  id: Type.String(),
  name: Type.String(),
  owner: UserSummary,
  playback: Playback,
  version: Type.Integer(),
});

export const DeviceDetail = Type.Object({
  ...DeviceState.properties,
  isOwner: Type.Boolean(),
  delegations: Type.Array(Delegation, { description: 'Only filled for the owner' }),
});

export const errors = (...codes: number[]) =>
  Object.fromEntries(codes.map((c) => [c, ErrorResponse])) as Record<number, typeof ErrorResponse>;
