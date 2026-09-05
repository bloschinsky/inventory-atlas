import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: true,
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: {
    command: 'pnpm --filter @inventory-atlas/web preview --host 127.0.0.1',
    port: 4173,
    reuseExistingServer: true,
  },
});
