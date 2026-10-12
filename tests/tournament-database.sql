-- Transactional acceptance checks: all fixtures roll back.
-- Run after applying supabase/tournaments.sql.
begin;
insert into auth.users(id, aud, role, is_anonymous)
values ('90000000-0000-4000-8000-000000000001','authenticated','authenticated',true),
       ('90000000-0000-4000-8000-000000000002','authenticated','authenticated',true),
       ('90000000-0000-4000-8000-000000000003','authenticated','authenticated',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;

-- Creator becomes admin automatically; the code never appears in any table.
do $$
declare tid uuid;
begin
  tid := public.create_tournament(
    jsonb_build_object('title','ปิงปองคัง','sport','ปิงปอง','sport_icon','🏓',
      'category','single','gender','mixed','format','single_elim','third_place','true'),
    '123456');
  if not exists (select 1 from public.weston_tournament_admins
    where tournament_id = tid and user_id = '90000000-0000-4000-8000-000000000001') then
    raise exception 'Creator not seeded as admin';
  end if;
  if public.claim_tournament_admin(tid, '999999') then
    raise exception 'Wrong admin code accepted';
  end if;
end $$;
begin
  perform public.create_tournament(
    jsonb_build_object('title','x','sport','y','category','single','gender','mixed','format','round_robin'),
    '12');
  raise exception 'Short admin code accepted';
exception when others then
  if sqlerrm like '%6 digits%' then null; else raise; end if;
end;

-- Non-creator claims admin with the code, adds a walk-in team (user_id null).
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare tid uuid := (select id from public.weston_tournaments limit 1);
begin
  if not public.claim_tournament_admin(tid, '123456') then
    raise exception 'Second player cannot claim admin with valid code';
  end if;
  insert into public.weston_participants(id, tournament_id, name)
  values (gen_random_uuid(), tid, 'ทีมบุก');
end $$;

-- Self-registration while the tournament is still registering.
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare tid uuid := (select id from public.weston_tournaments limit 1);
begin
  insert into public.weston_participants(id, tournament_id, user_id, name)
  values (gen_random_uuid(), tid, auth.uid(), 'ผู้เล่น 1');
  begin
    insert into public.weston_participants(id, tournament_id, user_id, name)
    values (gen_random_uuid(), tid, auth.uid(), 'ผู้เล่น 1 อีกครั้ง');
    raise exception 'Duplicate self-join accepted';
  exception when unique_violation then null;
  end;
end $$;

-- Admin starts the tournament, builds the bracket and records a score.
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$
declare tid uuid := (select id from public.weston_tournaments limit 1);
begin
  update public.weston_tournaments set status = 'ongoing' where id = tid;
  insert into public.weston_matches(id, tournament_id, round, match_no, round_label, slot_a, slot_b, status)
  select gen_random_uuid(), tid, 1, 1, 'ชิงชนะเลิศ', min(id), max(id), 'ready'
  from public.weston_participants where tournament_id = tid;
  update public.weston_matches set score_a = 11, score_b = 7,
    winner_id = slot_a, status = 'completed', completed_at = now()
  where tournament_id = tid;
  if not exists (select 1 from public.weston_matches
    where tournament_id = tid and status = 'completed' and score_a = 11) then
    raise exception 'Admin cannot record scores';
  end if;
end $$;

-- A player with no admin role cannot join after the start or write matches/status.
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
do $$
declare tid uuid := (select id from public.weston_tournaments limit 1);
begin
  begin
    insert into public.weston_participants(id, tournament_id, user_id, name)
    values (gen_random_uuid(), tid, auth.uid(), 'ผู้เล่น 3');
    raise exception 'Self-join accepted after tournament started';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.weston_participants(id, tournament_id, name)
    values (gen_random_uuid(), tid, 'ทีมแปลกปลอม');
    raise exception 'Non-admin walk-in insert accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.weston_matches set score_a = 0 where tournament_id = tid;
    raise exception 'Non-admin wrote match scores';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.weston_tournaments set status = 'cancelled' where id = tid;
    raise exception 'Non-admin changed tournament status';
  exception when insufficient_privilege then null;
  end;
  -- Bracket and scores stay publicly readable; the admin roster stays private.
  if not exists (select 1 from public.weston_matches where tournament_id = tid and score_a = 11) then
    raise exception 'Public bracket missing';
  end if;
  if exists (select 1 from public.weston_tournament_admins) then
    raise exception 'Admin roster leaked to non-admin';
  end if;
end $$;
reset role;
do $$
begin
  if not exists (select 1 from public.weston_tournaments) then
    raise exception 'Anonymous cannot list tournaments';
  end if;
  if not exists (select 1 from public.weston_matches) then
    raise exception 'Anonymous cannot read scores';
  end if;
  begin
    perform public.claim_tournament_admin(
      (select id from public.weston_tournaments limit 1), '123456');
    raise exception 'Anonymous claimed admin';
  exception when insufficient_privilege then null;
  end;
end $$;
select 'PASS: creator auto-admin, code claim/verify, walk-in + self-join rules, admin-only scores/status, public read without admin powers' as verification;
rollback;
