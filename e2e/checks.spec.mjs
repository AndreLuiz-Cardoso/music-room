// Browser checks of the web app (Playwright Test); needs `make dev` and `make mobile` (see README).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const APP = process.env.E2E_APP_URL ?? 'http://localhost:8081';
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const accounts = (...args) => execFileSync('npx', ['tsx', 'scripts/e2e-users.ts', ...args], { cwd: backend, encoding: 'utf8' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const preview = /\/tracks\/[^/]+\/preview|dzcdn\.net\/api/;

let browser, run, password, emails, alice, bob, phone, mix, page, bobDevice;

async function api(token, method, url, body) {
  const res = await fetch(API + url, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status === 204 ? null : res.json();
}
const tokenOf = async (who) => (await api(null, 'POST', '/auth/login', { email: emails[who], password })).accessToken;
const firstTrack = async (token, q) => (await api(token, 'GET', `/tracks/search?q=${encodeURIComponent(q)}&limit=1`))[0];

// window.__sound() counts the <audio> elements that really play.
async function newPage() {
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.sound = 0;
  page.on('dialog', (d) => d.dismiss());
  await page.exposeFunction('__sound', () => page.sound++);
  await page.addInitScript(() => {
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (!this.__watched) {
        this.__watched = true;
        this.addEventListener('timeupdate', () => {
          if (!this.__t && this.currentTime > 1) {
            this.__t = 1;
            window.__sound();
          }
        });
      }
      return play.call(this);
    };
  });
  return page;
}
async function login(page, who) {
  await page.goto(`${APP}/login`, { waitUntil: 'networkidle' });
  await page.getByText('Log in', { exact: true }).first().waitFor({ timeout: 60_000 });
  await page.locator('input').nth(0).fill(emails[who]);
  await page.locator('input').nth(1).fill(password);
  await page.getByText('Log in', { exact: true }).last().click();
  await page.getByText('New event').waitFor({ timeout: 20_000 });
}
const visible = (page, text) => page.getByText(text).filter({ visible: true }).count();
/** Opens an event from a freshly loaded list (the list itself is not live). */
async function openEvent(page, name) {
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByText(name).first().click();
  await page.getByText(/Queue \(/).waitFor();
}
async function until(fn, ms = 10_000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await fn().catch(() => false)) return true;
  return false;
}
/** This browser's own device: the only one of a fresh account (only the app registers devices, not the API logins here). */
async function ownDevice(token) {
  const { owned } = await api(token, 'GET', '/devices');
  if (owned.length !== 1) throw new Error(`expected only this browser's device, got ${owned.length}`);
  return owned[0];
}

/** Passes or fails the check; its detail is shown in the report either way. */
function check(ok, detail) {
  test.info().annotations.push({ type: 'detail', description: detail });
  expect(ok, detail).toBe(true);
}

test.beforeAll(async ({ browser: shared }) => {
  browser = shared;
  ({ run, password, emails } = JSON.parse(accounts()));
  [alice, bob] = [await tokenOf('alice'), await tokenOf('bob')];
  // Alice's phone, controlled by her friend Bob; a playlist Bob can read
  phone = await api(alice, 'POST', '/devices', { installationId: `e2e-${run}-phone`, name: 'Alice phone' });
  await api(alice, 'PUT', `/devices/${phone.id}/delegations/${(await api(bob, 'GET', '/me')).id}`, {});
  mix = await api(alice, 'POST', '/playlists', { name: `e2e mix ${run}` });
  for (const q of ['take on me', 'africa toto', 'billie jean', 'smooth criminal']) {
    await api(alice, 'POST', `/playlists/${mix.id}/tracks`, { trackId: (await firstTrack(alice, q)).id });
  }
  page = await newPage();
  await login(page, 'bob');
  bobDevice = await ownDevice(bob);
});

test.afterAll(() => {
  if (run) accounts('--remove', run);
});

test('logged out, "/" shows the login screen', async () => {
  const page = await newPage();
  await page.goto(APP, { waitUntil: 'networkidle' });
  const shown = await until(async () => (await visible(page, 'Log in')) > 0, 15_000);
  check(shown && !(await page.getByText('Unmatched Route').count()), `login shown=${shown}`);
});

test('a vote appears live on another screen', async () => {
  const party = await api(alice, 'POST', '/events', { name: `e2e party ${run}` });
  const song = await firstTrack(alice, 'dancing queen');
  await api(alice, 'POST', `/events/${party.id}/tracks`, { trackId: song.id });
  await openEvent(page, `e2e party ${run}`);
  const entry = (await api(alice, 'GET', `/events/${party.id}`)).queue[0];
  await api(await tokenOf('carol'), 'POST', `/events/${party.id}/tracks/${entry.id}/vote`, {});
  const score = () => page.getByText('▲').locator('..').innerText();
  const live = await until(async () => /2/.test(await score()));
  const shown = (await score()).replace(/\s+/g, ' ');
  await page.goBack();
  check(live, `score shown=${shown}`);
});

test('own player bar ignores a friend device', async () => {
  await page.getByText('Devices', { exact: true }).last().click();
  await page.getByText('Alice phone').first().click();
  await sleep(1500);
  const song = await firstTrack(alice, 'hey jude');
  await api(alice, 'POST', `/devices/${phone.id}/commands`, { action: 'PLAY_TRACK', trackId: song.id });
  const remote = await until(async () => (await visible(page, song.title)) > 0);
  await page.goBack();
  await page.getByText('Events', { exact: true }).last().click();
  await sleep(1500);
  const ownBar = await visible(page, /preview 30s/);
  check(remote && ownBar === 0, `remote screen updated=${remote}, own bar shows it=${ownBar > 0}`);
});

test('a playlist track plays on this device', async () => {
  page.sound = 0;
  const requested = [];
  page.on('request', (r) => preview.test(r.url()) && requested.push(new URL(r.url()).pathname));
  await api(bob, 'POST', `/devices/${bobDevice.id}/commands`, { action: 'PLAY_PLAYLIST', playlistId: mix.id });
  const heard = await until(async () => page.sound > 0);
  check(heard && /^\/tracks\/.+\/preview$/.test(requested[0] ?? ''), `sound=${heard}, first request=${requested[0]}`);
});

test('a track that fails is skipped once, the next plays', async () => {
  await api(bob, 'POST', `/devices/${bobDevice.id}/commands`, { action: 'PLAY_TRACK', trackId: (await firstTrack(bob, 'imagine lennon')).id });
  await sleep(2000);
  page.sound = 0;
  let refused = 0;
  const fail = (r) => (refused++ === 0 ? r.fulfill({ status: 403, body: 'expired' }) : r.continue());
  await page.route(preview, fail);
  await api(bob, 'POST', `/devices/${bobDevice.id}/commands`, { action: 'PLAY_PLAYLIST', playlistId: mix.id });
  const heard = await until(async () => page.sound > 0);
  const index = (await api(bob, 'GET', `/devices/${bobDevice.id}`)).playback.index;
  await page.unroute(preview, fail);
  await api(bob, 'POST', `/devices/${bobDevice.id}/commands`, { action: 'PAUSE' });
  check(heard && index === 1, `device index=${index}, sound=${heard}`);
});

test('the host player skips a failing track', async () => {
  const host = await newPage();
  await login(host, 'alice');
  const name = `e2e host ${run}`;
  const ev = await api(alice, 'POST', '/events', { name });
  for (const q of ['dancing queen', 'waterloo abba']) await api(alice, 'POST', `/events/${ev.id}/tracks`, { trackId: (await firstTrack(alice, q)).id });
  const first = (await api(alice, 'POST', `/events/${ev.id}/next`)).nowPlaying;
  await openEvent(host, name);
  await host.getByText('Play here', { exact: true }).waitFor();
  let refused = 0;
  await host.route(preview, (r) => (refused++ === 0 ? r.fulfill({ status: 403, body: 'expired' }) : r.continue()));
  await host.getByText('Play here', { exact: true }).click();
  const heard = await until(async () => host.sound > 0);
  const now = (await api(alice, 'GET', `/events/${ev.id}`)).nowPlaying;
  await host.getByText('Stop playing here', { exact: true }).click().catch(() => {});
  await host.context().close();
  check(heard && now?.id !== first.id, `now playing "${now?.title}" (was "${first.title}"), sound=${heard}`);
});

test('voting unlocks when the window opens', async () => {
  const startsAt = new Date(Date.now() + 15_000);
  const name = `e2e window ${run}`;
  const ev = await api(alice, 'POST', '/events', {
    name,
    license: 'LOCATION_TIME',
    location: { latitude: 48.8966, longitude: 2.3185, radiusMeters: 100 },
    voteWindow: { startsAt: startsAt.toISOString(), endsAt: new Date(Date.now() + 3_600_000).toISOString() },
  });
  await api(alice, 'POST', `/events/${ev.id}/tracks`, { trackId: (await firstTrack(alice, 'abba')).id });
  await openEvent(page, name);
  const closed = (await visible(page, 'The vote has not started yet.')) > 0;
  const opened = await until(async () => (await visible(page, 'Suggest')) > 0, 25_000);
  await page.goBack();
  check(closed && opened, `locked before=${closed}, unlocked after=${opened}`);
});

// one Wi-Fi for the whole party: the refresh can be refused with 429
test('a refresh refused with 429 keeps the session', async () => {
  let calls = 0;
  const tooMany = (r) => (calls++, r.fulfill({ status: 429, contentType: 'application/json', body: '{"error":"RATE_LIMITED","message":"later"}' }));
  const expired = (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"INVALID_TOKEN","message":"expired"}' });
  const refreshUrl = (u) => u.pathname === '/auth/refresh';
  await page.route(refreshUrl, tooMany);
  await page.route((u) => new URL(API).port === u.port && u.pathname.startsWith('/playlists'), expired, { times: 1 });
  await page.getByText('Playlists', { exact: true }).last().click();
  await sleep(2500);
  const signedIn = (await visible(page, 'Profile')) > 0;
  await page.unroute(refreshUrl, tooMany);
  check(calls > 0 && signedIn, `refresh calls=${calls}`);
});

// every session is revoked by a password change, except the new one of this device
test('after a password change the app keeps its new session', async () => {
  await page.getByText('Profile', { exact: true }).last().click();
  const fields = page.locator('input[type="password"]');
  await fields.first().waitFor();
  await fields.first().fill(password);
  await fields.last().fill(`${password}2`);
  await page.getByText('Update password', { exact: true }).click();
  await sleep(1500);
  await page.route((u) => new URL(API).port === u.port && u.pathname.startsWith('/events'), (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"INVALID_TOKEN","message":"expired"}' }), { times: 1 });
  const refreshed = page.waitForResponse((r) => r.url().endsWith('/auth/refresh'), { timeout: 5000 }).then((r) => r.status(), () => 'none');
  await page.getByText('Events', { exact: true }).last().click();
  const stillIn = await until(async () => (await visible(page, 'New event')) > 0, 5000);
  const status = await refreshed;
  check(stillIn && status === 200, `refresh with the new session=${status}, events screen shown=${stillIn}`);
});

// subject: "all the users can find your event", even when it is not among the 100 latest
test('an event older than the 100 latest is found by its name', async () => {
  const target = `e2e findme ${run}`;
  await api(alice, 'POST', '/events', { name: target });
  for (let i = 0; i < 100; i++) await api(alice, 'POST', '/events', { name: `e2e filler ${run} ${i}` });
  await page.goto(APP, { waitUntil: 'networkidle' });
  await page.getByText('New event').waitFor();
  const inList = (await visible(page, target)) > 0;
  const search = page.getByPlaceholder('Search events by name');
  const found = (await search.count()) > 0 && (await search.fill(target), await until(async () => (await visible(page, target)) > 0));
  check(!inList && found, `in the list=${inList}, found by search=${found}`);
});

test('a playlist is found by its name', async () => {
  const name = `e2e radio ${run}`;
  await api(alice, 'POST', '/playlists', { name });
  await page.getByText('Playlists', { exact: true }).last().click();
  const search = page.getByPlaceholder('Search playlists by name');
  const hasSearch = await search.waitFor({ timeout: 10_000 }).then(() => true, () => false);
  const found = hasSearch && (await search.fill(name), await until(async () => (await visible(page, name)) > 0));
  check(found, `found by search=${found}`);
});

// the server closes the socket when its token expires; the first refresh fails on purpose
test('real time comes back after the socket expiry, even if a refresh fails', { tag: '@slow' }, async () => {
  test.setTimeout(20 * 60_000);
  const slow = await newPage();
  let calls = 0;
  await slow.route((u) => u.pathname === '/auth/refresh', (r) => (++calls === 1 ? r.fulfill({ status: 503, body: '{}' }) : r.continue()));
  const loggedIn = slow.waitForResponse((r) => r.url().endsWith('/auth/login') && r.status() === 200);
  await login(slow, 'carol');
  const carol = await loggedIn.then((r) => r.json());
  console.log(`waiting ${Math.round(carol.expiresIn / 60)} minutes for the socket token to expire...`);
  await sleep(carol.expiresIn * 1000 + 20_000);
  const token = await tokenOf('carol');
  const device = await ownDevice(token);
  const song = await firstTrack(token, 'hotel california');
  await api(token, 'POST', `/devices/${device.id}/commands`, { action: 'PLAY_TRACK', trackId: song.id });
  const live = await until(async () => (await visible(slow, song.title)) > 0, 8000);
  check(live, `refresh calls=${calls}`);
});
