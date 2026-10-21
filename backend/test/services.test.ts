import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { prisma } from '../src/db';
import { createTestApp, createUser, makeFriends, resetDb, type TestContext, type TestUser } from './helpers';

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

// ---------------------------------------------------------------- Track Vote

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

// ---------------------------------------------------------------- Playlist Editor

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

// ---------------------------------------------------------------- Control Delegation

describe('Music Control Delegation', () => {
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

  it('registers devices idempotently with their platform', async () => {
    const [owner] = await users(1);
    const d1 = await device(owner);
    const d2 = await device(owner);
    expect(d1.id).toBe(d2.id);
    expect(d1).toMatchObject({ platform: 'android', model: 'Pixel', isOwner: true });
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
    await makeFriends(owner, friend);
    const d = await device(owner);
    await req(owner, 'PUT', `/devices/${d.id}/delegations/${friend.id}`, {});
    await prisma.deviceDelegation.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await req(friend, 'POST', `/devices/${d.id}/commands`, { action: 'PLAY' })).statusCode).toBe(404);

    await req(owner, 'PUT', `/devices/${d.id}/delegations/${friend.id}`, {});
    await req(friend, 'DELETE', `/friends/${owner.id}`);
    expect(await prisma.deviceDelegation.count()).toBe(0);
  });

  it('applies concurrent commands one after the other', async () => {
    const [owner, friend] = await users(2);
    await makeFriends(owner, friend);
    const d = await device(owner);
    await req(owner, 'PUT', `/devices/${d.id}/delegations/${friend.id}`, {});
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

// ---------------------------------------------------------------- Real time

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
});
