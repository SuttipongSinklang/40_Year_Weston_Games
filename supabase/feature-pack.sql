-- Apply once in project jlweqxpkqgnjcwcgisfj SQL Editor.
-- Feature pack: auto-verified run missions, daily missions, teams, double
-- elimination, match scheduling, cheers, activity events, health history,
-- announcements, and admin-team management. Requires the earlier migrations.
begin;

-- ── 1/4/8: mission verification types, daily reset, match scheduling side cols
alter table public.weston_missions
  add column verify_type text not null default 'self'
    check (verify_type in ('self','run_distance','run_count')),
  add column target_value integer check (target_value is null or target_value between 1 and 100000),
  add column reset_daily boolean not null default false;
alter table public.weston_missions
  add constraint weston_missions_target_required check (
    verify_type = 'self' or (target_value is not null and target_value >= 1)
  );

-- Daily missions can be completed once per Bangkok day; others once ever.
alter table public.weston_mission_completions
  add column day date not null default (now() at time zone 'Asia/Bangkok')::date;
alter table public.weston_mission_completions drop constraint weston_mission_completions_pkey;
alter table public.weston_mission_completions
  add primary key (mission_id, user_id, day);

-- ── 7: double elimination columns (bracket_side: 1 winners, 2 losers, 3 grand final)
alter table public.weston_matches
  add column bracket_side smallint not null default 1 check (bracket_side between 1 and 3),
  add column loser_next_match_id uuid references public.weston_matches(id) on delete set null,
  add column loser_next_slot smallint check (loser_next_slot in (1,2));
alter table public.weston_matches drop constraint weston_matches_tournament_id_round_match_no_key;
alter table public.weston_matches
  add constraint weston_matches_unique_slot unique (tournament_id, bracket_side, round, match_no);
create index weston_matches_side_idx on public.weston_matches(tournament_id, bracket_side, round, match_no);

-- ── 11: cheers on a live tournament
create table public.weston_cheers (
  id uuid primary key,
  tournament_id uuid not null references public.weston_tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now()
);
create index weston_cheers_tournament_idx on public.weston_cheers(tournament_id, created_at desc);
alter table public.weston_cheers enable row level security;
revoke all on public.weston_cheers from anon, authenticated;
grant select, insert on public.weston_cheers to authenticated;
create policy weston_cheers_read on public.weston_cheers
  for select to anon, authenticated using (true);
create policy weston_cheers_own_insert on public.weston_cheers
  for insert to authenticated with check (user_id = (select auth.uid()));

