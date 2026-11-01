-- Deployment prerequisite: every supported client must use explicit existing
-- FK names in embeds (for example fh_clients!fh_contacts_client_id_fkey).
-- Unhinted joins in older web/native builds become ambiguous after this runs.
-- Verify client compatibility and schema-cache reload in staging first.
-- RLS on a child row does not validate its foreign parent's company.
-- Composite foreign keys enforce both directions, including parent moves.
-- Existing single-column foreign keys keep their delete actions.
create unique index if not exists fh_clients_id_org_key on public.fh_clients(id, org_id);
create unique index if not exists fh_contacts_id_org_key on public.fh_contacts(id, org_id);
create unique index if not exists fh_leads_id_org_key on public.fh_leads(id, org_id);
create unique index if not exists fh_quotes_id_org_key on public.fh_quotes(id, org_id);

do $$
declare r record;
begin
  for r in select * from (values
    ('fh_contacts', 'client_id', 'fh_clients', 'fh_contacts_client_company_fk'),
    ('fh_leads', 'client_id', 'fh_clients', 'fh_leads_client_company_fk'),
    ('fh_quotes', 'client_id', 'fh_clients', 'fh_quotes_client_company_fk'),
    ('fh_quotes', 'job_id', 'fh_contacts', 'fh_quotes_job_company_fk'),
    ('fh_quotes', 'lead_id', 'fh_leads', 'fh_quotes_lead_company_fk'),
    ('fh_leads', 'quote_id', 'fh_quotes', 'fh_leads_quote_company_fk')
  ) as links(child_table, parent_column, parent_table, constraint_name) loop
    if not exists(select 1 from pg_constraint
      where conrelid = format('public.%I', r.child_table)::regclass and conname = r.constraint_name) then
      execute format('alter table public.%I add constraint %I foreign key (%I, org_id) references public.%I(id, org_id) not valid',
        r.child_table, r.constraint_name, r.parent_column, r.parent_table);
    end if;
    -- Fail the migration on inconsistent existing data rather than silently
    -- move customer records or accept an incomplete integrity boundary.
    execute format('alter table public.%I validate constraint %I', r.child_table, r.constraint_name);
  end loop;
end;
$$;
