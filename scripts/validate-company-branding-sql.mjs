// The company block on a teammate's documents (audit DATA-06). Builds the
// tables fh_company_branding reads (organizations, org_members, profiles,
// with the profile columns from database.types.ts) in a disposable PGlite
// database, applies the migration twice, and checks that an invited admin
// gets the owner's company details instead of their own empty profile,
// that a person who owns company A and works in company B gets B's details
// for B, and that nobody outside the company gets anything.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { auditDatabase, auditRoles } from './audit-database.mjs'

const MIGRATION = '20261117161700_company_branding.sql'
const db = await auditDatabase('companybranding')
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
let checks = 0
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; console.log(`PASS ${label}`) }
const denied = async (sql, params, label) => { await assert.rejects(() => db.query(sql, params)); checks++; console.log(`PASS ${label}`) }
const as = async user => {
  await db.query('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user ? id(user) : ''])
  await db.query(user ? 'set role authenticated' : 'set role anon')
}
const branding = async org => (await db.query('select public.fh_company_branding($1) as b', [org])).rows[0].b

const PARKER = id(100), SHYLD = id(200), NAMELESS = id(300)
const JESSE = 1, ADMIN = 2, CREW = 3, SAM = 4, OUTSIDER = 5, GONE = 6, OLD_OWNER = 7, NEW_OWNER = 8

try {
  const migration = await readFile(new URL(`../supabase/migrations/${MIGRATION}`, import.meta.url), 'utf8')
  const statements = migration.replace(/--.*$/gm, '')
  equal(/\b(delete\s+from|drop\s|truncate\s)/i.test(statements), false, 'the migration has no statement that removes rows or objects')

  await db.exec(`${auditRoles}
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.organizations(id uuid primary key, name text not null);
    create table public.org_members(org_id uuid, user_id uuid, role text, joined_at timestamptz, revoked_at timestamptz);
    create table public.profiles(user_id uuid primary key, full_name text, company_name text, company_address text, company_phone text,
      company_email text, company_website text, logo_url text, brand_accent_hex text, license_number text, insured_text text,
      payment_link text, payment_instructions text, estimate_template text not null default 'classic', warranty_default text,
      webhook_key text, preferences jsonb, onboarded_at timestamptz);
    grant usage on schema public, auth to authenticated, anon;
    grant select on all tables in schema public to authenticated;

    insert into public.organizations values ('${PARKER}', 'Parker Construction'), ('${SHYLD}', 'Shyld Roofing'), ('${NAMELESS}', 'Beasley Concrete');
    insert into public.org_members values
      ('${PARKER}', '${id(JESSE)}', 'owner', '2026-01-01', null),
      ('${PARKER}', '${id(ADMIN)}', 'admin', '2026-03-01', null),
      ('${PARKER}', '${id(CREW)}', 'crew', '2026-03-02', null),
      ('${PARKER}', '${id(SAM)}', 'admin', '2026-04-01', null),
      ('${PARKER}', '${id(GONE)}', 'admin', '2026-02-01', '2026-05-01'),
      ('${SHYLD}', '${id(SAM)}', 'owner', '2025-06-01', null),
      ('${NAMELESS}', '${id(OLD_OWNER)}', 'owner', '2025-01-01', '2026-01-01'),
      ('${NAMELESS}', '${id(NEW_OWNER)}', 'owner', '2026-02-01', null);
    insert into public.profiles(user_id, full_name, company_name, company_address, company_phone, company_email, company_website,
      logo_url, brand_accent_hex, license_number, insured_text, payment_link, payment_instructions, estimate_template, warranty_default, webhook_key, preferences, onboarded_at)
    values
      ('${id(JESSE)}', 'Jesse Parker', 'Parker Construction Company', '100 Main St, Murfreesboro TN', '615-555-0100', 'office@parker.co', 'parker.co',
       'https://cdn.example/parker.png', '#c9a227', 'TN-12345', 'Fully insured', 'https://pay.example/parker', 'Checks to Parker Construction', 'modern', 'One year on workmanship',
       'secret-hook', '{"quote_follow_up":{"days":3}}', '2026-01-01'),
      ('${id(SAM)}', 'Sam Shyld', 'Shyld Roofing LLC', '9 Ridge Rd', '615-555-0900', 'sam@shyld.co', null,
       'https://cdn.example/shyld.png', null, 'TN-99999', null, 'https://pay.example/shyld', null, 'classic', null, null, null, '2025-06-01'),
      ('${id(OLD_OWNER)}', 'Old Owner', 'Old Name Concrete', 'Gone St', null, null, null, null, null, null, null, null, null, 'classic', null, null, null, null),
      ('${id(NEW_OWNER)}', 'Lorraine Beasley', '  ', '4 Quarry Ln', null, null, null, null, null, null, null, null, null, 'classic', null, null, null, null);
    -- An invited admin's profile holds only the onboarding stamp.
    insert into public.profiles(user_id, onboarded_at) values ('${id(ADMIN)}', '2026-03-01'), ('${id(CREW)}', '2026-03-02');
  `)

  await db.exec(migration)
  await db.exec(migration)

  const parker = {
    org_id: PARKER,
    company_name: 'Parker Construction Company',
    full_name: 'Jesse Parker',
    company_address: '100 Main St, Murfreesboro TN',
    company_phone: '615-555-0100',
    company_email: 'office@parker.co',
    company_website: 'parker.co',
    logo_url: 'https://cdn.example/parker.png',
    brand_accent_hex: '#c9a227',
    license_number: 'TN-12345',
    insured_text: 'Fully insured',
    payment_link: 'https://pay.example/parker',
    payment_instructions: 'Checks to Parker Construction',
    estimate_template: 'modern',
    warranty_default: 'One year on workmanship'
  }

  await as(ADMIN)
  equal(await branding(PARKER), parker, "an invited admin gets the owner's company details, not an empty profile")
  await as(CREW)
  equal(await branding(PARKER), parker, 'a crew member of the company gets the same details')
  await as(JESSE)
  equal(await branding(PARKER), parker, 'the owner gets their own company details')

  await as(SAM)
  equal((await branding(PARKER)).company_name, 'Parker Construction Company', "someone who owns another company gets Parker's name for Parker's documents")
  equal((await branding(PARKER)).logo_url, 'https://cdn.example/parker.png', "and Parker's logo, not their own")
  equal((await branding(SHYLD)).company_name, 'Shyld Roofing LLC', "and their own company's details for their own company's documents")

  await as(OUTSIDER)
  equal(await branding(PARKER), null, 'someone outside the company gets nothing')
  await as(GONE)
  equal(await branding(PARKER), null, 'a removed member gets nothing')
  await as(ADMIN)
  equal(await branding(SHYLD), null, "a member of one company gets nothing for a company they are not in")
  equal(await branding(null), null, 'no company, nothing')

  await as(NEW_OWNER)
  const nameless = await branding(NAMELESS)
  equal(nameless.company_name, 'Beasley Concrete', "an owner with no company name on the profile prints the company's own name")
  equal(nameless.company_address, '4 Quarry Ln', 'the active owner is read, not a removed earlier owner')

  equal(Object.keys(await branding(NAMELESS)).includes('webhook_key'), false, 'no private profile field comes back')
  equal(Object.keys(await branding(NAMELESS)).includes('preferences'), false, 'nor the profile preferences')

  await as(null)
  await denied('select public.fh_company_branding($1)', [PARKER], 'a visitor who is not signed in cannot call it')

  console.log(`${checks} company branding checks passed.`)
} finally { await db.close() }
