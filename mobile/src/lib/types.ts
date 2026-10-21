// Mirrors the API schemas (see docs/openapi.json or GET /docs on the back-end).

export type Visibility = 'PUBLIC' | 'PRIVATE';
export type EventLicense = 'EVERYONE' | 'INVITED_ONLY' | 'LOCATION_TIME';
export type PlaylistLicense = 'EVERYONE' | 'INVITED_ONLY';

export interface UserSummary {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  musicPreferences: string[];
}

export interface Me {
  id: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  musicPreferences: string[];
  friendsInfo: string | null;
  privateInfo: string | null;
  hasPassword: boolean;
  linkedProviders: { google: boolean; facebook: boolean };
  createdAt: string;
}

export type Relation = 'self' | 'friend' | 'request_sent' | 'request_received' | 'none';

export interface Profile {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  musicPreferences: string[];
  friendsInfo: string | null;
  privateInfo: string | null;
  relation: Relation;
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: Me;
}

export interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  durationSec: number;
}

interface TrackFields {
  trackId: string;
  title: string;
  artist: string;
  album: string | null;
  coverUrl: string | null;
  previewUrl: string | null;
  durationSec: number;
}

export interface EventTrack extends TrackFields {
  id: string;
  score: number;
  status: 'QUEUED' | 'PLAYING' | 'PLAYED';
  suggestedById: string;
  createdAt: string;
}

export interface EventLocation {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface VoteWindow {
  startsAt: string;
  endsAt: string;
}

interface EventCommon {
  id: string;
  name: string;
  description: string | null;
  owner: UserSummary;
  visibility: Visibility;
  license: EventLicense;
  location: EventLocation | null;
  voteWindow: VoteWindow | null;
  createdAt: string;
}

export interface EventSummary extends EventCommon {
  isOwner: boolean;
  isInvited: boolean;
}

export interface EventState extends EventCommon {
  version: number;
  nowPlaying: EventTrack | null;
  queue: EventTrack[];
}

export interface EventDetail extends EventState {
  isOwner: boolean;
  isInvited: boolean;
  myVotes: string[];
  canVote: boolean;
  voteDeniedReason: string | null;
  requiresLocation: boolean;
}

export interface PlaylistTrack extends TrackFields {
  id: string;
  position: number;
  addedById: string;
}

interface PlaylistCommon {
  id: string;
  name: string;
  description: string | null;
  owner: UserSummary;
  visibility: Visibility;
  license: PlaylistLicense;
  version: number;
  updatedAt: string;
}

export interface PlaylistSummary extends PlaylistCommon {
  trackCount: number;
  isOwner: boolean;
  isInvited: boolean;
}

export interface PlaylistState extends PlaylistCommon {
  tracks: PlaylistTrack[];
}

export interface PlaylistDetail extends PlaylistState {
  isOwner: boolean;
  isInvited: boolean;
  canEdit: boolean;
}

export interface PlaybackTrack {
  id: string;
  title: string;
  artist: string;
  coverUrl: string | null;
  previewUrl: string | null;
  durationSec: number;
}

export interface Playback {
  queue: PlaybackTrack[];
  index: number;
  isPlaying: boolean;
  volume: number;
}

export interface DeviceState {
  id: string;
  name: string;
  owner: UserSummary;
  platform: string | null;
  model: string | null;
  appVersion: string | null;
  playback: Playback;
  version: number;
  lastSeenAt: string;
}

export interface DeviceDetail extends DeviceState {
  isOwner: boolean;
  delegations: { user: UserSummary; expiresAt: string | null; createdAt: string }[];
}

export type DeviceAction = 'PLAY' | 'PAUSE' | 'NEXT' | 'PREVIOUS' | 'SET_VOLUME' | 'PLAY_TRACK' | 'PLAY_PLAYLIST';
