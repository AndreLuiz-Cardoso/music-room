import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import jwt from 'jsonwebtoken';
import { io as connect, type Socket } from 'socket.io-client';
import { buildApp, type App } from '../src/app';
import { config } from '../src/config';
import { prisma } from '../src/db';
import { DeezerCatalog, previewAddress, type Track, type TrackCatalog } from '../src/services/catalog';
import { ConsoleMailer } from '../src/services/mailer';
import { FakeSocial, createTestApp, createUser, makeFriends, resetDb, type TestContext, type TestUser } from './helpers';

let ctx: TestContext;
const json = (res: { body: string }) => JSON.parse(res.body);

beforeAll(async () => {
  ctx = await createTestApp();
});
beforeEach(resetDb);
afterAll(async () => {
  await ctx.app.close();
});

const req = (user: TestUser, method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
  ctx.app.inject({ method, url, headers: user.auth, payload });

const users = (n: number, prefix = 'u') => Promise.all(Array.from({ length: n }, (_, i) => createUser(`${prefix}${i}`)));

describe('Music Track Vote', () => {
  async function createEvent(owner: TestUser, body: object = {}) {
    const res = await req(owner, 'POST', '/events', { name: 'Party', ...body });
    expect(res.statusCode).toBe(201);
    return json(res);
  }

  it('orders the queue by votes and plays the most voted track next', async () => {
    const [owner, a, b] = await users(3);
    const event = await createEvent(owner);
    await req(a, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1' });
    const s = json(await req(b, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:2' }));
    const entry2 = s.queue.find((t: { trackId: string }) => t.trackId === 'fake:2');
    const voted = json(await req(a, 'POST', `/events/${event.id}/tracks/${entry2.id}/vote`));
    expect(voted.queue.map((t: { trackId: string; score: number }) => [t.trackId, t.score])).toEqual([
      ['fake:2', 2],
      ['fake:1', 1],
    ]);
    expect(voted.myVotes).toContain(entry2.id);

    const next = json(await req(owner, 'POST', `/events/${event.id}/next`));
    expect(next.nowPlaying.trackId).toBe('fake:2');
    expect(next.queue).toHaveLength(1);
    expect((await req(a, 'POST', `/events/${event.id}/next`)).statusCode).toBe(403);
  });

  it('counts every vote exactly once under heavy concurrency', async () => {
    const [owner, ...voters] = await users(31);
    const event = await createEvent(owner);
    const entry = json(await req(owner, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:7' })).queue[0];

    // 30 different users vote at the same time, and each of them sends its vote 3 times
    const results = await Promise.all(
      voters.flatMap((v) => [1, 2, 3].map(() => req(v, 'POST', `/events/${event.id}/tracks/${entry.id}/vote`))),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const final = json(await req(owner, 'GET', `/events/${event.id}`));
    expect(final.queue[0].score).toBe(31);
    expect(await prisma.vote.count({ where: { eventTrackId: entry.id } })).toBe(31);
    expect(final.version).toBe(1 + 90);
  });

  it('merges simultaneous suggestions of the same track into one entry', async () => {
    const [owner, ...people] = await users(11);
    const event = await createEvent(owner);
    await Promise.all(people.map((p) => req(p, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:3' })));
    const state = json(await req(owner, 'GET', `/events/${event.id}`));
    expect(state.queue).toHaveLength(1);
    expect(state.queue[0].score).toBe(10);
  });

  it('stays consistent when votes, suggestions and "next" race on the same tracks', async () => {
    const [owner, ...people] = await users(21);
    const event = await createEvent(owner);
    for (let i = 1; i <= 3; i++) await req(owner, 'POST', `/events/${event.id}/tracks`, { trackId: `fake:${i}` });
    const queue = json(await req(owner, 'GET', `/events/${event.id}`)).queue as { id: string; trackId: string }[];

    const results = await Promise.all([
      ...people.map((p, i) => req(p, 'POST', `/events/${event.id}/tracks/${queue[i % 3].id}/vote`)),
      ...people.map((p, i) => req(p, 'POST', `/events/${event.id}/tracks`, { trackId: queue[(i + 1) % 3].trackId })),
      req(owner, 'POST', `/events/${event.id}/next`),
    ]);
    // nothing crashes: a vote that lost the race against "next" gets a clean 409
    expect(results.every((r) => r.statusCode === 200 || r.statusCode === 409)).toBe(true);

    // the stored score of every entry equals its number of vote rows
    const entries = await prisma.eventTrack.findMany({ where: { eventId: event.id }, include: { _count: { select: { votes: true } } } });
    for (const e of entries) expect(e.score).toBe(e._count.votes);
    expect(entries.filter((e) => e.status === 'PLAYING')).toHaveLength(1);
  });

  it('hides private events from non invited users', async () => {
    const [owner, guest, friend] = await users(3);
    const event = await createEvent(owner, { visibility: 'PRIVATE' });
    expect((await req(guest, 'GET', `/events/${event.id}`)).statusCode).toBe(404);
    expect(json(await req(guest, 'GET', '/events')).map((e: { id: string }) => e.id)).not.toContain(event.id);

    await req(owner, 'POST', `/events/${event.id}/invites`, { userId: friend.id });
    expect((await req(friend, 'GET', `/events/${event.id}`)).statusCode).toBe(200);
    expect((await req(friend, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1' })).statusCode).toBe(200);
  });

  it('INVITED_ONLY license: visible to all, only invited users vote', async () => {
    const [owner, guest, friend] = await users(3);
    const event = await createEvent(owner, { license: 'INVITED_ONLY' });
    await req(owner, 'POST', `/events/${event.id}/invites`, { userId: friend.id });
    const seen = json(await req(guest, 'GET', `/events/${event.id}`));
    expect(seen).toMatchObject({ canVote: false, voteDeniedReason: 'NOT_INVITED' });
    expect(json(await req(guest, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1' }))).toMatchObject({ error: 'NOT_INVITED' });
    expect((await req(friend, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1' })).statusCode).toBe(200);
  });

  it('LOCATION_TIME license: checks the place and the time window', async () => {
    const [owner, here, away] = await users(3);
    const hour = 3600_000;
    const event = await createEvent(owner, {
      license: 'LOCATION_TIME',
      location: { latitude: 48.8966, longitude: 2.3185, radiusMeters: 100 },
      voteWindow: { startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + hour).toISOString() },
    });
    const inside = await req(here, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1', latitude: 48.8967, longitude: 2.3186 });
    expect(inside.statusCode).toBe(200);
    expect(json(await req(away, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1', latitude: 45.76, longitude: 4.83 }))).toMatchObject({ error: 'OUTSIDE_AREA' });
    expect(json(await req(away, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:1' }))).toMatchObject({ error: 'LOCATION_REQUIRED' });

    await req(owner, 'PATCH', `/events/${event.id}`, {
      voteWindow: { startsAt: new Date(Date.now() - 2 * hour).toISOString(), endsAt: new Date(Date.now() - hour).toISOString() },
    });
    expect(json(await req(here, 'POST', `/events/${event.id}/tracks`, { trackId: 'fake:2', latitude: 48.8967, longitude: 2.3186 }))).toMatchObject({ error: 'VOTE_ENDED' });
  });

  it('rejects incomplete LOCATION_TIME settings and unknown tracks', async () => {
    const [owner] = await users(1);
    expect(json(await req(owner, 'POST', '/events', { name: 'x', license: 'LOCATION_TIME' }))).toMatchObject({ error: 'LOCATION_TIME_INCOMPLETE' });
    const event = await createEvent(owner);
    expect(json(await req(owner, 'POST', `/events/${event.id}/tracks`, { trackId: 'deezer:../../etc' }))).toMatchObject({ error: 'UNKNOWN_TRACK' });
  });
});

describe('Music Playlist Editor', () => {
  async function playlistWith(owner: TestUser, n: number, body: object = {}) {
    const p = json(await req(owner, 'POST', '/playlists', { name: 'Radio', ...body }));
    for (let i = 1; i <= n; i++) await req(owner, 'POST', `/playlists/${p.id}/tracks`, { trackId: `fake:${i}` });
    return json(await req(owner, 'GET', `/playlists/${p.id}`));
  }
  const order = (p: { tracks: { trackId: string }[] }) => p.tracks.map((t) => t.trackId.replace('fake:', '')).join(',');

  it('adds, moves and removes tracks', async () => {
    const [owner] = await users(1);
    const p = await playlistWith(owner, 4);
    expect(order(p)).toBe('1,2,3,4');
    const [t1, , t3] = p.tracks;
    const moved = json(await req(owner, 'POST', `/playlists/${p.id}/tracks/${t1.id}/move`, { afterEntryId: t3.id }));
    expect(order(moved)).toBe('2,3,1,4');
    const top = json(await req(owner, 'POST', `/playlists/${p.id}/tracks`, { trackId: 'fake:9', afterEntryId: null }));
    expect(order(top)).toBe('9,2,3,1,4');
    const removed = json(await req(owner, 'DELETE', `/playlists/${p.id}/tracks/${t3.id}`));
    expect(order(removed)).toBe('9,2,1,4');
    expect(removed.tracks.map((t: { position: number }) => t.position)).toEqual([0, 1, 2, 3]);
  });

  it('applies concurrent moves of different tracks and keeps positions consistent', async () => {
    const [owner, a, b] = await users(3);
    const p = await playlistWith(owner, 5);
    const [t1, t2, t3, t4, t5] = p.tracks;
    await Promise.all([
      req(a, 'POST', `/playlists/${p.id}/tracks/${t5.id}/move`, { afterEntryId: null }),
      req(b, 'POST', `/playlists/${p.id}/tracks/${t1.id}/move`, { afterEntryId: t4.id }),
    ]);
    const final = json(await req(owner, 'GET', `/playlists/${p.id}`));
    // whatever the order the server applied them in, both intentions are respected
    expect(order(final)).toBe('5,2,3,4,1');
    void t2;
    void t3;
  });

  it('keeps a dense order under a storm of concurrent random edits', async () => {
    const editors = await users(8);
    const p = await playlistWith(editors[0], 12);
    const ids: string[] = p.tracks.map((t: { id: string }) => t.id);
    const pick = () => ids[Math.floor(Math.random() * ids.length)];
    const ops = Array.from({ length: 60 }, (_, i) =>
      req(editors[i % editors.length], 'POST', `/playlists/${p.id}/tracks/${pick()}/move`, {
        afterEntryId: Math.random() < 0.2 ? null : pick(),
      }),
    );
    const results = await Promise.all(ops);
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    const final = json(await req(editors[0], 'GET', `/playlists/${p.id}`));
    expect(final.tracks.map((t: { position: number }) => t.position)).toEqual([...Array(12).keys()]);
    expect(new Set(final.tracks.map((t: { id: string }) => t.id))).toEqual(new Set(ids));
    expect(final.version).toBe(p.version + 60);
  });

  it('refuses a move whose anchor was deleted meanwhile, and duplicate adds', async () => {
    const [owner, other] = await users(2);
    const p = await playlistWith(owner, 3);
    await req(owner, 'DELETE', `/playlists/${p.id}/tracks/${p.tracks[2].id}`);
    const stale = await req(other, 'POST', `/playlists/${p.id}/tracks/${p.tracks[0].id}/move`, { afterEntryId: p.tracks[2].id });
    expect(json(stale)).toMatchObject({ error: 'ANCHOR_NOT_FOUND' });

    const both = await Promise.all([
      req(owner, 'POST', `/playlists/${p.id}/tracks`, { trackId: 'fake:50' }),
      req(other, 'POST', `/playlists/${p.id}/tracks`, { trackId: 'fake:50' }),
    ]);
    expect(both.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('enforces visibility and the editing license', async () => {
    const [owner, guest, friend] = await users(3);
    const closed = await playlistWith(owner, 1, { license: 'INVITED_ONLY' });
    expect(json(await req(guest, 'GET', `/playlists/${closed.id}`)).canEdit).toBe(false);
    expect(json(await req(guest, 'POST', `/playlists/${closed.id}/tracks`, { trackId: 'fake:2' }))).toMatchObject({ error: 'NOT_EDITOR' });
    await req(owner, 'POST', `/playlists/${closed.id}/invites`, { userId: friend.id });
    expect((await req(friend, 'POST', `/playlists/${closed.id}/tracks`, { trackId: 'fake:2' })).statusCode).toBe(200);

    const secret = await playlistWith(owner, 1, { visibility: 'PRIVATE' });
    expect((await req(guest, 'GET', `/playlists/${secret.id}`)).statusCode).toBe(404);
    expect((await req(guest, 'DELETE', `/playlists/${secret.id}`)).statusCode).toBe(404);
    expect((await req(friend, 'DELETE', `/playlists/${closed.id}`)).statusCode).toBe(403);
  });
});

async function device(owner: TestUser, installationId = 'install-0001') {
  return json(
    await ctx.app.inject({
      method: 'POST',
      url: '/devices',
      headers: { ...owner.auth, 'x-client-platform': 'android', 'x-client-device': 'Pixel' },
      payload: { installationId, name: 'Living room' },
    }),
  );
}

/** A device of `owner` that `friend` (befriended here) may control. */
async function delegatedDevice(owner: TestUser, friend: TestUser): Promise<{ id: string }> {
  await makeFriends(owner, friend);
  const d = await device(owner);
  await req(owner, 'PUT', `/devices/${d.id}/delegations/${friend.id}`, {});
  return d;
}

describe('Music Control Delegation', () => {
  it('registers devices idempotently with their platform', async () => {
    const [owner] = await users(1);
    const d1 = await device(owner);
    const d2 = await device(owner);
    expect(d1.id).toBe(d2.id);
    expect(d1.isOwner).toBe(true);
    // kept for the logs, never shown: the screens name a device by its name only
    expect(await prisma.device.findUnique({ where: { id: d1.id } })).toMatchObject({ platform: 'android', model: 'Pixel' });
    expect(d1).not.toHaveProperty('platform');
  });

  it('only friends can receive the control, per device', async () => {
    const [owner, friend, stranger] = await users(3);
    await makeFriends(owner, friend);
    const living = await device(owner, 'install-living');
    const kitchen = await device(owner, 'install-kitchen');

    expect(json(await req(owner, 'PUT', `/devices/${living.id}/delegations/${stranger.id}`, {}))).toMatchObject({ error: 'NOT_A_FRIEND' });
    await req(owner, 'PUT', `/devices/${living.id}/delegations/${friend.id}`, {});

    expect((await req(friend, 'POST', `/devices/${living.id}/commands`, { action: 'PLAY_TRACK', trackId: 'fake:4' })).statusCode).toBe(200);
    expect((await req(friend, 'POST', `/devices/${kitchen.id}/commands`, { action: 'PLAY' })).statusCode).toBe(404);
    expect((await req(stranger, 'GET', `/devices/${living.id}`)).statusCode).toBe(404);
    expect((await req(friend, 'PUT', `/devices/${living.id}/delegations/${stranger.id}`, {})).statusCode).toBe(403);

    const listed = json(await req(friend, 'GET', '/devices'));
    expect(listed.delegated.map((d: { id: string }) => d.id)).toEqual([living.id]);

    await req(owner, 'DELETE', `/devices/${living.id}/delegations/${friend.id}`);
    expect((await req(friend, 'POST', `/devices/${living.id}/commands`, { action: 'PAUSE' })).statusCode).toBe(404);
  });

  it('expired delegations give no control, unfriending revokes them', async () => {
    const [owner, friend] = await users(2);
    const d = await delegatedDevice(owner, friend);
    await prisma.deviceDelegation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await req(friend, 'POST', `/devices/${d.id}/commands`, { action: 'PLAY' })).statusCode).toBe(404);

    await req(owner, 'PUT', `/devices/${d.id}/delegations/${friend.id}`, {});
    await req(friend, 'DELETE', `/friends/${owner.id}`);
    expect(await prisma.deviceDelegation.count()).toBe(0);
  });

  it('applies concurrent commands one after the other', async () => {
    const [owner, friend] = await users(2);
    const d = await delegatedDevice(owner, friend);
    const playlist = json(await req(owner, 'POST', '/playlists', { name: 'mix' }));
    for (let i = 1; i <= 10; i++) await req(owner, 'POST', `/playlists/${playlist.id}/tracks`, { trackId: `fake:${i}` });
    await req(owner, 'POST', `/devices/${d.id}/commands`, { action: 'PLAY_PLAYLIST', playlistId: playlist.id });

    await Promise.all(
      Array.from({ length: 6 }, (_, i) => req(i % 2 ? owner : friend, 'POST', `/devices/${d.id}/commands`, { action: 'NEXT' })),
    );
    const state = json(await req(owner, 'GET', `/devices/${d.id}`));
    expect(state.playback).toMatchObject({ index: 6, isPlaying: true });
    expect(state.playback.queue).toHaveLength(10);
    expect(state.version).toBe(7);
  });
});

describe('Music previews', () => {
  /** Catalog double whose preview links change at each lookup, like Deezer's signed links. */
  class ExpiringLinks implements TrackCatalog {
    lookups = 0;
    async search() {
      return [];
    }
    async get(id: string): Promise<Track | null> {
      if (id !== 'test:1' && id !== 'test:2') return null;
      this.lookups++;
      const previewUrl = id === 'test:1' ? `https://cdn.test/1.mp3?exp=${this.lookups}` : null;
      return { id, title: id, artist: 'Artist', album: null, coverUrl: null, previewUrl, durationSec: 30 };
    }
  }

  const links = new ExpiringLinks();
  let app: App;
  beforeAll(async () => {
    app = await buildApp({ catalog: links, mailer: new ConsoleMailer(() => {}), social: new FakeSocial(), logger: false });
  });
  afterAll(async () => {
    await app.close();
  });
  const call = (user: TestUser, method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({ method, url, headers: user.auth, payload }).then((r) => JSON.parse(r.body));

  it('every stored track points to a stable address that redirects to a fresh link', async () => {
    const [owner] = await users(1);
    const event = await call(owner, 'POST', '/events', { name: 'party' });
    await call(owner, 'POST', `/events/${event.id}/tracks`, { trackId: 'test:1' });
    const playlist = await call(owner, 'POST', '/playlists', { name: 'mix' });
    await call(owner, 'POST', `/playlists/${playlist.id}/tracks`, { trackId: 'test:1' });
    const device = await call(owner, 'POST', '/devices', { installationId: 'install-preview', name: 'Phone' });
    await call(owner, 'POST', `/devices/${device.id}/commands`, { action: 'PLAY_PLAYLIST', playlistId: playlist.id });

    const stable = previewAddress('test:1', 'stored')!;
    expect(stable).toMatch(/^\/tracks\/test%3A1\/preview\?sig=[\w-]{22}$/);
    expect((await call(owner, 'GET', `/events/${event.id}`)).queue[0].previewUrl).toBe(stable);
    expect((await call(owner, 'GET', `/playlists/${playlist.id}`)).tracks[0].previewUrl).toBe(stable);
    expect((await call(owner, 'GET', `/devices/${device.id}`)).playback.queue[0].previewUrl).toBe(stable);

    // Later and tokenless, like <audio>: a fresh link (lookups 1-2 were the suggestion and the add).
    const played = await app.inject({ method: 'GET', url: stable });
    expect(played.statusCode).toBe(302);
    expect(played.headers.location).toBe('https://cdn.test/1.mp3?exp=3');
    // the web app plays it from another origin: a same-origin resource policy would block the audio
    expect(played.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });

  it('a track without preview keeps a null preview, an unknown one has no preview page', async () => {
    const [owner] = await users(1);
    const event = await call(owner, 'POST', '/events', { name: 'party' });
    await call(owner, 'POST', `/events/${event.id}/tracks`, { trackId: 'test:2' });
    expect((await call(owner, 'GET', `/events/${event.id}`)).queue[0].previewUrl).toBeNull();
    for (const url of [previewAddress('test:2', 'stored')!, previewAddress('nope', 'stored')!]) {
      const res = await app.inject({ method: 'GET', url });
      expect([res.statusCode, JSON.parse(res.body).error]).toEqual([404, 'PREVIEW_NOT_FOUND']);
    }
  });

  it('looks up only the addresses it signed: other ids never reach the catalog', async () => {
    const before = links.lookups;
    const signed = previewAddress('test:1', 'stored')!;
    for (const url of ['/tracks/test%3A1/preview', `${signed.slice(0, -1)}x`, signed.replace('test%3A1', 'test%3A2')]) {
      const res = await app.inject({ method: 'GET', url });
      expect([res.statusCode, JSON.parse(res.body).error]).toEqual([404, 'PREVIEW_NOT_FOUND']);
    }
    expect(links.lookups).toBe(before);
  });

  it('asks Deezer again for a track cached more than 10 minutes ago (its links expire after 15)', async () => {
    const start = Date.UTC(2026, 0, 1, 12);
    vi.useFakeTimers({ now: start, toFake: ['Date'] });
    let served = 0;
    vi.stubGlobal('fetch', async () => ({
      ok: true,
      json: async () => ({ id: 1, title: 'Song', duration: 30, preview: `https://cdn.test/song.mp3?exp=${++served}` }),
    }));
    try {
      const deezer = new DeezerCatalog();
      expect((await deezer.get('deezer:1'))?.previewUrl).toBe('https://cdn.test/song.mp3?exp=1');
      vi.setSystemTime(start + 5 * 60_000);
      expect((await deezer.get('deezer:1'))?.previewUrl).toBe('https://cdn.test/song.mp3?exp=1');
      vi.setSystemTime(start + 11 * 60_000);
      expect((await deezer.get('deezer:1'))?.previewUrl).toBe('https://cdn.test/song.mp3?exp=2');
    } finally {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});

describe('data about other users', () => {
  const area = { latitude: 48.8966, longitude: 2.3185, radiusMeters: 100 };
  const summary = (u: TestUser, displayName: string) => ({ id: u.id, displayName, avatarUrl: null });

  it('events: only the owner gets the coordinates, nobody learns who suggested a track', async () => {
    const [owner, guest] = await users(2);
    const ev = json(await req(owner, 'POST', '/events', { name: 'Party', location: area }));
    await req(owner, 'POST', `/events/${ev.id}/tracks`, { trackId: 'fake:1' });

    const asGuest = json(await req(guest, 'GET', `/events/${ev.id}`));
    expect(asGuest.location).toEqual({ radiusMeters: 100 });
    expect(asGuest.queue[0]).not.toHaveProperty('suggestedById');
    expect(asGuest.owner).toEqual(summary(owner, 'u0'));
    expect(json(await req(owner, 'GET', `/events/${ev.id}`)).location).toEqual(area);
    expect(json(await req(guest, 'GET', '/events'))[0]).not.toHaveProperty('location');
  });

  it('only the owner lists the invitees of an event or a playlist', async () => {
    const [owner, guest, invitee] = await users(3);
    const ev = json(await req(owner, 'POST', '/events', { name: 'Party' }));
    const priv = json(await req(owner, 'POST', '/events', { name: 'Closed', visibility: 'PRIVATE' }));
    const pl = json(await req(owner, 'POST', '/playlists', { name: 'Mix' }));
    await req(owner, 'POST', `/events/${ev.id}/invites`, { userId: invitee.id });
    await req(owner, 'POST', `/playlists/${pl.id}/invites`, { userId: invitee.id });

    for (const path of [`/events/${ev.id}/invites`, `/playlists/${pl.id}/invites`]) {
      expect((await req(guest, 'GET', path)).statusCode).toBe(403);
      expect((await req(invitee, 'GET', path)).statusCode).toBe(403);
      expect(json(await req(owner, 'GET', path))).toEqual([summary(invitee, 'u2')]);
    }
    expect((await req(guest, 'GET', `/events/${priv.id}/invites`)).statusCode).toBe(404);
  });

  it('playlists: nobody learns who added a track', async () => {
    const [owner, guest] = await users(2);
    const pl = json(await req(owner, 'POST', '/playlists', { name: 'Mix' }));
    await req(owner, 'POST', `/playlists/${pl.id}/tracks`, { trackId: 'fake:1' });

    const asGuest = json(await req(guest, 'GET', `/playlists/${pl.id}`));
    expect(asGuest.tracks[0]).not.toHaveProperty('addedById');
    expect(asGuest.owner).toEqual(summary(owner, 'u0'));
  });

  it('devices: a delegate learns nothing about the hardware, nor when it was last seen', async () => {
    const [owner, friend] = await users(2);
    const d = await delegatedDevice(owner, friend);

    const { delegated } = json(await req(friend, 'GET', '/devices'));
    for (const state of [delegated[0], json(await req(friend, 'GET', `/devices/${d.id}`))]) {
      for (const key of ['lastSeenAt', 'platform', 'model', 'appVersion']) expect(state).not.toHaveProperty(key);
      expect(state.owner).toEqual(summary(owner, 'u0'));
    }
    expect(json(await req(owner, 'GET', `/devices/${d.id}`)).delegations[0].user).toEqual(summary(friend, 'u1'));
  });

  it('search results and friend lists still show the music taste', async () => {
    const [me, other] = await users(2);
    await req(other, 'PATCH', '/me', { musicPreferences: ['jazz'] });
    await makeFriends(me, other);
    expect(json(await req(me, 'GET', '/users?genre=jazz'))[0].musicPreferences).toEqual(['jazz']);
    expect(json(await req(me, 'GET', '/friends')).friends[0].musicPreferences).toEqual(['jazz']);
  });

  it('my profile tells which providers are linked, never their ids or the lock state', async () => {
    const [me] = await users(1);
    await prisma.user.update({ where: { id: me.id }, data: { googleId: 'google-sub', failedLogins: 2, lockedUntil: new Date(0) } });
    const body = json(await req(me, 'GET', '/me'));
    expect(body.linkedProviders).toEqual({ google: true, facebook: false });
    for (const key of ['passwordHash', 'googleId', 'facebookId', 'failedLogins', 'lockedUntil']) expect(body).not.toHaveProperty(key);
  });
});

describe('real time', () => {
  let url: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await ctx.app.listen({ port: 0, host: '127.0.0.1' });
    url = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
  });
  afterAll(() => sockets.forEach((s) => s.close()));

  async function open(user: TestUser) {
    const s = connect(url, { auth: { token: user.token }, transports: ['websocket'] });
    sockets.push(s);
    await new Promise<void>((resolve, reject) => {
      s.on('connect', () => resolve());
      s.on('connect_error', reject);
    });
    return s;
  }
  const subscribe = (s: Socket, room: string) => s.emitWithAck('subscribe', room) as Promise<{ ok: boolean }>;

  it('refuses unauthenticated connections', async () => {
    const s = connect(url, { auth: { token: 'nope' }, transports: ['websocket'] });
    sockets.push(s);
    const err = await new Promise<Error>((resolve) => s.on('connect_error', resolve));
    expect(err.message).toBe('UNAUTHORIZED');
  });

  it('pushes the new queue to subscribers and protects private rooms', async () => {
    const [owner, guest] = await users(2);
    const pub = json(await req(owner, 'POST', '/events', { name: 'open' }));
    const priv = json(await req(owner, 'POST', '/events', { name: 'closed', visibility: 'PRIVATE' }));

    const s = await open(guest);
    expect(await subscribe(s, `event:${priv.id}`)).toEqual({ ok: false });
    expect(await subscribe(s, `event:${pub.id}`)).toEqual({ ok: true });

    const received = new Promise<{ queue: { trackId: string }[]; version: number }>((resolve) => s.once('event:state', resolve));
    await req(owner, 'POST', `/events/${pub.id}/tracks`, { trackId: 'fake:8' });
    const state = await received;
    expect(state.queue[0].trackId).toBe('fake:8');
    expect(state.version).toBe(1);
  });

  /** The owner's and the friend's sockets, both subscribed to the device. */
  async function bothSubscribed(owner: TestUser, friend: TestUser, deviceId: string) {
    const sockets = [await open(owner), await open(friend)];
    for (const s of sockets) expect(await subscribe(s, `device:${deviceId}`)).toEqual({ ok: true });
    return sockets;
  }

  /** Sends a command; true when the friend's socket got the new state (the owner's always does). */
  async function friendReceivesNextState(owner: TestUser, ownerSocket: Socket, friendSocket: Socket, deviceId: string) {
    let received = false;
    friendSocket.on('device:state', () => (received = true));
    const ownerGot = new Promise((resolve) => ownerSocket.once('device:state', resolve));
    await req(owner, 'POST', `/devices/${deviceId}/commands`, { action: 'SET_VOLUME', volume: 30 });
    await ownerGot;
    await new Promise((r) => setTimeout(r, 100));
    return received;
  }

  it('a delegate stops receiving the device once the delegation expired', async () => {
    const [owner, friend] = await users(2);
    const d = await delegatedDevice(owner, friend);
    const [so, sf] = await bothSubscribed(owner, friend, d.id);
    expect(await friendReceivesNextState(owner, so, sf, d.id)).toBe(true);

    await prisma.deviceDelegation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await friendReceivesNextState(owner, so, sf, d.id)).toBe(false);
  });

  it('an unfriended delegate stops receiving the device', async () => {
    const [owner, friend] = await users(2);
    const d = await delegatedDevice(owner, friend);
    const [so, sf] = await bothSubscribed(owner, friend, d.id);

    await req(owner, 'DELETE', `/friends/${friend.id}`);
    expect(await friendReceivesNextState(owner, so, sf, d.id)).toBe(false);
  });

  it('a failed access check evicts that subscriber only, the others still get the push', async () => {
    const [owner, friend] = await users(2);
    const d = await delegatedDevice(owner, friend);
    const [so, sf] = await bothSubscribed(owner, friend, d.id);

    const findUnique = prisma.device.findUnique.bind(prisma.device);
    const spy = vi.spyOn(prisma.device, 'findUnique').mockImplementation(((args: Parameters<typeof findUnique>[0]) =>
      (args.select?.delegations as { where?: { delegateId?: string } } | undefined)?.where?.delegateId === friend.id
        ? Promise.reject(new Error('connection lost'))
        : findUnique(args)) as never);
    try {
      expect(await friendReceivesNextState(owner, so, sf, d.id)).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('sends the current state on subscribe: a socket that was away catches up', async () => {
    const [owner, guest] = await users(2);
    const ev = json(await req(owner, 'POST', '/events', { name: 'missed' }));
    const priv = json(await req(owner, 'POST', '/events', { name: 'closed', visibility: 'PRIVATE' }));
    await req(owner, 'POST', `/events/${ev.id}/tracks`, { trackId: 'fake:3' }); // pushed to nobody

    const s = await open(guest);
    const states: { id: string; queue: { trackId: string }[] }[] = [];
    s.on('event:state', (state) => states.push(state));
    expect(await subscribe(s, `event:${priv.id}`)).toEqual({ ok: false });
    expect(await subscribe(s, `event:${ev.id}`)).toEqual({ ok: true });
    // sent before the ack: the state is there as soon as the subscription is
    expect(states.map((st) => [st.id, st.queue[0]?.trackId])).toEqual([[ev.id, 'fake:3']]);
  });

  it('closes the socket when its access token expires', async () => {
    const [user] = await users(1);
    const token = jwt.sign({ typ: 'access' }, config.jwtSecret, {
      subject: user.id,
      issuer: 'music-room',
      algorithm: 'HS256',
      expiresIn: 1,
    });
    const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
    sockets.push(s);
    const reason = await new Promise<string>((resolve, reject) => {
      s.on('connect_error', reject);
      s.on('disconnect', resolve);
    });
    expect(reason).toBe('io server disconnect');
  });

  it('evicts subscribers when a playlist becomes private', async () => {
    const [owner, guest] = await users(2);
    const p = json(await req(owner, 'POST', '/playlists', { name: 'soon private' }));
    const s = await open(guest);
    expect(await subscribe(s, `playlist:${p.id}`)).toEqual({ ok: true });
    await req(owner, 'PATCH', `/playlists/${p.id}`, { visibility: 'PRIVATE' });

    let leaked = false;
    s.on('playlist:state', () => (leaked = true));
    await req(owner, 'POST', `/playlists/${p.id}/tracks`, { trackId: 'fake:1' });
    await new Promise((r) => setTimeout(r, 200));
    expect(leaked).toBe(false);
  });

  it('pushes to a non-owner no more about other users than the HTTP responses', async () => {
    const [owner, guest, friend] = await users(3);
    const owners = { id: owner.id, displayName: 'u0', avatarUrl: null };
    const ev = json(await req(owner, 'POST', '/events', { name: 'Party', location: { latitude: 48.8966, longitude: 2.3185, radiusMeters: 100 } }));
    const pl = json(await req(owner, 'POST', '/playlists', { name: 'Mix' }));
    const d = await delegatedDevice(owner, friend);

    /** The push `user` receives in `room` after the owner's `change` (the snapshot comes before the ack). */
    async function pushed(user: TestUser, room: string, event: string, change: () => Promise<unknown>) {
      const s = await open(user);
      expect(await subscribe(s, room)).toEqual({ ok: true });
      const next = new Promise<Record<string, any>>((resolve) => s.once(event, resolve));
      await change();
      return next;
    }

    const eventState = await pushed(guest, `event:${ev.id}`, 'event:state', () =>
      req(owner, 'POST', `/events/${ev.id}/tracks`, { trackId: 'fake:1' }),
    );
    expect(eventState.location).toEqual({ radiusMeters: 100 });
    expect(eventState.queue[0]).not.toHaveProperty('suggestedById');
    expect(eventState.owner).toEqual(owners);

    const playlistState = await pushed(guest, `playlist:${pl.id}`, 'playlist:state', () =>
      req(owner, 'POST', `/playlists/${pl.id}/tracks`, { trackId: 'fake:1' }),
    );
    expect(playlistState.tracks[0]).not.toHaveProperty('addedById');
    expect(playlistState.owner).toEqual(owners);

    const deviceState = await pushed(friend, `device:${d.id}`, 'device:state', () =>
      req(owner, 'POST', `/devices/${d.id}/commands`, { action: 'SET_VOLUME', volume: 30 }),
    );
    for (const key of ['lastSeenAt', 'platform', 'model', 'appVersion']) expect(deviceState).not.toHaveProperty(key);
    expect(deviceState.owner).toEqual(owners);
  });
});
