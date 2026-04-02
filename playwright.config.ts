import { defineConfig, devices } from '@playwright/test';

const useManagedWebServer = process.env.PW_USE_MANAGED_WEBSERVER !== '0';
const baseURL = process.env.PW_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 120_000,
  expect: {
    timeout: 20_000
  },
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  ...(useManagedWebServer
    ? {
        webServer: {
          command: 'pnpm dev:all',
          url: baseURL,
          timeout: 300_000,
          reuseExistingServer: true
        }
      }
    : {})
});
