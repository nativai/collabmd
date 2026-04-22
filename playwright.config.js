import { defineConfig } from '@playwright/test';

const crossBrowserDiagramPreviewProjects = process.env.PLAYWRIGHT_DIAGRAM_PREVIEW_CROSS_BROWSER === '1'
  ? [
    {
      name: 'firefox-diagram-preview',
      testMatch: /diagram-preview\.spec\.js/,
      use: {
        browserName: 'firefox',
      },
    },
    {
      name: 'webkit-diagram-preview',
      testMatch: /diagram-preview\.spec\.js/,
      use: {
        browserName: 'webkit',
      },
    },
  ]
  : [];

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
    command: 'npm run build && node tests/e2e/scripts/reset-vault.mjs && node bin/collabmd.js --no-tunnel --port 4173 --host 127.0.0.1 .tmp/e2e-vault',
    env: {
      NODE_ENV: 'test',
      WS_ROOM_IDLE_GRACE_MS: '1',
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    url: 'http://127.0.0.1:4173/health',
  },
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
      },
    },
    ...crossBrowserDiagramPreviewProjects,
  ],
});
