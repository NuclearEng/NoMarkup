import { defineConfig, devices } from '@playwright/test';

import { HAS_STACK } from './tests/e2e/helpers/stack';

export default defineConfig({
  globalSetup: './tests/e2e/global-setup.ts',
  testDir: './tests/e2e',
  // The dogfood suite drives seeded dev accounts against a full local stack
  // (`bin/dev`: gateway + services + DB) and can never pass web-only. The
  // stack announces itself via SEED_PASSWORD (set in .env.local or CI env);
  // when it is unset — e.g. the backendless "Playwright E2E Tests" CI job —
  // ignore dogfood entirely instead of failing 60+ tests at login.
  testIgnore: HAS_STACK ? [] : ['**/dogfood/**'],
  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  workers: process.env['CI'] ? 1 : undefined,
  reporter: 'html',
  expect: {
    timeout: 30_000,
  },
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env['CI'],
  },
});
