// Ramp-up measurement of the three services.
//
// Start the API with the offline catalog and a high rate limit (the limit is per IP and
// the benchmark comes from a single IP):
//   TRACK_CATALOG=fake RATE_LIMIT_MAX=100000000 npm start
// then, in another terminal:
//   npm run load                      (defaults: 20s per step, steps of 10/50/100/200 connections)
//   LOAD_URL=http://host:3000 LOAD_DURATION=30 LOAD_STEPS=50,100,400 npm run load
//
// Users, an event, a playlist and a device are seeded directly in the database; each
// request picks a random user so that the votes are spread like in real life.
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import autocannon from 'autocannon';
import { prisma } from '../src/db';
import { signAccessToken } from '../src/auth/tokens';
import { initialPlayback } from '../src/domain/playback';
import { pairKey } from '../src/services/users';

const BASE = process.env.LOAD_URL ?? 'http://localhost:3000';
const DURATION = Number(process.env.LOAD_DURATION ?? 20);
const STEPS = (process.env.LOAD_STEPS ?? '10,50,100,200').split(',').map(Number);
const USERS = 500;
const TRACKS = 50;

interface Seed {
  tokens: string[];
  eventId: string;
  entryIds: string[];
  playlistId: string;
  playlistEntryIds: string[];
  deviceId: string;
}

async function seed(): Promise<Seed> {
  const run = Date.now().toString(36);
  await prisma.user.createMany({
    data: Array.from({ length: USERS }, (_, i) => ({
      email: `load-${run}-${i}@load.test`,
      displayName: `load${i}`,
      emailVerified: true,
    })),
  });
  const users = await prisma.user.findMany({ where: { email: { startsWith: `load-${run}-` } }, select: { id: true } });
  const owner = users[0].id;

  const event = await prisma.event.create({ data: { name: `load ${run}`, ownerId: owner } });
  const tracks = Array.from({ length: TRACKS }, (_, i) => ({
    trackId: `fake:${i + 1}`,
    title: `Track ${i + 1}`,
    artist: 'Load',
    durationSec: 180,
    suggestedById: owner,
  }));
  await prisma.eventTrack.createMany({ data: tracks.map((t) => ({ ...t, eventId: event.id })) });
  const entries = await prisma.eventTrack.findMany({ where: { eventId: event.id }, select: { id: true } });

  const playlist = await prisma.playlist.create({ data: { name: `load ${run}`, ownerId: owner } });
  await prisma.playlistTrack.createMany({
    data: tracks.map(({ suggestedById, ...t }, position) => ({ ...t, position, playlistId: playlist.id, addedById: suggestedById })),
  });
  const playlistEntries = await prisma.playlistTrack.findMany({ where: { playlistId: playlist.id }, select: { id: true } });

  // the device of user 0 is delegated to its 50 first friends
  const device = await prisma.device.create({
    data: { ownerId: owner, installationId: `load-${run}`, name: 'load', playback: initialPlayback as object },
  });
  const delegates = users.slice(1, 51);
  await prisma.friendship.createMany({
    data: delegates.map((u) => ({ ...pairKey(owner, u.id), requesterId: owner, status: 'ACCEPTED' as const })),
  });
  await prisma.deviceDelegation.createMany({ data: delegates.map((u) => ({ deviceId: device.id, delegateId: u.id })) });

  return {
    tokens: users.map((u) => signAccessToken(u.id)),
    eventId: event.id,
    entryIds: entries.map((e) => e.id),
    playlistId: playlist.id,
    playlistEntryIds: playlistEntries.map((e) => e.id),
    deviceId: device.id,
  };
}

const pick = <T>(list: T[]) => list[Math.floor(Math.random() * list.length)];

type Scenario = { name: string; request: () => { method: 'GET' | 'POST'; path: string; body?: string; token: string } };

function scenarios(s: Seed): Scenario[] {
  const delegateTokens = s.tokens.slice(0, 51);
  return [
    { name: 'GET event queue', request: () => ({ method: 'GET', path: `/events/${s.eventId}`, token: pick(s.tokens) }) },
    {
      name: 'Track Vote: vote',
      request: () => ({ method: 'POST', path: `/events/${s.eventId}/tracks/${pick(s.entryIds)}/vote`, body: '{}', token: pick(s.tokens) }),
    },
    {
      name: 'Playlist Editor: move',
      request: () => ({
        method: 'POST',
        path: `/playlists/${s.playlistId}/tracks/${pick(s.playlistEntryIds)}/move`,
        body: JSON.stringify({ afterEntryId: Math.random() < 0.1 ? null : pick(s.playlistEntryIds) }),
        token: pick(s.tokens),
      }),
    },
    {
      name: 'Control Delegation: command',
      request: () => ({
        method: 'POST',
        path: `/devices/${s.deviceId}/commands`,
        body: JSON.stringify({ action: 'SET_VOLUME', volume: Math.floor(Math.random() * 100) }),
        token: pick(delegateTokens),
      }),
    },
  ];
}

async function measure(sc: Scenario, connections: number) {
  const result = await autocannon({
    url: BASE,
    connections,
    duration: DURATION,
    requests: [
      {
        setupRequest: (req) => {
          const r = sc.request();
          return {
            ...req,
            method: r.method,
            path: r.path,
            body: r.body,
            headers: {
              authorization: `Bearer ${r.token}`,
              'content-type': 'application/json',
              'x-client-platform': 'loadtest',
              'x-client-device': 'autocannon',
              'x-client-version': '1.0.0',
            },
          };
        },
      },
    ],
  });
  const total = result.requests.total || 1;
  return {
    scenario: sc.name,
    connections,
    reqPerSec: Math.round(result.requests.average),
    p50: result.latency.p50,
    p99: result.latency.p99,
    errorRate: +(((result.errors + result.timeouts + result.non2xx) / total) * 100).toFixed(2),
  };
}

async function main() {
  const machine = {
    cpu: `${os.cpus()[0]?.model.trim()} x${os.cpus().length}`,
    ramGb: Math.round(os.totalmem() / 1024 ** 3),
    os: `${os.type()} ${os.release()}`,
    node: process.version,
  };
  console.log('Machine:', machine);
  const s = await seed();
  const rows = [];
  for (const sc of scenarios(s)) {
    for (const c of STEPS) {
      const row = await measure(sc, c);
      rows.push(row);
      console.log(
        `${row.scenario.padEnd(30)} ${String(c).padStart(4)} conn  ${String(row.reqPerSec).padStart(6)} req/s  p50 ${row.p50}ms  p99 ${row.p99}ms  errors ${row.errorRate}%`,
      );
    }
  }
  const out = path.resolve(__dirname, 'results.json');
  writeFileSync(out, JSON.stringify({ date: new Date().toISOString(), base: BASE, duration: DURATION, machine, rows }, null, 2));
  console.log(`Results written to ${out}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
