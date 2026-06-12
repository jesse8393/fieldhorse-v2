-- 049 — Change orders: customer sign-off via public link
--
-- Widens fh_public_links to carry change-order links: the customer
-- opens /p/:token, sees the CO on contractor letterhead, and signs by
-- typed name (same approval mechanics as proposals). The approved CO
-- then folds into the next invoice automatically via contractTotals().

alter table public.fh_public_links
  drop constraint if exists fh_public_links_kind_check;

alter table public.fh_public_links
  add constraint fh_public_links_kind_check
  check (kind in ('proposal', 'invoice', 'change_order'));

alter table public.fh_public_links
  add column if not exists change_order_id uuid
  references public.fh_change_orders(id) on delete cascade;
