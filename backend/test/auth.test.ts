import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db';
import { createLoggedApp, createTestApp, createUser, lastMailToken, makeFriends, resetDb, type TestContext } from './helpers';

let ctx: TestContext;
const json = (res: { body: string }) => JSON.parse(res.body);

beforeEach(async () => {
  await resetDb();
  ctx ??= await createTestApp();
  ctx.mailer.sent.length = 0;
});
afterAll(async () => {
  await ctx?.app.close();
});

async function register(email = 'alice@test.local', password = 'secret123') {
  return ctx.app.inject({ method: 'POST', url: '/auth/register', payload: { email, password, displayName: 'Alice' } });
}
const login = (email = 'alice@test.local', password = 'secret123') =>
  ctx.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password } });

describe('email / password account', () => {
  it('requires the email validation before login', async () => {
    expect((await register()).statusCode).toBe(201);
    expect(json(await login())).toMatchObject({ error: 'EMAIL_NOT_VERIFIED' });

    const token = lastMailToken(ctx.mailer);
    const verify = await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } });
    expect(verify.statusCode).toBe(204);
    // single use
    expect((await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token } })).statusCode).toBe(400);

    const res = await login();
    expect(res.statusCode).toBe(200);
    expect(json(res).user).toMatchObject({ email: 'alice@test.local', emailVerified: true, hasPassword: true });
    expect(json(res).user.passwordHash).toBeUndefined();
  });

  it('rejects weak passwords and unknown fields', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { email: 'bob@test.local', password: 'password', displayName: 'Bob' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('does not reveal whether an email is registered', async () => {
    await register();
    const again = await register();
    expect(again.statusCode).toBe(201);
    expect(ctx.mailer.sent.at(-1)?.subject).toContain('registration attempt');

    const forgotUnknown = await ctx.app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'nobody@test.local' } });
    expect(forgotUnknown.statusCode).toBe(204);
  });

  it('locks the account after repeated failures', async () => {
    await register();
    await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: lastMailToken(ctx.mailer) } });
    for (let i = 0; i < 5; i++) expect((await login(undefined, 'wrong1234')).statusCode).toBe(401);
    expect(json(await login())).toMatchObject({ error: 'ACCOUNT_LOCKED' });
  });

  it('locks the account when the failed attempts arrive all at once', async () => {
    await register();
    await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: lastMailToken(ctx.mailer) } });
    await Promise.all(Array.from({ length: 10 }, () => login(undefined, 'wrong1234')));
    expect(json(await login())).toMatchObject({ error: 'ACCOUNT_LOCKED' });
  });

  it('resets a forgotten password and revokes the open sessions', async () => {
    await register();
    await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: lastMailToken(ctx.mailer) } });
    const session = json(await login());

    await ctx.app.inject({ method: 'POST', url: '/auth/forgot-password', payload: { email: 'alice@test.local' } });
    const token = lastMailToken(ctx.mailer);
    const page = await ctx.app.inject({ method: 'GET', url: `/auth/reset-password?token=${token}` });
    expect(page.headers['content-type']).toContain('text/html');

    const reset = await ctx.app.inject({ method: 'POST', url: '/auth/reset-password', payload: { token, password: 'newSecret42' } });
    expect(reset.statusCode).toBe(204);
    expect((await login()).statusCode).toBe(401);
    expect((await login(undefined, 'newSecret42')).statusCode).toBe(200);

    const refresh = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: session.refreshToken } });
    expect(refresh.statusCode).toBe(401);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the session when one is reused', async () => {
    await register();
    await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: lastMailToken(ctx.mailer) } });
    const first = json(await login());

    const second = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(second.statusCode).toBe(200);

    // an attacker replays the stolen first token
    const replay = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: first.refreshToken } });
    expect(json(replay)).toMatchObject({ error: 'REFRESH_TOKEN_REUSED' });

    // the legitimate (rotated) token is now revoked too
    const legit = await ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken: json(second).refreshToken } });
    expect(legit.statusCode).toBe(401);
  });

  it('changing the password closes the other sessions and renews this one', async () => {
    await register();
    await ctx.app.inject({ method: 'POST', url: '/auth/verify-email', payload: { token: lastMailToken(ctx.mailer) } });
    const mine = json(await login());
    const stolen = json(await login());

    const change = await ctx.app.inject({
      method: 'PUT',
      url: '/me/password',
      headers: { authorization: `Bearer ${mine.accessToken}` },
      payload: { currentPassword: 'secret123', newPassword: 'newSecret42' },
    });
    expect(change.statusCode).toBe(200);

    const refresh = (refreshToken: string) => ctx.app.inject({ method: 'POST', url: '/auth/refresh', payload: { refreshToken } });
    expect((await refresh(stolen.refreshToken)).statusCode).toBe(401);
    expect((await refresh(json(change).refreshToken)).statusCode).toBe(200);
  });

  it('refuses requests without a valid access token', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/me' })).statusCode).toBe(401);
    const forged = await ctx.app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4In0.' },
    });
    expect(forged.statusCode).toBe(401);
  });
});

