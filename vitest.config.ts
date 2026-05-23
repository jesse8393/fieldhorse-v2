import { defineConfig } from 'vitest/config'

// Pure-logic unit tests run in node. Modules that construct the Supabase
// client at import time are mocked per-test (see stages.test.ts), so no
// network or env is needed here.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}']
  }
})
