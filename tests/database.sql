-- Transactional acceptance checks: all fixtures roll back.
begin;
insert into auth.users(id, aud, role, is_anonymous)
values ('90000000-0000-4000-8000-000000000001','authenticated','authenticated',true),
       ('90000000-0000-4000-8000-000000000002','authenticated','authenticated',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
set local role authenticated;
insert into public.weston_workouts(id,user_id,played_on)
select gen_random_uuid(),'90000000-0000-4000-8000-000000000001',(now() at time zone 'Asia/Bangkok')::date from generate_series(1,5);
insert into public.weston_workouts(id,user_id,played_on)
select id,user_id,played_on from public.weston_workouts on conflict(id) do nothing;
do $$ begin
  if (select total_workouts from public.weston_progress) <> 5 then raise exception 'Duplicate count or summary failure'; end if;
  if (select workouts from public.weston_days) <> 5 then raise exception 'Daily summary failure'; end if;
  if (select total_workouts from public.weston_scores where user_id='90000000-0000-4000-8000-000000000001') <> 5 then raise exception 'Leaderboard summary failure'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.weston_workouts) then raise exception 'Private ledger leaked'; end if;
  if exists(select 1 from public.weston_progress) then raise exception 'Private progress leaked'; end if;
  if exists(select 1 from public.weston_days) then raise exception 'Private dates leaked'; end if;
  begin
    insert into public.weston_workouts(id,user_id) values(gen_random_uuid(),'90000000-0000-4000-8000-000000000001');
    raise exception 'Cross-player write accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.weston_scores set total_workouts=999;
    raise exception 'Client can forge scores';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select 'PASS: atomic totals, idempotent replay, private owner isolation, cross-owner writes blocked, score forgery blocked' as verification;
rollback;
