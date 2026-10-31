// Isolated PostgreSQL test of the actual inbox view and security migration.
// Synthetic roles and policies exercise the view boundary; they do not claim
// to replay the repository's incomplete production migration history.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'
const db = await auditDatabase('inbox')
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
let checks = 0
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); checks++; console.log(`PASS ${label}`) }
try {
  await db.exec(`
    ${auditRoles}
    create table public.fh_clients(id text primary key,org_id text,name text,phone text,email text,company_name text);
    create table public.fh_conversations(id text primary key,org_id text,client_id text,status text,assigned_to text,starred boolean,unread_count integer,last_message_at timestamptz,last_inbound_at timestamptz,last_outbound_at timestamptz,last_channel text,last_preview text,snoozed_until timestamptz);
    create table public.fh_client_tags(client_id text,org_id text,tag text);
    create table public.fh_contacts(id text,org_id text,client_id text,stage text,updated_at timestamptz);
    create table public.fh_leads(id text,org_id text,client_id text,updated_at timestamptz);
    create table public.fh_quotes(id text,org_id text,client_id text,updated_at timestamptz);
    create table public.fh_invoices(id text,org_id text,client_id text,updated_at timestamptz);
    create table public.fh_agent_runs(conversation_id text,org_id text,status text);
    create table public.fh_messages(conversation_id text,org_id text,status text);
    create function public.fh_contacts_guard_money_fields() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$ begin if new.stage='forbidden' then raise exception 'Guard still runs' using errcode='42501'; end if; return new; end $$;
    create trigger money_guard before update on public.fh_contacts for each row execute function public.fh_contacts_guard_money_fields();
    grant usage on schema public to anon,authenticated,service_role;
    grant select,update on all tables in schema public to authenticated,service_role;
  `)
  const tables = ['fh_clients','fh_conversations','fh_client_tags','fh_contacts','fh_leads','fh_quotes','fh_invoices','fh_agent_runs','fh_messages']
  for (const table of tables) {
    const money = ['fh_quotes','fh_invoices'].includes(table)
    await db.exec(`alter table public.${table} enable row level security;
      create policy tenant on public.${table} to authenticated using (
        org_id=current_setting('test.org',true) and current_setting('test.active',true)='yes'
        ${money ? "and current_setting('test.member_role',true) in ('owner','admin','manager')" : ''}
      );`)
  }
  await db.exec(`
    insert into public.fh_clients values ('a','alpha','Alpha fixture',null,null,null),('b','beta','Beta fixture',null,null,null);
    insert into public.fh_conversations(id,org_id,client_id,last_preview) values ('ca','alpha','a','Alpha only'),('cb','beta','b','Beta only');
    insert into public.fh_client_tags values ('a','alpha','local'),('a','beta','foreign');
    insert into public.fh_contacts values ('ja','alpha','a','job','2026-01-01'),('jb','beta','b','job','2026-01-01');
    insert into public.fh_leads values ('la','alpha','a','2026-02-01');
    insert into public.fh_quotes values ('qa','alpha','a','2026-03-01');
    insert into public.fh_invoices values ('ia','alpha','a','2026-04-01');
    insert into public.fh_agent_runs values ('ca','alpha','proposed'),('ca','beta','proposed');
    insert into public.fh_messages values ('ca','alpha','held'),('ca','beta','held');
  `)
  await db.exec(await read('095_inbox_view_records.sql'))
  await db.exec('grant select on public.fh_v_inbox to authenticated,service_role')
  const scope = async (org, role = 'owner', active = 'yes') => {
    await db.exec('reset role')
    await db.query("select set_config('test.org',$1,false),set_config('test.member_role',$2,false),set_config('test.active',$3,false)", [org,role,active])
    await db.exec('set role authenticated')
  }
  const rows = async () => (await db.query('select * from public.fh_v_inbox order by conversation_id')).rows
  await scope('alpha')
  equal((await rows()).length, 2, 'reproduces owner-permission view bypass before the fix')
  await db.exec('reset role')
  const migration = await read('20261031031559_inbox_invoker_security.sql')
  await db.exec(migration)
  await db.exec(migration)
  for (const role of ['owner','admin','manager','crew','foreman']) {
    await scope('alpha',role)
    const inbox = await rows()
    equal(inbox.length, 1, `${role} sees only their company conversation`)
    equal(inbox[0].last_preview, 'Alpha only', `${role} keeps their own preview`)
    equal(inbox[0].tags, ['local'], `${role} cannot see foreign tags joined to a client`)
    equal(Number(inbox[0].pending_drafts), 1, `${role} cannot count foreign drafts`)
    equal(Number(inbox[0].held_messages), 1, `${role} cannot count foreign messages`)
    equal(inbox[0].latest_record, ['crew','foreman'].includes(role) ? 'lead' : 'invoice', `${role} respects underlying money visibility`)
  }
  await scope('alpha','owner','no'); equal((await rows()).length, 0, 'revoked membership sees no inbox rows')
  await scope('outside'); equal((await rows()).length, 0, 'nonmember sees no inbox rows')
  await scope('beta'); equal((await rows()).map(row => row.client_name), ['Beta fixture'], 'second company stays isolated')
  await scope('alpha')
  await assert.rejects(db.exec("update public.fh_contacts set stage='forbidden' where id='ja'"), error => error.code === '42501'); checks++; console.log('PASS trigger still enforces its guard after direct execution is revoked')
  await db.exec('reset role; set role service_role'); equal((await rows()).length, 2, 'service role retains intended administrative reads')
  await db.exec('reset role')
  for (const role of ['anon','authenticated']) {
    const result = await db.query("select has_function_privilege($1,'public.fh_contacts_guard_money_fields()','execute') as allowed", [role])
    equal(result.rows[0].allowed, false, `${role} has no direct trigger execution`)
  }
  await db.exec('set role anon')
  await assert.rejects(rows(), error => error.code === '42501'); checks++; console.log('PASS anonymous inbox access remains denied')
  console.log(`${checks} inbox security checks passed.`)
} finally { await db.close() }
