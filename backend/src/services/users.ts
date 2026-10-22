import type { User } from '@prisma/client';
import { prisma, type Tx } from '../db';
import { notFound } from '../errors';

export const userSummarySelect = { id: true, displayName: true, avatarUrl: true } as const;

/** Search results and friend lists also show the music taste. */
export const userCardSelect = { ...userSummarySelect, musicPreferences: true } as const;

/** Prisma options listing the invited users of an event or a playlist, oldest invitation first. */
export const invitees = { include: { user: { select: userSummarySelect } }, orderBy: { createdAt: 'asc' } } as const;

/** Emails are stored in lower case: every account created and every lookup goes through here. */
export const normalizeEmail = (email: string) => email.toLowerCase();

export const findUserByEmail = (email: string) => prisma.user.findUnique({ where: { email: normalizeEmail(email) } });

/** 404 when the user does not exist (befriended, invited...). */
export async function ensureUser(userId: string, db: Tx | typeof prisma = prisma): Promise<void> {
  if (!(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('user');
}

export function toMe(u: User) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified,
    displayName: u.displayName,
    avatarUrl: u.avatarUrl,
    bio: u.bio,
    musicPreferences: u.musicPreferences,
    friendsInfo: u.friendsInfo,
    privateInfo: u.privateInfo,
    hasPassword: u.passwordHash !== null,
    linkedProviders: { google: u.googleId !== null, facebook: u.facebookId !== null },
    createdAt: u.createdAt,
  };
}

/** Friendships are stored once per pair, with the smallest id first. */
export function pairKey(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export async function areFriends(a: string, b: string, db: Tx | typeof prisma = prisma): Promise<boolean> {
  if (a === b) return false;
  const f = await db.friendship.findUnique({ where: { userAId_userBId: pairKey(a, b) } });
  return f?.status === 'ACCEPTED';
}
