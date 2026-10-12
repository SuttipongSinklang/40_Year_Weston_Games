-- Apply once in project jlweqxpkqgnjcwcgisfj SQL Editor (run AFTER feature-pack.sql).
-- Achievements: unlocked client-side from real data, persisted per player,
-- announced on the public activity feed by a trigger.
begin;

create table public.weston_achievements (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (char_length(code) between 1 and 40),
  label text not null check (char_length(label) between 1 and 80),
  unlocked_at timestamptz not null default now(),
  primary key (user_id, code)
);

alter table public.weston_achievements enable row level security;
revoke all on public.weston_achievements from anon, authenticated;
grant select, insert on public.weston_achievements to authenticated;
create policy weston_achievements_read on public.weston_achievements
  for select to anon, authenticated using (true);
create policy weston_achievements_own_insert on public.weston_achievements
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Feed events gain the achievement kind.
alter table public.weston_events drop constraint weston_events_kind_check;
alter table public.weston_events
  add constraint weston_events_kind_check check (kind in ('mission','match','tournament','achievement'));

create function weston_private.log_achievement_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare player_name text;
begin
  select display_name into player_name from public.weston_scores where user_id = new.user_id;
  if player_name is null then player_name := 'ผู้เล่นไม่ระบุตัวตน'; end if;
  insert into public.weston_events(kind, text)
    values ('achievement', player_name || ' ปลดล็อกเหรียญตรา “' || new.label || '” 🏅');
  return new;
end;
$$;
revoke all on function weston_private.log_achievement_event() from public, anon, authenticated;
create trigger weston_achievement_event after insert on public.weston_achievements
  for each row execute function weston_private.log_achievement_event();

comment on table public.weston_achievements is
  'Player achievements unlocked from real activity; label is display-only, code is the stable key.';
commit;
