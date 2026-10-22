// Load ramp-up: start the API with TRACK_CATALOG=fake and a high RATE_LIMIT_MAX (docs/RAMPUP.md).
import os from 'node:os';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import autocannon from 'autocannon';
import { io, type Socket } from 'socket.io-client';
import { prisma } from '../src/db';
import { signAccessToken } from '../src/auth/tokens';
import { initialPlayback } from '../src/domain/playback';
import { pairKey } from '../src/services/users';

const BASE = process.env.LOAD_URL ?? 'http://localhost:3000';
const DURATION = Number(process.env.LOAD_DURATION ?? 20);
const STEPS = (process.env.LOAD_STEPS ?? '10,50,100,200').split(',').map(Number);
/** Real-time steps: phones connected by WebSocket to the voted event. */
const PHONES = (process.env.LOAD_PHONES ?? '100,500,1000').split(',').map(Number);
const USERS = 500;
const TRACKS = 50;

interface Seed {
  run: string;
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
    run,
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Real-time delay: from a probe's vote to each phone receiving that queue version (or later). */
async function measureRealtime(s: Seed, phones: number) {
  const received: { version: number; at: number }[][] = Array.from({ length: phones }, () => []);
  const sockets = await Promise.all(
    Array.from(
      { length: phones },
      (_, i) =>
        new Promise<Socket>((resolve, reject) => {
          const socket = io(BASE, { auth: { token: s.tokens[i % s.tokens.length] }, transports: ['websocket'], reconnection: false });
          socket.on('event:state', (state: { version: number }) => received[i].push({ version: state.version, at: performance.now() }));
          socket.on('connect_error', reject);
          socket.on('connect', () => socket.emit('subscribe', `event:${s.eventId}`, () => resolve(socket)));
        }),
    ),
  );

  const probes: { version: number; at: number }[] = [];
  const probeToken = s.tokens[s.tokens.length - 1];
  let vote = true;
  const probing = setInterval(async () => {
    const sent = performance.now();
    const res = await fetch(`${BASE}/events/${s.eventId}/tracks/${s.entryIds[0]}/vote`, {
      method: vote ? 'POST' : 'DELETE',
      headers: { authorization: `Bearer ${probeToken}`, ...(vote ? { 'content-type': 'application/json' } : {}) },
      body: vote ? '{}' : undefined,
    }).catch(() => null);
    vote = !vote;
    if (res?.ok) probes.push({ version: ((await res.json()) as { version: number }).version, at: sent });
  }, 500);
  const votes = await measure(scenarios(s)[1], 50);
  clearInterval(probing);
  await sleep(3000); // the last pushes

  const delays: number[] = [];
  let missed = 0;
  for (const probe of probes) {
    for (const pushes of received) {
      const push = pushes.find((p) => p.version >= probe.version);
      if (push) delays.push(push.at - probe.at);
      else missed++;
    }
  }
  sockets.forEach((socket) => socket.close());
  delays.sort((a, b) => a - b);
  const at = (q: number) => Math.round(delays[Math.min(delays.length - 1, Math.floor(q * delays.length))] ?? 0);
  return {
    scenario: 'Real time: phones following a voted event',
    connections: phones,
    reqPerSec: votes.reqPerSec,
    p50: at(0.5),
    p99: at(0.99),
    errorRate: +((missed / Math.max(1, probes.length * phones)) * 100).toFixed(2),
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
  try {
    for (const sc of scenarios(s)) {
      for (const c of STEPS) {
        const row = await measure(sc, c);
        rows.push(row);
        console.log(
          `${row.scenario.padEnd(30)} ${String(c).padStart(4)} conn  ${String(row.reqPerSec).padStart(6)} req/s  p50 ${row.p50}ms  p99 ${row.p99}ms  errors ${row.errorRate}%`,
        );
      }
    }
    for (const phones of PHONES) {
      const row = await measureRealtime(s, phones);
      rows.push(row);
      console.log(
        `Real time: ${String(phones).padStart(5)} phones follow the event, ${row.reqPerSec} votes/s  delay p50 ${row.p50}ms  p99 ${row.p99}ms  missed ${row.errorRate}%`,
      );
    }
  } finally {
    // the seeded users take their event, playlist, device and delegations with them (cascade)
    await prisma.user.deleteMany({ where: { email: { startsWith: `load-${s.run}-` } } });
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
