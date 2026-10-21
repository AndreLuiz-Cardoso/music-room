import type { User } from '@prisma/client';
import { prisma, type Tx } from '../db';

export const userSummarySelect = { id: true, displayName: true, avatarUrl: true, musicPreferences: true } as const;

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
