import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

// CI runs the Playwright suite in several groups. When an early group
// failed, GitHub skipped every later step, so about 48 specs reported
// nothing that run. Each group after the first must run whatever the
// earlier ones did, unless the run was cancelled.

const workflow = fs.readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')

// The steps of one job, as { name, if, run } read from the YAML text.
function steps(job: string) {
  const start = workflow.indexOf(`\n  ${job}:\n`)
  const rest = workflow.slice(start + 1)
  const end = rest.slice(1).search(/\n {2}[a-z][\w-]*:\n/)
  const body = end < 0 ? rest : rest.slice(0, end + 1)
  return body.split(/\n {6}- /).slice(1).map((text) => ({
    name: /name: (.*)/.exec(text)?.[1]?.trim() ?? '',
    if: /\n {8}if: (.*)/.exec(text)?.[1]?.trim() ?? null,
    run: /run: (.*)/.exec(text)?.[1]?.trim() ?? ''
  }))
}

describe('ci.yml e2e job', () => {
  it('runs every Playwright group even when an earlier group failed', () => {
    const groups = steps('e2e').filter((s) => s.run.startsWith('npx playwright test'))
    expect(groups.length).toBeGreaterThan(1)
    for (const group of groups.slice(1)) expect(group.if, group.name).toBe('success() || failure()')
  })

  it('compares what the code uses with database.types.ts in the check job', () => {
    expect(steps('check').map((s) => s.run)).toContain('npm run check:schema -- --types-only')
  })
})
