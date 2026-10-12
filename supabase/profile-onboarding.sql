-- Apply to jlweqxpkqgnjcwcgisfj only. Health and avatar data are private per player.
begin;
create table if not exists public.weston_health_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  age smallint not null check (age between 1 and 120),
  sex text not null check (sex in ('male','female')),
  weight_kg numeric(8,3) not null check (weight_kg > 0 and weight_kg < 10000),
  height_cm numeric(8,3) not null check (height_cm > 0 and height_cm < 10000),
  bmi numeric(12,4) not null check (bmi > 0),
  input_bmi numeric(12,4) not null check (input_bmi > 0),
  body_fat_percent numeric(7,4) not null check (body_fat_percent > 0 and body_fat_percent < 100),
  muscle_mass_kg numeric(8,3) not null check (muscle_mass_kg > 0 and muscle_mass_kg <= weight_kg),
  muscle_definition text check (muscle_definition in ('total','skeletal')),
  measured_at timestamptz not null,
  avatar_path text,
  photo_revision uuid,
  revision uuid not null,
  check (abs(bmi - weight_kg / power(height_cm / 100, 2)) < 0.05),
  check ((avatar_path is null and photo_revision is null) or
    (avatar_path is not null and photo_revision is not null and avatar_path = user_id::text || '/' || photo_revision::text || '.jpg'))
);
alter table public.weston_health_profiles enable row level security;
revoke all on public.weston_health_profiles from anon;
grant select, insert, update, delete on public.weston_health_profiles to authenticated;
drop policy if exists "weston_profile_read" on public.weston_health_profiles;
create policy "weston_profile_read" on public.weston_health_profiles for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "weston_profile_insert" on public.weston_health_profiles;
create policy "weston_profile_insert" on public.weston_health_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "weston_profile_update" on public.weston_health_profiles;
create policy "weston_profile_update" on public.weston_health_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "weston_profile_delete" on public.weston_health_profiles;
create policy "weston_profile_delete" on public.weston_health_profiles for delete to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('weston-private-avatars','weston-private-avatars',false,1048576,array['image/jpeg'])
on conflict (id) do update set public=false,file_size_limit=1048576,allowed_mime_types=array['image/jpeg'];
drop policy if exists "weston_avatar_read" on storage.objects;
create policy "weston_avatar_read" on storage.objects for select to authenticated using (bucket_id='weston-private-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "weston_avatar_insert" on storage.objects;
create policy "weston_avatar_insert" on storage.objects for insert to authenticated with check (bucket_id='weston-private-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "weston_avatar_update" on storage.objects;
create policy "weston_avatar_update" on storage.objects for update to authenticated using (bucket_id='weston-private-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text) with check (bucket_id='weston-private-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
drop policy if exists "weston_avatar_delete" on storage.objects;
create policy "weston_avatar_delete" on storage.objects for delete to authenticated using (bucket_id='weston-private-avatars' and (storage.foldername(name))[1]=(select auth.uid())::text);
commit;
