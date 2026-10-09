begin;
insert into auth.users(id) values ('e57b4921-8a10-4f65-b9ad-b501442ed101');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e57b4921-8a10-4f65-b9ad-b501442ed101","role":"authenticated"}',true);
insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s,activity,distance_source)
values ('e57b4921-8a10-4f65-b9ad-b501442ed201','e57b4921-8a10-4f65-b9ad-b501442ed101',now()-interval '20 minutes',now(),3500,1200,'treadmill','manual');
do $$ begin
 if not exists(select 1 from public.weston_runs where id='e57b4921-8a10-4f65-b9ad-b501442ed201' and activity='treadmill' and route='[]'::jsonb) then
 raise exception 'Treadmill backup failed'; end if;
 begin
 insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s,activity,distance_source,route)
 values ('e57b4921-8a10-4f65-b9ad-b501442ed202','e57b4921-8a10-4f65-b9ad-b501442ed101',now()-interval '20 minutes',now(),3500,1200,'treadmill','manual','[{}]'::jsonb);
 raise exception 'Fake treadmill GPS accepted';
 exception when check_violation then null; end;
end $$;
insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s,activity,distance_source,steps,stride_m)
values ('e57b4921-8a10-4f65-b9ad-b501442ed203','e57b4921-8a10-4f65-b9ad-b501442ed101',now()-interval '20 minutes',now(),24,1200,'treadmill','phone_steps',30,0.8);
do $$ begin
 if not exists(select 1 from public.weston_runs where id='e57b4921-8a10-4f65-b9ad-b501442ed203' and steps=30 and distance_source='phone_steps') then
 raise exception 'Phone measurement metadata lost'; end if;
 begin
 insert into public.weston_runs(id,user_id,started_at,ended_at,distance_m,duration_s,activity,distance_source,steps,stride_m)
 values ('e57b4921-8a10-4f65-b9ad-b501442ed204','e57b4921-8a10-4f65-b9ad-b501442ed101',now()-interval '20 minutes',now(),999,1200,'treadmill','phone_steps',30,0.8);
 raise exception 'Inconsistent estimate accepted';
 exception when check_violation then null; end;
end $$;
rollback;
