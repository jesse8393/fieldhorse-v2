import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aiDraftError, teamLoadError } from './serviceErrors.ts'

describe('service recovery messages', () => {
  it('does not expose deployment instructions or provider errors to operators', () => {
    const raw = new Error('ANTHROPIC_API_KEY missing at Netlify; provider diagnostic')
    expect(aiDraftError(raw)).not.toMatch(/ANTHROPIC|Netlify|diagnostic/)
    expect(teamLoadError(raw)).not.toMatch(/ANTHROPIC|Netlify|diagnostic/)
  })

  it('distinguishes setup failures from connection retries', () => {
    expect(aiDraftError({ code: 'missing_api_key', status: 500 })).toContain('not ready for this workspace')
    expect(teamLoadError({ message: 'server_misconfigured', status: 500 })).toContain('workspace setup')
    expect(teamLoadError(new Error('Failed to fetch'))).toContain('Check your connection')
  })

  it('offers appropriate recovery for authentication, authorization and throttling', () => {
    expect(aiDraftError({ status: 401 })).toContain('reconnect')
    expect(aiDraftError({ status: 429 })).toContain('try again shortly')
    expect(teamLoadError({ status: 403 })).toContain('selected workspace')
  })

  // raw-errors-13: toasts told the owner to add Resend or DocuSign keys in
  // Netlify. Setup notes like these are for us, never for a screen.
  it('no screen tells the owner to change hosting keys', () => {
    const srcDir = join(process.cwd(), 'src')
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return files(path)
      return /\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && entry.name !== 'serviceErrors.ts' ? [path] : []
    })
    const SETUP = /Netlify|Resend keys|DocuSign keys|set up the deploy/
    const hits = files(srcDir).flatMap((path) => (readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
      .match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [])
      .filter((literal) => SETUP.test(literal))
      .map((literal) => `${path.slice(srcDir.length + 1)} ${literal}`))
    expect(hits).toEqual([])
  })
})
