import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestApp, type TestContext } from './helpers';

// The web build of the app is a browser origin: vi.hoisted runs before the imports read the config.
vi.hoisted(() => {
  vi.stubEnv('CORS_ORIGINS', 'http://localhost:8081');
});

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp();
});
afterAll(async () => {
  await ctx.app.close();
  vi.unstubAllEnvs();
});

describe('CORS', () => {
  it.each(['PUT', 'PATCH', 'DELETE'])('lets the web app send %s requests', async (method) => {
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/me/password',
      headers: {
        origin: 'http://localhost:8081',
        'access-control-request-method': method,
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:8081');
    expect(String(preflight.headers['access-control-allow-methods']).split(/\s*,\s*/)).toContain(method);
  });

  it('refuses other origins', async () => {
    const preflight = await ctx.app.inject({
      method: 'OPTIONS',
      url: '/me/password',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'PUT' },
    });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
