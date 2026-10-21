-- leads_quotes_schema.test.sql
--
-- Checks for migration 092. Run inside one transaction that ends in
-- rollback, after the migration body. It borrows a real client so the
-- inserts satisfy the foreign keys, and rolls everything back.
--
-- Expected: quote_amount 1500, items_inherit_org true, lines_without_job 2.
-- (Run on production on October 19 with exactly those results.)

begin;
create temp table t_ids as
  select c.org_id, c.user_id, c.id as client_id
    from public.fh_clients c
   where exists (select 1 from public.org_members m where m.org_id = c.org_id and m.revoked_at is null)
   order by c.created_at limit 1;

insert into public.fh_leads (id, org_id, user_id, client_id, title)
  select '00000000-0000-0000-0000-00000000aaaa', org_id, user_id, client_id, 'Test lead' from t_ids;

insert into public.fh_quotes (id, org_id, user_id, client_id, lead_id, title)
  select '00000000-0000-0000-0000-00000000bbbb', org_id, user_id, client_id,
         '00000000-0000-0000-0000-00000000aaaa', 'Test quote' from t_ids;

insert into public.fh_quote_items (user_id, quote_id, description, qty, rate, amount)
  select user_id, '00000000-0000-0000-0000-00000000bbbb', d.description, 1, d.amount, d.amount
    from t_ids, (values ('Slab', 1200), ('Trench', 300)) d(description, amount);

select (select amount from public.fh_quotes where id = '00000000-0000-0000-0000-00000000bbbb') as quote_amount,
       (select bool_and(org_id = (select org_id from t_ids))
          from public.fh_quote_items where quote_id = '00000000-0000-0000-0000-00000000bbbb') as items_inherit_org,
       (select count(*) from public.fh_quote_items
         where quote_id = '00000000-0000-0000-0000-00000000bbbb' and contact_id is null) as lines_without_job;

-- Row level security: nine policies, four each plus the restrictive money
-- roles policy on quotes, all keyed on org membership.
select count(*) = 9 as policies_in_place
  from pg_policies where tablename in ('fh_leads', 'fh_quotes');
rollback;
