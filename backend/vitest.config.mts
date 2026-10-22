import { randomBytes } from 'node:crypto';
import 'dotenv/config';
import { defineConfig } from 'vitest/config';

// No credential in the repo: DATABASE_URL's server with another database, and a random JWT secret.
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL in backend/.env (see .env.example) or TEST_DATABASE_URL');
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = '/musicroom_test';
  url.searchParams.set('connection_limit', '20');
  return url.toString();
}
// also read by test/global-setup.ts, which runs in this process
process.env.TEST_DATABASE_URL = testDatabaseUrl();

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // integration tests share one database: run the files one after the other
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
      JWT_SECRET: randomBytes(48).toString('base64url'),
      TRACK_CATALOG: 'fake',
      BCRYPT_ROUNDS: '4',
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
      PUBLIC_URL: 'http://localhost:3000',
    },
  },
});
