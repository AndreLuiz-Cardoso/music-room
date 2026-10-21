import { Prisma, PrismaClient } from '@prisma/client';
import { notFound } from './errors';

export const prisma = new PrismaClient();

export type Tx = Prisma.TransactionClient;

const lockable = { Event: 'event', Playlist: 'playlist', Device: 'device' } as const;

/**
 * Takes a row-level lock (SELECT ... FOR UPDATE) on an aggregate root for the rest of the
 * transaction. Every mutation of an event queue, a playlist order or a device state goes
 * through this lock, so concurrent writers on the same aggregate are serialized by PostgreSQL
 * while writers on different aggregates still run in parallel.
 */
export async function lockRow(tx: Tx, table: keyof typeof lockable, id: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id = ${id} FOR UPDATE`,
  );
  if (rows.length === 0) throw notFound(lockable[table]);
}

function isRetryable(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  return err instanceof Error && /40P01|40001|deadlock detected/.test(err.message);
}

/**
 * Interactive transaction retried when PostgreSQL aborts it because of a deadlock or a
 * serialization failure (e.g. a vote and a suggestion touching the same rows in a
 * different order). The aborted attempt was fully rolled back, so retrying is safe.
 */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>, attempts = 4): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      // maxWait: time allowed to obtain a pooled connection, the default (2s) is too short under bursts
      return await prisma.$transaction(fn, { maxWait: 10_000, timeout: 10_000 });
    } catch (err) {
      if (i >= attempts || !isRetryable(err)) throw err;
      await new Promise((r) => setTimeout(r, Math.random() * 20 * i));
    }
  }
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}
