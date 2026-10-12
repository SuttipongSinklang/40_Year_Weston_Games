-- Apply once in project jlweqxpkqgnjcwcgisfj SQL Editor (run AFTER tournaments.sql
-- and tournaments-public-rpc.sql). Adds the global admin site (missions + all
-- tournament management) with a single shared admin code.
begin;

-- Sessions that claimed the global admin code. Site admins manage every
-- tournament automatically (is_tournament_admin includes them).
create table public.weston_site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

-- Single-row settings. Only the sha256 hash of the admin code is stored; no
-- client grants at all — every read/write goes through the RPCs below.
create table public.weston_admin_settings (
  single boolean primary key default true check (single),
  code_hash text not null
);

create table public.weston_missions (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 80),
  description text check (char_length(coalesce(description,'')) <= 300),
  icon text not null default '🎯' check (char_length(icon) between 1 and 8),
  reward_points integer not null default 10 check (reward_points between 1 and 10000),
  status text not null default 'active' check (status in ('active','hidden')),
  sort_index integer not null default 0 check (sort_index between 0 and 9999),
  created_at timestamptz not null default now()
);
create index weston_missions_list_idx on public.weston_missions(status, sort_index, created_at);

create table public.weston_mission_completions (
  mission_id uuid not null references public.weston_missions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  points_awarded integer not null default 0 check (points_awarded >= 0),
  completed_at timestamptz not null default now(),
  primary key (mission_id, user_id)
);
create index weston_mission_completions_user_idx on public.weston_mission_completions(user_id);

alter table public.weston_site_admins enable row level security;
alter table public.weston_admin_settings enable row level security;
alter table public.weston_missions enable row level security;
alter table public.weston_mission_completions enable row level security;

revoke all on public.weston_site_admins, public.weston_admin_settings,
  public.weston_missions, public.weston_mission_completions from anon, authenticated;
grant select on public.weston_missions to anon, authenticated;
grant select, insert, update, delete on public.weston_missions to authenticated;
grant select, insert on public.weston_mission_completions to authenticated;
grant select on public.weston_site_admins to authenticated;

create function weston_private.is_site_admin() returns boolean
language sql security definer set search_path = '' as $$
  select exists (select 1 from public.weston_site_admins where user_id = auth.uid());
$$;
grant execute on function weston_private.is_site_admin() to authenticated;

-- Site admins manage every tournament, not just ones they created.
create or replace function weston_private.is_tournament_admin(tid uuid) returns boolean
language sql security definer set search_path = '' as $$
  select
    exists (select 1 from public.weston_tournament_admins
            where tournament_id = tid and user_id = auth.uid())
    or exists (select 1 from public.weston_site_admins where user_id = auth.uid());
$$;
grant execute on function weston_private.is_tournament_admin(uuid) to authenticated;

create policy weston_missions_read on public.weston_missions
  for select to anon, authenticated using (true);
create policy weston_missions_admin_insert on public.weston_missions
  for insert to authenticated with check ((select weston_private.is_site_admin()));
create policy weston_missions_admin_update on public.weston_missions
  for update to authenticated
  using ((select weston_private.is_site_admin()))
  with check ((select weston_private.is_site_admin()));
create policy weston_missions_admin_delete on public.weston_missions
  for delete to authenticated using ((select weston_private.is_site_admin()));

-- Players see only their own completions; site admins see all (statistics).
create policy weston_completions_read on public.weston_mission_completions
  for select to authenticated
  using (user_id = (select auth.uid()) or (select weston_private.is_site_admin()));
-- Own completions only; the trigger snapshots the configured reward.
create policy weston_completions_own_insert on public.weston_mission_completions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy weston_site_admins_own_read on public.weston_site_admins
  for select to authenticated using (user_id = (select auth.uid()));

-- The server stamps the real reward and rejects inactive missions; the client
-- can never choose its own points.
create function weston_private.stamp_mission_completion() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'Completion must belong to the signed-in player';
  end if;
  if not exists (select 1 from public.weston_missions m
                 where m.id = new.mission_id and m.status = 'active') then
    raise exception 'Mission is not active' using errcode = '22023';
  end if;
  new.points_awarded := (select reward_points from public.weston_missions where id = new.mission_id);
  new.completed_at := now();
  return new;
end;
$$;
revoke all on function weston_private.stamp_mission_completion() from public, anon, authenticated;
create trigger weston_mission_completion_stamp before insert on public.weston_mission_completions
  for each row execute function weston_private.stamp_mission_completion();

-- First claim on a fresh install sets the admin code (bootstrap); after that the
-- code must match. The hash input is namespaced so it never collides with
-- tournament admin codes.
create or replace function public.claim_site_admin(code text) returns boolean
language plpgsql security definer set search_path = extensions, public, pg_temp as $$
declare
  caller uuid := auth.uid();
  stored text;
  hashed text := encode(digest('site:' || code, 'sha256'), 'hex');
begin
  if caller is null then raise exception 'Sign-in required'; end if;
  if code is null or code !~ '^[0-9]{6}$' then return false; end if;
  select code_hash into stored from public.weston_admin_settings limit 1;
  if stored is null then
    insert into public.weston_admin_settings(single, code_hash) values (true, hashed);
  elsif stored <> hashed then
    return false;
  end if;
  insert into public.weston_site_admins(user_id) values (caller)
    on conflict (user_id) do nothing;
  return true;
end;
$$;

create or replace function public.set_site_admin_code(old_code text, new_code text) returns boolean
language plpgsql security definer set search_path = extensions, public, pg_temp as $$
declare
  stored text;
  hashed_old text := encode(digest('site:' || old_code, 'sha256'), 'hex');
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if new_code is null or new_code !~ '^[0-9]{6}$' then return false; end if;
  if not exists (select 1 from public.weston_site_admins where user_id = auth.uid()) then
    return false;
  end if;
  select code_hash into stored from public.weston_admin_settings limit 1;
  if stored is null or stored <> hashed_old then return false; end if;
  update public.weston_admin_settings set code_hash = encode(digest('site:' || new_code, 'sha256'), 'hex');
  return true;
end;
$$;

revoke all on function public.claim_site_admin(text),
  public.set_site_admin_code(text, text) from public, anon, authenticated;
grant execute on function public.claim_site_admin(text),
  public.set_site_admin_code(text, text) to authenticated;

comment on table public.weston_missions is
  'Admin-created missions with score rewards; completions are stamped server-side so players cannot forge points.';
commit;
