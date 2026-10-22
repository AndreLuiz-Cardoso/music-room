import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSession } from '../src/auth/tokens';
import { createLoggedApp, createTestApp, createUser, resetDb, type TestContext } from './helpers';

// Low limits for this file only: vi.hoisted runs before the imports above read the config.
vi.hoisted(() => {
  vi.stubEnv('RATE_LIMIT_MAX', '20');
  vi.stubEnv('AUTH_RATE_LIMIT_MAX', '3');
});
afterAll(() => vi.unstubAllEnvs());

let ctx: TestContext;

// a new app per test: the rate limit counters live in memory
beforeEach(async () => {
  await resetDb();
  ctx = await createTestApp();
});
afterEach(async () => {
  await ctx.app.close();
});

describe('rate limits', () => {
  it('a client cannot reset its counter with a forged X-Forwarded-For', async () => {
    const statuses = [];
    for (let i = 1; i <= 4; i++) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/auth/login',
        headers: { 'x-forwarded-for': `203.0.113.${i}` },
        payload: { email: 'nobody@test.local', password: 'wrong1234' },
      });
      statuses.push(res.statusCode);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('adding an access token to the login does not give a fresh counter', async () => {
    const attacker = await createUser('attacker');
    const login = (headers = {}) =>
      ctx.app.inject({ method: 'POST', url: '/auth/login', headers, payload: { email: 'victim@test.local', password: 'wrong1234' } });
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await login()).statusCode);
    statuses.push((await login(attacker.auth)).statusCode);
    expect(statuses).toEqual([401, 401, 401, 429]);
  });

  it('session refreshes are not held to the login limit (guests of one Wi-Fi refresh together)', async () => {
    const user = await createUser('guest');
    let { refreshToken } = await issueSession(user.id);
    const statuses = [];
    for (let i = 0; i < 5; i++) {
      const res = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
      statuses.push(res.statusCode);
      if (res.statusCode === 200) refreshToken = JSON.parse(res.body).refreshToken;
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200]);
  });

  it('signed-in users sharing one address each have their own counter', async () => {
    const [busy, other] = await Promise.all([createUser('busy'), createUser('other')]);
    for (let i = 0; i < 20; i++) {
      expect((await ctx.app.inject({ method: 'GET', url: '/me', headers: busy.auth })).statusCode).toBe(200);
    }
    expect((await ctx.app.inject({ method: 'GET', url: '/me', headers: busy.auth })).statusCode).toBe(429);
    expect((await ctx.app.inject({ method: 'GET', url: '/me', headers: other.auth })).statusCode).toBe(200);
  });

  it('warns once when a proxy forwards the client address but TRUST_PROXY is not set', async () => {
    const { app, logs } = await createLoggedApp();
    for (let i = 0; i < 3; i++) await app.inject({ method: 'GET', url: '/health', headers: { 'x-forwarded-for': '203.0.113.9' } });
    await app.close();
    expect(logs().split('TRUST_PROXY is not set').length - 1).toBe(1);
  });
});
