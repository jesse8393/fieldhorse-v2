-- Fieldhorse v2 — Full schema
-- Run in Supabase SQL Editor. Idempotent where possible.

-- ============================================================
-- PROFILES EXTENSIONS
-- ============================================================
alter table public.profiles add column if not exists preferences jsonb default '{}'::jsonb;
alter table public.profiles add column if not exists webhook_key text;
alter table public.profiles add column if not exists subscription_tier text default 'solo';

-- Generate webhook key on profile create if missing
update public.profiles
set webhook_key = encode(gen_random_bytes(16), 'hex')
where webhook_key is null;

alter table public.profiles add constraint profiles_webhook_key_unique unique (webhook_key);

-- ============================================================
-- CONTACTS (leads, quotes, jobs, invoices, closed, lost)
-- ============================================================
create table if not exists public.fh_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text,
  phone text,
  email text,
  address text,
  job_title text,
  job_type text,
  stage text default 'lead',
  amount numeric default 0,
  cost numeric default 0,
  notes text,
  referred_by text,
  tags text[] default '{}',
  milestones jsonb default '[]'::jsonb,
  photos jsonb default '[]'::jsonb,
  last_contact date,
  has_inspections boolean default false,
  partner_shared boolean default false,
  heat_score int default 50,
  proposal_status text default 'draft',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_fh_contacts_user on public.fh_contacts(user_id);
create index if not exists idx_fh_contacts_user_stage on public.fh_contacts(user_id, stage);

-- ============================================================
-- NOTES
-- ============================================================
create table if not exists public.fh_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  text text,
  action text,
  when_text text,
  category text,
  done boolean default false,
  audio_url text,
  created_at timestamptz default now()
);

create index if not exists idx_fh_notes_user on public.fh_notes(user_id);
create index if not exists idx_fh_notes_contact on public.fh_notes(contact_id);

-- ============================================================
-- SCHEDULE
-- ============================================================
create table if not exists public.fh_schedule (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  title text,
  description text,
  start_at timestamptz,
  end_at timestamptz,
  assigned_to uuid,
  recurring text,
  weather_locked boolean default false,
  created_at timestamptz default now()
);

create index if not exists idx_fh_schedule_user on public.fh_schedule(user_id);
create index if not exists idx_fh_schedule_start on public.fh_schedule(user_id, start_at);

-- ============================================================
-- SUBCONTRACTORS (per contact)
-- ============================================================
create table if not exists public.fh_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete cascade,
  name text,
  trade text,
  phone text,
  rate numeric default 0,
  status text default 'scheduled',
  created_at timestamptz default now()
);

create index if not exists idx_fh_subs_user on public.fh_subs(user_id);
create index if not exists idx_fh_subs_contact on public.fh_subs(contact_id);

-- ============================================================
-- EXPENSES (per contact)
-- ============================================================
create table if not exists public.fh_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete cascade,
  description text,
  amount numeric default 0,
  category text,
  expense_date date default current_date,
  receipt_url text,
  created_at timestamptz default now()
);

create index if not exists idx_fh_expenses_user on public.fh_expenses(user_id);
create index if not exists idx_fh_expenses_contact on public.fh_expenses(contact_id);

-- ============================================================
-- PAYMENTS (multi-check support)
-- ============================================================
create table if not exists public.fh_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete cascade,
  amount numeric not null,
  method text,
  reference text,
  paid_on date default current_date,
  created_at timestamptz default now()
);

create index if not exists idx_fh_payments_user on public.fh_payments(user_id);
create index if not exists idx_fh_payments_contact on public.fh_payments(contact_id);

-- ============================================================
-- INSPECTIONS (per contact, per trade)
-- ============================================================
create table if not exists public.fh_inspections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete cascade,
  trade text,
  result text,
  inspector text,
  data jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_fh_inspections_user on public.fh_inspections(user_id);
create index if not exists idx_fh_inspections_contact on public.fh_inspections(contact_id);

-- ============================================================
-- MILEAGE (analytics)
-- ============================================================
create table if not exists public.fh_mileage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  miles numeric not null,
  drove_on date default current_date,
  purpose text,
  created_at timestamptz default now()
);

create index if not exists idx_fh_mileage_user on public.fh_mileage(user_id);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================
alter table public.fh_contacts enable row level security;
alter table public.fh_notes enable row level security;
alter table public.fh_schedule enable row level security;
alter table public.fh_subs enable row level security;
alter table public.fh_expenses enable row level security;
alter table public.fh_payments enable row level security;
alter table public.fh_inspections enable row level security;
alter table public.fh_mileage enable row level security;

-- Contacts
drop policy if exists "fh_contacts_own" on public.fh_contacts;
create policy "fh_contacts_own" on public.fh_contacts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Notes
drop policy if exists "fh_notes_own" on public.fh_notes;
create policy "fh_notes_own" on public.fh_notes
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Schedule
drop policy if exists "fh_schedule_own" on public.fh_schedule;
create policy "fh_schedule_own" on public.fh_schedule
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Subs
drop policy if exists "fh_subs_own" on public.fh_subs;
create policy "fh_subs_own" on public.fh_subs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Expenses
drop policy if exists "fh_expenses_own" on public.fh_expenses;
create policy "fh_expenses_own" on public.fh_expenses
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Payments
drop policy if exists "fh_payments_own" on public.fh_payments;
create policy "fh_payments_own" on public.fh_payments
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Inspections
drop policy if exists "fh_inspections_own" on public.fh_inspections;
create policy "fh_inspections_own" on public.fh_inspections
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Mileage
drop policy if exists "fh_mileage_own" on public.fh_mileage;
create policy "fh_mileage_own" on public.fh_mileage
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKETS (photos, receipts)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('jobphotos', 'jobphotos', true) on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false) on conflict (id) do nothing;

-- Job photos: folder-based RLS with user id prefix
drop policy if exists "jobphotos_own_upload" on storage.objects;
create policy "jobphotos_own_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'jobphotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "jobphotos_own_update" on storage.objects;
create policy "jobphotos_own_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'jobphotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "jobphotos_own_delete" on storage.objects;
create policy "jobphotos_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'jobphotos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "jobphotos_public_read" on storage.objects;
create policy "jobphotos_public_read" on storage.objects
  for select to public
  using (bucket_id = 'jobphotos');

-- Receipts: private, owner only
drop policy if exists "receipts_own_upload" on storage.objects;
create policy "receipts_own_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts_own_read" on storage.objects;
create policy "receipts_own_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "receipts_own_delete" on storage.objects;
create policy "receipts_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
-- AUTO-UPDATE updated_at trigger on contacts
-- ============================================================
create or replace function public.fh_touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists fh_contacts_touch on public.fh_contacts;
create trigger fh_contacts_touch
  before update on public.fh_contacts
  for each row execute procedure public.fh_touch_updated_at();

-- ============================================================
-- DONE
-- ============================================================