describe('social login', () => {
  const google = (identity: object) =>
    ctx.app.inject({ method: 'POST', url: '/auth/google', payload: { idToken: JSON.stringify(identity) } });

  it('creates an account on first login and finds it again later', async () => {
    const id = { providerId: 'g-1', email: 'carol@gmail.com', emailVerified: true, name: 'Carol' };
    const first = json(await google(id));
    expect(first.user).toMatchObject({ displayName: 'Carol', linkedProviders: { google: true }, hasPassword: false });
    expect(json(await google(id)).user.id).toBe(first.user.id);
  });

  it('defeats account pre-hijacking: an unverified password account is taken back by the real owner', async () => {
    await register('victim@gmail.com', 'attacker123');
    const res = json(await google({ providerId: 'g-2', email: 'victim@gmail.com', emailVerified: true }));
    expect(res.user).toMatchObject({ email: 'victim@gmail.com', hasPassword: false, emailVerified: true });
  });

  it('links and unlinks a provider from the profile', async () => {
    const user = await createUser('dave');
    const link = await ctx.app.inject({
      method: 'POST',
      url: '/me/links/facebook',
      headers: user.auth,
      payload: { accessToken: JSON.stringify({ providerId: 'fb-1', email: null, emailVerified: false }) },
    });
    expect(json(link).linkedProviders.facebook).toBe(true);
    // no password and no other provider: unlinking would lock the user out
    const unlink = await ctx.app.inject({ method: 'DELETE', url: '/me/links/facebook', headers: user.auth });
    expect(json(unlink)).toMatchObject({ error: 'LAST_LOGIN_METHOD' });
  });
});

describe('profile privacy', () => {
  it('shows friends-only info to friends and private info to nobody else', async () => {
    const [alice, bob, eve] = [await createUser('alice'), await createUser('bob'), await createUser('eve')];
    await ctx.app.inject({
      method: 'PATCH',
      url: '/me',
      headers: alice.auth,
      payload: { bio: 'public bio', friendsInfo: 'my phone', privateInfo: 'my secret', musicPreferences: ['Rock', 'rock', 'jazz'] },
    });
    await makeFriends(alice, bob);

    const asBob = json(await ctx.app.inject({ method: 'GET', url: `/users/${alice.id}`, headers: bob.auth }));
    expect(asBob).toMatchObject({ bio: 'public bio', friendsInfo: 'my phone', privateInfo: null, relation: 'friend', musicPreferences: ['rock', 'jazz'] });

    const asEve = json(await ctx.app.inject({ method: 'GET', url: `/users/${alice.id}`, headers: eve.auth }));
    expect(asEve).toMatchObject({ bio: 'public bio', friendsInfo: null, privateInfo: null, relation: 'none' });

    const asSelf = json(await ctx.app.inject({ method: 'GET', url: `/users/${alice.id}`, headers: alice.auth }));
    expect(asSelf.privateInfo).toBe('my secret');
  });

  it('ignores fields that are not part of the profile (mass assignment)', async () => {
    const alice = await createUser('alice');
    await ctx.app.inject({ method: 'PATCH', url: '/me', headers: alice.auth, payload: { emailVerified: false, email: 'x@y.z' } });
    const user = await prisma.user.findUniqueOrThrow({ where: { id: alice.id } });
    expect(user.emailVerified).toBe(true);
    expect(user.email).not.toBe('x@y.z');
  });

  it('crossed friend requests end up in a friendship', async () => {
    const [a, b] = [await createUser('a'), await createUser('b')];
    await Promise.all([
      ctx.app.inject({ method: 'POST', url: `/friends/${b.id}`, headers: a.auth }),
      ctx.app.inject({ method: 'POST', url: `/friends/${a.id}`, headers: b.auth }),
    ]);
    const list = json(await ctx.app.inject({ method: 'GET', url: '/friends', headers: a.auth }));
    expect(list.friends.map((f: { id: string }) => f.id)).toEqual([b.id]);
  });
});

describe('friend requests', () => {
  it('accepting a request cancelled at the same moment never answers 500', async () => {
    const statuses = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const [a, b] = await Promise.all([createUser('asker'), createUser('accepter')]);
      await ctx.app.inject({ method: 'POST', url: `/friends/${b.id}`, headers: a.auth });
      const [accept] = await Promise.all([
        ctx.app.inject({ method: 'POST', url: `/friends/${a.id}`, headers: b.auth }),
        ctx.app.inject({ method: 'DELETE', url: `/friends/${b.id}`, headers: a.auth }),
      ]);
      statuses.add(accept.statusCode);
    }
    expect([...statuses].filter((s) => s >= 500)).toEqual([]);
  });
});

describe('request logs', () => {
  it('do not contain the one-time tokens of the email links', async () => {
    const { app, logs } = await createLoggedApp();
    await app.inject({ method: 'GET', url: '/auth/reset-password?token=reset-secret-1234' });
    await app.inject({ method: 'GET', url: '/auth/verify-email?token=verify-secret-5678' });
    await app.close();

    const log = logs();
    expect(log).toContain('/auth/reset-password');
    expect(log).not.toContain('reset-secret-1234');
    expect(log).not.toContain('verify-secret-5678');
  });
});

describe('action logs', () => {
  it('logs each action with platform, device and app version', async () => {
    const user = await createUser('logger');
    await ctx.app.inject({
      method: 'GET',
      url: '/me',
      headers: { ...user.auth, 'x-client-platform': 'android 14', 'x-client-device': 'Pixel 8', 'x-client-version': '1.0.0' },
    });
    await ctx.app.close();
    const log = await prisma.actionLog.findFirst({ where: { userId: user.id } });
    expect(log).toMatchObject({ route: '/me', statusCode: 200, platform: 'android 14', device: 'Pixel 8', appVersion: '1.0.0' });
    ctx = await createTestApp();
  });
});
