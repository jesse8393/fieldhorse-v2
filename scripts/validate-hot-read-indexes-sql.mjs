// Indexes for the reads every open makes (PERF-12), in a disposable PGlite
// database with synthetic rows only:
//   * fh_schedule (org_id, start_at): Home, Schedule and Jobs read a
//     company's visits in a start_at range; only (user_id, start_at) and
//     (org_id) alone existed, so the range was sorted on every read.
//   * fh_leads (quote_id) and fh_quotes (approved_version_id): foreign keys
//     with no index, so changing a quote or a quote version scanned the
//     table that points at it.
// The migration is additive (create index if not exists only), applies
// twice without error, and the planner reads a company's week of visits
// through the new index.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase } from './audit-database.mjs'

const MIGRATION = '20261117130000_hot_read_indexes.sql'
const sql = await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const statements = sql.replace(/--.*$/gm, '').split(';').map(s => s.trim()).filter(Boolean)
assert.ok(statements.length >= 3, 'the migration creates the three indexes')
for (const statement of statements) {
  assert.match(statement, /^create index if not exists /i, `only additive index statements: ${statement}`)
}

const db = await auditDatabase('hotreads')
try {
  await db.exec(`
    create table public.organizations(id uuid primary key);
    create table public.fh_quote_versions(id uuid primary key);
    create table public.fh_quotes(id uuid primary key, org_id uuid references public.organizations, approved_version_id uuid references public.fh_quote_versions(id) on delete set null);
    create table public.fh_leads(id uuid primary key, org_id uuid references public.organizations, quote_id uuid references public.fh_quotes(id) on delete set null);
    create table public.fh_schedule(id uuid primary key default gen_random_uuid(), user_id uuid not null, org_id uuid references public.organizations, start_at timestamptz, end_at timestamptz, title text);
    create index if not exists idx_fh_schedule_start on public.fh_schedule(user_id, start_at);
    create index if not exists idx_fh_schedule_org_id on public.fh_schedule(org_id);
  `)
  await db.exec(sql)
  // Applying it again is harmless.
  await db.exec(sql)

  const indexes = (await db.query("select tablename, indexdef from pg_indexes where schemaname = 'public'")).rows
  const has = (table, columns) => indexes.some(i => i.tablename === table && i.indexdef.endsWith(`(${columns})`))
  assert.ok(has('fh_schedule', 'org_id, start_at'), 'fh_schedule (org_id, start_at)')
  assert.ok(has('fh_leads', 'quote_id'), 'fh_leads (quote_id)')
  assert.ok(has('fh_quotes', 'approved_version_id'), 'fh_quotes (approved_version_id)')
  console.log('PASS the three indexes exist and the migration applies twice')

  // Twelve companies, two years of visits each.
  await db.exec(`insert into public.organizations select ('00000000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(1, 12) n`)
  await db.exec(`
    insert into public.fh_schedule(user_id, org_id, start_at, end_at, title)
    select '${id(900)}', ('00000000-0000-4000-8000-' || lpad((1 + n % 12)::text, 12, '0'))::uuid,
      timestamptz '2025-01-01' + (n || ' hours')::interval, timestamptz '2025-01-01' + (n + 2 || ' hours')::interval, 'Synthetic visit'
    from generate_series(1, 20000) n;
    analyze public.fh_schedule;
  `)
  const plan = (await db.query(`explain select id, start_at from public.fh_schedule
    where org_id = '${id(3)}' and start_at >= '2026-10-05' and start_at < '2026-10-12' order by start_at`)).rows.map(r => r['QUERY PLAN']).join('\n')
  assert.match(plan, /fh_schedule_org_start_idx/, `a company's week reads through the new index:\n${plan}`)
  console.log("PASS a company's week of visits reads through (org_id, start_at)")
} finally {
  await db.close?.()
}
