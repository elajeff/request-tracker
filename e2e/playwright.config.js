import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: 2,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  globalSetup: './wait-ready.js',
  outputDir: '/results/tests',
  reporter: [
    ['list'],
    ['json', { outputFile: '/results/report.json' }],
  ],
  use: {
    baseURL: 'http://frontend:8080',
    locale: 'en-GB',
    timezoneId: 'UTC',
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
