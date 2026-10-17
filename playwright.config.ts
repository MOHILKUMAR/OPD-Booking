import { defineConfig, devices } from '@playwright/test'

// UI end-to-end tests run the production build against a mocked Supabase API
// (tests/e2e/mock-api.ts), so they need no backend and no secrets. Database behaviour is
// covered by tests/db against real PostgreSQL. Set E2E_BROWSER_CHANNEL=msedge or leave the
// default 'chrome' to use an installed browser instead of downloading one.
const channel = process.env.E2E_BROWSER_CHANNEL ?? 'chrome'
const PORT = 4173

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile', use: { ...devices['Pixel 7'], channel } },
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 860 }, channel },
    },
  ],
  webServer: {
    command: `npx vite build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      VITE_SUPABASE_URL: 'http://127.0.0.1:54399',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_e2e_mock_key_not_secret',
      VITE_HOSPITAL_SLUG: 'demo-hospital',
      VITE_PAYMENTS_ENABLED: 'false',
      VITE_APP_ENV: 'development',
    },
  },
})
