import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'checks.spec.mjs',
  // the checks share one signed-in browser and accounts set up in beforeAll
  workers: 1,
  timeout: 90_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    browserName: 'chromium',
    // Chrome's real autoplay policy: audio only starts after a user gesture, like on a phone
    launchOptions: { args: ['--autoplay-policy=document-user-activation-required'] },
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'checks', grepInvert: /@slow/ },
    // waits for the 15-minute access token to expire
    { name: 'slow', grep: /@slow/ },
  ],
});