-- ── 12: activity events written by triggers (public read, no client writes)
create table public.weston_events (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('mission','match','tournament')),
  text text not null check (char_length(text) between 1 and 240),
  tournament_id uuid references public.weston_tournaments(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index weston_events_recent_idx on public.weston_events(created_at desc);
alter table public.weston_events enable row level security;
revoke all on public.weston_events from anon, authenticated;
grant select on public.weston_events to anon, authenticated;
create policy weston_events_read on public.weston_events
  for select to anon, authenticated using (true);

create function weston_private.log_mission_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare player_name text; mission_title text; points integer;
begin
  select display_name into player_name from public.weston_scores where user_id = new.user_id;
  select title, reward_points into mission_title, points from public.weston_missions where id = new.mission_id;
  if player_name is null then player_name := 'ผู้เล่นไม่ระบุตัวตน'; end if;
  if mission_title is null then return new; end if;
  insert into public.weston_events(kind, text)
    values ('mission', player_name || ' ทำภารกิจ “' || mission_title || '” สำเร็จ +' || new.points_awarded || ' แต้ม');
  return new;
end;
$$;
revoke all on function weston_private.log_mission_event() from public, anon, authenticated;
create trigger weston_mission_event after insert on public.weston_mission_completions
  for each row execute function weston_private.log_mission_event();

create function weston_private.log_match_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a text; b text; t text;
begin
  if new.status = 'completed' and (old.status is distinct from 'completed') and new.score_a is not null then
    select name into a from public.weston_participants where id = new.slot_a;
    select name into b from public.weston_participants where id = new.slot_b;
    select title into t from public.weston_tournaments where id = new.tournament_id;
    if a is not null and b is not null and t is not null then
      insert into public.weston_events(kind, text, tournament_id)
        values ('match', 'ผลแข่งขัน ' || t || ': ' || a || ' ' || new.score_a || '–' || new.score_b || ' ' || b, new.tournament_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function weston_private.log_match_event() from public, anon, authenticated;
create trigger weston_match_event after update on public.weston_matches
  for each row execute function weston_private.log_match_event();

-- ── 3: teams
create table public.weston_teams (
  id uuid primary key,
  name text not null check (char_length(name) between 1 and 40),
  emoji text not null default '🦁' check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now()
);
create table public.weston_team_members (
  team_id uuid not null references public.weston_teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);
alter table public.weston_teams enable row level security;
alter table public.weston_team_members enable row level security;
revoke all on public.weston_teams, public.weston_team_members from anon, authenticated;
grant select on public.weston_teams, public.weston_team_members to anon, authenticated;
grant insert, update, delete on public.weston_teams to authenticated;
grant insert, delete on public.weston_team_members to authenticated;
create policy weston_teams_read on public.weston_teams for select to anon, authenticated using (true);
create policy weston_teams_admin_write on public.weston_teams for insert to authenticated
  with check ((select weston_private.is_site_admin()));
create policy weston_teams_admin_update on public.weston_teams for update to authenticated
  using ((select weston_private.is_site_admin()))
  with check ((select weston_private.is_site_admin()));
create policy weston_teams_admin_delete on public.weston_teams for delete to authenticated
  using ((select weston_private.is_site_admin()));
create policy weston_members_read on public.weston_team_members for select to anon, authenticated using (true);
create policy weston_members_own_insert on public.weston_team_members for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy weston_members_own_delete on public.weston_team_members for delete to authenticated
  using (user_id = (select auth.uid()));

-- ── 16: health history appended on every profile save
create table public.weston_health_history (
  user_id uuid not null references auth.users(id) on delete cascade,
  recorded_on date not null default (now() at time zone 'Asia/Bangkok')::date,
  weight_kg numeric, bmi numeric, body_fat_percent numeric, muscle_mass_kg numeric,
  primary key (user_id, recorded_on)
);
alter table public.weston_health_history enable row level security;
revoke all on public.weston_health_history from anon, authenticated;
grant select, insert on public.weston_health_history to authenticated;
create policy weston_history_own_read on public.weston_health_history
  for select to authenticated using (user_id = (select auth.uid()));
create policy weston_history_own_insert on public.weston_health_history
  for insert to authenticated with check (user_id = (select auth.uid()));
create function weston_private.snapshot_health() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'History must belong to the signed-in player';
  end if;
  insert into public.weston_health_history(user_id, recorded_on, weight_kg, bmi, body_fat_percent, muscle_mass_kg)
    values (new.user_id, (now() at time zone 'Asia/Bangkok')::date, new.weight_kg, new.bmi,
            new.body_fat_percent, new.muscle_mass_kg)
    on conflict (user_id, recorded_on) do update
      set weight_kg = excluded.weight_kg, bmi = excluded.bmi,
          body_fat_percent = excluded.body_fat_percent, muscle_mass_kg = excluded.muscle_mass_kg;
  return new;
end;
$$;
revoke all on function weston_private.snapshot_health() from public, anon, authenticated;
create trigger weston_health_snapshot after insert or update on public.weston_health_profiles
  for each row execute function weston_private.snapshot_health();

-- ── 20: announcements
create table public.weston_announcements (
  id uuid primary key,
  message text not null check (char_length(message) between 1 and 200),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table public.weston_announcements enable row level security;
revoke all on public.weston_announcements from anon, authenticated;
grant select on public.weston_announcements to anon, authenticated;
grant insert, delete on public.weston_announcements to authenticated;
create policy weston_announcements_read on public.weston_announcements
  for select to anon, authenticated using (expires_at is null or expires_at > now());
create policy weston_announcements_admin_insert on public.weston_announcements
  for insert to authenticated with check ((select weston_private.is_site_admin()));
create policy weston_announcements_admin_delete on public.weston_announcements
  for delete to authenticated using ((select weston_private.is_site_admin()));

-- ── 19: admins can see and remove each other
create policy weston_site_admins_admin_read on public.weston_site_admins
  for select to authenticated using ((select weston_private.is_site_admin()));
create policy weston_site_admins_admin_delete on public.weston_site_admins
  for delete to authenticated using ((select weston_private.is_site_admin()) and user_id <> (select auth.uid()));
grant delete on public.weston_site_admins to authenticated;

-- ── 2: leaderboard needs every player's mission points (points only, no names)
create policy weston_completions_public_read on public.weston_mission_completions
  for select to anon, authenticated using (true);

-- ── 1: server-verified run missions. The trigger stamps the reward; this RPC
-- only admits completion when the player's real run data meets the target.
create or replace function public.complete_run_mission(mission_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  mission public.weston_missions;
  runs numeric;
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if caller is null then raise exception 'Sign-in required'; end if;
  select * into mission from public.weston_missions
    where id = mission_id and status = 'active' and verify_type <> 'self';
  if mission.id is null then raise exception 'Mission is not active' using errcode = '22023'; end if;
  if exists (select 1 from public.weston_mission_completions
             where mission_id = mission.id and user_id = caller
               and (not mission.reset_daily or day = today)) then
    raise exception 'Already completed' using errcode = '23505';
  end if;
  if mission.verify_type = 'run_distance' then
    select coalesce(sum(distance_m), 0) into runs
      from public.weston_runs
      where user_id = caller
        and (not mission.reset_daily or (started_at at time zone 'Asia/Bangkok')::date = today);
  else
    select count(*) into runs
      from public.weston_runs
      where user_id = caller
        and (not mission.reset_daily or (started_at at time zone 'Asia/Bangkok')::date = today);
  end if;
  if runs < mission.target_value then
    raise exception 'ยังไม่ถึงเป้าหมาย (ปัจจุบัน % จาก %)', runs, mission.target_value using errcode = '22023';
  end if;
  insert into public.weston_mission_completions(mission_id, user_id, day, points_awarded)
    values (mission.id, caller, today, 0);
  return true;
end;
$$;
revoke all on function public.complete_run_mission(uuid) from public, anon, authenticated;
grant execute on function public.complete_run_mission(uuid) to authenticated;

comment on table public.weston_events is 'Public activity feed events generated by triggers; never written directly by clients.';
commit;
