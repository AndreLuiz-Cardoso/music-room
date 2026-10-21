import { describe, expect, it } from 'vitest';
import {
  canControlDevice,
  canEditPlaylist,
  canSeeEvent,
  canSeePlaylist,
  distanceMeters,
  voteDecision,
  type EventRules,
} from '../src/domain/policies';
import { applyCommand, initialPlayback, parsePlayback, type PlaybackTrack } from '../src/domain/playback';
import { insertionIndex, moveAfter } from '../src/domain/ordering';

const paris = { latitude: 48.8566, longitude: 2.3522 };
const baseEvent: EventRules = {
  ownerId: 'owner',
  visibility: 'PUBLIC',
  license: 'EVERYONE',
  latitude: null,
  longitude: null,
  radiusMeters: null,
  voteStartsAt: null,
  voteEndsAt: null,
};
const now = new Date('2026-06-01T17:00:00Z');
const guest = { userId: 'guest', invited: false };
const invited = { userId: 'friend', invited: true };

describe('event visibility', () => {
  it('public events are visible to everyone', () => {
    expect(canSeeEvent(baseEvent, guest)).toBe(true);
  });
  it('private events are visible to the owner and invited users only', () => {
    const e = { ...baseEvent, visibility: 'PRIVATE' as const };
    expect(canSeeEvent(e, guest)).toBe(false);
    expect(canSeeEvent(e, invited)).toBe(true);
    expect(canSeeEvent(e, { userId: 'owner', invited: false })).toBe(true);
  });
});

describe('event vote license', () => {
  it('everyone votes by default', () => {
    expect(voteDecision(baseEvent, guest, now)).toEqual({ allowed: true });
  });
  it('INVITED_ONLY restricts the vote to invited users', () => {
    const e = { ...baseEvent, license: 'INVITED_ONLY' as const };
    expect(voteDecision(e, guest, now)).toEqual({ allowed: false, reason: 'NOT_INVITED' });
    expect(voteDecision(e, invited, now)).toEqual({ allowed: true });
  });
  it('a private event is closed to non invited users whatever the license', () => {
    const e = { ...baseEvent, visibility: 'PRIVATE' as const };
    expect(voteDecision(e, guest, now)).toEqual({ allowed: false, reason: 'NOT_INVITED' });
  });

  describe('LOCATION_TIME', () => {
    const e: EventRules = {
      ...baseEvent,
      license: 'LOCATION_TIME',
      ...paris,
      radiusMeters: 200,
      voteStartsAt: new Date('2026-06-01T16:00:00Z'),
      voteEndsAt: new Date('2026-06-01T18:00:00Z'),
    };
    it('allows a voter inside the area during the window', () => {
      expect(voteDecision(e, guest, now, { latitude: 48.8567, longitude: 2.3523 })).toEqual({ allowed: true });
    });
    it('refuses a voter outside the area', () => {
      expect(voteDecision(e, guest, now, { latitude: 48.87, longitude: 2.35 })).toEqual({ allowed: false, reason: 'OUTSIDE_AREA' });
    });
    it('requires a location', () => {
      expect(voteDecision(e, guest, now, null)).toEqual({ allowed: false, reason: 'LOCATION_REQUIRED' });
    });
    it('refuses before and after the window', () => {
      expect(voteDecision(e, guest, new Date('2026-06-01T15:59:00Z'), paris)).toEqual({ allowed: false, reason: 'VOTE_NOT_STARTED' });
      expect(voteDecision(e, guest, new Date('2026-06-01T18:01:00Z'), paris)).toEqual({ allowed: false, reason: 'VOTE_ENDED' });
    });
    it('always lets the owner vote', () => {
      expect(voteDecision(e, { userId: 'owner', invited: false }, new Date('2030-01-01'), null)).toEqual({ allowed: true });
    });
  });

  it('computes distances', () => {
    const london = { latitude: 51.5074, longitude: -0.1278 };
    expect(distanceMeters(paris, london) / 1000).toBeCloseTo(343.5, 0);
    expect(distanceMeters(paris, paris)).toBe(0);
  });
});

