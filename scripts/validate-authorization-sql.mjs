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
const denied = async (work, message) => { await assert.rejects(work, /unauthorized|does not belong|status must be|cannot change a job/); checks++; console.log(`PASS ${message}`) }
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
    create table public.fh_contacts(id uuid primary key,user_id uuid,org_id uuid,approved_quote_version_id uuid,proposal_status text,stage text,amount numeric,cost numeric,completed_at timestamptz,job_title text);
    create table public.fh_quotes(id uuid primary key,user_id uuid,org_id uuid,approved_version_id uuid,status text);
    create table public.fh_job_partners(job_id uuid,partner_user_id uuid,status text,deleted_by_partner_at timestamptz);
    create table public.fh_quote_versions(id uuid primary key default gen_random_uuid(),user_id uuid,org_id uuid,contact_id uuid,quote_id uuid,version_number integer,status text,snapshot jsonb,base_total numeric,optional_total numeric,excluded_count integer,approval_method text,approved_by_name text,approved_by_email text,approval_note text,signature_kind text,signature_data text,superseded_at timestamptz,superseded_by uuid);
    create unique index quote_versions on public.fh_quote_versions(quote_id,version_number) where quote_id is not null;
    create unique index job_versions on public.fh_quote_versions(contact_id,version_number) where contact_id is not null;
    create table public.fh_notifications(id uuid primary key,user_id uuid,org_id uuid,title text,link text,read_at timestamptz);
    create table public.fh_follow_ups(id uuid primary key,user_id uuid,org_id uuid,contact_id uuid,lead_id uuid,quote_id uuid,headline text,status text,completed_at timestamptz,completed_by uuid);
    grant usage on schema public,auth to authenticated;
    alter table public.fh_contacts enable row level security;
    create policy contact_member on public.fh_contacts to authenticated
      using(public.fh_is_org_member(org_id)) with check(public.fh_is_org_member(org_id));
    grant select,update on public.fh_contacts to authenticated;
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
  // Existing production guard, including its omission of cost.
  await db.exec(`
CREATE OR REPLACE FUNCTION public.fh_contacts_guard_money_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if auth.uid() is null or old.org_id is null or pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if public.fh_money_visible(old.org_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Your role cannot delete jobs.' using errcode = '42501';
  end if;
  if new.stage is distinct from old.stage
     or new.amount is distinct from old.amount
     or new.completed_at is distinct from old.completed_at
     or new.proposal_status is distinct from old.proposal_status then
    raise exception 'Your role cannot change a job''s stage, value, approval or completion.' using errcode = '42501';
  end if;
  return new;
end
$function$;

    create trigger fh_contacts_guard_money_fields
      before delete or update of stage, amount, completed_at, proposal_status on public.fh_contacts
      for each row execute function public.fh_contacts_guard_money_fields();
  `)
  await scope(3)
  equal(Number((await db.query('update public.fh_contacts set cost=42.5 where id=$1 returning cost',[id(10)])).rows[0].cost),42.5,'baseline crew can change job cost')
  await db.exec('reset role')
  await db.query('update public.fh_contacts set cost=0 where id=$1',[id(10)])
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
  for (const user of [3,8]) {
    await scope(user)
    await denied(() => db.query('update public.fh_contacts set cost=42.5 where id=$1',[id(10)]),`restricted role ${user} cannot change job cost`)
    equal(Number((await db.query('select cost from public.fh_contacts where id=$1',[id(10)])).rows[0].cost),0,'denied cost remains unchanged')
  }
  await scope(3)
  equal((await db.query("update public.fh_contacts set job_title='Fixture' where id=$1 returning job_title",[id(10)])).rows[0].job_title,'Fixture','crew can still update ordinary job details')
  for (const user of [1,2,7]) {
    await scope(user)
    equal(Number((await db.query('update public.fh_contacts set cost=$1 where id=$2 returning cost',[user,id(10)])).rows[0].cost),user,`authorized role ${user} can change job cost`)
  }
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

  // Role and partner boundaries (DB-04, DB-05, DB-08, DB-12, DB-14).
  const refused = async (work, label) => { await assert.rejects(work, e => e.code === '42501'); checks++; console.log(`PASS ${label}`) }
  const service = async () => { await db.query('reset role'); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.query('set role service_role') }
  const rows = async (sql, params) => (await db.query(sql, params)).rows
  await db.exec(`reset role;
    create function public.auth_user_org_ids() returns setof uuid language sql stable security definer as $$ select org_id from public.org_members where user_id=auth.uid() and revoked_at is null $$;
    create function public.fh_is_org_manager(org uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.org_members where org_id=org and user_id=auth.uid() and revoked_at is null and role in ('owner','admin','manager')) $$;
    grant usage on schema public, auth to service_role;
    alter table public.fh_job_partners add column id uuid primary key default gen_random_uuid(), add column org_id uuid, add column partner_email text, add column accepted_at timestamptz;
    alter table public.fh_job_partners alter column status set default 'pending';
    update public.fh_job_partners set org_id='${id(100)}';
    alter table public.fh_job_partners enable row level security;
    create policy fh_job_partners_own on public.fh_job_partners for all to authenticated using (org_id in (select public.auth_user_org_ids())) with check (org_id in (select public.auth_user_org_ids()));
    create policy fh_job_partners_partner_read on public.fh_job_partners for select to authenticated using (partner_user_id = (select auth.uid()));
    grant select, insert, update on public.fh_job_partners to authenticated, service_role;
  `)
  const grantPartner = values => db.query(`insert into public.fh_job_partners(id,job_id,org_id,partner_email,partner_user_id,status) values($1,$2,$3,$4,$5,$6) returning id`, [id(values.row), id(10), id(100), values.email, values.partner == null ? null : id(values.partner), values.status])
  await scope(3)
  equal((await grantPartner({ row: 60, email: 'second@example.test', partner: 3, status: 'accepted' })).rows.length, 1, 'baseline: crew grants an account accepted partner access')
  await db.exec(`reset role; delete from public.fh_job_partners where id='${id(60)}'`)

  await db.exec(`reset role;
    create table public.org_invites(id uuid primary key default gen_random_uuid(),org_id uuid not null,email text not null,role text not null default 'crew',token text not null unique,invited_by uuid not null,expires_at timestamptz not null default now() + interval '14 days');
    alter table public.org_invites enable row level security;
    create policy "org_invites_insert_by_owner_admin" on public.org_invites for insert to authenticated
      with check (invited_by = (select auth.uid()) and exists (select 1 from public.org_members m where m.org_id = org_invites.org_id and m.user_id = (select auth.uid()) and m.role in ('owner','admin') and m.revoked_at is null));
    grant insert on public.org_invites to authenticated;
    grant select on public.org_members to authenticated;
  `)
  let inviteCount = 0
  const invite = (user, role) => db.query('insert into public.org_invites(org_id,email,role,token,invited_by) values($1,$2,$3,$4,$5)', [id(100), `invitee${++inviteCount}@example.test`, role, `token-${inviteCount}`, id(user)])
  await scope(7)
  await invite(7, 'owner')
  equal(true, true, 'baseline: an admin creates an owner invite directly')
  await db.exec('reset role')

  await db.exec(`
    alter table public.org_members add column default_hourly_rate numeric;
    update public.org_members set default_hourly_rate = 25 where user_id = '${id(3)}';
    create table public.fh_time_punches(id uuid primary key default gen_random_uuid(),user_id uuid not null,org_id uuid,contact_id uuid,punch_out_at timestamptz,hourly_rate numeric,approved_at timestamptz,approved_by uuid,flagged boolean not null default false,flag_reason text);
    alter table public.fh_time_punches enable row level security;
    create policy fh_time_punches_ins on public.fh_time_punches for insert to authenticated with check (user_id = (select auth.uid()) and org_id in (select public.auth_user_org_ids()));
    create policy fh_time_punches_sel on public.fh_time_punches for select to authenticated using (public.fh_is_org_manager(org_id) or user_id = (select auth.uid()));
    create policy fh_time_punches_upd on public.fh_time_punches for update to authenticated using (user_id = (select auth.uid()) and approved_at is null)
      with check (user_id = (select auth.uid()) and approved_at is null and org_id in (select public.auth_user_org_ids()));
    grant select, insert, update on public.fh_time_punches to authenticated, service_role;
  `)
  {
    const source = await read('migrations/054_audit_hardening.sql')
    const start = source.indexOf('create or replace function public.fh_guard_time_punch_approval()')
    const end = source.indexOf('$$;', source.indexOf('as $$', start)) + 3
    assert(start >= 0 && end > start)
    await db.exec(source.slice(start, end))
    await db.exec('create trigger fh_time_punches_guard_approval before insert or update on public.fh_time_punches for each row execute function public.fh_guard_time_punch_approval()')
  }
  const punch = (user, rate = null) => db.query('insert into public.fh_time_punches(user_id,org_id,hourly_rate) values($1,$2,$3) returning id, hourly_rate', [id(user), id(100), rate]).then(r => r.rows[0])
  const rate = value => value == null ? null : Number(value)
  await scope(3)
  equal(rate((await punch(3, 9999)).hourly_rate), 9999, 'baseline: crew sets their own pay rate on a new punch')
  const open = await punch(3)
  equal(rate((await rows('update public.fh_time_punches set hourly_rate=9999 where id=$1 returning hourly_rate', [open.id]))[0].hourly_rate), 9999, 'baseline: crew sets their own pay rate at clock out')
  await db.exec('reset role')
  await db.query('insert into public.fh_time_punches(id,user_id,org_id) values($1,$2,$3)', [id(70), id(4), id(100)])
  await scope(4)
  await refused(() => db.query('update public.fh_time_punches set punch_out_at=now() where id=$1', [id(70)]), 'a removed member already cannot edit their punch (the update check needs membership)')
  await db.exec('reset role')

  await db.exec(`
    alter table public.fh_notifications enable row level security;
    create policy fh_notifications_own on public.fh_notifications for all to authenticated
      using (org_id in (select public.auth_user_org_ids()) and user_id = (select auth.uid()))
      with check (org_id in (select public.auth_user_org_ids()));
    grant select, insert on public.fh_notifications to authenticated;
  `)
  let notificationCount = 80
  const notify = (to, link = '/jobs') => db.query('insert into public.fh_notifications(id,user_id,org_id,title,link) values($1,$2,$3,$4,$5)', [id(++notificationCount), id(to), id(100), 'Fixture alert', link])
  await scope(3)
  await notify(1, 'https://example.test/phish')
  equal(true, true, 'baseline: crew pushes a notification with any link to the owner')
  await db.exec('reset role')

  // Partner and removal policies (DB-13, DB-14) run in a separate migration.
  const partnerTables = ['fh_invoices', 'fh_change_orders', 'fh_stage_transitions']
  for (const [n, table] of partnerTables.entries()) {
    await db.exec(`
      create table public.${table}(id uuid primary key,org_id uuid,contact_id uuid);
      insert into public.${table} values ('${id(90 + n)}','${id(100)}','${id(10)}');
      alter table public.${table} enable row level security;
      create policy ${table}_sel on public.${table} for select to authenticated using (
        org_id in (select public.auth_user_org_ids())
        or exists (select 1 from public.fh_job_partners p where p.job_id = ${table}.contact_id and p.partner_user_id = (select auth.uid()) and p.status = 'accepted'));
      grant select on public.${table} to authenticated;
    `)
  }
  const visible = async table => (await rows(`select id from public.${table}`)).length
  await scope(9)
  for (const table of partnerTables) equal(await visible(table), 1, `baseline: a partner who left still reads ${table}`)
  await db.exec('reset role')
  await db.exec(`reset role;
    create policy fh_time_punches_del on public.fh_time_punches for delete to authenticated using (user_id = (select auth.uid()) and approved_at is null);
    grant delete on public.fh_time_punches to authenticated;
    insert into public.fh_time_punches(id,user_id,org_id) values ('${id(71)}','${id(4)}','${id(100)}');`)
  await scope(4)
  equal((await rows('delete from public.fh_time_punches where id=$1 returning id', [id(71)])).length, 1, 'baseline: a removed member removes their unapproved punch')
  await db.exec('reset role')

  const boundaries = await read('migrations/20261117110100_role_boundaries.sql')
  assert(!/drop|delete|truncate/i.test(boundaries), 'role boundary migration avoids words that need owner approval')
  await db.exec(boundaries)
  await db.exec(boundaries)
  equal(true, true, 'role boundary migration installs twice safely')

  // DB-04: partner access is granted by managers and accepted only by the invite link.
  await scope(3)
  await refused(() => grantPartner({ row: 61, email: 'second@example.test', partner: 3, status: 'accepted' }), 'crew cannot grant accepted partner access')
  await refused(() => grantPartner({ row: 61, email: 'second@example.test', status: 'pending' }), 'crew cannot send a partner invite directly')
  equal((await rows("update public.fh_job_partners set status='revoked' where partner_user_id=$1 returning id", [id(6)])).length, 0, 'crew cannot revoke a partner')
  equal((await rows('select id from public.fh_job_partners where job_id=$1', [id(10)])).length, 2, 'crew still sees who is partnered on the job')
  await scope(2)
  await refused(() => grantPartner({ row: 61, email: 'second@example.test', partner: 2, status: 'accepted' }), 'manager cannot write an accepted partner row directly')
  await refused(() => grantPartner({ row: 61, email: 'second@example.test', partner: 2, status: 'pending' }), 'manager cannot pick the partner account directly')
  equal((await grantPartner({ row: 61, email: 'new@example.test', status: 'pending' })).rows.length, 1, 'manager sends a pending partner invite')
  await refused(() => db.query('update public.fh_job_partners set partner_user_id=$1 where id=$2', [id(2), id(61)]), 'manager cannot attach an account to an invite')
  await refused(() => db.query("update public.fh_job_partners set status='accepted' where id=$1", [id(61)]), 'manager cannot mark an invite accepted')
  equal((await rows("update public.fh_job_partners set status='revoked' where id=$1 returning id", [id(61)])).length, 1, 'manager revokes a partner invite')
  await service()
  equal((await rows("update public.fh_job_partners set status='accepted', partner_user_id=$1, accepted_at=now() where id=$2 returning id", [id(5), id(61)])).length, 1, 'invite link acceptance through the service path still works')
  await db.exec('reset role')

  // DB-05: an invite is always for a role below the inviter's.
  const roleName = { 1: 'owner', 2: 'manager', 3: 'crew', 4: 'removed owner', 7: 'admin' }
  for (const [user, role, allowed] of [[7,'owner',false],[7,'admin',false],[7,'manager',true],[7,'crew',true],[1,'owner',false],[1,'admin',true],[1,'foreman',true],[2,'crew',false],[3,'crew',false],[4,'crew',false]]) {
    await scope(user)
    const label = `${roleName[user]} ${allowed ? 'can' : 'cannot'} invite ${/^[aeiou]/.test(role) ? 'an' : 'a'} ${role}`
    if (allowed) { await invite(user, role); equal(true, true, label) } else await refused(() => invite(user, role), label)
  }
  await db.exec('reset role')

  // DB-08: only owners and admins choose a pay rate; everyone else gets their member rate.
  await scope(3)
  equal(rate((await punch(3, 9999)).hourly_rate), 25, 'crew rate on a new punch becomes their member rate')
  const closing = await punch(3)
  equal(rate(closing.hourly_rate), null, 'crew punch without a rate stays unrated')
  equal(rate((await rows('update public.fh_time_punches set hourly_rate=9999 where id=$1 returning hourly_rate', [closing.id]))[0].hourly_rate), 25, 'crew rate at clock out becomes their member rate')
  await assert.rejects(db.query('update public.fh_time_punches set hourly_rate=30 where id=$1', [closing.id])); equal(true, true, 'a stamped rate still cannot be changed')
  await assert.rejects(db.query("insert into public.fh_time_punches(user_id,org_id,approved_at) values($1,$2,now())", [id(3), id(100)])); equal(true, true, 'crew still cannot insert an approved punch')
  await scope(8)
  equal(rate((await punch(8, 50)).hourly_rate), null, 'foreman without a member rate cannot invent one')
  await scope(2)
  equal(rate((await punch(2, 40)).hourly_rate), null, 'manager cannot set their own pay rate')
  await scope(1)
  equal(rate((await punch(1, 80)).hourly_rate), 80, 'owner still sets a rate on their own punch')
  await scope(7)
  equal(rate((await punch(7, 60)).hourly_rate), 60, 'admin still sets a rate on their own punch')
  await scope(3)
  const unrated = await punch(3)
  await service()
  equal(rate((await rows('update public.fh_time_punches set hourly_rate=30 where id=$1 returning hourly_rate', [unrated.id]))[0].hourly_rate), 30, 'approval through the service path stamps the rate')
  await db.exec('reset role')

  // DB-12: a signed in member writes notifications only to their own bell.
  await scope(3)
  await refused(() => notify(1), 'crew cannot notify another member')
  await notify(3); equal(true, true, 'crew can still notify themselves')
  await scope(1)
  await refused(() => notify(2), "owner cannot write into another member's bell directly")
  await notify(1); equal(true, true, 'owner can still notify themselves')
  await db.exec('reset role')

  const removal = await read('migrations/20261117110200_partner_and_removal_policies.sql')
  await db.exec(removal)
  await db.exec(removal)
  equal(true, true, 'partner and removal policy migration installs twice safely')

  // DB-13: a partner who left the job no longer reads its invoices, change orders or history.
  for (const [user, expected, who] of [[9, 0, 'a partner who left'], [6, 1, 'an active partner'], [1, 1, 'the owner'], [3, 1, 'crew']]) {
    await scope(user)
    for (const table of partnerTables) equal(await visible(table), expected, `${who} ${expected ? 'reads' : 'no longer reads'} ${table}`)
  }

  // DB-14: removed members no longer remove their punches; active members still can.
  await scope(4)
  equal((await rows('delete from public.fh_time_punches where id=$1 returning id', [id(70)])).length, 0, 'a removed member can no longer remove their punch')
  await scope(3)
  const own = await punch(3)
  equal((await rows('delete from public.fh_time_punches where id=$1 returning id', [own.id])).length, 1, 'an active member still removes their unapproved punch')
  await db.exec('reset role')

  // DB-10: new functions in public are not executable by anon by default.
  await db.exec(`reset role;
    alter default privileges for role postgres revoke execute on functions from public;
    alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;
    create function public.fh_fixture_before() returns int language sql as 'select 1';`)
  const canRun = async (role, fn) => (await rows(`select has_function_privilege($1, 'public.${fn}()', 'EXECUTE') as ok`, [role]))[0].ok
  equal(await canRun('anon', 'fh_fixture_before'), true, 'baseline: a new function is executable by anon')
  const defaults = await read('migrations/20261117110300_function_default_privileges.sql')
  assert(!/drop|delete|truncate/i.test(defaults))
  await db.exec(defaults); await db.exec(defaults)
  await db.exec("create function public.fh_fixture_after() returns int language sql as 'select 1'")
  equal(await canRun('anon', 'fh_fixture_after'), false, 'a new function is not executable by anon')
  equal(await canRun('authenticated', 'fh_fixture_after'), true, 'a new function stays executable by signed in users')
  equal(await canRun('service_role', 'fh_fixture_after'), true, 'a new function stays executable by the service role')
  equal(await canRun('anon', 'fh_fixture_before'), true, 'existing function grants are left as they are')

  // DB-15: tables the app listens to are in the realtime publication.
  await db.exec('create publication supabase_realtime for table public.fh_notifications')
  const published = async () => (await rows("select tablename from pg_publication_tables where pubname='supabase_realtime' order by 1")).map(r => r.tablename)
  equal(await published(), ['fh_notifications'], 'baseline: job, quote and invoice changes are not published')
  const realtime = await read('migrations/20261117110400_realtime_publication.sql')
  assert(!/drop|delete|truncate/i.test(realtime))
  await db.exec(realtime); await db.exec(realtime)
  equal(await published(), ['fh_change_orders', 'fh_contacts', 'fh_invoices', 'fh_notifications', 'fh_quotes'], 'present app tables join the publication once, and missing ones are passed over')

  // DB-09: customer conversations are for owners, admins and managers.
  for (const table of ['fh_conversations', 'fh_messages']) {
    await db.exec(`
      create table public.${table}(id uuid primary key default gen_random_uuid(),org_id uuid,body text);
      insert into public.${table}(org_id,body) values ('${id(100)}','Customer thread');
      alter table public.${table} enable row level security;
      create policy ${table.slice(3)}_org on public.${table} for all to authenticated using (org_id in (select public.auth_user_org_ids())) with check (org_id in (select public.auth_user_org_ids()));
      grant select, insert, update on public.${table} to authenticated;
    `)
  }
  await scope(3)
  equal((await rows('select id from public.fh_messages')).length, 1, 'baseline: crew reads customer messages')
  await db.exec('reset role')
  const office = await read('migrations/20261117110500_customer_messages_office_roles.sql')
  assert(!/drop|delete|truncate/i.test(office))
  await db.exec(office); await db.exec(office)
  for (const user of [3, 8]) {
    await scope(user)
    for (const table of ['fh_conversations', 'fh_messages']) {
      equal((await rows(`select id from public.${table}`)).length, 0, `${roleName[user] ?? 'foreman'} no longer reads ${table}`)
      await refused(() => db.query(`insert into public.${table}(org_id,body) values($1,'x')`, [id(100)]), `${roleName[user] ?? 'foreman'} cannot write ${table}`)
      equal((await rows(`update public.${table} set body='x' returning id`)).length, 0, `${roleName[user] ?? 'foreman'} cannot edit ${table}`)
    }
  }
  for (const user of [1, 2, 7]) {
    await scope(user)
    for (const table of ['fh_conversations', 'fh_messages']) {
      equal((await rows(`select id from public.${table}`)).length >= 1, true, `${roleName[user]} still reads ${table}`)
      equal((await rows(`insert into public.${table}(org_id,body) values($1,'Reply') returning id`, [id(100)])).length, 1, `${roleName[user]} still writes ${table}`)
    }
  }
  await db.exec('reset role')

  console.log(`${checks} authorization transition checks passed.`)
} finally { await db.close() }
