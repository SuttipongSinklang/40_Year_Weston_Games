-- LINE AUTH PACK — ทำให้ข้อมูลเกมผูกกับบัญชี LINE ของพนักงาน ไม่ผูกกับเครื่อง
-- รันบนโปรเจกต์เกม jlweqxpkqgnjcwcgisfj (Supabase Dashboard > SQL Editor) — idempotent
-- สิ่งที่ต้องตั้งใน Dashboard เพิ่มเติม (ทำครั้งเดียว ดูLINE-AUTH-SETUP.md):
--   1) Authentication > Providers > LINE > Enable + กรอก Channel ID/Secret ของ LINE Login channel 2011737916
--   2) LINE Developers > แชแนล 2011737916 > Callback URL เพิ่ม:
--      https://jlweqxpkqgnjcwcgisfj.supabase.co/auth/v1/callback
--   3) Authentication > URL Configuration > Site URL / Redirect URLs เพิ่ม https://p.westonsupa.xyz
begin;

-- กันการ "รับเด็ก" ข้อมูล anonymous เดิมซ้ำ/ขโมยข้อมูลกันเอง: บันทึกว่า uid เดิมถูกย้ายไปแล้ว
create table if not exists public.weston_adopted (
  old_user uuid primary key,
  new_user uuid not null references auth.users(id) on delete cascade,
  adopted_at timestamptz not null default now()
);
alter table public.weston_adopted enable row level security;
revoke all on public.weston_adopted from anon, authenticated;

-- ย้ายข้อมูลเกมทั้งหมดของผู้เล่น anonymous เดิม (เครื่องเดิม) มาที่บัญชี LINE ของผู้เรียก
-- เรียกครั้งเดียวจากเกมหลังล็อกอิน LINE สำเร็จ (data.js จะเรียกเอง)
create or replace function public.weston_adopt_progress(old_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  moved jsonb;
begin
  if caller is null then raise exception 'ต้องล็อกอินก่อน'; end if;
  if old_user is null or old_user = caller then raise exception 'ต้องระบุผู้เล่นเดิมที่ไม่ใช่ตัวเอง'; end if;
  -- ห้ามรับข้อมูลของบัญชีจริง (อีกคน) รับได้เฉพาะผู้เล่น anonymous ของเครื่องเดิมเท่านั้น
  if exists (select 1 from auth.users u where u.id = old_user and u.is_anonymous = false) then
    raise exception 'ผู้เล่นเดิมไม่ใช่บัญชี anonymous';
  end if;
  -- ห้ามย้าย uid เดิมซ้ำ (ป้องกันคนอื่นมาอ้างข้อมูลชุดเดียวกัน)
  if exists (select 1 from public.weston_adopted where old_user = weston_adopt_progress.old_user) then
    return jsonb_build_object('adopted', false, 'reason', 'already');
  end if;

  -- คะแนนรวม: นับใหม่จากจำนวนเกมจริงของทั้งสองบัญชี
  update public.weston_progress dst set total_workouts = (
    select count(*) from public.weston_workouts w
    where w.user_id in (dst.user_id, old_user)
  ) where dst.user_id = caller;

  -- ประวัติวันเล่น: รวม workouts ต่อวัน
  insert into public.weston_days (user_id, played_on, workouts)
  select caller, played_on, sum(workouts) from public.weston_days
  where user_id = old_user group by played_on
  on conflict (user_id, played_on) do update
    set workouts = public.weston_days.workouts + excluded.workouts;

  insert into public.weston_workouts (id, user_id, played_on)
  select id, caller, played_on from public.weston_workouts where user_id = old_user
  on conflict do nothing;

  insert into public.weston_runs (id, user_id, activity, distance_source, steps, stride_m,
    started_at, ended_at, distance_m, duration_s, route, splits, events)
  select r.id, caller, r.activity, r.distance_source, r.steps, r.stride_m,
    r.started_at, r.ended_at, r.distance_m, r.duration_s, r.route, r.splits, r.events
  from public.weston_runs r where r.user_id = old_user
  on conflict do nothing;

  insert into public.weston_health_history (user_id, recorded_on, weight_kg, bmi, body_fat_percent, muscle_mass_kg)
  select caller, recorded_on, weight_kg, bmi, body_fat_percent, muscle_mass_kg
  from public.weston_health_history where user_id = old_user
  on conflict do nothing;

  -- โปรไฟล์สุขภาพ: ใช้ของเดิมเฉพาะเมื่อบัญชีใหม่ยังไม่เคยกรอก
  insert into public.weston_health_profiles (user_id, age, sex, weight_kg, height_cm, bmi, input_bmi,
    body_fat_percent, muscle_mass_kg, muscle_definition, measured_at, avatar_path, photo_revision, revision)
  select caller, p.age, p.sex, p.weight_kg, p.height_cm, p.bmi, p.input_bmi,
    p.body_fat_percent, p.muscle_mass_kg, p.muscle_definition, p.measured_at, p.avatar_path, p.photo_revision, p.revision
  from public.weston_health_profiles p where p.user_id = old_user
  on conflict (user_id) do nothing;

  insert into public.weston_adopted (old_user, new_user) values (old_user, caller);

  select jsonb_build_object(
    'adopted', true,
    'workouts', (select count(*) from public.weston_workouts where user_id = caller),
    'days', (select count(*) from public.weston_days where user_id = caller)
  ) into moved;
  return moved;
end;
$$;

grant execute on function public.weston_adopt_progress(uuid) to authenticated;
revoke execute on function public.weston_adopt_progress(uuid) from anon;

commit;
