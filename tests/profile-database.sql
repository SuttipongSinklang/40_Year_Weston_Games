-- Transactional RLS integration checks. All synthetic rows are rolled back.
begin;
do $$
declare a uuid; b uuid;
begin
  select u.id into a from auth.users u where not exists (select 1 from public.weston_health_profiles p where p.user_id=u.id) order by u.id limit 1;
  select u.id into b from auth.users u where u.id<>a and not exists (select 1 from public.weston_health_profiles p where p.user_id=u.id) order by u.id limit 1;
  if a is null or b is null then raise exception 'Two unused player identities are needed for rollback-only checks'; end if;
  perform set_config('weston.test_a',a::text,true);
  perform set_config('weston.test_b',b::text,true);
end $$;
set local role authenticated;
do $$
declare a uuid:=current_setting('weston.test_a')::uuid;
        b uuid:=current_setting('weston.test_b')::uuid;
        path text:=a::text||'/'||gen_random_uuid()::text||'.jpg';
        affected integer;
begin
  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  insert into public.weston_health_profiles(user_id,age,sex,weight_kg,height_cm,bmi,input_bmi,body_fat_percent,muscle_mass_kg,measured_at,revision)
    values(a,30,'female',60,165,22.0386,22,25,25,now(),gen_random_uuid());
  if (select count(*) from public.weston_health_profiles where user_id=a)<>1 then raise exception 'Owner cannot read profile'; end if;
  update public.weston_health_profiles set age=31 where user_id=a;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Owner cannot update profile'; end if;
  insert into storage.objects(bucket_id,name) values('weston-private-avatars',path);
  if (select count(*) from storage.objects where bucket_id='weston-private-avatars' and name=path)<>1 then raise exception 'Owner cannot read avatar metadata'; end if;
  update storage.objects set metadata='{"test":true}'::jsonb where bucket_id='weston-private-avatars' and name=path;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Owner cannot update avatar metadata'; end if;

  perform set_config('request.jwt.claims',json_build_object('sub',b,'role','authenticated')::text,true);
  if exists(select 1 from public.weston_health_profiles where user_id=a) then raise exception 'Other player can read health data'; end if;
  if exists(select 1 from storage.objects where bucket_id='weston-private-avatars' and name=path) then raise exception 'Other player can read avatar metadata'; end if;
  update public.weston_health_profiles set age=40 where user_id=a;
  get diagnostics affected=row_count;
  if affected<>0 then raise exception 'Other player can update profile'; end if;
  begin
    insert into public.weston_health_profiles(user_id,age,sex,weight_kg,height_cm,bmi,input_bmi,body_fat_percent,muscle_mass_kg,measured_at,revision)
      values(a,30,'female',60,165,22.0386,22,25,25,now(),gen_random_uuid());
    raise exception 'Other player can insert profile under wrong owner';
  exception when insufficient_privilege then null; end;
  begin
    insert into storage.objects(bucket_id,name) values('weston-private-avatars',a::text||'/'||gen_random_uuid()::text||'.jpg');
    raise exception 'Other player can insert avatar under wrong owner';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claims',json_build_object('sub',a,'role','authenticated')::text,true);
  begin
    update public.weston_health_profiles set user_id=b where user_id=a;
    raise exception 'Owner can reassign profile to another player';
  exception when insufficient_privilege then null; end;
  delete from public.weston_health_profiles where user_id=a;
  get diagnostics affected=row_count;
  if affected<>1 then raise exception 'Owner cannot delete profile'; end if;
end $$;
rollback;
