import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

// Local-only convenience: if e2e/.env exists, load E2E_EMAIL / E2E_PASSWORD
// from it so `npx playwright test` works with no inline env vars. The file is
// gitignored; real env vars still win in CI.
try {
  process.loadEnvFile(path.resolve(__dirname, 'e2e/.env'));
} catch {
  // no e2e/.env — rely on the ambient environment
}

// The app is a split deployment: the Angular dev server (:4200) proxies /api
// to the Worker (:8787). Both are started by hand (see README "Start both dev
// servers") — no webServer block here on purpose.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  projects: [
    // Logs in once per `playwright test` run using E2E_EMAIL / E2E_PASSWORD
    // (from e2e/.env) and refreshes playwright/.auth/user.json.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], storageState: 'playwright/.auth/user.json' },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
});
