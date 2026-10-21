// Pure access rules for the three services. No I/O here: the routes load the facts
// (ownership, invitation, friendship...) and these functions decide.

export type Visibility = 'PUBLIC' | 'PRIVATE';
export type EventLicense = 'EVERYONE' | 'INVITED_ONLY' | 'LOCATION_TIME';
export type PlaylistLicense = 'EVERYONE' | 'INVITED_ONLY';

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface EventRules {
  ownerId: string;
  visibility: Visibility;
  license: EventLicense;
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number | null;
  voteStartsAt: Date | null;
  voteEndsAt: Date | null;
}

export interface Membership {
  userId: string;
  invited: boolean;
}

export type VoteDenial =
  | 'NOT_INVITED'
  | 'VOTE_NOT_STARTED'
  | 'VOTE_ENDED'
  | 'LOCATION_REQUIRED'
  | 'OUTSIDE_AREA';

export type Decision<R> = { allowed: true } | { allowed: false; reason: R };

const allow = { allowed: true } as const;
const deny = <R>(reason: R): Decision<R> => ({ allowed: false, reason });

const EARTH_RADIUS_M = 6_371_000;

export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** Public events are visible to everybody, private ones only to the owner and the invited users. */
export function canSeeEvent(event: Pick<EventRules, 'ownerId' | 'visibility'>, m: Membership): boolean {
  return event.visibility === 'PUBLIC' || event.ownerId === m.userId || m.invited;
}

/**
 * Who may suggest or vote. Called with `location === undefined` to compute a preview
 * (e.g. to grey out the vote buttons): the area check is then skipped.
 */
export function voteDecision(
  event: EventRules,
  m: Membership,
  now: Date,
  location?: GeoPoint | null,
): Decision<VoteDenial> {
  if (!canSeeEvent(event, m)) return deny('NOT_INVITED');
  if (event.ownerId === m.userId) return allow;
  switch (event.license) {
    case 'EVERYONE':
      return allow;
    case 'INVITED_ONLY':
      return m.invited ? allow : deny('NOT_INVITED');
    case 'LOCATION_TIME': {
      if (event.voteStartsAt && now < event.voteStartsAt) return deny('VOTE_NOT_STARTED');
      if (event.voteEndsAt && now > event.voteEndsAt) return deny('VOTE_ENDED');
      if (location === undefined) return allow;
      if (event.latitude === null || event.longitude === null || event.radiusMeters === null) return allow;
      if (location === null) return deny('LOCATION_REQUIRED');
      const center = { latitude: event.latitude, longitude: event.longitude };
      return distanceMeters(center, location) <= event.radiusMeters ? allow : deny('OUTSIDE_AREA');
    }
  }
}

export interface PlaylistRules {
  ownerId: string;
  visibility: Visibility;
  license: PlaylistLicense;
}

export function canSeePlaylist(p: Pick<PlaylistRules, 'ownerId' | 'visibility'>, m: Membership): boolean {
  return p.visibility === 'PUBLIC' || p.ownerId === m.userId || m.invited;
}

export function canEditPlaylist(p: PlaylistRules, m: Membership): boolean {
  if (!canSeePlaylist(p, m)) return false;
  if (p.ownerId === m.userId) return true;
  return p.license === 'EVERYONE' || m.invited;
}

export interface DelegationGrant {
  expiresAt: Date | null;
}

/** A device is controlled by its owner, or by a friend holding a non-expired delegation for this device. */
export function canControlDevice(
  device: { ownerId: string },
  userId: string,
  grant: DelegationGrant | null,
  now: Date,
): boolean {
  if (device.ownerId === userId) return true;
  if (!grant) return false;
  return grant.expiresAt === null || grant.expiresAt > now;
}
