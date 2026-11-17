import { describe, expect, it, vi } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

vi.mock('expo-crypto', () => ({ getRandomBytesAsync: vi.fn() }))
vi.mock('./supabase', () => ({ supabase: {} }))
import { buildPublicUrl } from './publicLink'

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '..')
const LIVE_SITE = 'https://animated-kheer-db7c2c.netlify.app'

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.expo')) return []
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !name.endsWith('.test.ts') ? [path] : []
  })
}

describe('native outbound site address', () => {
  it('customer links point at the live site when the build sets no address', () => {
    expect(process.env.EXPO_PUBLIC_API_BASE_URL).toBeUndefined()
    expect(buildPublicUrl('abc')).toBe(`${LIVE_SITE}/p/abc`)
  })

  it('no app source or example env falls back to the retired fieldhorse.io site', () => {
    const offenders = [...sources(MOBILE), join(MOBILE, '.env.example')]
      .filter((path) => readFileSync(path, 'utf8').includes('https://fieldhorse.io'))
      .map((path) => path.slice(MOBILE.length + 1))
    expect(offenders).toEqual([])
  })

  it('every build profile sets the site address', () => {
    const eas = JSON.parse(readFileSync(join(MOBILE, 'eas.json'), 'utf8'))
    for (const profile of ['development', 'preview', 'production']) {
      expect(eas.build[profile].env?.EXPO_PUBLIC_API_BASE_URL).toBe(LIVE_SITE)
    }
  })
})
