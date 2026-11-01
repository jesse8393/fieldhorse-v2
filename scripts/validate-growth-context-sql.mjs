// Disposable PostgreSQL only; no customer records, provider calls or production writes.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('growth')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const source = file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')
let passed = 0
async function test(name, run) { await run(); passed++; console.log(`PASS ${name}`) }
async function as(user = 1, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user == null ? null : id(user), role })])
  await db.exec(`set role ${role}`)
}
async function denied(sql, args = []) { await assert.rejects(db.query(sql, args), e => e.code === '42501') }
async function count(table) { return Number((await db.query(`select count(*) as n from public.${table}`)).rows[0].n) }
try {
  await db.exec(`
    ${auditRoles}
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims',true)::jsonb->>'sub','')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    grant execute on function auth.uid() to authenticated,anon,service_role;
    create table public.org_members(org_id uuid,user_id uuid,role text,revoked_at timestamptz);
    create table public.fh_clients(id uuid primary key,org_id uuid,name text,phone text,email text,address text,company_name text,source text,notes text,created_at timestamptz,last_activity_at timestamptz,total_lifetime_value numeric,active_jobs_count integer,updated_at timestamptz);
    create table public.fh_contacts(id uuid primary key,org_id uuid,client_id uuid,job_title text,job_type text,stage text,amount numeric,address text,source text,quote_sent_at timestamptz,quote_expires_at timestamptz,completed_at timestamptz,follow_up_on date,created_at timestamptz,updated_at timestamptz);
    create table public.fh_org_settings(org_id uuid,app_base_url text,default_from_email text);
    create table public.fh_client_tags(client_id uuid,tag text);
    create table public.fh_client_fields(client_id uuid,key text,value jsonb);
    create table public.fh_consent(client_id uuid,sms_status text,email_status text,calls_status text,dnd_all boolean);
    create table public.fh_conversations(id uuid primary key default gen_random_uuid(),org_id uuid,client_id uuid,status text,assigned_to uuid,last_inbound_at timestamptz,last_outbound_at timestamptz,unread_count integer,updated_at timestamptz,unique(org_id,client_id));
    create table public.fh_phone_numbers(id uuid primary key,org_id uuid,e164 text);
    create table public.fh_channels(id uuid,org_id uuid,kind text,status text,config jsonb,external_id text,created_at timestamptz);
    create table public.fh_agents(id uuid primary key,org_id uuid,key text,status text);
    create table public.fh_agent_runs(id uuid primary key default gen_random_uuid(),org_id uuid,agent_id uuid,client_id uuid,contact_id uuid,conversation_id uuid,trigger_kind text,mode text,input jsonb,status text,proposal jsonb,run_id uuid,approved_by uuid,approved_at timestamptz,executed_message_id uuid,updated_at timestamptz);
    create table public.fh_messages(id uuid primary key default gen_random_uuid(),org_id uuid,conversation_id uuid,client_id uuid,contact_id uuid,channel text,direction text,status text,hold_reason text,purpose text,subject text,body text,body_html text,from_address text,to_address text,media jsonb,sent_by_user uuid,sent_by_kind text,workflow_run_id uuid,agent_run_id uuid,campaign_id uuid,phone_number_id uuid,error text);
    create table public.fh_outbox(id uuid primary key default gen_random_uuid(),org_id uuid,kind text,payload jsonb,status text,hold_reason text,next_attempt_at timestamptz,run_id uuid,message_id uuid,client_id uuid,campaign_id uuid,agent_run_id uuid,phone_number_id uuid);
    create function public.fh_is_org_member(p_org_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid() and revoked_at is null) $$;
    create function public.fh_money_visible(p_org_id uuid) returns boolean language sql stable security definer set search_path=pg_catalog,public as $$ select not exists(select 1 from public.org_members where org_id=p_org_id and user_id=auth.uid() and revoked_at is null and role in ('crew','foreman')) $$;
    create function public.fh_org_ctx(uuid) returns jsonb language sql as $$ select '{"name":"Synthetic company"}'::jsonb $$;
    create function public.fh_first_name(text) returns text language sql as $$ select split_part($1,' ',1) $$;
    create function public.fh_normalize_phone(text) returns text language sql as $$ select $1 $$;
    create function public.fh_normalize_email(text) returns text language sql as $$ select lower($1) $$;
    create function public.fh_pick_phone_number(uuid,text) returns uuid language sql as $$ select id from public.fh_phone_numbers where org_id=$1 limit 1 $$;
    -- Provider hold policy is stubbed: this test validates tenant relations, not delivery.
    create function public.fh_message_hold(uuid,uuid,text,text,boolean,uuid) returns table(hold_reason text,retry_at timestamptz) language sql as $$ select null::text,null::timestamptz $$;
    create function public.fh_conversation_for_client(uuid,uuid) returns uuid language plpgsql as $$ declare v uuid; begin insert into public.fh_conversations(org_id,client_id) values($1,$2) on conflict(org_id,client_id) do update set updated_at=now() returning id into v; return v; end $$;
    create function public.fh_tag_add(uuid,uuid,text,text,uuid) returns boolean language sql as $$ select true $$;
    grant select on all tables in schema public to authenticated,service_role;
    grant all on all tables in schema public to service_role;
  `)
  for (const [user,org,role,revoked] of [[1,10,'owner',false],[2,10,'crew',false],[3,10,'foreman',false],[4,10,'manager',false],[5,20,'owner',false],[6,10,'manager',true]]) {
    await db.query('insert into public.org_members values($1,$2,$3,$4)',[id(org),id(user),role,revoked?'2026-10-01':null])
  }
  for (const [client,org] of [[100,10],[101,10],[200,20]]) {
    await db.query("insert into public.fh_clients(id,org_id,name,phone,email,total_lifetime_value) values($1,$2,'Synthetic customer','+15555550100','fixture@example.invalid',1234.56)",[id(client),id(org)])
  }
  for (const [job,client,org] of [[300,100,10],[301,101,10],[400,200,20]]) {
    await db.query("insert into public.fh_contacts(id,client_id,org_id,job_title,stage,amount) values($1,$2,$3,'Synthetic work','job',9876.54)",[id(job),id(client),id(org)])
  }
  for (const [org,number,agent] of [[10,500,600],[20,501,601]]) {
    await db.query("insert into public.fh_phone_numbers values($1,$2,'+15555550101')",[id(number),id(org)])
    await db.query("insert into public.fh_agents values($1,$2,'assistant','active')",[id(agent),id(org)])
  }
  await db.exec(await source('supabase/tests/fixtures/growth_context_baseline.sql'))
  await db.exec(`revoke all on function public.fh_client_ctx(uuid,uuid,jsonb) from public,anon,authenticated;
    revoke all on function public.fh_enqueue_message(uuid,uuid,uuid,text,text,text,text,uuid,text,uuid,uuid,uuid,uuid,boolean,text,jsonb,jsonb) from public,anon,authenticated;
    grant execute on function public.fh_client_ctx_app(uuid,uuid,jsonb),public.fh_send_message(uuid,text,text,text,uuid,uuid,jsonb),public.fh_agent_request(text,uuid,text,uuid),public.fh_agent_run_approve(uuid,text,text) to authenticated,service_role;
    alter table public.fh_contacts enable row level security;
    create policy own_org on public.fh_contacts for select to authenticated using(public.fh_is_org_member(org_id));`)
  await as()
  const ctx = (client,job) => db.query('select public.fh_client_ctx_app($1,$2) as ctx',[id(client),job==null?null:id(job)])
  await test('baseline reproduces foreign job context despite direct RLS denial',async()=>{
    assert.equal((await db.query('select id from public.fh_contacts where id=$1',[id(400)])).rows.length,0)
    assert.equal((await ctx(100,400)).rows[0].ctx.job.id,id(400))
  })
  await as(2)
  await test('baseline reproduces crew financial fields through the context RPC',async()=>{
    assert.equal((await ctx(100,300)).rows[0].ctx.job.amount,9876.54)
  })
  await db.exec('reset role')
  await db.exec(await source('supabase/migrations/20261101014840_growth_context_boundaries.sql'))
  await as()
  for (const job of [301,400,999]) await test(`context denies mismatched or missing job ${job}`,()=>denied('select public.fh_client_ctx_app($1,$2)',[id(100),id(job)]))
  await test('valid explicit and implicit job contexts retain financial cents for owner',async()=>{
    for(const job of [300,null]) { const result=(await ctx(100,job)).rows[0].ctx; assert.equal(result.job.id,id(300)); assert.equal(result.job.amount,9876.54) }
  })
  for(const user of [2,3]) await test(`role ${user} sees context without financial values`,async()=>{
    await as(user); const result=(await ctx(100,300)).rows[0].ctx
    assert.equal(result.job.id,id(300)); assert(!Object.hasOwn(result.job,'amount')); assert(!Object.hasOwn(result.client,'lifetime_value'))
  })
  await as(4)
  await test('manager retains financial context',async()=>assert.equal((await ctx(100,300)).rows[0].ctx.client.lifetime_value,1234.56))
  for(const user of [5,6]) await test(`outside or revoked user ${user} cannot read context`,async()=>{await as(user); await assert.rejects(ctx(100,300))})
  await as()
  for(const channel of ['note','sms']) for(const job of [301,400,999]) await test(`${channel} rejects unrelated job ${job} without creating a message`,async()=>{
    const before=await count('fh_messages'); await denied('select public.fh_send_message($1,$2,$3,null,$4)',[id(100),channel,'Synthetic message',id(job)]); assert.equal(await count('fh_messages'),before)
  })
  await test('sending with another company number is denied before queueing',async()=>{
    const before=await count('fh_outbox'); await denied("select public.fh_send_message($1,'sms','Synthetic',null,$2,$3)",[id(100),id(300),id(501)]); assert.equal(await count('fh_outbox'),before)
  })
  await test('valid notes and SMS still write the correct tenant context',async()=>{
    for(const channel of ['note','sms']) { const result=await db.query('select public.fh_send_message($1,$2,$3,null,$4,$5) as id',[id(100),channel,'Synthetic',id(300),id(500)]); const row=(await db.query('select org_id,client_id,contact_id from public.fh_messages where id=$1',[result.rows[0].id])).rows[0]; assert.deepEqual(row,{org_id:id(10),client_id:id(100),contact_id:id(300)}) }
  })
  for(const job of [301,400,999]) await test(`agent request rejects unrelated job ${job} without queueing`,async()=>{
    const before=await count('fh_outbox'); await denied("select public.fh_agent_request('assistant',$1,'Synthetic',$2)",[id(100),id(job)]); assert.equal(await count('fh_outbox'),before)
  })
  await test('valid agent request succeeds',async()=>{
    const result=await db.query("select public.fh_agent_request('assistant',$1,'Synthetic',$2) as id",[id(100),id(300)]); assert(result.rows[0].id)
  })
  await db.exec('reset role')
  for(const [run,job] of [[700,400],[701,301],[702,300]]) await db.query("insert into public.fh_agent_runs(id,org_id,client_id,contact_id,status,proposal) values($1,$2,$3,$4,'proposed',$5)",[id(run),id(10),id(100),id(job),JSON.stringify({actions:[{type:'set_stage',stage:'closed'}]})])
  await as()
  for(const run of [700,701]) await test(`approval rejects an existing mismatched run ${run}`,()=>denied('select public.fh_agent_run_approve($1)',[id(run)]))
  await test('valid approval executes once and a repeated approval cannot execute',async()=>{
    await db.query('select public.fh_agent_run_approve($1)',[id(702)]); await assert.rejects(db.query('select public.fh_agent_run_approve($1)',[id(702)]))
    assert.equal((await db.query('select stage from public.fh_contacts where id=$1',[id(300)])).rows[0].stage,'closed')
  })
  await as(null,'service_role')
  await test('service role retains valid context but cannot mix customers',async()=>{
    assert.equal((await ctx(100,300)).rows[0].ctx.job.id,id(300)); await denied('select public.fh_client_ctx($1,$2)',[id(100),id(400)])
  })
  await as(null,'anon')
  await test('anonymous callers cannot execute context or send RPCs',async()=>{
    await denied('select public.fh_client_ctx_app($1,$2)',[id(100),id(300)])
    await denied("select public.fh_send_message($1,'note','Synthetic')",[id(100)])
  })
  await as()
  await test('authenticated callers cannot execute internal helpers directly',async()=>{
    await denied('select public.fh_client_ctx($1,$2)',[id(100),id(300)])
    await denied('select public.fh_assert_growth_context($1,$2)',[id(10),id(100)])
  })
  console.log(JSON.stringify({passed,failed:0,limitations:['Focused growth schema with synthetic records','Delivery and complete schema replay not exercised','Concurrent approval lock requires separate PostgreSQL sessions']}))
} finally { await db.close() }
