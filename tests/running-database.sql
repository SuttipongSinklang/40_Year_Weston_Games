-- Synthetic fixtures only. All changes are rolled back.
begin;
insert into auth.users(id,aud,role,is_anonymous)
values ('90000000-0000-4000-8000-000000000003','authenticated','authenticated',true),
       ('90000000-0000-4000-8000-000000000004','authenticated','authenticated',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
set local role authenticated;
insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s,route,splits)
values ('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003',
        '2026-10-08 01:00:00+00','2026-10-08 01:10:00+00',1000,600,
        '[{"lat":0,"lng":0,"accuracy":5,"timestamp":1791421200000,"segment":0,"active_ms":0,"distance_m":0}]','[]');
insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s)
values ('91000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000003',
        '2026-10-08 01:00:00+00','2026-10-08 01:10:00+00',1000,600)
on conflict(id) do nothing;
do $$ begin
  if (select count(*) from public.weston_runs) <> 1 then raise exception 'Run replay duplicated or owner read failed'; end if;
  begin
    update public.weston_runs set distance_m=999999;
    raise exception 'Run updates allowed unexpectedly';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s)
    values(gen_random_uuid(),'90000000-0000-4000-8000-000000000003',now(),now(),-1,0);
    raise exception 'Invalid distance accepted';
  exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
do $$ begin
  if exists(select 1 from public.weston_runs) then raise exception 'Private route leaked to another user'; end if;
  begin
    insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s)
    values(gen_random_uuid(),'90000000-0000-4000-8000-000000000003',now(),now(),0,0);
    raise exception 'Cross-owner write accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.weston_runs;
    raise exception 'Anonymous public reader can see routes';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: private GPS isolation, insert replay, owner write protection, public access denied, numeric validation' as verification;
rollback;
