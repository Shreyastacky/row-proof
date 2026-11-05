-- DELIBERATELY BROKEN FUNCTION. For a throwaway local lab instance only.
-- Never apply to the demo stack you keep, to remote staging, or to production.
-- The table policy stays correct; this SECURITY DEFINER function drops its owner
-- check, so any caller (even anonymous) can fetch any invoice by id. The Data API
-- path keeps passing while the RPC path leaks.
create or replace function public.get_invoice(p_id uuid)
returns setof public.invoices
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select i.* from public.invoices i where i.id = p_id;
$$;
