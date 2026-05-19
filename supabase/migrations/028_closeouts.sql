-- 028_closeouts.sql
--
-- Closeout records — the "real system" for finishing a job. Pairs with
-- the Mark Complete sheet. One row per fh_contacts.id captures the
-- warranty start, the customer sign-off (method + typed name + date),
-- a closing note, and a snapshot of dollars/photo count at close so
-- the historical record doesn't drift if line items get edited later.

create table if not exists public.fh_closeouts (
  id                   uuid primary key default gen_random_uuid(),
  contact_id           uuid not null references public.fh_contacts(id) on delete cascade,
  user_id              uuid not null references auth.users(id) on delete cascade,
  closed_at            timestamptz not null default now(),
  warranty_start_date  date,
  warranty_months      integer check (warranty_months is null or warranty_months >= 0),
  signoff_name         text,
  signoff_method       text not null default 'verbal' check (signoff_method in ('verbal','text','email','in_person','signature_typed')),
  signoff_at           timestamptz not null default now(),
  notes                text,
  final_amount         numeric not null default 0,
  paid_at_close        numeric not null default 0,
  final_photo_count    integer not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (contact_id)
);

create index if not exists fh_closeouts_user_idx
  on public.fh_closeouts (user_id);

create or replace function public.fh_closeouts_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists fh_closeouts_touch_t on public.fh_closeouts;
create trigger fh_closeouts_touch_t
  before update on public.fh_closeouts
  for each row execute procedure public.fh_closeouts_touch();

alter table public.fh_closeouts enable row level security;

drop policy if exists fh_closeouts_own on public.fh_closeouts;
create policy fh_closeouts_own on public.fh_closeouts
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
