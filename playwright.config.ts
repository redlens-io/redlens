import { defineConfig, devices } from '@playwright/test';

/** UI-interaction harness (Fase UX-QA). Runs headless Chromium against the real
 * webview pages. Executed in Docker on the VM Lab via scripts/remote/uitest.sh. */
export default defineConfig({
  testDir: './ui-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    headless: true,
  },
});
