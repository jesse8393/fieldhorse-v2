// Reminders stay in step with their records (AUTO-01 to AUTO-09, AUTO-12, AUTO-13).
// Disposable PGlite databases with synthetic rows only. The starting point is
// the live reminder engine: 091 and 096 are run whole (the engine body is
// checked against the md5 production reported), and fh_follow_up_set_status
// is the text of 20261101020547, so every check also proves the migration
// applies on top of what is deployed.
//   20261117100000_follow_ups_in_step.sql     triggers, reconcile, engine, Done and Dismiss, fh_my_open_reminders
//   20261117100100_follow_up_unique_indexes.sql one open reminder per record and person
//   supabase/manual/20261117_follow_up_cleanup.sql the one time cleanup run by hand
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const read = path => readFile(new URL(`../supabase/${path}`, import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const MIGRATION = 'migrations/20261117100000_follow_ups_in_step.sql'
const INDEXES = 'migrations/20261117100100_follow_up_unique_indexes.sql'
const CLEANUP = 'manual/20261117_follow_up_cleanup.sql'
const LIVE_ENGINE_MD5 = 'eae4aeed468cf247f8d41f7f38f98eeb'

const BASELINE = `
${auditRoles}
create schema auth;
create table auth.users(id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;

create table public.organizations(id uuid primary key, name text, created_at timestamptz not null default now());
create table public.org_members(org_id uuid references public.organizations(id) on delete cascade, user_id uuid, role text, revoked_at timestamptz, joined_at timestamptz default now());
create function public.auth_user_org_ids() returns setof uuid language sql stable security definer set search_path = pg_catalog, public as $$
  select org_id from public.org_members where user_id = auth.uid() and revoked_at is null $$;
create function public.fh_is_org_member(p_org_id uuid) returns boolean language sql stable security definer set search_path = pg_catalog, public as $$
  select exists (select 1 from public.org_members m where m.org_id = p_org_id and m.user_id = (select auth.uid()) and m.revoked_at is null) $$;
-- 070 and 071 (supabase/reference/deployed_migrations)
create table public.fh_org_settings(org_id uuid primary key, engine_enabled boolean not null default false, timezone text not null default 'America/Chicago');
create function public.fh_org_tz(p_org_id uuid) returns text language sql stable set search_path = pg_catalog, public as $$
  select coalesce((select timezone from public.fh_org_settings where org_id = p_org_id), 'America/Chicago') $$;

create table public.fh_clients(
  id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id) on delete cascade, user_id uuid,
  name text, phone text, email text, address text, created_at timestamptz not null default now());
create table public.fh_contacts(
  id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id) on delete cascade, user_id uuid,
  client_id uuid references public.fh_clients(id) on delete set null, name text, stage text, proposal_status text,
  completed_at timestamptz, last_contact date, follow_up_on date, quote_sent_at timestamptz, amount numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.fh_leads(
  id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id) on delete cascade, user_id uuid not null,
  client_id uuid not null references public.fh_clients(id) on delete cascade, title text, notes text,
  status text not null default 'open' check (status in ('open','quoted','lost')), follow_up_on date, last_contact date,
  origin_contact_id uuid references public.fh_contacts(id) on delete set null, quote_id uuid,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.fh_quotes(
  id uuid primary key default gen_random_uuid(), org_id uuid references public.organizations(id) on delete cascade, user_id uuid not null,
  client_id uuid not null references public.fh_clients(id) on delete cascade, lead_id uuid references public.fh_leads(id) on delete set null,
  job_id uuid references public.fh_contacts(id) on delete set null, title text, amount numeric not null default 0,
  status text not null default 'draft' check (status in ('draft','sent','viewed','changes_requested','approved','rejected','expired','lost')),
  sent_at timestamptz, expires_at timestamptz, change_request_note text, change_requested_at timestamptz,
  origin_contact_id uuid references public.fh_contacts(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
alter table public.fh_leads add constraint fh_leads_quote_fk foreign key (quote_id) references public.fh_quotes(id) on delete set null;

create table public.fh_follow_up_settings(
  org_id uuid primary key references public.organizations(id) on delete cascade,
  enabled boolean not null default false, auto_send boolean not null default false,
  from_name text, review_link text, review_ask_enabled boolean not null default true,
  day3_days integer not null default 3, day7_days integer not null default 7, day14_days integer not null default 14, day30_days integer not null default 30,
  day3_enabled boolean not null default true, day7_enabled boolean not null default true, day14_enabled boolean not null default true, day30_enabled boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());

-- fh_follow_ups as it stood before 091. 091 adds client_id and 096 adds lead_id
-- and quote_id, with the delete actions production has: contacts cascade,
-- clients, leads and quotes set null.
create table public.fh_follow_ups(
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,
  user_id uuid, kind text not null, channel text, due_on date,
  status text not null default 'queued' check (status in ('queued','done','skipped','sent')),
  headline text, draft_body text, stage_at_queue text, days_quiet integer, anchor_on date,
  created_at timestamptz not null default now(), completed_at timestamptz, completed_by uuid);
create index fh_follow_ups_contact_kind_idx on public.fh_follow_ups(contact_id, kind, created_at desc);
create unique index fh_follow_ups_one_open_per_contact_kind_idx on public.fh_follow_ups(contact_id, kind) where status = 'queued';

create table public.fh_notifications(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade, actor_user_id uuid,
  kind text not null, title text not null, body text, link text, read_at timestamptz, created_at timestamptz not null default now());
create table public.fh_stage_transitions(contact_id uuid, to_stage text, transitioned_at timestamptz);
grant usage on schema public to anon, authenticated, service_role;
`

/** A fresh database with the live reminder engine and the live Done and Dismiss. */
async function makeDb(label) {
  const db = await auditDatabase(label)
  await db.exec(BASELINE)
  await db.exec(await read('migrations/091_follow_up_engine_per_client.sql'))
  const m096 = await read('migrations/096_engine_reads_leads_quotes.sql')
  await db.exec(m096)
  const guards = await read('migrations/20261101020547_authorization_transition_guards.sql')
  await db.exec(guards.match(/CREATE OR REPLACE FUNCTION public\.fh_follow_up_set_status[\s\S]*?\$function\$;/)[0])
  const body = m096.match(/create or replace function public\.fh_run_follow_up_engine[\s\S]*?as \$function\$([\s\S]*?)\$function\$;/)[1]
  const stripped = '\n' + body.split('\n').filter(l => !/^\s*--/.test(l) && l.trim() !== '').join('\n') + '\n'
  assert.equal(crypto.createHash('md5').update(stripped).digest('hex'), LIVE_ENGINE_MD5, 'the base engine is the one production runs')
  return db
}

async function seedOrg(db, { org = 100, enabled = true, name = 'Synthetic Concrete Co.' } = {}) {
  await db.query('insert into public.organizations(id, name) values ($1, $2)', [id(org), name])
  for (const [user, role] of [[1, 'owner'], [2, 'manager']]) {
    await db.query('insert into auth.users(id) values ($1) on conflict do nothing', [id(user)])
    await db.query('insert into public.org_members(org_id, user_id, role) values ($1,$2,$3)', [id(org), id(user), role])
  }
  await db.query('insert into public.fh_follow_up_settings(org_id, enabled, from_name) values ($1,$2,$3)', [id(org), enabled, name])
}

let seq = 1000
const nextId = () => id(++seq)
async function addClient(db, { org = 100, user = 1, name = 'Fixture Customer', phone = '615-555-0100', email = null } = {}) {
  const cid = nextId()
  await db.query('insert into public.fh_clients(id, org_id, user_id, name, phone, email) values ($1,$2,$3,$4,$5,$6)', [cid, id(org), id(user), name, phone, email])
  return cid
}
async function addLead(db, client, { org = 100, user = 1, daysAgo = 0, status = 'open', title = 'Driveway', origin = null } = {}) {
  const lid = nextId()
  await db.query(
    `insert into public.fh_leads(id, org_id, user_id, client_id, title, status, origin_contact_id, created_at)
     values ($1,$2,$3,$4,$5,$6,$7, now() - make_interval(days => $8))`,
    [lid, id(org), id(user), client, title, status, origin, daysAgo])
  return lid
}
async function addQuote(db, client, { org = 100, user = 1, sentDaysAgo = 0, status = 'sent', title = 'Patio', lead = null } = {}) {
  const qid = nextId()
  await db.query(
    `insert into public.fh_quotes(id, org_id, user_id, client_id, title, status, lead_id, sent_at, created_at)
     values ($1,$2,$3,$4,$5,$6,$7, case when $6 = 'draft' then null else now() - make_interval(days => $8) end, now() - make_interval(days => $8 + 1))`,
    [qid, id(org), id(user), client, title, status, lead, sentDaysAgo])
  return qid
}
async function addJob(db, client, { org = 100, user = 1, stage = 'job', name = 'Fixture Customer', completedDaysAgo = null, createdDaysAgo = 40 } = {}) {
  const jid = nextId()
  await db.query(
    `insert into public.fh_contacts(id, org_id, user_id, client_id, name, stage, completed_at, created_at)
     values ($1,$2,$3,$4,$5,$6, case when $7::int is null then null else now() - make_interval(days => $7::int) end, now() - make_interval(days => $8))`,
    [jid, id(org), id(user), client, name, stage, completedDaysAgo, createdDaysAgo])
  return jid
}

const runEngine = async db => (await db.query('select public.fh_run_follow_up_engine() as r')).rows[0].r
/** Move every date N days into the past, which is the clock moving N days on. */
async function advanceDays(db, n) {
  await db.exec(`
    update public.fh_leads set created_at = created_at - interval '${n} days', last_contact = last_contact - ${n};
    update public.fh_quotes set created_at = created_at - interval '${n} days', sent_at = sent_at - interval '${n} days', change_requested_at = change_requested_at - interval '${n} days';
    update public.fh_contacts set created_at = created_at - interval '${n} days', completed_at = completed_at - interval '${n} days';
    update public.fh_follow_ups set created_at = created_at - interval '${n} days', completed_at = completed_at - interval '${n} days', due_on = due_on - ${n}, anchor_on = anchor_on - ${n};
    update public.fh_notifications set created_at = created_at - interval '${n} days', read_at = read_at - interval '${n} days';
  `)
}
async function asUser(db, user) {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user == null ? '' : id(user)])
}
const rows = async (db, sql, args = []) => (await db.query(sql, args)).rows
const one = async (db, sql, args = []) => (await db.query(sql, args)).rows[0]
const followUps = (db, where = 'true') => rows(db, `select id, kind, status, lead_id, quote_id, contact_id, client_id, user_id, headline from public.fh_follow_ups where ${where} order by created_at, kind`)
const notes = (db, where = 'true') => rows(db, `select id, user_id, kind, title, link, read_at from public.fh_notifications where ${where} order by created_at, title`)
const queued = db => followUps(db, "status = 'queued'")
const unread = db => notes(db, "read_at is null and kind in ('follow_up_due','review_ask_due')")
const closed = db => rows(db, "select kind, status, closed_reason from public.fh_follow_ups where status <> 'queued' order by created_at, kind")
const localToday = async db => (await one(db, "select (now() at time zone 'America/Chicago')::date::text as d")).d

