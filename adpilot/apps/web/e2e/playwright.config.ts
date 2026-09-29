import { defineConfig, devices } from '@playwright/test';
import { env } from './support/env';

/**
 * End-to-end suite for the web app against a running stack (web + API + worker + scheduler + Meta emulator).
 * See apps/web/README.md → "End-to-end tests". The specs run in file order with one worker: they share the
 * dev database and the emulator.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results',
  reporter: [['list'], ['./support/skip-reasons.ts']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: env.baseUrl,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: executablePath ? { executablePath } : {},
  },
});
