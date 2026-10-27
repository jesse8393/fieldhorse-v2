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
})