describe('playlist rules', () => {
  const p = { ownerId: 'owner', visibility: 'PUBLIC' as const, license: 'EVERYONE' as const };
  it('public + EVERYONE: everyone can see and edit', () => {
    expect(canSeePlaylist(p, guest)).toBe(true);
    expect(canEditPlaylist(p, guest)).toBe(true);
  });
  it('INVITED_ONLY: only invited users and the owner edit', () => {
    const q = { ...p, license: 'INVITED_ONLY' as const };
    expect(canSeePlaylist(q, guest)).toBe(true);
    expect(canEditPlaylist(q, guest)).toBe(false);
    expect(canEditPlaylist(q, invited)).toBe(true);
    expect(canEditPlaylist(q, { userId: 'owner', invited: false })).toBe(true);
  });
  it('private: only invited users have access', () => {
    const q = { ...p, visibility: 'PRIVATE' as const };
    expect(canSeePlaylist(q, guest)).toBe(false);
    expect(canEditPlaylist(q, guest)).toBe(false);
    expect(canEditPlaylist(q, invited)).toBe(true);
  });
});

describe('device control', () => {
  const d = { ownerId: 'owner' };
  it('owner always controls, others need a valid delegation', () => {
    expect(canControlDevice(d, 'owner', null, now)).toBe(true);
    expect(canControlDevice(d, 'friend', null, now)).toBe(false);
    expect(canControlDevice(d, 'friend', { expiresAt: null }, now)).toBe(true);
    expect(canControlDevice(d, 'friend', { expiresAt: new Date('2026-06-02') }, now)).toBe(true);
    expect(canControlDevice(d, 'friend', { expiresAt: new Date('2026-05-31') }, now)).toBe(false);
  });
});

describe('playback state machine', () => {
  const t = (id: string): PlaybackTrack => ({ id, title: id, artist: 'a', coverUrl: null, previewUrl: null, durationSec: 30 });
  const loaded = applyCommand(initialPlayback, { action: 'LOAD', queue: [t('a'), t('b'), t('c')], index: 0 });

  it('loads and plays', () => {
    expect(loaded).toMatchObject({ index: 0, isPlaying: true });
  });
  it('navigates and stops at the end', () => {
    const s = applyCommand(applyCommand(loaded, { action: 'NEXT' }), { action: 'NEXT' });
    expect(s.index).toBe(2);
    expect(applyCommand(s, { action: 'NEXT' })).toMatchObject({ index: 2, isPlaying: false });
    expect(applyCommand(loaded, { action: 'PREVIOUS' }).index).toBe(0);
  });
  it('clamps the volume and the index', () => {
    expect(applyCommand(loaded, { action: 'SET_VOLUME', volume: 250 }).volume).toBe(100);
    expect(applyCommand(initialPlayback, { action: 'LOAD', queue: [t('a')], index: 9 }).index).toBe(0);
  });
  it('cannot play an empty queue', () => {
    expect(applyCommand(initialPlayback, { action: 'PLAY' }).isPlaying).toBe(false);
  });
  it('survives a corrupted stored value', () => {
    expect(parsePlayback('garbage')).toEqual(initialPlayback);
  });
});

describe('anchor based ordering', () => {
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const ids = (l: { id: string }[] | null) => l?.map((i) => i.id).join('');

  it('moves after an anchor or to the top', () => {
    expect(ids(moveAfter(items, 'a', 'c'))).toBe('bcad');
    expect(ids(moveAfter(items, 'd', null))).toBe('dabc');
    expect(ids(moveAfter(items, 'b', 'b'))).toBe('abcd');
  });
  it('refuses a missing anchor or item', () => {
    expect(moveAfter(items, 'a', 'zz')).toBeNull();
    expect(moveAfter(items, 'zz', 'a')).toBeNull();
  });
  it('two moves of different items commute', () => {
    const first = moveAfter(moveAfter(items, 'a', 'b')!, 'd', null)!;
    const second = moveAfter(moveAfter(items, 'd', null)!, 'a', 'b')!;
    expect(ids(first)).toBe(ids(second));
  });
  it('computes insertion indexes', () => {
    expect(insertionIndex(items, undefined)).toBe(4);
    expect(insertionIndex(items, null)).toBe(0);
    expect(insertionIndex(items, 'b')).toBe(2);
    expect(insertionIndex(items, 'zz')).toBe(-1);
  });
});
