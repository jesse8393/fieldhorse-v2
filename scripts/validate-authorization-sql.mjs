// Actual deployed function definitions, isolated synthetic rows and roles.
// This does not apply migrations to the application or impersonate real users.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('authorization')
const read = path => readFile(new URL(`../supabase/${path}`, import.meta.url), 'utf8')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; console.log(`PASS ${message}`) }
const denied = async (work, message) => { await assert.rejects(work, /unauthorized|does not belong|status must be/); checks++; console.log(`PASS ${message}`) }
const scope = async (user = 1, session = db) => {
  await session.query('reset role')
  await session.query("select set_config('request.jwt.claim.sub',$1,false)", [id(user)])
  await session.query('set role authenticated')
}
const approveSql = `select id,version_number from public.fn_approve_quote_version($1,$2,'{}'::jsonb,100,0,0,'in_person','Synthetic fixture',null,null,null,null,$3)`
const approve = (user, job = null, quote = 20, session = db) => session.query(approveSql, [id(user), job ? id(job) : null, quote ? id(quote) : null])
try {
  await db.exec(`
    ${auditRoles}
    create schema auth;
    create table auth.users(id uuid primary key,email text);
    create table public.fh_sub_profiles(id uuid primary key,org_id uuid,email text);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.org_members(org_id uuid,user_id uuid,role text,revoked_at timestamptz);
    create function public.fh_is_org_member(org uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.org_members where org_id=org and user_id=auth.uid() and revoked_at is null) $$;
    create function public.fh_money_visible(org uuid) returns boolean language sql stable security definer as $$ select not exists(select 1 from public.org_members where org_id=org and user_id=auth.uid() and revoked_at is null and role in ('crew','foreman')) $$;
    create table public.fh_contacts(id uuid primary key,user_id uuid,org_id uuid,approved_quote_version_id uuid,proposal_status text);
    create table public.fh_quotes(id uuid primary key,user_id uuid,org_id uuid,approved_version_id uuid,status text);
    create table public.fh_job_partners(job_id uuid,partner_user_id uuid,status text,deleted_by_partner_at timestamptz);
    create table public.fh_quote_versions(id uuid primary key default gen_random_uuid(),user_id uuid,org_id uuid,contact_id uuid,quote_id uuid,version_number integer,status text,snapshot jsonb,base_total numeric,optional_total numeric,excluded_count integer,approval_method text,approved_by_name text,approved_by_email text,approval_note text,signature_kind text,signature_data text,superseded_at timestamptz,superseded_by uuid);
    create unique index quote_versions on public.fh_quote_versions(quote_id,version_number) where quote_id is not null;
    create unique index job_versions on public.fh_quote_versions(contact_id,version_number) where contact_id is not null;
    create table public.fh_notifications(id uuid primary key,user_id uuid,org_id uuid,title text,link text,read_at timestamptz);
    create table public.fh_follow_ups(id uuid primary key,user_id uuid,org_id uuid,contact_id uuid,lead_id uuid,quote_id uuid,headline text,status text,completed_at timestamptz,completed_by uuid);
    grant usage on schema public,auth to authenticated;
    alter table public.fh_follow_ups enable row level security;
    create policy tenant on public.fh_follow_ups to authenticated using(public.fh_is_org_member(org_id));
    grant select on public.fh_follow_ups to authenticated;
    insert into public.org_members values
      ('${id(100)}','${id(1)}','owner',null),('${id(100)}','${id(2)}','manager',null),
      ('${id(100)}','${id(3)}','crew',null),('${id(100)}','${id(4)}','owner',now()),
      ('${id(100)}','${id(7)}','admin',null),('${id(100)}','${id(8)}','foreman',null);
    insert into public.fh_contacts(id,user_id,org_id) values ('${id(10)}','${id(4)}','${id(100)}'),('${id(11)}','${id(5)}','${id(200)}'),('${id(12)}','${id(1)}',null);
    insert into public.fh_quotes(id,user_id,org_id) values ('${id(20)}','${id(4)}','${id(100)}'),('${id(21)}','${id(3)}','${id(100)}'),('${id(22)}','${id(1)}',null);
    insert into public.fh_job_partners values ('${id(10)}','${id(6)}','accepted',null),('${id(10)}','${id(9)}','accepted',now());
    insert into auth.users values ('${id(6)}','active@example.test'),('${id(9)}','removed@example.test');
    insert into public.fh_sub_profiles values ('${id(50)}','${id(100)}','active@example.test'),('${id(51)}','${id(100)}','removed@example.test');
    insert into public.fh_notifications values ('${id(30)}','${id(1)}','${id(100)}','Fixture reminder','/jobs/${id(11)}',null),('${id(31)}','${id(1)}','${id(100)}','Fixture reminder','/jobs/${id(10)}',null),('${id(32)}','${id(4)}','${id(100)}','Fixture reminder','/jobs/${id(10)}',null);
    insert into public.fh_follow_ups(id,user_id,org_id,contact_id,headline,status) values ('${id(40)}','${id(5)}','${id(200)}','${id(11)}','Fixture reminder','queued'),('${id(41)}','${id(1)}','${id(100)}','${id(10)}','Fixture reminder','queued');
  `)
  await db.exec(await read('tests/fixtures/authorization_transition_baseline.sql'))
  await scope(1)
  equal((await db.query('select id from public.fh_follow_ups')).rows.map(r => r.id), [id(41)], 'direct RLS denies the foreign reminder')
  await db.query('select public.fh_follow_up_set_status($1,$2)', [id(30), 'done'])
  await db.exec('reset role')
  equal((await db.query('select status from public.fh_follow_ups where id=$1', [id(40)])).rows[0].status, 'done', 'baseline linked notification bypass changes a foreign reminder')
  await scope(4)
  equal((await approve(4)).rows.length, 1, 'baseline revoked quote creator still approves')
  await scope(3)
  equal((await approve(3, null, 21)).rows.length, 1, 'baseline demoted quote creator still approves')
  await db.exec("reset role; truncate public.fh_quote_versions; update public.fh_follow_ups set status='queued',completed_at=null,completed_by=null;")
  const migration = await read('migrations/20261101020547_authorization_transition_guards.sql')
  await db.exec(migration)
  await db.exec(migration)
  await scope(1)
  await db.query('select public.fh_follow_up_set_status($1,$2)', [id(30), 'done'])
  await db.exec('reset role')
  equal((await db.query('select status from public.fh_follow_ups where id=$1', [id(40)])).rows[0].status, 'queued', 'foreign reminder remains unchanged after the fix')
  await scope(1)
  await db.query('select public.fh_follow_up_set_status($1,$2)', [id(31), 'done'])
  equal((await db.query('select status from public.fh_follow_ups where id=$1', [id(41)])).rows[0].status, 'done', 'own company reminder completion still works')
  await denied(() => db.query('select public.fh_follow_up_set_status($1,null)', [id(31)]), 'null follow-up status rejected')
  await scope(4)
  await denied(() => db.query('select public.fh_follow_up_set_status($1,$2)', [id(32), 'dismissed']), 'revoked notification owner cannot alter company reminders')
  await scope(2)
  await denied(() => db.query('select public.fh_follow_up_set_status($1,$2)', [id(31), 'dismissed']), 'other member cannot complete a personal notification')
  for (const user of [3,4,5,8]) {
    await scope(user)
    await denied(() => approve(user, null, user === 3 ? 21 : 20), `user ${user}: demoted/revoked/nonmember quote approval denied`)
    await denied(() => approve(user, 10, null), `user ${user}: demoted/revoked/nonmember job approval denied`)
  }
  for (const user of [1,2,7]) {
    await scope(user)
    equal((await approve(user)).rows.length, 1, `active owner/manager/admin ${user} can approve a quote`)
    equal((await approve(user,10,null)).rows.length, 1, `active owner/manager/admin ${user} can approve a job`)
  }
  await scope(6); equal((await approve(6,10,null)).rows.length, 1, 'accepted job partner retains the existing approval capability')
  equal((await db.query('select public.fh_sub_profile_ids_for_caller() as id')).rows.map(r => r.id), [id(50)], 'active partner retains their vendor profile access')
  await scope(9); await denied(() => approve(9,10,null), 'removed partner cannot approve a job')
  equal((await db.query('select public.fh_sub_profile_ids_for_caller() as id')).rows.length, 0, 'removed partner loses vendor profile and storage binding')
  await scope(1)
  equal((await approve(1,null,22)).rows.length, 1, 'legacy solo quote owner still works')
  equal((await approve(1,12,null)).rows.length, 1, 'legacy solo job owner still works')
  if (db.openSession) {
    for (const [job,quote] of [[null,20],[10,null]]) {
      const first = await db.openSession(); const second = await db.openSession()
      try {
        await scope(1,first); await scope(2,second)
        await first.query('begin'); await second.query('begin')
        const a = await approve(1,job,quote,first)
        const waiting = approve(2,job,quote,second)
        await first.query('commit')
        const b = await waiting
        await second.query('commit')
        equal(b.rows[0].version_number, a.rows[0].version_number + 1, `${job ? 'job' : 'quote'} concurrent approvals serialize version numbers`)
      } finally { await first.end(); await second.end() }
    }
  } else console.log('SKIP concurrent version locking: PostgreSQL CI supplies independent sessions; PGlite does not.')
  await db.exec('reset role')
  equal((await db.query("select count(*)::int as n from public.fh_quote_versions where quote_id=$1 and status='approved'",[id(20)])).rows[0].n, 1, 'exactly one current approved quote version remains')
  console.log(`${checks} authorization transition checks passed.`)
} finally { await db.close() }
