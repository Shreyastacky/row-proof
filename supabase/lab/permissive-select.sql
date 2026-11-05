-- DELIBERATELY BROKEN POLICY. For a throwaway local lab instance only.
-- Never apply to the demo stack you keep, to remote staging, or to production.
-- Policies are permissive (OR-ed), so this exposes every invoice to every
-- authenticated user, the regression an AI-assisted edit could introduce.
create policy shipsafe_lab_permissive_select
  on public.invoices
  for select
  to authenticated
  using (true);
