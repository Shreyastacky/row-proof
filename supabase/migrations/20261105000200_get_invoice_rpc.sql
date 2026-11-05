-- A second request path to the same rows: an RPC function, the way many apps
-- expose "get one record" to the client. It is SECURITY DEFINER (it runs as its
-- owner and bypasses RLS), so the owner check inside it is the only boundary.
-- Pyx checks this path separately because a correct table policy says nothing
-- about it. Synthetic data only.

create function public.get_invoice(p_id uuid)
returns setof public.invoices
language sql
stable
security definer
set search_path = ''
rows 1
as $$
  select i.*
  from public.invoices i
  where i.id = p_id
    and i.owner_id = (select auth.uid());
$$;

comment on function public.get_invoice(uuid) is 'Pyx synthetic demo: one invoice by id, owner only.';

revoke all on function public.get_invoice(uuid) from public;
grant execute on function public.get_invoice(uuid) to anon, authenticated, service_role;
