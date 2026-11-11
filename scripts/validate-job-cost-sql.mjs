// Exercise the real job guard under PostgreSQL roles with synthetic records.
// A focused schema models the deployed company and accepted partner policies.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const db = await auditDatabase('jobcost')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sqlFile = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')
const results = []

async function test(name, fn) {
  try {
    await fn()
    results.push(name)
    console.log(`PASS ${name}`)
  } catch (error) {
    console.error(`FAIL ${name}`)
    throw error
  }
}

async function as(user, role = 'authenticated') {
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: user == null ? null : id(user), role })])
  await db.exec(`set role ${role}`)
}

async function denied(sql, params = []) {
  await assert.rejects(db.query(sql, params), error => error.code === '42501')
}

try {
  await db.exec(`
    ${auditRoles}
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
    grant usage on schema auth to authenticated, service_role;
    grant execute on function auth.uid() to authenticated, service_role;

    create table public.org_members (
      org_id uuid not null, user_id uuid not null, role text not null, revoked_at timestamptz
    );
    create table public.fh_contacts (
      id uuid primary key, user_id uuid not null, org_id uuid, stage text, amount numeric,
      cost numeric, completed_at timestamptz, proposal_status text, notes text
    );
    create table public.fh_job_partners (
      job_id uuid not null references public.fh_contacts(id), partner_user_id uuid not null,
      status text not null, deleted_by_partner_at timestamptz
    );
    create function public.auth_user_org_ids() returns setof uuid
      language sql stable security definer set search_path = pg_catalog, public
      as $$ select org_id from public.org_members where user_id = auth.uid() and revoked_at is null $$;
    grant select on public.org_members, public.fh_job_partners to authenticated, service_role;
    grant select, update, delete on public.fh_contacts to authenticated, service_role;
    alter table public.fh_contacts enable row level security;
    create policy contacts_select on public.fh_contacts for select to authenticated
      using ((org_id in (select public.auth_user_org_ids())) or exists (
        select 1 from public.fh_job_partners p
        where p.job_id = fh_contacts.id and p.partner_user_id = auth.uid()
          and p.status = 'accepted' and p.deleted_by_partner_at is null
      ));
    create policy contacts_update on public.fh_contacts for update to authenticated
      using ((org_id in (select public.auth_user_org_ids())) or exists (
        select 1 from public.fh_job_partners p
        where p.job_id = fh_contacts.id and p.partner_user_id = auth.uid()
          and p.status = 'accepted' and p.deleted_by_partner_at is null
      ))
      with check ((org_id in (select public.auth_user_org_ids())) or exists (
        select 1 from public.fh_job_partners p
        where p.job_id = fh_contacts.id and p.partner_user_id = auth.uid()
          and p.status = 'accepted' and p.deleted_by_partner_at is null
      ));
    create policy contacts_delete on public.fh_contacts for delete to authenticated
      using (org_id in (select public.auth_user_org_ids()));
  `)

  for (const [user, role, revoked] of [[1, 'owner', false], [2, 'admin', false], [3, 'manager', false], [4, 'crew', false], [5, 'foreman', false], [8, 'crew', true]]) {
    await db.query('insert into public.org_members(org_id,user_id,role,revoked_at) values($1,$2,$3,$4)',
      [id(100), id(user), role, revoked ? '2026-01-01' : null])
  }
  await db.query("insert into public.fh_contacts values($1,$2,$3,'job',1000,200,null,'draft','original')", [id(200), id(1), id(100)])
  await db.query("insert into public.fh_job_partners values($1,$2,'accepted',null)", [id(200), id(6)])

  // Use the actual role helper and existing production migration.
  const roleSource = await sqlFile('064_role_and_recipient_boundaries.sql')
  const start = roleSource.indexOf('create or replace function public.fh_money_visible(p_org_id uuid)')
  const end = roleSource.indexOf('$$;', roleSource.indexOf('as $$', start)) + 3
  assert(start >= 0 && end > start)
  await db.exec(roleSource.slice(start, end))
  await db.exec(await sqlFile('067_job_money_field_guard.sql'))

  await as(4)
  await test('the deployed guard permits the reported crew cost change', async () => {
    const result = await db.query('update public.fh_contacts set cost=300 where id=$1 returning cost', [id(200)])
    assert.equal(Number(result.rows[0]?.cost), 300)
  })

  await db.exec('reset role')
  await db.exec(await sqlFile('20261111195709_guard_job_cost_updates.sql'))

  for (const [user, role] of [[4, 'crew'], [5, 'foreman']]) {
    await as(user)
    await test(`${role} cannot change job cost`, async () => {
      await denied('update public.fh_contacts set cost=400 where id=$1', [id(200)])
    })
  }

  await as(4)
  await test('crew can update normal notes and leave cost unchanged', async () => {
    const result = await db.query("update public.fh_contacts set notes='field note', cost=cost where id=$1 returning notes", [id(200)])
    assert.equal(result.rows[0]?.notes, 'field note')
  })
  await test('a mixed update fails without saving its other changes', async () => {
    await denied("update public.fh_contacts set cost=400, notes='unexpected' where id=$1", [id(200)])
    const result = await db.query('select notes from public.fh_contacts where id=$1', [id(200)])
    assert.equal(result.rows[0]?.notes, 'field note')
  })
  await test('existing protections still block other guarded fields and deletion', async () => {
    for (const statement of [
      "update public.fh_contacts set stage='closed' where id=$1",
      'update public.fh_contacts set amount=2000 where id=$1',
      "update public.fh_contacts set proposal_status='approved' where id=$1",
      "update public.fh_contacts set completed_at='2026-11-11' where id=$1",
      'delete from public.fh_contacts where id=$1'
    ]) await denied(statement, [id(200)])
  })

  for (const [user, role, amount] of [[1, 'owner', 410], [2, 'admin', 420], [3, 'manager', 430]]) {
    await as(user)
    await test(`${role} retains job cost access`, async () => {
      const result = await db.query('update public.fh_contacts set cost=$1 where id=$2 returning cost', [amount, id(200)])
      assert.equal(Number(result.rows[0]?.cost), amount)
    })
  }

  await as(6)
  await test('an accepted partner retains existing access', async () => {
    const result = await db.query('update public.fh_contacts set cost=440 where id=$1 returning cost', [id(200)])
    assert.equal(Number(result.rows[0]?.cost), 440)
  })
  for (const [user, role] of [[7, 'outsider'], [8, 'revoked member']]) {
    await as(user)
    await test(`${role} cannot reach the job`, async () => {
      const result = await db.query('update public.fh_contacts set cost=450 where id=$1 returning id', [id(200)])
      assert.equal(result.rows.length, 0)
    })
  }

  await as(null, 'service_role')
  await test('service operations retain access', async () => {
    const result = await db.query('update public.fh_contacts set cost=null where id=$1 returning cost', [id(200)])
    assert.equal(result.rows[0]?.cost, null)
  })
  await as(4)
  await test('a crew member cannot replace a null cost', async () => {
    await denied('update public.fh_contacts set cost=0 where id=$1', [id(200)])
  })
  await as(null, 'service_role')
  await test('the migration can be applied twice safely', async () => {
    await db.exec('reset role')
    await db.exec(await sqlFile('20261111195709_guard_job_cost_updates.sql'))
    await as(5)
    await denied('update public.fh_contacts set cost=0 where id=$1', [id(200)])
  })
  console.log(`${results.length} job cost guard checks passed.`)
} finally {
  await db.close()
}
