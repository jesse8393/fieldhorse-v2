import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '061_audit_rls_policies.sql'
)
const migration = fs.readFileSync(migrationPath, 'utf8')
const failures = []

function requirePattern(pattern, message) {
  if (!pattern.test(migration)) failures.push(message)
}

function listFiles(directory) {
  const absolute = path.join(root, directory)
  if (!fs.existsSync(absolute)) return []

  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const relative = path.join(directory, entry.name)
    if (entry.isDirectory()) return listFiles(relative)
    return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [relative] : []
  })
}

function directCallers(table) {
  const pattern = new RegExp(String.raw`\.from\(\s*['"]${table}['"]\s*\)`)
  return ['src', 'mobile', 'netlify/functions']
    .flatMap(listFiles)
    .filter((file) => pattern.test(fs.readFileSync(path.join(root, file), 'utf8')))
}

requirePattern(
  /alter table public\.org_invites enable row level security;/,
  'org_invites must keep RLS enabled'
)
requirePattern(
  /create policy "org_invites_select_owner_admin_or_recipient"[\s\S]*?for select[\s\S]*?to authenticated[\s\S]*?m\.role in \('owner', 'admin'\)[\s\S]*?auth\.jwt\(\)/,
  'combined owner, admin, and invitee select policy is missing'
)
requirePattern(
  /create policy "org_invites_insert_by_owner_admin"[\s\S]*?for insert[\s\S]*?invited_by = \(select auth\.uid\(\)\)/,
  'owner and admin invite insert policy must bind invited_by to the caller'
)
requirePattern(
  /create policy "org_invites_delete_by_owner_admin"[\s\S]*?for delete[\s\S]*?m\.revoked_at is null/,
  'owner and admin invite delete policy is missing'
)
requirePattern(
  /drop policy if exists "fh_app_config_authenticated_public_read" on public\.fh_app_config;/,
  'the legacy authenticated app config read policy must be removed'
)
requirePattern(
  /grant select, insert, delete on table public\.org_invites to authenticated;/,
  'org_invites must grant only the audited client operations'
)

for (const table of ['fh_app_config', 'fh_integration_secrets']) {
  requirePattern(
    new RegExp(`alter table public\\.${table} enable row level security;`),
    `${table} must keep RLS enabled`
  )
  requirePattern(
    new RegExp(`revoke all on table public\\.${table} from anon, authenticated;`),
    `${table} must revoke all client grants`
  )
  if (new RegExp(`create policy[^;]+on public\\.${table}`, 'i').test(migration)) {
    failures.push(`${table} must not receive a client policy`)
  }
}

const configCallers = directCallers('fh_app_config')
const secretCallers = directCallers('fh_integration_secrets')
const browserCallers = [...configCallers, ...secretCallers].filter(
  (file) => file.startsWith('src') || file.startsWith('mobile')
)

if (browserCallers.length > 0) {
  failures.push(`server-only tables are queried by browser code: ${browserCallers.join(', ')}`)
}
if (
  configCallers.length !== 1 ||
  configCallers[0] !== path.join('netlify', 'functions', 'lib', 'push.js')
) {
  failures.push(
    `fh_app_config must be read only by the server push helper: ${configCallers.join(', ') || 'none'}`
  )
}

if (failures.length > 0) {
  console.error('RLS audit failed:')
  failures.forEach((failure) => console.error(`- ${failure}`))
  process.exit(1)
}

console.log('RLS audit passed.')
console.log(`fh_app_config direct callers: ${configCallers.join(', ')}`)
console.log(
  `fh_integration_secrets direct callers: ${secretCallers.join(', ') || 'none in application code'}`
)
