import { randomUUID } from 'node:crypto';
import { buildApp, type App } from '../src/app';
import { prisma } from '../src/db';
import { signAccessToken } from '../src/auth/tokens';
import { ConsoleMailer } from '../src/services/mailer';
import type { Provider, SocialIdentity, SocialVerifier } from '../src/services/social';
import { pairKey } from '../src/services/users';

/** Social verifier double: the "token" is a JSON-encoded identity. */
export class FakeSocial implements SocialVerifier {
  async verify(provider: Provider, credential: string): Promise<SocialIdentity> {
    return { provider, picture: null, name: null, ...JSON.parse(credential) };
  }
}

export interface TestContext {
  app: App;
  mailer: ConsoleMailer;
}

export async function createTestApp(): Promise<TestContext> {
  const mailer = new ConsoleMailer(() => {});
  const app = await buildApp({ mailer, social: new FakeSocial(), logger: false });
  await app.ready();
  return { app, mailer };
}

export async function resetDb() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "User", "RefreshToken", "OneTimeToken", "Friendship", "Event", "EventInvite", "EventTrack", "Vote", ' +
      '"Playlist", "PlaylistInvite", "PlaylistTrack", "Device", "DeviceDelegation", "ActionLog" CASCADE',
  );
}

export interface TestUser {
  id: string;
  token: string;
  auth: { authorization: string };
}

export async function createUser(name = 'user'): Promise<TestUser> {
  const user = await prisma.user.create({
    data: { email: `${name}-${randomUUID()}@test.local`, displayName: name, emailVerified: true },
  });
  const token = signAccessToken(user.id);
  return { id: user.id, token, auth: { authorization: `Bearer ${token}` } };
}

export async function makeFriends(a: TestUser, b: TestUser) {
  await prisma.friendship.create({ data: { ...pairKey(a.id, b.id), requesterId: a.id, status: 'ACCEPTED' } });
}

/** Extracts the token of the last link sent by mail. */
export function lastMailToken(mailer: ConsoleMailer): string {
  const text = mailer.sent[mailer.sent.length - 1]?.text ?? '';
  const match = /token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match) throw new Error(`no token in mail: ${text}`);
  return match[1];
}
