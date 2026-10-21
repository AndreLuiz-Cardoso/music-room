import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { prisma } from '../db';
import { unauthorized } from '../errors';

const ISSUER = 'music-room';

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

export function signAccessToken(userId: string): string {
  return jwt.sign({ typ: 'access' }, config.jwtSecret, {
    subject: userId,
    issuer: ISSUER,
    algorithm: 'HS256',
    expiresIn: config.accessTokenTtlSec,
  });
}

/** Returns the user id, or throws 401. The algorithm is pinned to refuse "alg: none" tokens. */
export function verifyAccessToken(token: string): string {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'], issuer: ISSUER });
    if (typeof payload === 'string' || payload.typ !== 'access' || !payload.sub) throw new Error();
    return payload.sub;
  } catch {
    throw unauthorized('INVALID_TOKEN', 'Invalid or expired access token');
  }
}

export interface Session {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export async function issueSession(userId: string, familyId: string = randomUUID()): Promise<Session> {
  const refreshToken = randomToken();
  await prisma.refreshToken.create({
    data: {
      userId,
      familyId,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(Date.now() + config.refreshTokenTtlDays * 86_400_000),
    },
  });
  return { accessToken: signAccessToken(userId), refreshToken, expiresIn: config.accessTokenTtlSec };
}

/**
 * Refresh token rotation: each refresh token can be used exactly once. Presenting an
 * already used token means it was copied (session theft): the whole family is revoked,
 * which disconnects both the thief and the victim, who simply logs in again.
 */
export async function rotateSession(refreshToken: string): Promise<{ userId: string; session: Session }> {
  const now = new Date();
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
  if (!stored || stored.expiresAt < now) throw unauthorized('INVALID_REFRESH_TOKEN', 'Invalid refresh token');

  const consumed = await prisma.refreshToken.updateMany({
    where: { id: stored.id, revokedAt: null },
    data: { revokedAt: now },
  });
  if (consumed.count !== 1) {
    await prisma.refreshToken.updateMany({
      where: { familyId: stored.familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    throw unauthorized('REFRESH_TOKEN_REUSED', 'Session revoked: this refresh token was already used');
  }
  return { userId: stored.userId, session: await issueSession(stored.userId, stored.familyId) };
}

export async function revokeSession(refreshToken: string): Promise<void> {
  const stored = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
  if (!stored) return;
  await prisma.refreshToken.updateMany({
    where: { familyId: stored.familyId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}
