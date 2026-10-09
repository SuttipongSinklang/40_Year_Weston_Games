-- Opt-in current positions only; private run history is never published.
create table public.weston_live_runners (
  user_id uuid primary key references auth.users(id) on delete cascade,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy double precision not null check (accuracy between 0 and 40),
  fix_at timestamptz not null,
  display_name text not null,
  updated_at timestamptz not null,
  expires_at timestamptz not null
);
create index weston_live_expiry_idx on public.weston_live_runners(expires_at);
create index weston_live_recent_idx on public.weston_live_runners(updated_at desc);
create function public.weston_stamp_live_runner() returns trigger
language plpgsql set search_path = '' as $$
declare received timestamptz := clock_timestamp();
begin
  if new.fix_at < received - interval '15 seconds'
    or new.fix_at > received + interval '10 seconds' then
    raise exception 'GPS fix is not fresh' using errcode = '22023';
  end if;
  if TG_OP = 'UPDATE' and new.fix_at < old.fix_at then
    raise exception 'GPS fix is out of order' using errcode = '22023';
  end if;
  new.display_name := 'นักวิ่ง ' || upper(substr(replace(new.user_id::text, '-', ''), 1, 8));
  new.updated_at := received;
  new.expires_at := received + interval '60 seconds';
  return new;
end;
$$;
revoke all on function public.weston_stamp_live_runner() from public, anon, authenticated;
create trigger weston_live_stamp before insert or update on public.weston_live_runners
for each row execute function public.weston_stamp_live_runner();
alter table public.weston_live_runners enable row level security;
revoke all on public.weston_live_runners from public, anon, authenticated;
grant select, insert, update, delete on public.weston_live_runners to authenticated;
create policy live_read on public.weston_live_runners for select to authenticated
  using (expires_at > now() or user_id = (select auth.uid()));
create policy live_insert_own on public.weston_live_runners for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy live_update_own on public.weston_live_runners for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy live_delete_own on public.weston_live_runners for delete to authenticated
  using (user_id = (select auth.uid()));
alter publication supabase_realtime add table public.weston_live_runners;
-- Delete stale coordinates on the server even when all clients have left.
create extension if not exists pg_cron;
select cron.schedule('weston-live-expiry', '* * * * *',
  $$delete from public.weston_live_runners where expires_at <= now()$$);
comment on table public.weston_live_runners is
  'Explicit opt-in live position, visible to authenticated players for 60 seconds. Cleanup every minute. No route history.';
