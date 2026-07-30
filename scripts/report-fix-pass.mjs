import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('..', import.meta.url)))
const phases = [
  ['Preflight', '5321236', 'Session startup and AI workflow smoke coverage'],
  ['Phase A', '4255b6e', 'Canonical tokens'],
  ['Phase B', '4bc837d', 'Shared components and codebase design sweep'],
  ['Phase C', '199a6ae', 'Home dashboard and lead to cash workflow'],
  ['Phase D', '227ae09', 'Supabase RLS migration'],
  ['QA follow through', 'a645b7c', 'Browser harness, zero trends, and count copy'],
  ['Repository audit closure', '31d50d1', 'Server email and launch manifest sweep']
]

function git(args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  }).trim()
}

function filesFor(commit) {
  const output = git([
    'diff-tree',
    '--no-commit-id',
    '--name-status',
    '--find-renames',
    '-r',
    commit
  ])
  return output ? output.split(/\r?\n/) : []
}

const replacementReport = readFileSync(
  join(root, 'DESIGN_SYSTEM_REPLACEMENTS.md'),
  'utf8'
)
const migration = readFileSync(
  join(root, 'supabase', 'migrations', '061_audit_rls_policies.sql'),
  'utf8'
).trim()

const replacementSummary =
  replacementReport.match(/Total replacements: \*\*([^*]+)\*\* across \*\*([^*]+)\*\*\./)
const totals = Object.fromEntries(
  [...replacementReport.matchAll(/^(Colors|Radii|Type|Spacing|Tracking): ([\d,]+)$/gm)]
    .map((match) => [match[1], match[2]])
)

const lines = [
  '# FieldHorse Fix Pass 1 Handoff',
  '',
  'Production repository: `C:\\Users\\Jesse\\OneDrive\\Desktop\\fieldhorse-v2`',
  '',
  'Production Supabase project: `pnmhblvslftdzfcdezbw`',
  '',
  'Branch: `codex/jobber-workflow`',
  '',
  '## Result',
  '',
  'Phases A through D are implemented, committed, and live on `https://fieldhorse.io`. Pull request 207 was merged to `main` as `b16ae1f31ff851ffdefc3562b85de7a4b254e488`.',
  '',
  'The RLS migration was applied to production project `pnmhblvslftdzfcdezbw` as migration `20260730184123 audit_rls_policies`.',
  '',
  '## Replacement Counts',
  '',
  `Total: ${replacementSummary?.[1] || 'unknown'} replacements across ${replacementSummary?.[2] || 'unknown'}.`,
  '',
  `Colors: ${totals.Colors || 'unknown'}`,
  '',
  `Radii: ${totals.Radii || 'unknown'}`,
  '',
  `Type: ${totals.Type || 'unknown'}`,
  '',
  `Spacing: ${totals.Spacing || 'unknown'}`,
  '',
  `Tracking: ${totals.Tracking || 'unknown'}`,
  '',
  'The complete per-file ledger is in [DESIGN_SYSTEM_REPLACEMENTS.md](DESIGN_SYSTEM_REPLACEMENTS.md).',
  '',
  '## Unresolved Tokens',
  '',
  'No off-palette colors or non-token control/card radii remain in audited product source, native manifests, public source assets, or server generated emails.',
  '',
  '`#0000` remains only as the example card reference placeholder in `V3PaymentSheet.tsx`. It is user-entered text, not a color declaration.',
  '',
  'The 999px pill radius remains restricted to Badge and StatusPill components. The design audit enforces this exception.',
  '',
  '## Verification',
  '',
  '- `npm run audit:design`: passed across `src`, `mobile`, `netlify`, `public`, and `index.html`.',
  '- `npm run audit:rls`: passed. `fh_app_config` has one server caller; `fh_integration_secrets` has no application caller.',
  '- `npm run lint`: passed.',
  '- `npm run typecheck`: passed.',
  '- `npm test`: 21 files and 130 tests passed.',
  '- `npm run build`: passed with 4,480 modules transformed.',
  '- `npm run e2e`: 10 passed across desktop and mobile. Two production credential tests were skipped because no E2E account was supplied.',
  '- `npm run qa:workflow`: 4 desktop/mobile lead to cash workflow tests passed.',
  '- Modified Netlify functions passed `node --check`.',
  '- `mobile/app.json` passed JSON parsing.',
  '- Production `https://fieldhorse.io`: HTTP 200 from the merged Netlify deployment.',
  '- Production bundle: one Collected this week label, one Owner Queue, one Revenue Opportunities card, one Job Health Preview, no Reports column, canonical gold present, and legacy gold absent.',
  '- Production Supabase: migration `20260730184123 audit_rls_policies` applied and resulting RLS policies and grants verified.',
  '',
  '## Files By Phase',
  ''
]

for (const [label, commit, description] of phases) {
  const files = filesFor(commit)
  lines.push(`### ${label}: ${description}`)
  lines.push('')
  lines.push(`Commit: \`${commit}\``)
  lines.push('')
  lines.push(`Files changed: ${files.length}`)
  lines.push('')
  for (const entry of files) {
    const [status, ...pathParts] = entry.split('\t')
    lines.push(`- \`${status}\` \`${pathParts.join('\t')}\``)
  }
  lines.push('')
}

lines.push('## Migration SQL')
lines.push('')
lines.push('```sql')
lines.push(migration)
lines.push('```')
lines.push('')

writeFileSync(
  join(root, 'FIELDHORSE_FIX_PASS_1_REPORT.md'),
  lines.join('\n')
)

console.log('Wrote FIELDHORSE_FIX_PASS_1_REPORT.md')
