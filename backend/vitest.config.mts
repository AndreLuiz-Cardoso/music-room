import { defineConfig } from 'vitest/config';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgresql://musicroom:musicroom@localhost:5433/musicroom_test?connection_limit=20';

export default defineConfig({
  test: {
    globalSetup: ['test/global-setup.ts'],
    // integration tests share one database: run the files one after the other
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDatabaseUrl,
      JWT_SECRET: 'test-secret-test-secret-test-secret-test-secret',
      TRACK_CATALOG: 'fake',
      BCRYPT_ROUNDS: '4',
      RATE_LIMIT_MAX: '100000',
      AUTH_RATE_LIMIT_MAX: '100000',
      PUBLIC_URL: 'http://localhost:3000',
    },
  },
});
