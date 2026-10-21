import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Creates the test database when missing and applies the migrations to it.
export default async function setup() {
  const url = new URL(
    process.env.TEST_DATABASE_URL ?? 'postgresql://musicroom:musicroom@localhost:5433/musicroom_test',
  );
  const database = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';

  const prisma = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    const rows = await prisma.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${database}`;
    if (rows.length === 0) await prisma.$executeRawUnsafe(`CREATE DATABASE "${database.replace(/"/g, '')}"`);
  } finally {
    await prisma.$disconnect();
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: url.toString() },
  });
}
