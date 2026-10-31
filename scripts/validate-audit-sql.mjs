// Focused, isolated PostgreSQL validation for audit migrations.
// PGLITE_RUNTIME points at a separately installed @electric-sql/pglite package.
// Uses real SQL, roles, RLS, triggers and rollback with synthetic data only.
// CI uses independent PostgreSQL sessions; the local PGlite fallback is single-connection.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'
import { verifyConcurrency } from './audit-concurrency.mjs'
const db = await auditDatabase('billing')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sqlFile = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const results = []
async function test(name, fn) {
  try { await fn(); results.push({ name, result: 'passed' }); console.log(`PASS ${name}`) }
  catch (error) { results.push({ name, result: 'failed', message: error.message }); throw Object.assign(error, { testName: name }) }
}
async function rejects(sql, code, params = []) {
  await assert.rejects(db.query(sql, params), error => error.code === code)
}
async function as(user = 1, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user == null ? null : id(user), role })])
  await db.exec(`set role ${role}`)
}
const insertInvoice = (n, amount, options = {}) => db.query(
  'insert into public.fh_invoices(id,contact_id,user_id,org_id,amount,status) values($1,$2,$3,$4,$5,$6) returning *',
  [id(n), options.job === null ? null : id(options.job ?? 200), id(options.user ?? 1), options.org == null ? null : id(options.org), amount, options.status ?? 'draft'])
const visit = (n, start, end, members = [4], options = {}) => db.query(
  'insert into public.fh_schedule(id,contact_id,user_id,org_id,start_at,end_at,assigned_user_ids,assigned_to,title,lead_id,quote_id) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *',
  [id(n), options.job === null ? null : id(options.job ?? 200), id(options.user ?? 1), options.org == null ? null : id(options.org), start, end, members.map(id), options.legacy == null ? null : id(options.legacy), 'Synthetic visit', options.lead == null ? null : id(options.lead), options.quote == null ? null : id(options.quote)])
