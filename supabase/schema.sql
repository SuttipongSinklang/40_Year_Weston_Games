-- Apply once in project jlweqxpkqgnjcwcgisfj SQL Editor.
-- Additive Weston tables only. No health data or private progress in the public leaderboard.
begin;
create schema if not exists weston_private;
revoke all on schema weston_private from public, anon, authenticated;

create table public.weston_workouts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  played_on date not null default (now() at time zone 'Asia/Bangkok')::date,
  created_at timestamptz not null default now(),
  check (played_on <= (now() at time zone 'Asia/Bangkok')::date)
);
create index weston_workouts_user_day_idx on public.weston_workouts(user_id, played_on);
create table public.weston_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_workouts integer not null default 0 check (total_workouts >= 0)
);
create table public.weston_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  played_on date not null,
  workouts integer not null default 0 check (workouts >= 0),
  primary key(user_id, played_on)
);
create table public.weston_scores (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  total_workouts integer not null default 0 check (total_workouts >= 0)
);
create index weston_scores_rank_idx on public.weston_scores(total_workouts desc, user_id);

alter table public.weston_workouts enable row level security;
alter table public.weston_progress enable row level security;
alter table public.weston_days enable row level security;
alter table public.weston_scores enable row level security;
revoke all on public.weston_workouts, public.weston_progress, public.weston_days, public.weston_scores from anon, authenticated;
grant select, insert on public.weston_workouts to authenticated;
grant select on public.weston_progress, public.weston_days to authenticated;
grant select on public.weston_scores to anon, authenticated;
create policy weston_workouts_own_read on public.weston_workouts for select to authenticated using ((select auth.uid()) = user_id);
create policy weston_workouts_own_insert on public.weston_workouts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy weston_progress_own_read on public.weston_progress for select to authenticated using ((select auth.uid()) = user_id);
create policy weston_days_own_read on public.weston_days for select to authenticated using ((select auth.uid()) = user_id);
create policy weston_scores_public_read on public.weston_scores for select to anon, authenticated using (true);

-- Internal trigger needs elevated writes to derived totals. No client execute grant.
create function weston_private.record_workout() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or auth.uid() <> new.user_id then
    raise exception 'Workout owner does not match signed-in player';
  end if;
  insert into public.weston_progress(user_id,total_workouts) values(new.user_id,1)
    on conflict(user_id) do update set total_workouts = public.weston_progress.total_workouts + 1;
  insert into public.weston_days(user_id,played_on,workouts) values(new.user_id,new.played_on,1)
    on conflict(user_id,played_on) do update set workouts = public.weston_days.workouts + 1;
  insert into public.weston_scores(user_id,display_name,total_workouts)
    values(new.user_id,'ผู้เล่น ' || left(new.user_id::text,8),1)
    on conflict(user_id) do update set total_workouts = public.weston_scores.total_workouts + 1;
  return new;
end;
$$;
revoke all on function weston_private.record_workout() from public, anon, authenticated;
create trigger weston_workout_recorded after insert on public.weston_workouts
  for each row execute function weston_private.record_workout();
commit;
