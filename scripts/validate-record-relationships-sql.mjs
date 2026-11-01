import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('relationships')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const equal = (a,b,label) => { assert.deepEqual(a,b,label); checks++; console.log(`PASS ${label}`) }
const foreignKeyDenied = async (sql,params,label) => {
  await assert.rejects(() => db.query(sql,params), e => e.code === '23503')
  checks++; console.log(`PASS ${label}`)
}
try {
  await db.exec(`${auditRoles}
    create table public.fh_clients(id uuid primary key,org_id uuid);
    create table public.fh_contacts(id uuid primary key,org_id uuid,client_id uuid references public.fh_clients on delete set null);
    create table public.fh_leads(id uuid primary key,org_id uuid,client_id uuid references public.fh_clients on delete cascade,quote_id uuid);
    create table public.fh_quotes(id uuid primary key,org_id uuid,client_id uuid references public.fh_clients on delete cascade,job_id uuid references public.fh_contacts on delete set null,lead_id uuid references public.fh_leads on delete set null);
    alter table public.fh_leads add foreign key(quote_id) references public.fh_quotes on delete set null;
    grant usage on schema public to authenticated;
    grant select,insert,update,delete on all tables in schema public to authenticated;
    insert into public.fh_clients values('${id(10)}','${id(100)}'),('${id(11)}','${id(200)}'),('${id(12)}','${id(100)}');
    insert into public.fh_contacts values('${id(20)}','${id(100)}','${id(10)}'),('${id(21)}','${id(200)}','${id(11)}');
    insert into public.fh_leads values('${id(30)}','${id(100)}','${id(10)}',null),('${id(31)}','${id(200)}','${id(11)}',null);
    insert into public.fh_quotes values('${id(40)}','${id(100)}','${id(10)}','${id(20)}','${id(30)}'),('${id(41)}','${id(200)}','${id(11)}','${id(21)}','${id(31)}');
  `)
  for (const table of ['fh_clients','fh_contacts','fh_leads','fh_quotes']) {
    await db.exec(`alter table public.${table} enable row level security;
      create policy tenant on public.${table} to authenticated using(org_id=current_setting('test.org')::uuid)
      with check(org_id=current_setting('test.org')::uuid);`)
  }
  await db.query("select set_config('test.org',$1,false)",[id(100)])
  await db.exec('set role authenticated')
  equal((await db.query('select id from public.fh_clients where id=$1',[id(11)])).rows.length,0,'direct foreign customer read denied by RLS')
  await db.query('insert into public.fh_contacts values($1,$2,$3)',[id(99),id(100),id(11)])
  equal((await db.query('select client_id from public.fh_contacts where id=$1',[id(99)])).rows[0].client_id,id(11),'baseline RLS permits a foreign customer pointer')
  await db.exec('reset role')
  await db.query('delete from public.fh_contacts where id=$1',[id(99)])
  const migration=await readFile(new URL('../supabase/migrations/20261101185443_record_relationship_guards.sql',import.meta.url),'utf8')
  await db.exec(migration); await db.exec(migration)
  await db.exec('set role authenticated')
  for (const [table,record] of [['fh_contacts',20],['fh_leads',30],['fh_quotes',40]]) {
    await foreignKeyDenied(`update public.${table} set client_id=$1 where id=$2`,[id(11),id(record)],`${table} cannot reference a foreign customer`)
  }
  for (const [table,column,foreign,record] of [['fh_quotes','job_id',21,40],['fh_quotes','lead_id',31,40],['fh_leads','quote_id',41,30]]) {
    await foreignKeyDenied(`update public.${table} set ${column}=$1 where id=$2`,[id(foreign),id(record)],`${table}.${column} cannot cross company boundaries`)
  }
  await foreignKeyDenied('insert into public.fh_contacts values($1,$2,$3)',[id(99),id(100),id(11)],'new job cannot link a foreign customer')
  await db.query('update public.fh_contacts set client_id=$1 where id=$2',[id(12),id(20)])
  equal((await db.query('select client_id from public.fh_contacts where id=$1',[id(20)])).rows[0].client_id,id(12),'same company customer replacement works on a quoted job')
  await db.query('update public.fh_contacts set client_id=null where id=$1',[id(20)])
  equal((await db.query('select client_id from public.fh_contacts where id=$1',[id(20)])).rows[0].client_id,null,'customer unlink remains available')
  await db.exec('reset role')
  await foreignKeyDenied('update public.fh_clients set org_id=$1 where id=$2',[id(200),id(10)],'parent company move cannot strand existing child associations')
  await db.query('delete from public.fh_contacts where id=$1',[id(20)])
  equal((await db.query('select job_id from public.fh_quotes where id=$1',[id(40)])).rows[0].job_id,null,'existing job deletion still clears quote link')
  await db.query('delete from public.fh_clients where id=$1',[id(10)])
  equal((await db.query('select id from public.fh_quotes where id=$1',[id(40)])).rows.length,0,'existing customer cascade remains intact')
  equal((await db.query("select count(*)::int n from pg_constraint where conname like '%_company_fk' and convalidated")).rows[0].n,6,'all six company relationship constraints validate')
  console.log(`${checks} record relationship checks passed.`)
} finally { await db.close() }