const count = async table => Number((await db.query(`select count(*) as count from ${table}`)).rows[0].count)
try {
  console.log(JSON.stringify({ engine: (await db.query('select version()')).rows[0].version, limitations: ['Focused schema, not the complete historical migration chain', 'Supabase auth functions reproduced from JWT GUC semantics', ...(db.openSession ? [] : ['PGlite has one connection; simultaneous transactions unverified'])] }))
  await db.exec(`
    ${auditRoles}
    create schema auth; create schema extensions;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt()->>'sub','')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select auth.jwt()->>'role' $$;
    grant usage on schema auth to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;
    create table public.org_members(id uuid primary key default gen_random_uuid(), org_id uuid not null,user_id uuid not null references auth.users,role text not null,revoked_at timestamptz,joined_at timestamptz default now());
    create table public.fh_contacts(id uuid primary key,user_id uuid not null references auth.users,org_id uuid,amount numeric);
    create table public.fh_leads(id uuid primary key,user_id uuid not null references auth.users,org_id uuid);
    create table public.fh_quotes(id uuid primary key,user_id uuid not null references auth.users,org_id uuid);
    create table public.fh_change_orders(id uuid primary key default gen_random_uuid(),contact_id uuid references public.fh_contacts,amount numeric,status text);
    create table public.fh_invoices(id uuid primary key,contact_id uuid references public.fh_contacts,user_id uuid not null references auth.users,org_id uuid,amount numeric not null,status text not null default 'draft',notes text);
    create table public.fh_schedule(id uuid primary key,user_id uuid not null references auth.users,org_id uuid,contact_id uuid references public.fh_contacts,title text,start_at timestamptz,end_at timestamptz,assigned_to uuid,lead_id uuid references public.fh_leads on delete set null,quote_id uuid references public.fh_quotes on delete set null);
    grant select,insert,update,delete on all tables in schema public to authenticated, service_role;
    grant select on public.org_members to anon;
    alter table public.fh_invoices enable row level security;
    alter table public.fh_schedule enable row level security;
    create policy invoice_company on public.fh_invoices for all to authenticated
      using ((org_id is null and user_id = auth.uid()) or exists(select 1 from public.org_members m where m.org_id=fh_invoices.org_id and m.user_id=auth.uid() and m.revoked_at is null and m.role in ('owner','admin','manager')))
      with check ((org_id is null and user_id = auth.uid()) or exists(select 1 from public.org_members m where m.org_id=fh_invoices.org_id and m.user_id=auth.uid() and m.revoked_at is null and m.role in ('owner','admin','manager')));
    create policy schedule_company on public.fh_schedule for all to authenticated
      using ((org_id is null and user_id=auth.uid()) or exists(select 1 from public.org_members m where m.org_id=fh_schedule.org_id and m.user_id=auth.uid() and m.revoked_at is null))
      with check ((org_id is null and user_id=auth.uid()) or exists(select 1 from public.org_members m where m.org_id=fh_schedule.org_id and m.user_id=auth.uid() and m.revoked_at is null));
  `)
  for (let n = 1; n <= 8; n++) await db.query('insert into auth.users values($1)', [id(n)])
  for (const [user, role, org, revoked] of [[1,'owner',100,false],[2,'manager',100,false],[3,'admin',100,false],[4,'crew',100,false],[5,'foreman',100,false],[6,'manager',100,true],[7,'owner',101,false],[8,'crew',101,false]]) {
    await db.query('insert into public.org_members(org_id,user_id,role,revoked_at) values($1,$2,$3,$4)', [id(org),id(user),role,revoked ? '2026-01-01' : null])
  }
  for (const [job,user,org,amount] of [[200,1,100,10000],[201,7,101,10000],[202,1,null,1000],[203,1,100,null],[204,1,100,'NaN'],[205,1,100,10000],[206,1,100,10000]]) {
    await db.query('insert into public.fh_contacts values($1,$2,$3,$4)', [id(job),id(user),org == null ? null : id(org),amount])
  }
  for (const table of ['fh_leads','fh_quotes']) {
    const first = table === 'fh_leads' ? 210 : 220
    for (const [record,user,org] of [[first,1,100],[first+1,7,101],[first+2,1,100]]) {
      await db.query(`insert into public.${table} values($1,$2,$3)`, [id(record),id(user),id(org)])
    }
    await db.exec(`alter table public.${table} enable row level security;
      create policy canonical_company on public.${table} for all to authenticated
      using (exists(select 1 from public.org_members m where m.org_id=${table}.org_id and m.user_id=auth.uid() and m.revoked_at is null))
      with check (exists(select 1 from public.org_members m where m.org_id=${table}.org_id and m.user_id=auth.uid() and m.revoked_at is null));`)
  }
  // Execute real repository attribution functions, not simplified replacements.
  for (const [file,name,delimiter] of [['065_sub_portal_binding_and_workspace.sql','fh_set_org_id','$$'],['092_leads_and_quotes.sql','fh_inherit_org_from_contact','$function$']]) {
    const source = await sqlFile(file)
    const start = source.indexOf(`create or replace function public.${name}()`)
    const end = source.indexOf(`${delimiter};`, source.indexOf(`as ${delimiter}`, start)) + delimiter.length + 1
    assert(start >= 0 && end > start)
    await db.exec(source.slice(start,end))
  }
  for (const table of ['fh_invoices','fh_schedule']) await db.exec(`
    create trigger fh_set_org_id_trg before insert on public.${table} for each row execute function public.fh_set_org_id();
    create trigger zz_inherit_org_from_contact before insert or update of contact_id,org_id on public.${table} for each row execute function public.fh_inherit_org_from_contact();
  `)
  // Existing problematic history must not prevent installation.
  await db.query('insert into public.fh_invoices values($1,$2,$3,$4,$5,$6,$7),($8,$2,$3,$4,$9,$6,$7)',[id(300),id(205),id(1),id(100),8000,'draft',null,id(301),8000])
  await db.query('insert into public.fh_invoices values($1,$2,$3,$4,$5,$6,$7)',[id(302),id(206),id(1),id(100),-4000,'draft',null])
  await db.query('insert into public.fh_schedule(id,user_id,org_id,contact_id,title,start_at,end_at,assigned_to) values($1,$2,$3,$4,$5,$6,$7,$8)',[id(500),id(1),id(100),id(200),'Legacy visit','2026-11-01T10:00Z','2026-11-01T11:00Z',id(4)])
  await test('invoice migration executes without rewriting legacy invoices', async () => { await db.exec(await sqlFile('20261027170408_invoice_billing_safeguards.sql')); assert.equal(await count('public.fh_invoices'),3) })
  await test('schedule migration executes with btree_gist and legacy schedule intact', async () => { await db.exec(await sqlFile('20261027170430_schedule_crew_allocation.sql')); assert.equal(await count('public.fh_schedule'),1) })
  await as()
  await test('invoice insert inherits the job company before budget validation', async () => { assert.equal((await insertInvoice(310,4000)).rows[0].org_id,id(100)) })
  await test('a subsequent invoice cannot consume an already reserved balance', async () => { await assert.rejects(insertInvoice(311,6000.01), e => e.code === '23514'); assert.equal(await count('public.fh_invoices'),4) })
  await test('an exact remaining installment succeeds to the cent', async () => { await insertInvoice(312,6000) })
  await test('voiding an unused draft permits its replacement', async () => { await db.query("update public.fh_invoices set status='void' where id=$1",[id(310)]); await insertInvoice(313,4000) })
  await test('paid installments still reserve approved contract value', async () => { await db.query("update public.fh_invoices set status='paid' where id=$1",[id(312)]); await assert.rejects(insertInvoice(314,0.01),e=>e.code==='23514') })
  await test('approved scope increases budget while pending scope does not', async () => { await db.query('insert into public.fh_change_orders(contact_id,amount,status) values($1,1000,\'pending\')',[id(200)]); await assert.rejects(insertInvoice(315,1000),e=>e.code==='23514'); await db.query("update public.fh_change_orders set status='approved' where contact_id=$1",[id(200)]); await insertInvoice(316,1000) })
  await test('overbilled legacy drafts can reduce or void but cannot issue unchanged', async () => { await db.query('update public.fh_invoices set amount=7000 where id=$1',[id(300)]); await rejects("update public.fh_invoices set status='sent' where id=$1",'23514',[id(300)]); await db.query("update public.fh_invoices set status='void' where id=$1",[id(301)]); await db.query("update public.fh_invoices set status='sent' where id=$1",[id(300)]) })
  await test('negative legacy invoices cannot manufacture free scope', async () => { await assert.rejects(insertInvoice(317,10001,{job:206}),e=>e.code==='23514') })
  await test('negative, zero and nonfinite new invoice amounts fail', async () => { for (const amount of [-1,0,'NaN','Infinity','-Infinity']) await assert.rejects(insertInvoice(318,amount,{job:203}),e=>e.code==='23514') })
  await test('invalid stored contract values fail closed', async () => { await assert.rejects(insertInvoice(319,100,{job:204}),e=>e.code==='23514') })
  await test('invalid approved change values fail closed', async () => { await db.query("insert into public.fh_change_orders(contact_id,amount,status) values($1,'Infinity','approved')",[id(206)]); await assert.rejects(insertInvoice(320,100,{job:206}),e=>e.code==='23514') })
  await test('unknown contract value does not invent a cap', async () => { await insertInvoice(321,25000,{job:203}) })
  await test('foreign company contact ids cannot probe or bill another job', async () => { await assert.rejects(insertInvoice(322,1,{job:201,org:100}),e=>e.code==='42501') })
  for (const user of [4,5,6,7]) await test(`invoice budget rejects unauthorized role user ${user}`, async () => { await as(user); await assert.rejects(insertInvoice(323,1),e=>e.code==='42501') })
  await as(2)
  await test('manager can create an invoice inside approved scope', async () => { await insertInvoice(324,10,{job:203,user:2}) })
  await as(3)
  await test('admin can create an invoice inside approved scope', async () => { await insertInvoice(325,10,{job:203,user:3}) })
  await as(null,'service_role')
  await test('service writes inherit company while retaining budget constraints', async () => { await insertInvoice(326,10,{job:203}); await assert.rejects(insertInvoice(327,1),e=>e.code==='23514') })
  await as()
  await test('failed invoice transactions roll back all prior inserts', async () => { const before=await count('public.fh_invoices'); await assert.rejects(db.transaction(async tx=> { await tx.query('insert into public.fh_invoices(id,contact_id,user_id,amount) values($1,$2,$3,1)',[id(328),id(203),id(1)]); await tx.query('insert into public.fh_invoices(id,contact_id,user_id,amount) values($1,$2,$3,1)',[id(329),id(200),id(1)]) })); assert.equal(await count('public.fh_invoices'),before) })
  await test('schedule insert inherits job company before allocation validation', async () => { const row=(await visit(510,'2026-11-02T10:00Z','2026-11-02T11:00Z',[4,5])).rows[0]; assert.equal(row.org_id,id(100)); assert.deepEqual(row.assigned_user_ids,[id(4),id(5)]); assert.equal(row.assigned_to,id(4)) })
  await test('overlapping assigned visits fail', async () => { await assert.rejects(visit(511,'2026-11-02T10:30Z','2026-11-02T11:30Z',[4]),e=>e.code==='23P01') })
  await test('adjacent visits succeed with half open ranges', async () => { await visit(512,'2026-11-02T11:00Z','2026-11-02T12:00Z',[4]) })
  await test('legacy reservations are checked without rewriting history', async () => { await assert.rejects(visit(513,'2026-11-01T10:30Z','2026-11-01T11:30Z',[4]),e=>e.code==='23P01') })
  await test('duplicate selected members normalize into one reservation', async () => { const row=(await visit(514,'2026-11-03T10:00Z','2026-11-03T11:00Z',[4,4])).rows[0]; assert.deepEqual(row.assigned_user_ids,[id(4)]) })
  await test('foreign and revoked assignees fail', async () => { for(const member of [6,8]) await assert.rejects(visit(515,'2026-11-04T10:00Z','2026-11-04T11:00Z',[member]),e=>e.code==='23514') })
  await test('assigned visits require a valid bounded interval', async () => { for(const [start,end] of [[null,null],['2026-11-04T11:00Z','2026-11-04T10:00Z'],['2026-11-04T10:00Z','2026-11-04T10:00Z']]) await assert.rejects(visit(516,start,end,[4]),e=>e.code==='23514') })
  await test('unassigned visits retain original permissive time semantics', async () => { await visit(517,null,null,[]) })
  await test('legacy assigned_to insert creates canonical crew allocation', async () => { assert.deepEqual((await visit(518,'2026-11-05T10:00Z','2026-11-05T11:00Z',[],{legacy:4})).rows[0].assigned_user_ids,[id(4)]) })
  await test('updating one visit excludes its own reservation', async () => { await db.query('update public.fh_schedule set end_at=$1 where id=$2',['2026-11-03T10:45Z',id(514)]) })
  await test('deletion frees an allocated slot', async () => { await db.query('delete from public.fh_schedule where id=$1',[id(514)]); await visit(519,'2026-11-03T10:00Z','2026-11-03T11:00Z',[4]) })
  for(const user of [4,5,6,7]) await test(`schedule assignment rejects unauthorized role user ${user}`, async () => { await as(user); await assert.rejects(visit(520,'2026-11-06T10:00Z','2026-11-06T11:00Z',[4],{user}),e=>e.code==='42501') })
  await as(4)
  await test('crew cannot move or delete an assigned company visit', async () => { await rejects('update public.fh_schedule set start_at=$1 where id=$2','42501',['2026-11-02T09:00Z',id(510)]); await rejects('delete from public.fh_schedule where id=$1','42501',[id(510)]) })
  await as(2)
  await test('manager can assign active company members', async () => { await visit(521,'2026-11-07T10:00Z','2026-11-07T11:00Z',[4],{user:2}) })
  await as(3)
  await test('admin can assign active company members', async () => { await visit(522,'2026-11-08T10:00Z','2026-11-08T11:00Z',[4],{user:3}) })
  await as()
  await test('all schedule writes in a failed recurring batch roll back', async () => { const before=await count('public.fh_schedule'); await assert.rejects(db.transaction(async tx=> { for (const n of [523,524]) await tx.query('insert into public.fh_schedule(id,user_id,contact_id,start_at,end_at,assigned_user_ids) values($1,$2,$3,$4,$5,$6)',[id(n),id(1),id(200),'2026-11-09T10:00Z','2026-11-09T11:00Z',[id(4)]]) })); assert.equal(await count('public.fh_schedule'),before) })
  for (const [kind,parent,otherCompany,sameCompany,n] of [['lead',210,211,212,530],['quote',220,221,222,531]]) {
    await test(`${kind} visits inherit canonical company before allocating crew`, async () => {
      const row=(await visit(n,`2026-11-${n-510}T10:00Z`,`2026-11-${n-510}T11:00Z`,[4],{job:null,[kind]:parent})).rows[0]
      assert.equal(row.org_id,id(100))
    })
    await test(`changing only the ${kind} cannot attach allocated crew to an inaccessible company`, async () => {
      const before=(await db.query('select * from public.fh_schedule where id=$1',[id(n)])).rows[0]
      await rejects(`update public.fh_schedule set ${kind}_id=$1 where id=$2`,'42501',[id(otherCompany),id(n)])
      assert.deepEqual((await db.query('select * from public.fh_schedule where id=$1',[id(n)])).rows[0],before)
    })
    await test(`changing only the ${kind} within a company preserves reservations`, async () => {
      await db.query(`update public.fh_schedule set ${kind}_id=$1 where id=$2`,[id(sameCompany),id(n)])
      const row=(await db.query('select * from public.fh_schedule where id=$1',[id(n)])).rows[0]
      assert.equal(row[`${kind}_id`],id(sameCompany))
      assert.equal(row.org_id,id(100))
      await assert.rejects(visit(n+10,`2026-11-${n-510}T10:30Z`,`2026-11-${n-510}T11:30Z`,[4]),e=>e.code==='23P01')
    })
  }
  await test('changing only the parent job cannot move allocated crew across companies', async () => {
    await db.exec('reset role')
    await db.query('insert into public.org_members(org_id,user_id,role) values($1,$2,$3)',[id(101),id(1),'owner'])
    await as()
    await rejects('update public.fh_schedule set contact_id=$1 where id=$2','42501',[id(201),id(510)])
    assert.equal((await db.query('select org_id from public.fh_schedule where id=$1',[id(510)])).rows[0].org_id,id(100))
  })
  for (const [kind,parent,otherCompany,n] of [['lead',210,211,530],['quote',220,221,531]]) {
    await test(`dual-company owner cannot bypass allocation checks by changing only the ${kind}`, async () => {
      await rejects(`update public.fh_schedule set ${kind}_id=$1 where id=$2`,'42501',[id(otherCompany),id(n)])
      assert.equal((await db.query('select org_id from public.fh_schedule where id=$1',[id(n)])).rows[0].org_id,id(100))
    })
    await test(`event form ${kind} updates preserve company invariants`, async () => {
      const patch='update public.fh_schedule set contact_id=null,lead_id=$1,quote_id=$2,start_at=start_at,end_at=end_at where id=$3 returning *'
      const params=target=>[kind==='lead'?id(target):null,kind==='quote'?id(target):null,id(n)]
      assert.equal((await db.query(patch,params(parent))).rows[0].org_id,id(100))
      await rejects(patch,'42501',params(otherCompany))
    })
    await test(`clearing crew allows a ${kind} visit to move and reserve its new company`, async () => {
      await db.query("update public.fh_schedule set assigned_user_ids='{}',assigned_to=null where id=$1",[id(n)])
      assert.equal((await db.query(`update public.fh_schedule set ${kind}_id=$1 where id=$2 returning org_id`,[id(otherCompany),id(n)])).rows[0].org_id,id(101))
      await db.query('update public.fh_schedule set assigned_user_ids=$1 where id=$2',[[id(8)],id(n)])
      await visit(n+12,`2026-11-${n-510}T10:00Z`,`2026-11-${n-510}T11:00Z`,[4])
      await assert.rejects(visit(n+14,`2026-11-${n-510}T10:30Z`,`2026-11-${n-510}T11:30Z`,[8],{job:null,[kind]:otherCompany}),e=>e.code==='23P01')
    })
  }
  await test('private reservation tables and trigger functions are not public API', async () => { await rejects('select * from private.fh_schedule_allocations','42501'); for(const name of ['fh_guard_schedule_allocation','fh_sync_schedule_allocations','fh_check_invoice_contract_budget']) assert.equal((await db.query("select has_function_privilege(current_user,p.oid,'execute') as can_execute from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname=$1",[name])).rows[0].can_execute,false) })
  await as(null,'anon')
  await test('anonymous writes cannot bypass invoice or allocation guards', async () => { await assert.rejects(insertInvoice(330,1),e=>e.code==='42501'); await assert.rejects(visit(525,'2026-11-10T10:00Z','2026-11-10T11:00Z',[4]),e=>e.code==='42501') })
  await db.exec('reset role')
  await test('reservation exclusion constraint independently rejects conflicts', async () => { await rejects('insert into private.fh_schedule_allocations(event_id,scope_id,member_id,during) values($1,$2,$3,tstzrange($4,$5,\'[)\'))','23P01',[id(517),id(100),id(4),'2026-11-02T10:30Z','2026-11-02T10:45Z']) })
  await test('migrations are idempotent without rewriting history', async () => { const invoices=await count('public.fh_invoices'), schedule=await count('public.fh_schedule'); await db.exec(await sqlFile('20261027170408_invoice_billing_safeguards.sql')); await db.exec(await sqlFile('20261027170430_schedule_crew_allocation.sql')); assert.equal(await count('public.fh_invoices'),invoices); assert.equal(await count('public.fh_schedule'),schedule) })
  if (db.openSession) await verifyConcurrency(db, test)
  console.log(JSON.stringify({ passed:results.length, results, unverified:[...(db.openSession ? [] : ['Two simultaneous PostgreSQL sessions']), 'Complete historical migration replay', 'Live Supabase role and API configuration'] },null,2))
} catch(error) {
  console.error(JSON.stringify({ failed:error.testName, message:error.message, code:error.code, detail:error.detail, passed:results.filter(r=>r.result==='passed').length, results },null,2))
  process.exitCode=1
} finally { await db.close() }
