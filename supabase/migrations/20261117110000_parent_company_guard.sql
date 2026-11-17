-- Parent records must belong to the same company as the row (DB-01, DB-02,
-- DB-03, DB-11).
--
-- Row level security only checks a row's own org_id. A member could write a
-- row with their own job and another company's quote_id, invoice_id,
-- schedule_id, conversation_id or client_id. Definer triggers then changed
-- that company's quote total, calendar, inbox or customer, and the customer
-- portal showed the injected lines and payments.
--
-- This adds one check that runs before every insert and update on each
-- table that carries one of those parent ids. It compares each parent's
-- org_id with the row's org_id and refuses a mismatch with 42501. A personal
-- row (no company) may only point at a personal parent. A parent id that
-- does not resolve is left to the foreign key. On update, a parent is
-- checked when it or the row's company changes, so unrelated edits to old
-- rows keep working.
--
-- Service role and definer paths are checked too, because the attacks
-- above flowed through definer triggers and cron. Every server path in the
-- repository writes a parent taken from the same company.
--
-- The trigger is named zzzz_assert_parent_org so it runs after
-- fh_set_org_id_trg and zz_inherit_org_from_contact (row triggers of the
-- same kind fire in name order) and sees the company those settle on.
--
-- Only create or replace statements. Running it twice is safe.

create or replace function public.fh_assert_parent_org()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_new        jsonb   := to_jsonb(new);
  v_old        jsonb   := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  v_org        uuid    := nullif(v_new ->> 'org_id', '')::uuid;
  v_all        boolean := tg_op = 'INSERT' or (v_new -> 'org_id') is distinct from (v_old -> 'org_id');
  v_parent     record;
  v_id         uuid;
  v_found      boolean;
  v_parent_org uuid;
begin
  for v_parent in
    select * from (values
      ('quote_id',        'fh_quotes',        'quote'),
      ('lead_id',         'fh_leads',         'lead'),
      ('invoice_id',      'fh_invoices',      'invoice'),
      ('schedule_id',     'fh_schedule',      'calendar event'),
      ('conversation_id', 'fh_conversations', 'conversation'),
      ('client_id',       'fh_clients',       'customer')
    ) as p(col, tbl, label)
  loop
    continue when not (v_new ? v_parent.col);
    v_id := nullif(v_new ->> v_parent.col, '')::uuid;
    continue when v_id is null;
    continue when not v_all and (v_new -> v_parent.col) is not distinct from (v_old -> v_parent.col);

    v_found := null;
    v_parent_org := null;
    execute format('select true, org_id from public.%I where id = $1', v_parent.tbl)
      into v_found, v_parent_org using v_id;
    continue when v_found is null;

    if v_parent_org is distinct from v_org then
      raise exception 'This % belongs to another company.', v_parent.label
        using errcode = '42501';
    end if;
  end loop;
  return new;
end
$$;

revoke all on function public.fh_assert_parent_org() from public, anon, authenticated;

-- Every table with org_id and at least one of the parent ids above, from the
-- repository migrations and the recovered production history. Tables that
-- are not present, or lack org_id or every parent column, are passed over.
do $$
declare
  t text;
begin
  foreach t in array array[
    'fh_agent_runs', 'fh_appointments', 'fh_campaign_recipients',
    'fh_client_attribution', 'fh_client_fields', 'fh_client_tags',
    'fh_consent', 'fh_contacts', 'fh_conversations', 'fh_esign_envelopes',
    'fh_events', 'fh_follow_ups', 'fh_form_submissions', 'fh_invoices',
    'fh_leads', 'fh_messages', 'fh_notes', 'fh_outbox', 'fh_payments',
    'fh_public_links', 'fh_quote_items', 'fh_quote_versions', 'fh_quotes',
    'fh_review_requests', 'fh_reviews', 'fh_schedule', 'fh_selections',
    'fh_workflow_runs'
  ]
  loop
    continue when to_regclass('public.' || t) is null;
    continue when not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'org_id'
    );
    continue when not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t
         and column_name in ('quote_id', 'lead_id', 'invoice_id', 'schedule_id', 'conversation_id', 'client_id')
    );
    execute format(
      'create or replace trigger zzzz_assert_parent_org before insert or update on public.%I for each row execute function public.fh_assert_parent_org()',
      t
    );
  end loop;
end
$$;
