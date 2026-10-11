import { defineConfig, devices } from '@playwright/test'

// Browser channel. Unset (the default) runs Playwright's bundled Chromium,
// which is what CI and most containers have. Set PW_CHANNEL=chrome to run
// against an installed Google Chrome for device parity checks. Before this
// the suite hardcoded 'chrome' and could not start anywhere Chrome was not
// installed, which is how it ended up red on main without anyone noticing.
const browserChannel = process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}

const mockAnonKey = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  'eyJyb2xlIjoiYW5vbiIsImlhdCI6MTcxMDAwMDAwMCwiZXhwIjoyMDAwMDAwMDAwfQ',
  'qa-signature'
].join('.')

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.SCROLL_BASE_URL || 'http://127.0.0.1:5173',
    // Jesse works in Central time. CI runs in UTC, so pin the browser's
    // zone or the hour, day and sun times in the specs would shift.
    timezoneId: 'America/Chicago',
    ...browserChannel,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], ...browserChannel }
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], ...browserChannel }
    }
  ],
  webServer: process.env.SCROLL_BASE_URL ? undefined : {
    command: 'npm run dev -- --host 127.0.0.1',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: true,
    timeout: 90_000,
    env: {
      VITE_SUPABASE_URL: 'https://qa-mock.supabase.co',
      VITE_SUPABASE_ANON_KEY: mockAnonKey
    }
  }
})
