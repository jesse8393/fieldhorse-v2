#!/usr/bin/env node
// npm run check:schema
//
// Lists every database function, table and column the web app (src) and the
// Netlify functions call, and checks that each one exists:
//   1. in src/lib/database.types.ts, always. Those types describe the
//      schema the repo's migrations build, not production, so this half
//      only proves the code and the migrations agree.
//   2. in production, when this run can read it. Set SUPABASE_DB_URL (a
//      read only connection string), or SUPABASE_URL and
//      SUPABASE_SERVICE_ROLE_KEY. Without them the run says production was
//      not checked and does not fail: the anon key cannot see functions
//      that are revoked from anon, so it cannot answer the question.
//
// Pass --types-only to skip production even when those are set (CI does).
// Exits 1 when anything the code uses is missing, and names file and line.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectRefs,
  compareRefs,
  formatProblems,
  parseDatabaseTypes,
  productionPlan,
  schemaFromCatalog,
  schemaFromOpenApi
} from './lib/schemaRefs.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCAN = ['src', 'netlify/functions']
const typesOnly = process.argv.includes('--types-only')

function sourceFiles() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry.name) && !/\.(test|spec)\.|database\.types\.ts$|\.d\.ts$/.test(entry.name)) {
        out.push({ path: path.relative(root, full), text: fs.readFileSync(full, 'utf8') })
      }
    }
  }
  for (const dir of SCAN) walk(path.join(root, dir))
  return out
}

async function readCatalog(dbUrl) {
  const { default: pg } = await import('pg')
  const client = new pg.Client({ connectionString: dbUrl, statement_timeout: 30000 })
  await client.connect()
  try {
    await client.query('set transaction read only').catch(() => {})
    const columns = await client.query(`
      select c.relname as table, a.attname as column
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p', 'f')
        and a.attnum > 0 and not a.attisdropped`)
    const procs = await client.query(`
      select p.proname as name, p.proargnames::text[] as names, p.proargmodes::text[] as modes,
             p.pronargs as nargs, p.pronargdefaults as ndefaults
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'`)
    const functions = procs.rows.map((r) => {
      const names = r.names ?? []
      const modes = r.modes ?? names.map(() => 'i')
      const inputs = names.filter((_, i) => ['i', 'b', 'v'].includes(modes[i] ?? 'i'))
      while (inputs.length < r.nargs) inputs.push('')
      const firstOptional = r.nargs - r.ndefaults
      return { name: r.name, args: inputs.map((name, i) => ({ name, optional: i >= firstOptional })) }
    })
    return schemaFromCatalog({ columns: columns.rows, functions })
  } finally {
    await client.end()
  }
}

async function readOpenApi(url, key) {
  const headers = { apikey: key, accept: 'application/openapi+json' }
  // A legacy service role key is a JWT and goes in Authorization too; a new
  // secret key (sb_secret_...) goes in apikey alone.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`${url} answered ${res.status}`)
  return schemaFromOpenApi(await res.json())
}

function report(label, problems) {
  if (problems.length === 0) {
    console.log(`ok: everything the code uses is in ${label}`)
    return true
  }
  console.error(`missing from ${label}: ${problems.length}`)
  for (const line of formatProblems(problems)) console.error(line)
  return false
}

async function main() {
  const files = sourceFiles()
  const refs = collectRefs(files)
  const count = (list) => new Set(list.map((r) => r.name)).size
  console.log(`read ${files.length} files: ${count(refs.rpcs)} functions, ${count(refs.tables)} tables, ${refs.columns.length} column uses`)

  const typesText = fs.readFileSync(path.join(root, 'src/lib/database.types.ts'), 'utf8')
  let ok = report('src/lib/database.types.ts', compareRefs(refs, parseDatabaseTypes(typesText)))

  if (typesOnly) return ok
  const plan = productionPlan(process.env)
  if (plan.kind === 'none') {
    console.warn(`warning: ${plan.reason}`)
    if (process.env.GITHUB_ACTIONS) console.log(`::warning title=Schema check::${plan.reason}`)
    return ok
  }
  const live = plan.kind === 'catalog' ? await readCatalog(plan.dbUrl) : await readOpenApi(plan.url, plan.key)
  ok = report('production', compareRefs(refs, live)) && ok
  return ok
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err) => {
    console.error(`schema check could not run: ${err.message}`)
    process.exit(2)
  }
)
