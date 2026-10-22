import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp, type App } from '../src/app';
import type { Mailer } from '../src/services/mailer';
import { FakeSocial, resetDb } from './helpers';

// Production-like hash cost and a slow mail server; vi.hoisted runs before the imports read config.
vi.hoisted(() => {
  vi.stubEnv('BCRYPT_ROUNDS', '10');
});

let mailDelayMs = 0;
const slowMailer: Mailer = { send: () => new Promise((resolve) => setTimeout(resolve, mailDelayMs)) };
let app: App;

beforeAll(async () => {
  app = await buildApp({ mailer: slowMailer, social: new FakeSocial(), logger: false });
});
afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  await resetDb();
  await app.inject({ method: 'POST', url: '/auth/register', payload: { email: 'known@test.local', password: 'secret123', displayName: 'Known' } });
});

async function duration(url: string, payload: object) {
  const start = performance.now();
  const res = await app.inject({ method: 'POST', url, payload });
  return { status: res.statusCode, ms: performance.now() - start };
}

describe('the answer time does not reveal which emails have an account', () => {
  it('register', async () => {
    mailDelayMs = 0; // the password hash alone
    const known = await duration('/auth/register', { email: 'known@test.local', password: 'secret123', displayName: 'X' });
    const unknown = await duration('/auth/register', { email: 'new@test.local', password: 'secret123', displayName: 'X' });
    expect([known.status, unknown.status]).toEqual([201, 201]);
    expect(Math.abs(known.ms - unknown.ms)).toBeLessThan(Math.max(known.ms, unknown.ms) / 2);
  });

  it('forgot-password', async () => {
    mailDelayMs = 300; // the mail server
    const known = await duration('/auth/forgot-password', { email: 'known@test.local' });
    const unknown = await duration('/auth/forgot-password', { email: 'nobody@test.local' });
    expect([known.status, unknown.status]).toEqual([204, 204]);
    expect(known.ms).toBeLessThan(unknown.ms + 100);
  });
});
