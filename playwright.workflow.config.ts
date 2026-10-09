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
  testMatch: 'mock-workflows.spec.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    ...browserChannel,
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'desktop-workflow',
      use: { ...devices['Desktop Chrome'], ...browserChannel }
    },
    {
      name: 'mobile-workflow',
      use: { ...devices['Pixel 7'], ...browserChannel }
    }
  ],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 5199',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: false,
    timeout: 90_000,
    env: {
      VITE_SUPABASE_URL: 'https://qa-mock.supabase.co',
      VITE_SUPABASE_ANON_KEY: mockAnonKey
    }
  }
})
