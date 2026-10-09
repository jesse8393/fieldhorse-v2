import { describe, expect, it } from 'vitest'
import { safeNextPath } from './nextPath.ts'

describe('safeNextPath', () => {
  it('accepts paths on this site', () => {
    expect(safeNextPath('/invite/3f9c2a7b')).toBe('/invite/3f9c2a7b')
    expect(safeNextPath('/jobs/42?tab=quote#notes')).toBe('/jobs/42?tab=quote#notes')
    expect(safeNextPath('/')).toBe('/')
  })

  it('refuses anything that could send the session to another site', () => {
    const unsafe = [
      null,
      undefined,
      '',
      'invite/abc',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\n/evil.example',
      ' /invite/abc',
      'javascript:alert(1)'
    ]
    for (const raw of unsafe) expect(safeNextPath(raw)).toBeNull()
  })
})
