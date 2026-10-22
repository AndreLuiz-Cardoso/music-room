import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('configuration', () => {
  it('refuses to start with the example JWT secret of .env.example (anyone could sign tokens)', async () => {
    vi.stubEnv('JWT_SECRET', 'change-me-change-me-change-me-change-me');
    vi.resetModules();
    await expect(import('../src/config.js')).rejects.toThrow(/JWT_SECRET/);
  });
});
