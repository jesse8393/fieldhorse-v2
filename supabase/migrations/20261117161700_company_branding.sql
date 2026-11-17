-- The company block on a customer document (audit DATA-06).
--
-- Quote and invoice PDFs are built in the browser. Their company name,
-- address, logo, licence and payment details came from the profile of
-- whoever tapped the button, so a teammate's documents printed "My
-- Company" (an invited member's profile holds no company details), and
-- someone who runs a company of their own and works in another printed
-- their own letterhead on the other company's documents.
--
-- A record belongs to the company in its org_id. public.organizations
-- holds that company's name, set when the company was made, and nothing
-- else a document prints. The address, phone, email, website, logo,
-- licence, insurance line and payment details live only on the owner's
-- profile, which is where the email and the customer link already take
-- them from (netlify/functions/lib/orgAccess.js brandingUserIdFor: the
-- earliest active owner). This returns that owner's document fields, with
-- the company's own name when the owner's profile has none, so the PDF
-- names the company the email and the link name.
--
-- The policies on profiles predate this folder and the app only ever reads
-- the signed in person's own row, so the function is security definer
-- rather than relying on a teammate being able to read the owner's row.
-- It answers only an active member of the company, and only with the
-- fields a document prints.
--
-- Reverse: none needed. The app reads the caller's own profile when the
-- function is missing, so leaving it unused restores the old behaviour.

create or replace function public.fh_company_branding(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'org_id', o.id,
    'company_name', coalesce(nullif(btrim(p.company_name), ''), nullif(btrim(o.name), '')),
    'full_name', p.full_name,
    'company_address', p.company_address,
    'company_phone', p.company_phone,
    'company_email', p.company_email,
    'company_website', p.company_website,
    'logo_url', p.logo_url,
    'brand_accent_hex', p.brand_accent_hex,
    'license_number', p.license_number,
    'insured_text', p.insured_text,
    'payment_link', p.payment_link,
    'payment_instructions', p.payment_instructions,
    'estimate_template', p.estimate_template,
    'warranty_default', p.warranty_default
  )
  from public.organizations o
  left join lateral (
    select m.user_id
      from public.org_members m
     where m.org_id = o.id
       and m.role = 'owner'
       and m.revoked_at is null
     order by m.joined_at asc
     limit 1
  ) owner on true
  left join public.profiles p on p.user_id = owner.user_id
  where o.id = p_org_id
    and exists (
      select 1
        from public.org_members me
       where me.org_id = o.id
         and me.user_id = auth.uid()
         and me.revoked_at is null
    )
$$;

revoke all on function public.fh_company_branding(uuid) from public;
revoke all on function public.fh_company_branding(uuid) from anon;
grant execute on function public.fh_company_branding(uuid) to authenticated, service_role;
