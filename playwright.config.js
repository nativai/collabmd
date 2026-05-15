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
  retries: process.env.CI ? 2 : 0,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
  },
  fullyParallel: false,
  workers: '50%',
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
