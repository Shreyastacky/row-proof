-- A second, customer-shaped table used to test `pyx init` on an arbitrary user-owned table:
-- an extra NOT NULL column (needs --fixture-defaults), a foreign key WITHOUT cascade, and the
-- marker stored in an ordinary text column. Synthetic data only.

create table public.project_notes (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users (id),
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index project_notes_author_id_idx on public.project_notes (author_id);

revoke all on table public.project_notes from anon, authenticated;
grant select on table public.project_notes to anon, authenticated;
revoke all on table public.project_notes from service_role;
grant select, insert, update, delete on table public.project_notes to service_role;

alter table public.project_notes enable row level security;

create policy project_notes_author_select
  on public.project_notes
  for select
  to authenticated
  using ((select auth.uid()) = author_id);