let passed = 0
async function test(name, fn) {
  try {
    await fn()
  } catch (error) {
    console.log(`FAIL ${name}`)
    throw error
  }
  passed++
  console.log(`PASS ${name}`)
}

async function reset(db) {
  await db.exec('reset role')
  await db.exec(`truncate public.fh_notifications, public.fh_follow_ups, public.fh_quotes, public.fh_leads, public.fh_contacts,
                 public.fh_clients, public.fh_follow_up_settings, public.org_members, public.organizations cascade; delete from auth.users;`)
  await seedOrg(db)
}

// ---------------------------------------------------------------------------
// Part 1. The migration and the manual cleanup on rows shaped like production's.
// ---------------------------------------------------------------------------
{
  const db = await makeDb('followupcleanup')
  try {
    await seedOrg(db)
    // Leads reminded, then bulk skipped with their notifications left unread (2026-10-31).
    for (let i = 0; i < 6; i++) await addLead(db, await addClient(db, { name: `Skipped ${i}` }), { daysAgo: 30 })
    await runEngine(db)
    await db.exec("update public.fh_follow_ups set status = 'skipped', completed_at = now() where status = 'queued'")
    // Leads with a live reminder (queued, unread).
    for (let i = 0; i < 3; i++) await addLead(db, await addClient(db, { name: `Live ${i}` }), { daysAgo: 7 })
    await runEngine(db)
    // A quote era reminder still queued on a row that is now a finished job.
    const jc = await addClient(db, { name: 'Won Job' })
    const job = await addJob(db, jc, { stage: 'quote', name: 'Won Job' })
    await db.query(`insert into public.fh_follow_ups(org_id, contact_id, client_id, user_id, kind, channel, due_on, status, headline, draft_body, stage_at_queue, days_quiet, anchor_on)
                    values ($1,$2,$3,$4,'day14','text',current_date - 5,'queued','Day 14 close out ask: Won Job','x','quote',14,current_date - 19)`, [id(100), job, jc, id(1)])
    await db.query(`insert into public.fh_notifications(user_id, org_id, kind, title, body, link, read_at) values ($1,$2,'follow_up_due','Day 14 close out ask: Won Job','x',$3, now())`, [id(1), id(100), `/jobs/${job}`])
    await db.query("update public.fh_contacts set stage = 'job', completed_at = now() - interval '2 days' where id = $1", [job])
    await runEngine(db)
    // The quote was deleted while its reminder was open.
    const oq = await addQuote(db, await addClient(db, { name: 'Deleted Quote' }), { sentDaysAgo: 3 })
    await runEngine(db)
    await db.query('delete from public.fh_quotes where id = $1', [oq])
    // A lead marked lost while its reminder was open.
    const ll = await addLead(db, await addClient(db, { name: 'Lost Lead' }), { daysAgo: 14 })
    await runEngine(db)
    await db.query("update public.fh_leads set status = 'lost' where id = $1", [ll])
    // A review ask nobody answered for 100 days.
    const rc = await addClient(db, { name: 'Old Review' })
    const rj = await addJob(db, rc, { stage: 'closed', completedDaysAgo: 100, name: 'Old Review', createdDaysAgo: 140 })
    await db.query(`insert into public.fh_follow_ups(org_id, contact_id, client_id, user_id, kind, status, headline, due_on, created_at) values ($1,$2,$3,$4,'review_ask','queued','Ask Old Review for a review',current_date - 100, now() - interval '100 days')`, [id(100), rj, rc, id(1)])
    await db.query(`insert into public.fh_notifications(user_id, org_id, kind, title, link, created_at) values ($1,$2,'review_ask_due','Ask Old Review for a review',$3, now() - interval '100 days')`, [id(1), id(100), `/jobs/${rj}`])
    // A customer whose phone was removed after the reminder was raised.
    const uc = await addClient(db, { name: 'No Phone Now' })
    await addLead(db, uc, { daysAgo: 3 })
    await runEngine(db)
    await db.query('update public.fh_clients set phone = null where id = $1', [uc])

    await test('before the migration a bulk close leaves stale unread reminders (AUTO-01)', async () => {
      const stale = await one(db, `select count(*)::int as n from public.fh_notifications n where n.read_at is null and n.kind = 'follow_up_due'
        and not exists (select 1 from public.fh_follow_ups f where f.headline = n.title and f.status = 'queued' and n.link like '%' || coalesce(f.lead_id, f.quote_id, f.contact_id)::text)`)
      assert.ok(stale.n >= 6, `${stale.n} stale unread`)
    })

    await test('the migration applies on top of the live engine, twice, and links every notification it can', async () => {
      const m = await read(MIGRATION)
      await db.exec(m); await db.exec(m)
      const linked = await one(db, "select count(*) filter (where follow_up_id is not null)::int as linked, count(*)::int as total from public.fh_notifications where kind in ('follow_up_due','review_ask_due')")
      // The one left is the deleted quote's: its follow up no longer names a record.
      assert.equal(linked.linked, linked.total - 1)
    })

    const snapshot = async () => JSON.stringify(await rows(db, `select 'f' as t, id::text, status, coalesce(closed_reason,'') as x from public.fh_follow_ups
      union all select 'n', id::text, coalesce(read_at::text,''), coalesce(follow_up_id::text,'') from public.fh_notifications order by 1,2`))
    let dry
    await test('the reconcile dry run reports and changes nothing', async () => {
      const before = await snapshot()
      dry = (await one(db, 'select public.fh_follow_up_reconcile(false) as r')).r
      assert.equal(await snapshot(), before)
      assert.equal(dry.applied, false)
      // 6 bulk skipped, the deleted quote's, the lost lead's, the old review ask's and the unreachable customer's.
      assert.equal(dry.notifications_marked_read, 10)
      assert.equal(dry.of_those_follow_up_was_already_closed, 6)
      assert.equal(dry.of_those_no_follow_up_left, 1)
      assert.equal(dry.closed_record_deleted, 1)
      assert.equal(dry.closed_lead_not_open_or_quoted, 1)
      assert.equal(dry.closed_pipeline_on_job_row, 1)
      assert.equal(dry.closed_expired, 1)
      assert.equal(dry.closed_unreachable, 1)
      assert.equal(dry.closed_superseded, 0)
      assert.equal(dry.still_queued, 4); assert.equal(dry.still_unread_reminders, 4)
    })

    const cleanup = await read(CLEANUP)
    await test('the manual cleanup file run as it stands changes nothing', async () => {
      const before = await snapshot()
      await db.exec(cleanup)
      assert.equal(await snapshot(), before)
    })

    await test('the manual cleanup with step 2 committed does what the dry run said, and a second reconcile finds nothing', async () => {
      const apply = cleanup.replace(/rollback;(\s*-- end of step 2)/, 'commit;$1')
      assert.notEqual(apply, cleanup, 'step 2 has the marker the operator edits')
      await db.exec(apply)
      const again = (await one(db, 'select public.fh_follow_up_reconcile(true) as r')).r
      for (const k of ['notifications_linked', 'closed_record_deleted', 'closed_lead_not_open_or_quoted', 'closed_quote_not_waiting', 'closed_pipeline_on_job_row',
        'closed_review_ask', 'closed_unreachable', 'closed_superseded', 'closed_expired', 'notifications_marked_read']) assert.equal(again[k], 0, k)
      assert.equal(again.still_queued, dry.still_queued)
      assert.deepEqual((await queued(db)).map(f => f.kind).sort(), ['day7', 'day7', 'day7', 'review_ask'])
      assert.equal((await unread(db)).length, 4)
      const stale = await one(db, `select count(*)::int as n from public.fh_notifications n left join public.fh_follow_ups f on f.id = n.follow_up_id
                                   where n.kind in ('follow_up_due','review_ask_due') and n.read_at is null and (f.id is null or f.status <> 'queued')`)
      assert.equal(stale.n, 0)
    })

    await test('the unique indexes build after the cleanup, twice', async () => {
      const m = await read(INDEXES)
      await db.exec(m); await db.exec(m)
      const idx = await rows(db, "select indexname from pg_indexes where indexname in ('fh_follow_ups_one_open_per_lead_person_idx','fh_follow_ups_one_open_per_quote_person_idx','fh_notifications_one_per_follow_up_person_idx')")
      assert.equal(idx.length, 3)
    })
  } finally {
    await db.close()
  }
}

