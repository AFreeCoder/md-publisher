import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'apps/web/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: {
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
    baseURL: 'http://127.0.0.1:3000',
    viewport: { width: 1440, height: 1000 },
    permissions: ['clipboard-read', 'clipboard-write'],
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120000,
  },
});
