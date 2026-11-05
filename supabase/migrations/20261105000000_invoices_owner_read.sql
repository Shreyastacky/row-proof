-- Pyx disposable demo: one user-owned table with an owner-only SELECT policy.
-- Synthetic data only. Applied by `supabase start` / `supabase db reset` on the local stack.

create table public.invoices (
  id uuid primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Synthetic marker: makes accidental use of real records visible and lets the
  -- runner check that a returned row is exactly the expected fixture.
  fixture_marker text not null check (fixture_marker ~ '^synthetic-[a-z0-9-]{1,48}$'),
  amount_cents integer not null default 0 check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

comment on table public.invoices is 'Pyx synthetic demo fixture. Owner-only read access.';

create index invoices_owner_id_idx on public.invoices (owner_id);

-- Grants are explicit rather than relying on platform default privileges, which
-- differ between project generations. Ordinary roles may SELECT; RLS decides rows.
revoke all on table public.invoices from anon, authenticated;
grant select on table public.invoices to anon, authenticated;
-- service_role is used only by local setup tooling (provision/verify fixtures).
revoke all on table public.invoices from service_role;
grant select, insert, update, delete on table public.invoices to service_role;

alter table public.invoices enable row level security;

-- The approved boundary: an authenticated user reads only rows they own.
-- No policy exists for anon, so anonymous reads return an empty result.
create policy invoices_owner_select
  on public.invoices
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);