// ---------------------------------------------------------------------------
// Part 2. The rules, from a clean database with both migrations applied.
// ---------------------------------------------------------------------------
const db = await makeDb('followuprules')
try {
  await seedOrg(db)
  await test('the index migration stops with a plain message while duplicates are open', async () => {
    await db.exec(await read(MIGRATION))
    const c = await addClient(db, { name: 'Dupe' })
    const l = await addLead(db, c, { daysAgo: 30 })
    for (const kind of ['day3', 'day30']) {
      await db.query(`insert into public.fh_follow_ups(org_id, lead_id, client_id, user_id, kind, status, headline, due_on) values ($1,$2,$3,$4,$5,'queued','h',current_date)`, [id(100), l, c, id(1), kind])
    }
    await assert.rejects(db.exec(await read(INDEXES)), /Run the cleanup in supabase\/manual\/20261117_follow_up_cleanup\.sql first: 1 leads/)
    assert.equal((await one(db, 'select public.fh_follow_up_reconcile(true) as r')).r.closed_superseded, 1)
    await db.exec(await read(INDEXES))
  })

  await reset(db)
  await test('Done closes the follow up, reads the notification, clears the lead date and restarts its quiet clock (AUTO-06)', async () => {
    const l = await addLead(db, await addClient(db, { name: 'Ada Done' }), { daysAgo: 3 })
    await runEngine(db)
    const [n] = await unread(db)
    assert.ok((await one(db, 'select follow_up_on from public.fh_leads where id = $1', [l])).follow_up_on)
    await asUser(db, 1)
    await db.query("select public.fh_follow_up_set_status($1, 'done')", [n.id])
    await db.exec('reset role')
    const f = await one(db, 'select status, closed_reason, completed_by from public.fh_follow_ups')
    const lead = await one(db, 'select follow_up_on, last_contact::text as last_contact from public.fh_leads where id = $1', [l])
    assert.deepEqual([f.status, f.closed_reason, f.completed_by], ['done', 'done', id(1)])
    assert.equal((await unread(db)).length, 0)
    assert.equal(lead.follow_up_on, null); assert.equal(lead.last_contact, await localToday(db))
    await advanceDays(db, 1); assert.equal((await runEngine(db)).pipeline_queued, 0)
    await advanceDays(db, 2); assert.equal((await runEngine(db)).pipeline_queued, 1)
  })

  await reset(db)
  await test('Dismiss closes and reads; the cadence carries on to the next tier', async () => {
    const l = await addLead(db, await addClient(db, { name: 'Bo Dismiss' }), { daysAgo: 3 })
    await runEngine(db)
    const [n] = await unread(db)
    await asUser(db, 1)
    await db.query("select public.fh_follow_up_set_status($1, 'dismissed')", [n.id])
    await db.exec('reset role')
    const f = await one(db, 'select status, closed_reason from public.fh_follow_ups')
    assert.deepEqual([f.status, f.closed_reason], ['skipped', 'dismissed'])
    assert.equal((await unread(db)).length, 0)
    assert.equal((await one(db, 'select last_contact from public.fh_leads where id = $1', [l])).last_contact, null)
    await advanceDays(db, 1); assert.equal((await runEngine(db)).pipeline_queued, 0)
    await advanceDays(db, 3)
    assert.equal((await runEngine(db)).pipeline_queued, 1); assert.equal((await queued(db))[0].kind, 'day7')
  })

  await reset(db)
  await test('a bulk close by plain SQL reads every notification (AUTO-01)', async () => {
    for (let i = 0; i < 5; i++) await addLead(db, await addClient(db, { name: `Bulk ${i}` }), { daysAgo: 30 })
    await runEngine(db)
    assert.equal((await unread(db)).length, 5)
    await db.exec("update public.fh_follow_ups set status = 'skipped' where status = 'queued'")
    assert.equal((await unread(db)).length, 0)
    assert.ok((await closed(db)).every(f => f.closed_reason === 'closed'))
    assert.equal(Number((await one(db, 'select count(*) as n from public.fh_follow_ups where completed_at is null')).n), 0)
  })

  for (const [label, change] of [['lead marked lost', "update public.fh_leads set status = 'lost'"], ['lead quoted', "update public.fh_leads set status = 'quoted'"]]) {
    await reset(db)
    await test(`${label}: its reminder closes and the notification is read (AUTO-02)`, async () => {
      await addLead(db, await addClient(db, { name: 'Cal Lead' }), { daysAgo: 7 })
      await runEngine(db)
      await db.exec(change)
      assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
      assert.equal((await closed(db))[0].closed_reason, 'record_closed')
    })
  }

  await reset(db)
  await test('a quote made from a lead closes the lead reminder as soon as the quote row exists (AUTO-02)', async () => {
    const c = await addClient(db, { name: 'Quo Lead' })
    const l = await addLead(db, c, { daysAgo: 7 })
    await runEngine(db)
    await addQuote(db, c, { status: 'draft', lead: l })
    assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
  })

  for (const status of ['approved', 'rejected', 'lost', 'expired']) {
    await reset(db)
    await test(`quote ${status}: its reminder closes and the notification is read (AUTO-02)`, async () => {
      await addQuote(db, await addClient(db, { name: 'Dee Quote' }), { sentDaysAgo: 7 })
      await runEngine(db)
      await db.query('update public.fh_quotes set status = $1', [status])
      assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
    })
  }

  await reset(db)
  await test('quote made into a job: closed and read (AUTO-02)', async () => {
    const c = await addClient(db, { name: 'Eve Convert' })
    const q = await addQuote(db, c, { sentDaysAgo: 7 })
    await runEngine(db)
    await db.query('update public.fh_quotes set job_id = $1 where id = $2', [await addJob(db, c, { stage: 'job' }), q])
    assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
  })

  await reset(db)
  await test('a quote past its valid until date is closed by the next run and never reminded again (AUTO-12)', async () => {
    const q = await addQuote(db, await addClient(db, { name: 'Fay Expires' }), { sentDaysAgo: 7 })
    await db.query("update public.fh_quotes set expires_at = now() + interval '2 days' where id = $1", [q])
    await runEngine(db)
    assert.equal((await queued(db)).length, 1)
    for (let d = 0; d < 30; d++) { await advanceDays(db, 1); await db.query("update public.fh_quotes set expires_at = expires_at - interval '1 day'"); await runEngine(db) }
    assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
    assert.equal(Number((await one(db, 'select count(*) as n from public.fh_follow_ups')).n), 1)
  })

  await reset(db)
  await test('a quote sent again closes the old cycle; a fresh day3 comes three days later (AUTO-08)', async () => {
    const q = await addQuote(db, await addClient(db, { name: 'Gia Resent' }), { sentDaysAgo: 0 })
    for (let day = 1; day <= 7; day++) { await advanceDays(db, 1); await runEngine(db) }
    assert.deepEqual((await queued(db)).map(f => f.kind), ['day7'])
    await advanceDays(db, 1)
    await db.query('update public.fh_quotes set sent_at = now() where id = $1', [q])
    assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
    for (let day = 1; day <= 3; day++) { await advanceDays(db, 1); await runEngine(db) }
    assert.deepEqual((await queued(db)).map(f => f.kind), ['day3']); assert.equal((await unread(db)).length, 1)
  })

  await reset(db)
  await test('a deleted quote closes its reminder instead of leaving an orphan that blocks the customer (AUTO-05)', async () => {
    const c = await addClient(db, { name: 'Hal Gone' })
    const q = await addQuote(db, c, { sentDaysAgo: 3 })
    await runEngine(db)
    await db.query('delete from public.fh_quotes where id = $1', [q])
    assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
    assert.equal((await closed(db))[0].closed_reason, 'record_deleted')
    await addQuote(db, c, { sentDaysAgo: 3, title: 'New quote' })
    assert.equal((await runEngine(db)).pipeline_queued, 1)
  })

  await reset(db)
  await test('a deleted job or client leaves no unread reminder behind (AUTO-05)', async () => {
    const c1 = await addClient(db, { name: 'Ian Job' }), c2 = await addClient(db, { name: 'Jan Client' })
    const j = await addJob(db, c1, { completedDaysAgo: 1, name: 'Ian Job' })
    await addLead(db, c2, { daysAgo: 3 })
    await runEngine(db)
    assert.equal((await unread(db)).length, 2)
    await db.query('delete from public.fh_contacts where id = $1', [j])
    await db.query('delete from public.fh_clients where id = $1', [c2])
    assert.equal((await unread(db)).length, 0); assert.equal((await queued(db)).length, 0)
  })

  await reset(db)
  await test('job rows: a won deal closes its pipeline reminder and reopening work closes the review ask (AUTO-02)', async () => {
    const c = await addClient(db, { name: 'Kai Job' })
    const j = await addJob(db, c, { stage: 'quote', name: 'Kai Job' })
    await db.query(`insert into public.fh_follow_ups(org_id, contact_id, client_id, user_id, kind, status, headline, due_on) values ($1,$2,$3,$4,'day14','queued','Day 14 close out ask: Kai Job',current_date)`, [id(100), j, c, id(1)])
    await db.query("update public.fh_contacts set stage = 'job' where id = $1", [j])
    assert.equal((await queued(db)).length, 0)
    await db.query("update public.fh_contacts set completed_at = now() - interval '1 day' where id = $1", [j])
    await runEngine(db)
    assert.deepEqual((await queued(db)).map(f => f.kind), ['review_ask'])
    await db.query('update public.fh_contacts set completed_at = null where id = $1', [j])
    assert.equal((await queued(db)).length, 0); assert.equal((await unread(db)).length, 0)
  })

  await reset(db)
  await test('a newer tier supersedes the older one: one quiet lead never has more than one open or unread reminder (AUTO-03)', async () => {
    await addLead(db, await addClient(db, { name: 'Lou Single' }), { daysAgo: 0 })
    let maxQ = 0, maxU = 0
    for (let day = 1; day <= 31; day++) {
      await advanceDays(db, 1); await runEngine(db)
      maxQ = Math.max(maxQ, (await queued(db)).length); maxU = Math.max(maxU, (await unread(db)).length)
    }
    assert.equal(maxQ, 1); assert.equal(maxU, 1)
    assert.deepEqual((await queued(db)).map(f => f.kind), ['day30'])
    assert.deepEqual((await closed(db)).map(f => `${f.kind}/${f.closed_reason}`), ['day3/superseded', 'day7/superseded', 'day14/superseded'])
  })

  await reset(db)
  await test('the database holds one open reminder per record and person, and one notification per follow up (AUTO-03)', async () => {
    const c = await addClient(db, { name: 'Max Unique' })
    const l = await addLead(db, c, { daysAgo: 3 })
    await runEngine(db)
    await assert.rejects(
      db.query(`insert into public.fh_follow_ups(org_id, lead_id, client_id, user_id, kind, status, headline, due_on) values ($1,$2,$3,$4,'day30','queued','h',current_date)`, [id(100), l, c, id(1)]),
      e => e.code === '23505')
    const f = (await followUps(db))[0], n = (await notes(db))[0]
    await assert.rejects(
      db.query(`insert into public.fh_notifications(user_id, org_id, kind, title, follow_up_id) values ($1,$2,'follow_up_due','again',$3)`, [n.user_id, id(100), f.id]),
      e => e.code === '23505')
  })

  await reset(db)
  await test('records that should not be reminded get nothing (AUTO-12)', async () => {
    const mk = name => addClient(db, { name })
    await addLead(db, await mk('lost lead'), { daysAgo: 7, status: 'lost' })
    await addLead(db, await mk('quoted lead'), { daysAgo: 7, status: 'quoted' })
    const cq = await mk('open lead with a quote')
    const lq = await addLead(db, cq, { daysAgo: 7 })
    await db.exec('alter table public.fh_quotes disable trigger fh_quotes_new_closes_lead_follow_ups')
    await addQuote(db, cq, { status: 'draft', lead: lq })
    await db.exec('alter table public.fh_quotes enable trigger fh_quotes_new_closes_lead_follow_ups')
    for (const s of ['draft', 'approved', 'rejected', 'expired', 'lost']) await addQuote(db, await mk(`quote ${s}`), { sentDaysAgo: 7, status: s })
    const qe = await addQuote(db, await mk('quote past its date'), { sentDaysAgo: 30 })
    await db.query("update public.fh_quotes set expires_at = now() - interval '5 days' where id = $1", [qe])
    const cj = await mk('quote already a job'); const qj = await addQuote(db, cj, { sentDaysAgo: 7 })
    await db.query('update public.fh_quotes set job_id = $1 where id = $2', [await addJob(db, cj, { stage: 'job' }), qj])
    await addLead(db, await addClient(db, { name: 'no phone no email', phone: null, email: null }), { daysAgo: 7 })
    await addLead(db, await addClient(db, { name: 'blank phone', phone: '  ', email: '' }), { daysAgo: 7 })
    await addJob(db, await mk('lost job'), { stage: 'lost', completedDaysAgo: 2 })
    await addJob(db, await mk('moved row'), { stage: 'moved_lead', completedDaysAgo: 2 })
    await addJob(db, await addClient(db, { name: 'finished, unreachable', phone: null, email: null }), { stage: 'closed', completedDaysAgo: 2 })
    await db.query("insert into public.organizations(id, name) values ($1,'Off Co')", [id(200)])
    await db.query('insert into public.org_members(org_id, user_id, role) values ($1,$2,$3)', [id(200), id(1), 'owner'])
    await db.query('insert into public.fh_follow_up_settings(org_id, enabled) values ($1,false)', [id(200)])
    await addLead(db, await addClient(db, { org: 200, name: 'off company lead' }), { org: 200, daysAgo: 7 })
    const res = await runEngine(db)
    assert.equal(res.pipeline_queued, 0); assert.equal(res.review_asks_queued, 0)
    assert.equal((await followUps(db)).length, 0)
  })

  await reset(db)
  await test('a customer with only an email is reminded by email; day7 is a call only with a phone (AUTO-12)', async () => {
    await addLead(db, await addClient(db, { name: 'Email Only', phone: null, email: 'x@example.invalid' }), { daysAgo: 7 })
    await addLead(db, await addClient(db, { name: 'Has Phone' }), { daysAgo: 7 })
    await runEngine(db)
    const f = await rows(db, 'select c.name, f.channel from public.fh_follow_ups f join public.fh_clients c on c.id = f.client_id order by c.name')
    assert.deepEqual(f.map(x => `${x.name}:${x.channel}`), ['Email Only:email', 'Has Phone:call'])
  })

  await reset(db)
  await test('the creator left the company: the owner gets the reminder (AUTO-11, database part)', async () => {
    await addLead(db, await addClient(db, { name: 'Ned Former' }), { daysAgo: 3, user: 2 })
    await db.query('update public.org_members set revoked_at = now() where user_id = $1', [id(2)])
    await runEngine(db)
    const u = await unread(db)
    assert.equal(u.length, 1); assert.equal(u[0].user_id, id(1))
  })

  await reset(db)
  await test('a moved record keeps its history: a tier dismissed on the old contact row is not raised again (AUTO-04)', async () => {
    const c = await addClient(db, { name: 'Oz Moved' })
    const old = await addJob(db, c, { stage: 'moved_lead', name: 'Oz Moved', createdDaysAgo: 35 })
    await db.query(`insert into public.fh_follow_ups(org_id, contact_id, client_id, user_id, kind, status, headline, due_on, anchor_on, created_at, completed_at, completed_by)
                    values ($1,$2,$3,$4,'day30','skipped','Day 30 revival: Oz Moved',current_date - 3,current_date - 35, now() - interval '3 days', now() - interval '2 days', $4)`, [id(100), old, c, id(1)])
    await addLead(db, c, { daysAgo: 35, origin: old })
    assert.equal((await runEngine(db)).pipeline_queued, 0)
  })

  await reset(db)
  await test('lead copy does not talk about an estimate the customer never got, and has no dashes (AUTO-12)', async () => {
    await addLead(db, await addClient(db, { name: 'Pat Lead' }), { daysAgo: 3 })
    await addQuote(db, await addClient(db, { name: 'Quin Quote' }), { sentDaysAgo: 3 })
    await runEngine(db)
    const f = await rows(db, 'select stage_at_queue, draft_body from public.fh_follow_ups order by stage_at_queue')
    assert.doesNotMatch(f[0].draft_body, /estimate reached you/); assert.match(f[1].draft_body, /estimate reached you/)
    for (const x of f) assert.doesNotMatch(x.draft_body, /[–—]| - /)
  })

  await reset(db)
  await test('switching reminders on does not flood: the daily cap holds and long dead records are left alone (AUTO-04)', async () => {
    await db.exec('update public.fh_follow_up_settings set enabled = false')
    for (let i = 0; i < 40; i++) await addLead(db, await addClient(db, { name: `Old ${String(i).padStart(2, '0')}` }), { daysAgo: 20 + i * 3 })
    await db.exec('update public.fh_follow_up_settings set enabled = true')
    await runEngine(db)
    const perDay = [(await unread(db)).length]
    assert.ok(perDay[0] <= 10, `first day raised ${perDay[0]}`)
    for (let d = 0; d < 6; d++) { await advanceDays(db, 1); await runEngine(db); perDay.push((await unread(db)).length) }
    const oldest = await one(db, 'select max(days_quiet)::int as d from public.fh_follow_ups')
    assert.ok(oldest.d <= 44, `oldest reminded lead was quiet ${oldest.d} days`)
    for (let i = 1; i < perDay.length; i++) assert.ok(perDay[i] - perDay[i - 1] <= 10)
  })

  await reset(db)
  await test('the daily cap per person: 25 leads go quiet together, 10 a day, and the company setting lowers it (AUTO-04)', async () => {
    for (let i = 0; i < 25; i++) await addLead(db, await addClient(db, { name: `Wave ${String(i).padStart(2, '0')}` }), { daysAgo: 7 })
    const perDay = []
    for (let d = 0; d < 4; d++) { const res = await runEngine(db); perDay.push([res.pipeline_queued, res.held_by_daily_cap]); await advanceDays(db, 1) }
    assert.deepEqual(perDay, [[10, 15], [10, 5], [5, 0], [0, 0]])
    await db.exec('update public.fh_follow_up_settings set max_new_per_day = 3')
    for (let i = 0; i < 5; i++) await addLead(db, await addClient(db, { name: `Late ${i}` }), { daysAgo: 3 })
    assert.equal((await runEngine(db)).pipeline_queued, 3)
  })

  await reset(db)
  await test('days are counted in the company time zone: evening and morning leads of one local day are reminded together (AUTO-13)', async () => {
    const morning = await addClient(db, { name: 'Una Morning' }), evening = await addClient(db, { name: 'Vic Evening' })
    await db.query(`insert into public.fh_leads(org_id, user_id, client_id, title, created_at) values
      ($1,$2,$3,'am', (((now() at time zone 'America/Chicago')::date - 3) + time '10:00') at time zone 'America/Chicago'),
      ($1,$2,$4,'pm', (((now() at time zone 'America/Chicago')::date - 3) + time '19:30') at time zone 'America/Chicago')`, [id(100), id(1), morning, evening])
    await runEngine(db)
    const f = await rows(db, 'select c.name, f.kind, f.due_on::text as due_on from public.fh_follow_ups f join public.fh_clients c on c.id = f.client_id order by c.name')
    assert.deepEqual(f.map(x => `${x.name}:${x.kind}`), ['Una Morning:day3', 'Vic Evening:day3'])
    assert.equal(f[0].due_on, await localToday(db))
  })

  await reset(db)
  await test('Dismiss on an old notification only touches its own follow up (AUTO-08)', async () => {
    const q = await addQuote(db, await addClient(db, { name: 'Wes Stale' }), { sentDaysAgo: 3 })
    await runEngine(db)
    const [n1] = await unread(db)
    await advanceDays(db, 2)
    await db.query('update public.fh_quotes set sent_at = now() where id = $1', [q])
    await advanceDays(db, 3); await runEngine(db)
    const before = await queued(db); assert.equal(before.length, 1)
    await asUser(db, 1)
    await db.query("select public.fh_follow_up_set_status($1, 'dismissed')", [n1.id])
    await db.exec('reset role')
    const after = await queued(db)
    assert.equal(after.length, 1); assert.equal(after[0].id, before[0].id)
  })

  await reset(db)
  await test('the engine is idempotent: a second run the same day adds nothing', async () => {
    for (let i = 0; i < 3; i++) await addLead(db, await addClient(db, { name: `Idem ${i}` }), { daysAgo: 7 })
    await addJob(db, await addClient(db, { name: 'Idem job' }), { stage: 'closed', completedDaysAgo: 1, name: 'Idem job' })
    const a = await runEngine(db), b = await runEngine(db)
    assert.deepEqual([a.pipeline_queued, a.review_asks_queued], [3, 1]); assert.deepEqual([b.pipeline_queued, b.review_asks_queued, b.superseded], [0, 0, 0])
    assert.equal((await unread(db)).length, 4)
  })

  await reset(db)
  await test('a read reminder stays open and listed, and a later lead of the same customer is not starved (AUTO-07)', async () => {
    const c = await addClient(db, { name: 'Xia Read' })
    await addLead(db, c, { daysAgo: 3, title: 'First job' })
    await runEngine(db)
    await db.exec('update public.fh_notifications set read_at = now() where read_at is null')
    await asUser(db, 1)
    const mine = await rows(db, 'select * from public.fh_my_open_reminders()')
    await db.exec('reset role')
    assert.equal(mine.length, 1); assert.equal(mine[0].client_name, 'Xia Read'); assert.ok(mine[0].read_at)
    for (let d = 0; d < 60; d++) { await advanceDays(db, 1); await runEngine(db) }
    await addLead(db, c, { daysAgo: 3, title: 'Second job' })
    assert.equal((await runEngine(db)).pipeline_queued, 1)
    const q = await rows(db, "select l.title, f.kind from public.fh_follow_ups f join public.fh_leads l on l.id = f.lead_id where f.status = 'queued' order by l.title")
    assert.deepEqual(q.map(x => `${x.title}:${x.kind}`), ['First job:day30', 'Second job:day3'])
    for (let d = 0; d < 20; d++) { await advanceDays(db, 1); await runEngine(db) }
    const later = await one(db, "select f.status, f.closed_reason from public.fh_follow_ups f join public.fh_leads l on l.id = f.lead_id where l.title = 'First job' and f.kind = 'day30'")
    assert.deepEqual([later.status, later.closed_reason], ['skipped', 'expired'])
  })

  await reset(db)
  await test('fh_my_open_reminders returns the caller\'s open reminders only, with the client to group by and how to reach them (AUTO-09)', async () => {
    const a = await addClient(db, { name: 'Zed Last', phone: null, email: 'zed@example.invalid' }), b = await addClient(db, { name: 'Amy First' })
    await addLead(db, a, { daysAgo: 7 }); await addQuote(db, b, { sentDaysAgo: 3 })
    await addLead(db, await addClient(db, { name: 'Teammate Lead' }), { daysAgo: 3, user: 2 })
    await addJob(db, b, { stage: 'closed', completedDaysAgo: 1, name: 'Amy First' })
    await runEngine(db)
    await asUser(db, 1)
    const mine = await rows(db, 'select client_name, client_phone, client_email, kind, record_kind, link from public.fh_my_open_reminders()')
    await asUser(db, 2)
    const theirs = await rows(db, 'select client_name from public.fh_my_open_reminders()')
    await asUser(db, 9)
    const stranger = await rows(db, 'select * from public.fh_my_open_reminders()')
    await db.exec('reset role')
    assert.deepEqual(mine.map(m => m.client_name), ['Amy First', 'Amy First', 'Zed Last'])
    assert.deepEqual(mine.map(m => m.record_kind).sort(), ['job', 'lead', 'quote'])
    assert.deepEqual([mine[2].client_phone, mine[2].client_email], [null, 'zed@example.invalid'])
    assert.deepEqual(theirs.map(m => m.client_name), ['Teammate Lead']); assert.equal(stranger.length, 0)
  })

  await reset(db)
  await test('the guards of 20261101020547 still refuse another person, a signed out caller, a removed member and a bad status', async () => {
    await addLead(db, await addClient(db, { name: 'Guard' }), { daysAgo: 3 })
    await runEngine(db)
    const [n] = await unread(db)
    await asUser(db, 2)
    await assert.rejects(db.query("select public.fh_follow_up_set_status($1, 'done')", [n.id]), /does not belong to the caller/)
    await asUser(db, null)
    await assert.rejects(db.query("select public.fh_follow_up_set_status($1, 'done')", [n.id]), /does not belong to the caller/)
    await db.exec('reset role')
    await db.query('update public.org_members set revoked_at = now() where user_id = $1', [id(1)])
    await asUser(db, 1)
    await assert.rejects(db.query("select public.fh_follow_up_set_status($1, 'done')", [n.id]), /does not belong to the caller/)
    await assert.rejects(db.query("select public.fh_follow_up_set_status($1, null)", [n.id]), /status must be done or dismissed/)
    await assert.rejects(db.query("select public.fh_follow_up_set_status($1, 'nope')", [n.id]), /status must be done or dismissed/)
    await db.exec('reset role')
    assert.equal((await queued(db)).length, 1)
  })

  await reset(db)
  await test('only signed in people may call the screen functions; the engine, reconcile and close helpers stay server only', async () => {
    const grants = await rows(db, `select p.proname, has_function_privilege('authenticated', p.oid, 'execute') as auth, has_function_privilege('anon', p.oid, 'execute') as anon
      from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'public'
       and p.proname in ('fh_my_open_reminders','fh_follow_up_set_status','fh_run_follow_up_engine','fh_follow_up_reconcile','fh_follow_up_close') order by 1`)
    assert.deepEqual(grants.map(g => `${g.proname}:${g.auth}:${g.anon}`), [
      'fh_follow_up_close:false:false', 'fh_follow_up_reconcile:false:false', 'fh_follow_up_set_status:true:false',
      'fh_my_open_reminders:true:false', 'fh_run_follow_up_engine:false:false'
    ])
  })

  await reset(db)
  await test('review asks: one per finished job and client, linked to its notification, 180 day rule holds', async () => {
    const c = await addClient(db, { name: 'Rev Client' })
    await addJob(db, c, { stage: 'closed', completedDaysAgo: 2, name: 'Rev Client' })
    await addJob(db, c, { stage: 'job', completedDaysAgo: 1, name: 'Rev Client' })
    assert.equal((await runEngine(db)).review_asks_queued, 1)
    assert.ok((await one(db, "select follow_up_id from public.fh_notifications where kind = 'review_ask_due'")).follow_up_id)
    await advanceDays(db, 10)
    await addJob(db, c, { stage: 'closed', completedDaysAgo: 1, name: 'Rev Client' })
    assert.equal((await runEngine(db)).review_asks_queued, 0)
  })

  console.log(`${passed} follow up checks passed.`)
} finally {
  await db.close()
}
