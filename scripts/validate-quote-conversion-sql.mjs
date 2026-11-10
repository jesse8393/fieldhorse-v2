import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('conversion')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; console.log(`PASS ${label}`) }
const denied = async (fn, label) => { await assert.rejects(fn); checks++; console.log(`PASS ${label}`) }
const scope = async (user = 1, session = db) => {
  await session.query('reset role')
  await session.query("select set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : ''])
  await session.query(`set role ${user ? 'authenticated' : 'anon'}`)
}
const convert = async (quote = 20, session = db) =>
  (await session.query('select public.fh_make_job_from_quote($1) as id', [id(quote)])).rows[0].id
const countJobs = async () => {
  await db.exec('reset role')
  return (await db.query('select count(*)::int n from public.fh_contacts')).rows[0].n
}
try {
  await db.exec(`${auditRoles}
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.org_members(org_id uuid,user_id uuid,role text,revoked_at timestamptz);
    create function public.fh_is_org_member(org uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.org_members where org_id=org and user_id=auth.uid() and revoked_at is null) $$;
    create function public.fh_money_visible(org uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from public.org_members where org_id=org and user_id=auth.uid() and revoked_at is null and role in ('owner','admin','manager')) $$;
    create table public.fh_clients(id uuid primary key,user_id uuid,org_id uuid,name text,phone text,email text,address text);
    create table public.fh_contacts(id uuid primary key default gen_random_uuid(),user_id uuid,org_id uuid,client_id uuid references public.fh_clients,stage text,name text,phone text,email text,address text,job_title text,job_type text,scope_text text,terms_text text,exclusions_text text,amount numeric);
    create table public.fh_quotes(id uuid primary key,user_id uuid,org_id uuid,client_id uuid references public.fh_clients,job_id uuid references public.fh_contacts,title text,job_type text,scope_text text,terms_text text,exclusions_text text,status text);
    create table public.fh_quote_items(id uuid primary key default gen_random_uuid(),user_id uuid,org_id uuid,contact_id uuid references public.fh_contacts,quote_id uuid references public.fh_quotes,description text,qty numeric,rate numeric,amount numeric,unit text,section text,notes text,is_optional boolean default false,is_excluded boolean default false,sort_order integer default 0);
    grant usage on schema public,auth to authenticated,anon;
    grant select,insert,update,delete on public.fh_contacts,public.fh_clients,public.fh_quotes,public.fh_quote_items to authenticated;
    alter table public.fh_contacts enable row level security;
    alter table public.fh_clients enable row level security;
    alter table public.fh_quotes enable row level security;
    alter table public.fh_quote_items enable row level security;
    create policy member on public.fh_contacts to authenticated using(public.fh_is_org_member(org_id)) with check(public.fh_is_org_member(org_id));
    create policy member on public.fh_clients to authenticated using(public.fh_is_org_member(org_id)) with check(public.fh_is_org_member(org_id));
    create policy money on public.fh_quotes to authenticated using(public.fh_is_org_member(org_id) and public.fh_money_visible(org_id)) with check(public.fh_is_org_member(org_id) and public.fh_money_visible(org_id));
    create policy money on public.fh_quote_items to authenticated using(public.fh_is_org_member(org_id) and public.fh_money_visible(org_id)) with check(public.fh_is_org_member(org_id) and public.fh_money_visible(org_id));
    insert into public.org_members values
      ('${id(100)}','${id(1)}','owner',null),('${id(100)}','${id(2)}','manager',null),
      ('${id(100)}','${id(3)}','crew',null),('${id(100)}','${id(4)}','owner',now()),
      ('${id(100)}','${id(5)}','foreman',null),('${id(100)}','${id(6)}','admin',null),
      ('${id(200)}','${id(1)}','owner',null);
    insert into public.fh_clients values ('${id(10)}','${id(4)}','${id(100)}','Fixture customer','6155550100','customer@example.test','Fixture address'),('${id(11)}','${id(1)}','${id(200)}','Other company',null,null,null);
    insert into public.fh_quotes(id,user_id,org_id,client_id,title,job_type,scope_text,terms_text,exclusions_text,status)
      select '${id(20)}'::uuid, '${id(4)}','${id(100)}','${id(10)}','Deck','deck','Build deck','Deposit','Permits','approved';
  `)
  for (const n of [21,22,23,24,25,26,27,28,29,30,31]) {
    await db.query('insert into public.fh_quotes select $1,user_id,org_id,client_id,null,title,job_type,scope_text,terms_text,exclusions_text,status from public.fh_quotes where id=$2', [id(n),id(20)])
  }
  await db.query('update public.fh_quotes set client_id=$1 where id=$2', [id(11),id(21)])
  for (const [n,amount,opt,excluded] of [[30,1000.25,false,false],[31,250,true,false],[32,75,false,true],[33,500.5,false,false]]) {
    await db.query('insert into public.fh_quote_items(id,user_id,org_id,quote_id,description,qty,rate,amount,is_optional,is_excluded,sort_order) values($1,$2,$3,$4,$5,1,$6,$6,$7,$8,$9)',[id(n),id(4),id(100),id(20),`Fixture ${n}`,amount,opt,excluded,n])
  }
  await db.exec('alter table public.fh_quotes add column origin_contact_id uuid references public.fh_contacts(id)')
  const migration = await readFile(new URL('../supabase/migrations/20261101184536_atomic_quote_conversion.sql',import.meta.url),'utf8')
  await db.exec(migration); await db.exec(migration)
  await scope(2)
  const job = await convert()
  equal(await convert(),job,'retry returns one existing job')
  const row = (await db.query('select * from public.fh_contacts where id=$1',[job])).rows[0]
  equal(Number(row.amount),1500.75,'only base items contribute exact cents')
  equal(row.address,'Fixture address','customer address survives conversion')
  equal([row.user_id,row.scope_text,row.terms_text,row.exclusions_text],[id(2),'Build deck','Deposit','Permits'],'active converter owns copied work and terms survive')
  equal((await db.query('select count(*)::int n from public.fh_quote_items where contact_id=$1',[job])).rows[0].n,4,'all optional and excluded lines remain visible on job')
  equal((await db.query('select status from public.fh_quotes where id=$1',[id(20)])).rows[0].status,'approved','quote status preserved')
  equal(await countJobs(),1,'retry creates no duplicate jobs')
  for (const user of [0,3,4,5,7]) {
    await scope(user)
    await denied(()=>convert(),`caller ${user} cannot convert or retrieve without current permission`)
  }
  await scope(1)
  await denied(()=>convert(21),'customer company mismatch rejected even with membership in both companies')
  await scope(6)
  const emptyJob = await convert(22)
  equal(Number((await db.query('select amount from public.fh_contacts where id=$1',[emptyJob])).rows[0].amount),0,'empty quote converts with zero base amount')
  await db.exec('reset role')
  // Reproduce moved quote rows without exposing real customer records.
  await db.exec(`
    insert into public.fh_contacts(id,user_id,org_id,client_id,stage) values
      ('${id(50)}','${id(1)}','${id(100)}','${id(10)}','moved_quote'),
      ('${id(51)}','${id(1)}','${id(100)}','${id(10)}','moved_quote'),
      ('${id(52)}','${id(1)}','${id(200)}','${id(11)}','moved_quote'),
      ('${id(53)}','${id(1)}','${id(100)}','${id(10)}','job');
    update public.fh_quotes set origin_contact_id='${id(50)}' where id in ('${id(27)}','${id(28)}','${id(31)}');
    update public.fh_quotes set origin_contact_id='${id(52)}' where id='${id(29)}';
    update public.fh_quotes set origin_contact_id='${id(53)}' where id='${id(30)}';
    insert into public.fh_quote_items(id,user_id,org_id,contact_id,quote_id,description,qty,rate,amount,is_optional,is_excluded,sort_order) values
      ('${id(60)}','${id(1)}','${id(100)}','${id(50)}','${id(27)}','Legacy item',1,199.25,199.25,false,false,1),
      ('${id(61)}','${id(1)}','${id(100)}',null,'${id(27)}','Optional item',1,80,80,true,false,2),
      ('${id(62)}','${id(1)}','${id(100)}','${id(51)}','${id(28)}','Wrong origin',1,10,10,false,false,1),
      ('${id(63)}','${id(1)}','${id(100)}','${id(52)}','${id(29)}','Foreign origin',1,10,10,false,false,1),
      ('${id(64)}','${id(1)}','${id(100)}','${id(53)}','${id(30)}','Wrong stage',1,10,10,false,false,1),
      ('${id(65)}','${id(1)}','${id(200)}','${id(50)}','${id(31)}','Foreign line',1,10,10,false,false,1);
  `)
  await scope(1)
  const legacyJob = await convert(27)
  equal(await convert(27),legacyJob,'legacy conversion retry returns the same job')
  equal(Number((await db.query('select amount from public.fh_contacts where id=$1',[legacyJob])).rows[0].amount),199.25,'legacy conversion preserves exact base total')
  equal((await db.query('select count(*)::int n from public.fh_quote_items where contact_id=$1 and quote_id is null',[legacyJob])).rows[0].n,2,'legacy and optional lines copy to the new job')
  equal((await db.query('select count(*)::int n from public.fh_quote_items where contact_id=$1 and quote_id=$2',[id(50),id(27)])).rows[0].n,1,'legacy quote retains its original line')
  for (const [quote,label] of [[28,'another origin'],[29,'foreign origin'],[30,'non migrated origin'],[31,'foreign line']]) {
    const countBefore = await countJobs()
    await scope(1)
    await denied(()=>convert(quote),`rejects ${label}`)
    equal(await countJobs(),countBefore,`${label} creates no partial job`)
  }
  await db.exec('reset role')
  await db.exec(`
    insert into public.fh_quote_items(user_id,org_id,quote_id,description,qty,rate,amount) values('${id(1)}','${id(100)}','${id(23)}','blocked copy',1,10,10);
    alter table public.fh_quote_items add constraint fail_copy check(contact_id is null or description <> 'blocked copy');
  `)
  const before = await countJobs()
  await scope(1); await denied(()=>convert(23),'line copy failure rejects conversion')
  equal(await countJobs(),before,'line copy failure rolls back inserted job')
  equal((await db.query('select job_id from public.fh_quotes where id=$1',[id(23)])).rows[0].job_id,null,'line copy failure leaves quote unlinked')
  await db.exec(`create function fail_link() returns trigger language plpgsql as $$ begin
    if new.id='${id(24)}' and new.job_id is not null then return null; end if;
    return new;
  end $$; create trigger fail_link before update on public.fh_quotes for each row execute function fail_link();`)
  await scope(1); await denied(()=>convert(24),'suppressed quote link rejects conversion')
  equal(await countJobs(),before,'suppressed quote link rolls back inserted job')
  if (db.openSession) {
    const a=await db.openSession(), b=await db.openSession()
    try {
      await scope(1,a); await scope(2,b); await a.query('begin'); await b.query('begin')
      const first=await convert(25,a); const waiting=convert(25,b)
      await a.query('commit'); const second=await waiting; await b.query('commit')
      equal(second,first,'independent concurrent conversions return identical jobs')
    } finally { await a.end(); await b.end() }
  } else console.log('SKIP independent conversion concurrency: requires PostgreSQL sessions.')
  await db.exec('reset role')
  equal((await db.query("select prosecdef from pg_proc where oid='public.fh_make_job_from_quote(uuid)'::regprocedure")).rows[0].prosecdef,false,'conversion retains invoker RLS')
  console.log(`${checks} quote conversion checks passed.`)
} finally { await db.close() }
