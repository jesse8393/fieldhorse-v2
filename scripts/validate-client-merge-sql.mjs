// Merge duplicates must not lose records (audit DATA-01, M-04). Builds the
// foreign keys that point at fh_clients with the delete rules from the
// migrations (092 for leads, quotes and invoices; 053 statement links; 039
// selections; 091 follow ups; the captured growth migrations for
// conversations, messages, consent and tags), shows that deleting the
// duplicate the old way loses its leads and quotes, then runs
// fh_merge_client_into and the app's delete and checks nothing is lost.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('clientmerge')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; console.log(`PASS ${label}`) }
const denied = async (sql, params, label) => { await assert.rejects(() => db.query(sql, params)); checks++; console.log(`PASS ${label}`) }
const as = async user => {
  await db.query('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id(user)])
  await db.query('set role authenticated')
}
const count = async (sql, params = []) => {
  await db.query('reset role')
  return (await db.query(sql, params)).rows[0].n
}

const ORG = id(100), OTHER_ORG = id(200)
const OWNER = 1, CREW = 2, OUTSIDER = 3
const KEEP = id(10), DUPE = id(11), FOREIGN = id(12), OLD_KEEP = id(13), OLD_DUPE = id(14)

try {
  const migration = await readFile(new URL('../supabase/migrations/20261117090000_merge_client_into.sql', import.meta.url), 'utf8')
  const statements = migration.replace(/--.*$/gm, '')
  equal(/\b(delete\s+from|drop\s|truncate\s)/i.test(statements), false, 'the merge migration has no statement that removes rows or objects')

  await db.exec(`${auditRoles}
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.org_members(org_id uuid,user_id uuid,role text,revoked_at timestamptz);
    create table public.fh_clients(id uuid primary key,user_id uuid,org_id uuid,name text,phone text);
    create table public.fh_contacts(id uuid primary key,org_id uuid,client_id uuid references public.fh_clients(id) on delete set null,stage text);
    create table public.fh_leads(id uuid primary key,org_id uuid,client_id uuid not null references public.fh_clients(id) on delete cascade,title text);
    create table public.fh_quotes(id uuid primary key,org_id uuid,client_id uuid not null references public.fh_clients(id) on delete cascade,status text,amount numeric);
    create table public.fh_quote_items(id uuid primary key,quote_id uuid references public.fh_quotes(id) on delete cascade,amount numeric);
    create table public.fh_quote_versions(id uuid primary key,quote_id uuid not null references public.fh_quotes(id) on delete cascade,base_total numeric);
    create table public.fh_invoices(id uuid primary key,org_id uuid,client_id uuid references public.fh_clients(id) on delete set null,contact_id uuid,amount numeric);
    create table public.fh_public_links(id uuid primary key,client_id uuid references public.fh_clients(id) on delete cascade,quote_id uuid references public.fh_quotes(id) on delete cascade);
    create table public.fh_selections(id uuid primary key,client_id uuid references public.fh_clients(id) on delete set null);
    create table public.fh_follow_ups(id uuid primary key,client_id uuid references public.fh_clients(id) on delete set null,lead_id uuid);
    create table public.fh_conversations(id uuid primary key,org_id uuid,client_id uuid not null references public.fh_clients(id) on delete cascade,
      unread_count integer not null default 0,last_message_at timestamptz,last_inbound_at timestamptz,last_outbound_at timestamptz,updated_at timestamptz,unique(org_id,client_id));
    create table public.fh_messages(id uuid primary key,org_id uuid,conversation_id uuid not null references public.fh_conversations(id) on delete cascade,
      client_id uuid not null references public.fh_clients(id) on delete cascade,body text);
    create table public.fh_events(id uuid primary key,client_id uuid references public.fh_clients(id) on delete cascade,
      conversation_id uuid references public.fh_conversations(id) on delete set null);
    create table public.fh_consent(client_id uuid primary key references public.fh_clients(id) on delete cascade,
      sms_status text not null default 'unknown',email_status text not null default 'unknown',calls_status text not null default 'unknown',
      dnd_all boolean not null default false,updated_at timestamptz);
    create table public.fh_client_tags(client_id uuid not null references public.fh_clients(id) on delete cascade,tag text not null,primary key(client_id,tag));
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;

    insert into public.org_members values('${ORG}','${id(OWNER)}','owner',null),('${ORG}','${id(CREW)}','crew',null),('${OTHER_ORG}','${id(OUTSIDER)}','owner',null);
    insert into public.fh_clients values
      ('${KEEP}','${id(OWNER)}','${ORG}','Dana Whitfield','615-555-0101'),
      ('${DUPE}','${id(OWNER)}','${ORG}','Dana Whitfield','(615) 555-0101'),
      ('${FOREIGN}','${id(OUTSIDER)}','${OTHER_ORG}','Dana W','615-555-0101'),
      ('${OLD_KEEP}','${id(OWNER)}','${ORG}','Sam Old','615-555-0102'),
      ('${OLD_DUPE}','${id(OWNER)}','${ORG}','Sam Old','615-555-0102');
    insert into public.fh_contacts values('${id(20)}','${ORG}','${DUPE}','job');
    insert into public.fh_leads values('${id(30)}','${ORG}','${DUPE}','Back patio'),('${id(31)}','${ORG}','${OLD_DUPE}','Old lead');
    insert into public.fh_quotes values('${id(40)}','${ORG}','${DUPE}','approved',12000),('${id(41)}','${ORG}','${DUPE}','sent',4800),
      ('${id(42)}','${ORG}','${OLD_DUPE}','approved',3000);
    insert into public.fh_quote_items values('${id(50)}','${id(40)}',12000),('${id(51)}','${id(41)}',4800),('${id(52)}','${id(42)}',3000);
    insert into public.fh_quote_versions values('${id(60)}','${id(40)}',12000),('${id(61)}','${id(42)}',3000);
    insert into public.fh_invoices values('${id(70)}','${ORG}','${DUPE}',null,500),('${id(71)}','${ORG}','${OLD_DUPE}',null,800);
    insert into public.fh_public_links values('${id(80)}',null,'${id(41)}'),('${id(81)}','${DUPE}',null);
    insert into public.fh_selections values('${id(85)}','${DUPE}');
    insert into public.fh_follow_ups values('${id(86)}','${DUPE}','${id(30)}');
    insert into public.fh_conversations values('${id(90)}','${ORG}','${KEEP}',1,'2026-11-01',null,null,null),('${id(91)}','${ORG}','${DUPE}',2,'2026-11-10',null,null,null);
    insert into public.fh_messages values('${id(92)}','${ORG}','${id(90)}','${KEEP}','hi'),('${id(93)}','${ORG}','${id(91)}','${DUPE}','call me back');
    insert into public.fh_events values('${id(94)}','${DUPE}','${id(91)}');
    insert into public.fh_consent values('${KEEP}','opted_in','unknown','unknown',false,null),('${DUPE}','opted_out','opted_in','unknown',false,null);
    insert into public.fh_client_tags values('${KEEP}','vip'),('${DUPE}','vip'),('${DUPE}','repeat');
  `)

  // The old merge (jobs, statement links and selections only, then delete)
  // loses the duplicate's leads, quotes, approved versions and links, and
  // its invoice loses the client.
  await db.query('update public.fh_contacts set client_id=$1 where client_id=$2', [OLD_KEEP, OLD_DUPE])
  await db.query('update public.fh_public_links set client_id=$1 where client_id=$2', [OLD_KEEP, OLD_DUPE])
  await db.query('update public.fh_selections set client_id=$1 where client_id=$2', [OLD_KEEP, OLD_DUPE])
  await db.query('delete from public.fh_clients where id=$1', [OLD_DUPE])
  equal(await count('select count(*)::int n from public.fh_leads where id=$1', [id(31)]), 0, 'baseline: the old merge deletes the duplicate lead')
  equal(await count('select count(*)::int n from public.fh_quote_versions where id=$1', [id(61)]), 0, 'baseline: the old merge deletes the approved quote version')
  equal(await count('select count(*)::int n from public.fh_invoices where id=$1 and client_id is null', [id(71)]), 1, 'baseline: the old merge leaves the invoice with no client')

  await db.exec(migration)
  await db.exec(migration)

  await as(CREW)
  await denied('select public.fh_merge_client_into($1,$2)', [KEEP, [DUPE]], 'a crew member cannot merge clients')
  await as(OUTSIDER)
  await denied('select public.fh_merge_client_into($1,$2)', [KEEP, [DUPE]], 'someone from another company cannot merge these clients')
  await as(OWNER)
  await denied('select public.fh_merge_client_into($1,$2)', [KEEP, [FOREIGN]], "another company's client cannot be merged in")
  equal(await count('select count(*)::int n from public.fh_leads where client_id=$1', [DUPE]), 1, 'a refused merge moves nothing')

  await as(OWNER)
  const moved = (await db.query('select public.fh_merge_client_into($1,$2) as r', [KEEP, [DUPE]])).rows[0].r
  equal(moved, { jobs: 1, leads: 1, quotes: 2, invoices: 1 }, 'the merge reports what moved')
  const again = (await db.query('select public.fh_merge_client_into($1,$2) as r', [KEEP, [DUPE]])).rows[0].r
  equal(again, { jobs: 0, leads: 0, quotes: 0, invoices: 0 }, 'running the merge again moves nothing twice')

  // The app deletes the emptied duplicate as its own step.
  await db.query('reset role')
  await db.query('delete from public.fh_clients where id=$1', [DUPE])

  equal(await count('select count(*)::int n from public.fh_leads where client_id=$1', [KEEP]), 1, 'the lead survives on the kept client')
  equal(await count('select count(*)::int n from public.fh_quotes where client_id=$1', [KEEP]), 2, 'both quotes survive on the kept client')
  equal(await count('select count(*)::int n from public.fh_quote_items where quote_id in ($1,$2)', [id(40), id(41)]), 2, 'the quote lines survive')
  equal(await count('select count(*)::int n from public.fh_quote_versions where id=$1', [id(60)]), 1, 'the approved version survives')
  equal(await count('select count(*)::int n from public.fh_public_links where id in ($1,$2)', [id(80), id(81)]), 2, 'customer and statement links survive')
  equal(await count('select count(*)::int n from public.fh_invoices where id=$1 and client_id=$2', [id(70), KEEP]), 1, 'the invoice keeps a client')
  equal(await count('select count(*)::int n from public.fh_contacts where client_id=$1', [KEEP]), 1, 'the job moves')
  equal(await count('select count(*)::int n from public.fh_selections where client_id=$1', [KEEP]), 1, 'the selection moves')
  equal(await count('select count(*)::int n from public.fh_follow_ups where client_id=$1', [KEEP]), 1, 'the follow up moves')
  equal(await count('select count(*)::int n from public.fh_messages where conversation_id=$1', [id(90)]), 2, "the duplicate's messages join the kept thread")
  equal(await count('select unread_count n from public.fh_conversations where id=$1', [id(90)]), 3, 'unread counts add up')
  equal(await count('select count(*)::int n from public.fh_events where id=$1 and client_id=$2 and conversation_id=$3', [id(94), KEEP, id(90)]), 1, 'the event moves with its thread')
  equal(await count("select (sms_status='opted_out' and email_status='opted_in')::int n from public.fh_consent where client_id=$1", [KEEP]), 1, 'an opt out on the duplicate is kept')
  equal(await count("select count(*)::int n from public.fh_client_tags where client_id=$1", [KEEP]), 2, 'tags are combined')

  console.log(`${checks} client merge checks passed.`)
} finally { await db.close() }
