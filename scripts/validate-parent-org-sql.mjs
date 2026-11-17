// Cross company parent ids (DB-01, DB-02 table path, DB-03, DB-11).
// Real fh_set_org_id, fh_inherit_org_from_contact and quote total recalc
// from the repository; the appointment and message definer triggers are
// stand ins for the live ones the audit read (their source is not tracked).
// Synthetic rows only.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('parentorg')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sqlFile = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
let checks = 0
const pass = label => { checks++; console.log(`PASS ${label}`) }
const equal = (actual, expected, label) => { assert.deepEqual(actual, expected, label); pass(label) }
const blocked = async (sql, params, label) => {
  await assert.rejects(db.query(sql, params), e => e.code === '42501' && /another company/.test(e.message), label)
  pass(label)
}
const works = async (sql, params, label) => { await db.query(sql, params); pass(label) }
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
async function as(user, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user == null ? null : id(user), role })])
  await db.exec(`set role ${role}`)
}

// Org A (100) is the victim, org B (200) the attacker, org C (300) a partner's own company.
// Users: 1 owner of A, 2 owner of B, 5 owner of C and accepted partner on A's job 20.
const A = 100, B = 200
const children = ['fh_quote_items', 'fh_quote_versions', 'fh_payments', 'fh_appointments', 'fh_messages', 'fh_events', 'fh_workflow_runs', 'fh_notes', 'fh_invoices', 'fh_schedule']
try {
  await db.exec(`
    ${auditRoles}
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create table public.org_members(org_id uuid, user_id uuid, role text, revoked_at timestamptz, joined_at timestamptz default now());
    create function public.auth_user_org_ids() returns setof uuid language sql stable security definer set search_path = pg_catalog, public
      as $$ select org_id from public.org_members where user_id = auth.uid() and revoked_at is null $$;
    create table public.fh_clients(id uuid primary key, org_id uuid, name text, notes text);
    create table public.fh_contacts(id uuid primary key, org_id uuid, client_id uuid references public.fh_clients, name text, amount numeric);
    create table public.fh_leads(id uuid primary key, org_id uuid, client_id uuid references public.fh_clients);
    create table public.fh_quotes(id uuid primary key, org_id uuid, client_id uuid references public.fh_clients, lead_id uuid references public.fh_leads, amount numeric);
    create table public.fh_invoices(id uuid primary key default gen_random_uuid(), org_id uuid, contact_id uuid references public.fh_contacts, client_id uuid references public.fh_clients, amount numeric);
    create table public.fh_schedule(id uuid primary key default gen_random_uuid(), org_id uuid, contact_id uuid references public.fh_contacts, quote_id uuid references public.fh_quotes, lead_id uuid references public.fh_leads, title text, start_at timestamptz);
    create table public.fh_conversations(id uuid primary key, org_id uuid, client_id uuid references public.fh_clients, last_preview text, unread_count int not null default 0);
    create table public.fh_quote_items(id uuid primary key default gen_random_uuid(), org_id uuid, contact_id uuid references public.fh_contacts, quote_id uuid references public.fh_quotes, description text, amount numeric, is_optional boolean not null default false, is_excluded boolean not null default false);
    create table public.fh_quote_versions(id uuid primary key default gen_random_uuid(), org_id uuid, contact_id uuid references public.fh_contacts, quote_id uuid references public.fh_quotes, version_number int, status text);
    create table public.fh_payments(id uuid primary key default gen_random_uuid(), org_id uuid, contact_id uuid references public.fh_contacts, invoice_id uuid references public.fh_invoices, amount numeric);
    create table public.fh_appointments(id uuid primary key default gen_random_uuid(), org_id uuid, client_id uuid references public.fh_clients, contact_id uuid references public.fh_contacts, schedule_id uuid references public.fh_schedule on delete set null, start_at timestamptz, status text default 'booked');
    create table public.fh_messages(id uuid primary key default gen_random_uuid(), org_id uuid, conversation_id uuid references public.fh_conversations, client_id uuid references public.fh_clients, contact_id uuid references public.fh_contacts, body text);
    create table public.fh_events(id uuid primary key default gen_random_uuid(), org_id uuid, type text, client_id uuid references public.fh_clients, contact_id uuid references public.fh_contacts, conversation_id uuid references public.fh_conversations);
    create table public.fh_workflow_runs(id uuid primary key default gen_random_uuid(), org_id uuid, client_id uuid references public.fh_clients, contact_id uuid references public.fh_contacts);
    create table public.fh_notes(id uuid primary key default gen_random_uuid(), org_id uuid, contact_id uuid references public.fh_contacts, quote_id uuid references public.fh_quotes, lead_id uuid references public.fh_leads, text text);
    create table public.fh_job_partners(job_id uuid, partner_user_id uuid, status text);
    grant usage on schema public to authenticated, service_role;
    grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
  `)
  for (const table of [...children, 'fh_clients', 'fh_contacts', 'fh_leads', 'fh_quotes', 'fh_conversations']) {
    const partner = table === 'fh_payments' || table === 'fh_quote_items'
      ? ` or exists(select 1 from public.fh_job_partners p where p.job_id = ${table}.contact_id and p.partner_user_id = auth.uid() and p.status = 'accepted')` : ''
    await db.exec(`alter table public.${table} enable row level security;
      create policy member on public.${table} for all to authenticated
        using (org_id in (select public.auth_user_org_ids())${partner})
        with check (org_id in (select public.auth_user_org_ids())${partner});`)
  }
  // Real attribution and recalc functions from the repository.
  for (const [file, name, delimiter] of [['065_sub_portal_binding_and_workspace.sql', 'fh_set_org_id', '$$'], ['092_leads_and_quotes.sql', 'fh_inherit_org_from_contact', '$function$'], ['092_leads_and_quotes.sql', 'fn_recalc_contact_amount_from_items', '$function$']]) {
    const source = await sqlFile(file)
    const start = source.indexOf(`create or replace function public.${name}()`)
    const end = source.indexOf(`${delimiter};`, source.indexOf(`as ${delimiter}`, start)) + delimiter.length + 1
    assert(start >= 0 && end > start, `${name} source found`)
    await db.exec(source.slice(start, end))
  }
  for (const table of children) await db.exec(`
    create trigger fh_set_org_id_trg before insert on public.${table} for each row execute function public.fh_set_org_id();
    create trigger zz_inherit_org_from_contact before insert or update of contact_id, org_id on public.${table} for each row execute function public.fh_inherit_org_from_contact();`)
  await db.exec(`
    create trigger fh_set_org_id_trg before insert on public.fh_conversations for each row execute function public.fh_set_org_id();
    create trigger trg_quote_items_recalc after insert or update or delete on public.fh_quote_items for each row execute function public.fn_recalc_contact_amount_from_items();
    -- Stand ins for the live definer triggers described in the audit (DB-03, DB-02).
    create function public.fh_appointments_mirror() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
    begin
      if new.schedule_id is not null then
        update public.fh_schedule set start_at = new.start_at, title = 'Appointment' where id = new.schedule_id;
      end if;
      return new;
    end $$;
    create trigger fh_appointments_mirror before insert or update of start_at, status on public.fh_appointments for each row execute function public.fh_appointments_mirror();
    create function public.fh_appointments_mirror_after() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
    begin
      if new.status = 'cancelled' and old.schedule_id is not null then
        delete from public.fh_schedule where id = old.schedule_id;
      end if;
      return null;
    end $$;
    create trigger fh_appointments_mirror_after after update of status on public.fh_appointments for each row execute function public.fh_appointments_mirror_after();
    create function public.fh_messages_after_insert() returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
    begin
      update public.fh_conversations set last_preview = new.body, unread_count = unread_count + 1 where id = new.conversation_id;
      return null;
    end $$;
    create trigger fh_messages_after_insert after insert on public.fh_messages for each row execute function public.fh_messages_after_insert();
  `)
  await db.query(`insert into public.org_members(org_id, user_id, role) values ($1,$2,'owner'),($3,$4,'owner'),($5,$6,'owner')`, [id(A), id(1), id(B), id(2), id(300), id(5)])
  await db.exec(`
    insert into public.fh_clients values ('${id(10)}','${id(A)}','Victim customer',null),('${id(11)}','${id(B)}','Attacker customer',null),('${id(12)}',null,'Personal customer',null);
    insert into public.fh_contacts values ('${id(20)}','${id(A)}','${id(10)}','Victim job',null),('${id(21)}','${id(B)}','${id(11)}','Attacker job',null),('${id(22)}',null,'${id(12)}','Personal job',null);
    insert into public.fh_leads values ('${id(30)}','${id(A)}','${id(10)}'),('${id(31)}','${id(B)}','${id(11)}');
    insert into public.fh_quotes values ('${id(40)}','${id(A)}','${id(10)}','${id(30)}',1000),('${id(41)}','${id(B)}','${id(11)}','${id(31)}',0),('${id(42)}',null,'${id(12)}',null,0);
    insert into public.fh_invoices(id, org_id, contact_id, client_id, amount) values ('${id(60)}','${id(A)}','${id(20)}','${id(10)}',500),('${id(61)}','${id(B)}','${id(21)}','${id(11)}',500);
    insert into public.fh_schedule(id, org_id, contact_id, title, start_at) values ('${id(70)}','${id(A)}','${id(20)}','Victim visit','2026-12-01T15:00Z'),('${id(71)}','${id(B)}','${id(21)}','Attacker visit','2026-12-02T15:00Z');
    insert into public.fh_conversations values ('${id(80)}','${id(A)}','${id(10)}','Victim thread',0),('${id(81)}','${id(B)}','${id(11)}','Attacker thread',0);
    insert into public.fh_job_partners values ('${id(20)}','${id(5)}','accepted');
  `)
  const victimQuote = async () => Number((await one('select amount from public.fh_quotes where id=$1', [id(40)])).amount)
  const victimVisit = () => one('select title, start_at from public.fh_schedule where id=$1', [id(70)])
  const victimThread = () => one('select last_preview, unread_count from public.fh_conversations where id=$1', [id(80)])

  // Baseline: the attacks from the audit report succeed before the guard.
  await as(2)
  await db.query("insert into public.fh_quote_items(id, contact_id, quote_id, description, amount) values ($1,$2,$3,'Injected',50000)", [id(90), id(21), id(40)])
  await db.exec('reset role')
  equal(await victimQuote(), 50000, 'baseline: a foreign quote item rewrites the victim quote total')
  await as(2)
  await db.query("insert into public.fh_appointments(id, client_id, contact_id, start_at) values ($1,$2,$3,'2026-12-05T15:00Z')", [id(91), id(11), id(21)])
  await db.query("update public.fh_appointments set schedule_id=$1, start_at='2027-01-01T00:00Z' where id=$2", [id(70), id(91)])
  await db.exec('reset role')
  equal((await victimVisit()).title, 'Appointment', 'baseline: a foreign schedule id moves the victim calendar event')
  await as(2)
  await db.query("insert into public.fh_messages(conversation_id, client_id, body) values ($1,$2,'Injected')", [id(80), id(11)])
  await db.exec('reset role')
  equal((await victimThread()).last_preview, 'Injected', 'baseline: a foreign conversation id rewrites the victim inbox preview')

  // Put the victim back as it was, keeping the poisoned rows as legacy data.
  await db.exec(`reset role;
    update public.fh_quotes set amount = 1000 where id = '${id(40)}';
    update public.fh_schedule set title = 'Victim visit', start_at = '2026-12-01T15:00Z' where id = '${id(70)}';
    update public.fh_conversations set last_preview = 'Victim thread', unread_count = 0 where id = '${id(80)}';`)

  const migration = await sqlFile('20261117110000_parent_company_guard.sql')
  assert(!/\b(drop|delete|truncate)\b/i.test(migration), 'migration text avoids words that need owner approval')
  pass('migration text avoids words that need owner approval')
  await db.exec(migration)
  await db.exec(migration)
  pass('guard installs twice safely')
  const triggers = (await db.query(`select c.relname as table, array_agg(t.tgname::text order by t.tgname) as names from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal and c.relname = any($1) and t.tgname like 'zz%' group by c.relname order by 1`, [children])).rows
  for (const row of triggers) assert.deepEqual(row.names, ['zz_inherit_org_from_contact', 'zzzz_assert_parent_org'], row.table)
  equal(triggers.length, children.length, 'guard is attached to every child table and sorts after the org inherit trigger')
  equal((await one("select count(*)::int n from pg_trigger where tgname='zzzz_assert_parent_org'")).n, children.length + 4, 'guard also covers conversations, jobs, leads and quotes, and skips tables that do not exist')

  // DB-01: quote items, versions, payments.
  await as(2)
  await blocked("insert into public.fh_quote_items(contact_id, quote_id, description, amount) values ($1,$2,'x',50000)", [id(21), id(40)], 'quote item on another company quote is refused')
  await blocked("insert into public.fh_quote_versions(contact_id, quote_id, version_number, status) values ($1,$2,99,'approved')", [id(21), id(40)], 'quote version on another company quote is refused')
  await blocked('insert into public.fh_payments(contact_id, invoice_id, amount) values ($1,$2,1)', [id(21), id(60)], 'payment on another company invoice is refused')
  await db.query("insert into public.fh_quote_items(id, contact_id, quote_id, description, amount) values ($1,$2,$3,'Own line',10)", [id(92), id(21), id(41)])
  await blocked('update public.fh_quote_items set quote_id=$1 where id=$2', [id(40), id(92)], 'moving an own quote item onto another company quote is refused')
  await blocked('insert into public.fh_notes(contact_id, quote_id, text) values ($1,$2,$3)', [id(21), id(40), 'x'], 'note on another company quote is refused')
  await blocked('insert into public.fh_notes(contact_id, lead_id, text) values ($1,$2,$3)', [id(21), id(30), 'x'], 'note on another company lead is refused')
  await blocked('insert into public.fh_invoices(contact_id, client_id, amount) values ($1,$2,1)', [id(21), id(10)], 'invoice for another company customer is refused')
  await blocked('insert into public.fh_schedule(contact_id, quote_id, title) values ($1,$2,$3)', [id(21), id(40), 'x'], 'visit on another company quote is refused')
  await db.exec('reset role')
  equal(await victimQuote(), 1000, 'victim quote total is unchanged')

  // DB-03: appointments cannot point at another company calendar event.
  await as(2)
  await db.query("insert into public.fh_appointments(id, client_id, contact_id, start_at) values ($1,$2,$3,'2026-12-05T15:00Z')", [id(93), id(11), id(21)])
  await blocked('update public.fh_appointments set schedule_id=$1 where id=$2', [id(70), id(93)], 'appointment cannot take another company event id')
  await blocked("update public.fh_appointments set schedule_id=$1, start_at='2027-01-01T00:00Z' where id=$2", [id(70), id(93)], 'appointment cannot move another company event')
  await blocked("insert into public.fh_appointments(client_id, contact_id, schedule_id, start_at) values ($1,$2,$3,'2027-01-01T00:00Z')", [id(11), id(21), id(70)], 'new appointment cannot claim another company event')
  await blocked("insert into public.fh_appointments(client_id, contact_id, start_at) values ($1,$2,'2027-01-01T00:00Z')", [id(10), id(21)], 'appointment cannot name another company customer')
  await db.exec('reset role')
  equal(await victimVisit(), { title: 'Victim visit', start_at: new Date('2026-12-01T15:00Z') }, 'victim calendar event is unchanged')

  // DB-02: inbox, events and workflow runs.
  await as(2)
  await blocked("insert into public.fh_messages(conversation_id, client_id, body) values ($1,$2,'x')", [id(80), id(11)], 'message cannot enter another company conversation')
  await blocked("insert into public.fh_messages(conversation_id, client_id, body) values ($1,$2,'x')", [id(81), id(10)], 'message cannot name another company customer')
  await blocked("insert into public.fh_events(type, client_id) values ('tag.added',$1)", [id(10)], 'event cannot name another company customer')
  await blocked('insert into public.fh_events(type, conversation_id) values ($1,$2)', ['message.inbound', id(80)], 'event cannot name another company conversation')
  await blocked('insert into public.fh_workflow_runs(client_id) values ($1)', [id(10)], 'workflow run cannot enroll another company customer')
  await blocked('insert into public.fh_conversations(id, client_id) values ($1,$2)', [id(82), id(10)], 'conversation cannot wrap another company customer')
  await db.exec('reset role')
  equal(await victimThread(), { last_preview: 'Victim thread', unread_count: 0 }, 'victim inbox is unchanged')

  // Service role and definer paths are checked too.
  await as(null, 'service_role')
  await blocked("insert into public.fh_events(org_id, type, client_id) values ($1,'tag.added',$2)", [id(B), id(10)], 'service role event with another company customer is refused')
  await blocked('insert into public.fh_workflow_runs(org_id, client_id) values ($1,$2)', [id(B), id(10)], 'service role workflow run for another company customer is refused')
  await blocked("insert into public.fh_quote_items(contact_id, quote_id, description, amount) values ($1,$2,'x',1)", [id(21), id(40)], 'service role quote item joining two companies is refused')
  await blocked('insert into public.fh_conversations(id, org_id, client_id) values ($1,null,$2)', [id(83), id(10)], 'a personal row cannot point at a company customer')
  await db.exec('reset role')
  equal(await victimQuote(), 1000, 'victim quote total is still unchanged')

  // Legitimate same company writes keep working.
  await as(1)
  await works("insert into public.fh_quote_items(quote_id, description, amount) values ($1,'Forms',1200)", [id(40)], 'owner adds a quote item to their own quote')
  await db.exec('reset role')
  equal(await victimQuote(), 51200, 'own quote total recalculates (the legacy injected line is still counted until cleaned up)')
  await as(1)
  await works("insert into public.fh_quote_versions(quote_id, version_number, status) values ($1,1,'approved')", [id(40)], 'owner approves a version of their own quote')
  await works('insert into public.fh_payments(contact_id, invoice_id, amount) values ($1,$2,250)', [id(20), id(60)], 'owner logs a payment on their own invoice')
  await works("insert into public.fh_appointments(id, client_id, contact_id, schedule_id, start_at) values ($1,$2,$3,$4,'2026-12-01T16:00Z')", [id(94), id(10), id(20), id(70)], 'owner books an appointment on their own calendar event')
  await works("update public.fh_appointments set start_at='2026-12-03T16:00Z' where id=$1", [id(94)], 'owner moves their own appointment')
  await works("insert into public.fh_messages(conversation_id, client_id, contact_id, body) values ($1,$2,$3,'On our way')", [id(80), id(10), id(20)], 'owner messages in their own conversation')
  await works("insert into public.fh_events(type, client_id, contact_id) values ('tag.added',$1,$2)", [id(10), id(20)], 'owner emits an event for their own customer')
  await works('insert into public.fh_notes(quote_id, lead_id, text) values ($1,$2,$3)', [id(40), id(30), 'Called'], 'owner notes on their own quote and lead')
  await works('insert into public.fh_invoices(contact_id, client_id, amount) values ($1,$2,10)', [id(20), id(10)], 'owner invoices their own customer')
  await works('insert into public.fh_schedule(contact_id, quote_id, lead_id, title) values ($1,$2,$3,$4)', [id(20), id(40), id(30), 'Walkthrough'], 'owner schedules a visit on their own quote')
  await db.exec('reset role')
  equal((await victimVisit()).start_at, new Date('2026-12-03T16:00Z'), 'own calendar event follows its appointment')
  equal((await victimThread()).last_preview, 'On our way', 'own inbox preview updates')

  // A partner from another company writes on the shared job (org comes from the job).
  await as(5)
  const partnerPayment = await one('insert into public.fh_payments(contact_id, invoice_id, amount) values ($1,$2,75) returning org_id', [id(20), id(60)])
  equal(partnerPayment.org_id, id(A), 'accepted partner logs a payment on the shared job invoice')
  await blocked('insert into public.fh_payments(contact_id, invoice_id, amount) values ($1,$2,75)', [id(20), id(61)], 'partner cannot attach the shared job to a third company invoice')

  // Server paths: approval with explicit org, e-sign with org inherited from the quote, inbound message, cron run.
  await as(null, 'service_role')
  await works("insert into public.fh_quote_versions(org_id, quote_id, version_number, status) values ($1,$2,2,'approved')", [id(A), id(40)], 'service approval with explicit company works')
  equal((await one("insert into public.fh_notes(quote_id, text) values ($1,'Proposal sent') returning org_id", [id(40)])).org_id, id(A), 'service note inherits the quote company')
  await works("insert into public.fh_messages(org_id, conversation_id, client_id, body) values ($1,$2,$3,'Inbound')", [id(A), id(80), id(10)], 'inbound message into own conversation works')
  await works('insert into public.fh_workflow_runs(org_id, client_id) values ($1,$2)', [id(A), id(10)], 'service workflow run for own customer works')
  await works("insert into public.fh_quote_items(quote_id, contact_id, description, amount) values ($1,$2,'Personal line',5)", [id(42), id(22)], 'personal records without a company still work')
  await db.exec('reset role')

  // Legacy rows that already mismatch are not frozen for unrelated edits.
  await as(2)
  await works("update public.fh_appointments set status='booked' where id=$1", [id(93)], 'unrelated edit on an own appointment works')
  await db.exec('reset role')
  await works("update public.fh_quote_items set description='Legacy' where id=$1", [id(90)], 'unrelated edit on a legacy mismatched row is not blocked')
  console.log(`${checks} parent company checks passed.`)
} finally { await db.close() }
