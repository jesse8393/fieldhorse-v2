-- Preserve the inbox contract while applying the querying user's existing
-- table grants and row policies to every joined record and aggregate.
-- No table policies or memberships are widened.
alter view public.fh_v_inbox set (security_invoker = true);

-- This function is only a trigger. Clients do not need direct RPC execution.
-- Revoking execution does not disable an already-installed trigger.
revoke execute on function public.fh_contacts_guard_money_fields() from public, anon, authenticated;
