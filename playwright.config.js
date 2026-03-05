import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45000,
  expect: {
    timeout: 10000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build && node bin/collabmd.js --no-tunnel --port 4173 --host 127.0.0.1 test-vault',
    env: {
      NODE_ENV: 'test',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    url: 'http://127.0.0.1:4173/health',
  },
  workers: 1,
});
