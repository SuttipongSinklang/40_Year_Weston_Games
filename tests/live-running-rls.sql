-- Synthetic coordinates only. Entire test transaction rolls back.
begin;
insert into auth.users(id) values
 ('d57b4921-8a10-4f65-b9ad-b501442ed101'),
 ('d57b4921-8a10-4f65-b9ad-b501442ed102');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d57b4921-8a10-4f65-b9ad-b501442ed101","role":"authenticated"}', true);
insert into public.weston_live_runners(user_id,lat,lng,accuracy,fix_at,display_name,updated_at,expires_at)
values ('d57b4921-8a10-4f65-b9ad-b501442ed101',13,100,5,clock_timestamp(),'spoofed',now(),now()+interval '1 year');
do $$ begin
 if not exists(select 1 from public.weston_live_runners
 where display_name = 'นักวิ่ง D57B4921' and expires_at-updated_at=interval '60 seconds') then
 raise exception 'Server timestamp/name failed'; end if;
 begin
  insert into public.weston_live_runners(user_id,lat,lng,accuracy,fix_at)
  values ('d57b4921-8a10-4f65-b9ad-b501442ed102',13,100,5,clock_timestamp());
  raise exception 'Cross owner insert succeeded';
 exception when insufficient_privilege then null; end;
 begin
  update public.weston_live_runners set fix_at=now()-interval '1 hour';
  raise exception 'Stale fix succeeded';
 exception when invalid_parameter_value then null; end;
 begin
  update public.weston_live_runners set lat='NaN'::float8;
  raise exception 'Invalid coordinate succeeded';
 exception when check_violation then null; end;
end $$;
select set_config('request.jwt.claims', '{"sub":"d57b4921-8a10-4f65-b9ad-b501442ed102","role":"authenticated"}', true);
do $$ declare affected integer; begin
 if (select count(*) from public.weston_live_runners where user_id='d57b4921-8a10-4f65-b9ad-b501442ed101') <> 1 then
 raise exception 'Fresh position invisible to viewer'; end if;
 update public.weston_live_runners set lat=20 where user_id='d57b4921-8a10-4f65-b9ad-b501442ed101';
 get diagnostics affected = row_count;
 if affected<>0 then raise exception 'Cross owner update succeeded'; end if;
 delete from public.weston_live_runners where user_id='d57b4921-8a10-4f65-b9ad-b501442ed101';
 get diagnostics affected = row_count;
 if affected<>0 then raise exception 'Cross owner delete succeeded'; end if;
end $$;
reset role;
alter table public.weston_live_runners disable trigger weston_live_stamp;
update public.weston_live_runners set expires_at=now()-interval '1 second'
where user_id='d57b4921-8a10-4f65-b9ad-b501442ed101';
alter table public.weston_live_runners enable trigger weston_live_stamp;
set local role authenticated;
do $$ begin
 if exists(select 1 from public.weston_live_runners where user_id='d57b4921-8a10-4f65-b9ad-b501442ed101') then
 raise exception 'Expired position visible to another player'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"d57b4921-8a10-4f65-b9ad-b501442ed101","role":"authenticated"}', true);
delete from public.weston_live_runners where user_id='d57b4921-8a10-4f65-b9ad-b501442ed101';
set local role anon;
do $$ begin
 begin
 perform count(*) from public.weston_live_runners;
 raise exception 'Unauthenticated read succeeded';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
