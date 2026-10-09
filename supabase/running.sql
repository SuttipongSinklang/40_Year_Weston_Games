-- Private GPS running history. Apply once through weston_supabase MCP.
create table public.weston_runs (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  distance_m numeric(12,3) not null check (distance_m >= 0 and distance_m <= 1000000),
  duration_s numeric(12,3) not null check (duration_s >= 0 and duration_s <= 604800),
  route jsonb not null default '[]'::jsonb,
  splits jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  check (ended_at >= started_at),
  check (duration_s <= extract(epoch from (ended_at - started_at)) + 1),
  check (jsonb_typeof(route) = 'array' and jsonb_array_length(route) <= 10000),
  check (jsonb_typeof(splits) = 'array' and jsonb_array_length(splits) <= 1000),
  check (octet_length(route::text) <= 3000000)
);
create index weston_runs_owner_date_idx on public.weston_runs(user_id, started_at desc);
alter table public.weston_runs enable row level security;
revoke all on public.weston_runs from public, anon, authenticated;
grant select, insert on public.weston_runs to authenticated;
create policy weston_runs_own_read on public.weston_runs for select to authenticated
  using ((select auth.uid()) = user_id);
create policy weston_runs_own_insert on public.weston_runs for insert to authenticated
  with check ((select auth.uid()) = user_id);
comment on table public.weston_runs is 'Opt-in private GPS run backups. No leaderboard or public route access.';
