import { defineConfig, devices } from '@playwright/test'

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
    channel: 'chrome',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' }
    },
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 7'], channel: 'chrome' }
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
