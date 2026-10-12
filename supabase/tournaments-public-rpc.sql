-- Apply once AFTER supabase/tournaments.sql. Safe to re-run any number of times:
-- it only moves the two client RPCs into `public` (PostgREST serves only
-- public/storage, so weston_private functions are unreachable from browsers).
-- Tables, RLS and weston_private.is_tournament_admin stay untouched.
begin;

drop function if exists weston_private.create_tournament(jsonb, text);
drop function if exists weston_private.claim_tournament_admin(uuid, text);

-- The admin code is only ever stored as sha256(id || ':' || code); the hash itself
-- is public but cannot be reversed into the code.
create or replace function public.create_tournament(payload jsonb, admin_code text) returns uuid
language plpgsql security definer set search_path = extensions, public, pg_temp as $$
declare
  new_id uuid := gen_random_uuid();
  caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Sign-in required'; end if;
  if admin_code is null or admin_code !~ '^[0-9]{6}$' then
    raise exception 'Admin code must be 6 digits' using errcode = '22023';
  end if;
  insert into public.weston_tournaments (
    id, title, sport, sport_icon, category, gender, format, description,
    max_participants, third_place, allow_draw, score_label,
    points_win, points_draw, points_loss, status, created_by, admin_code_hash
  ) values (
    new_id,
    payload->>'title',
    payload->>'sport',
    coalesce(nullif(payload->>'sport_icon', ''), '🏆'),
    payload->>'category',
    payload->>'gender',
    payload->>'format',
    nullif(payload->>'description', ''),
    nullif(payload->>'max_participants', '')::integer,
    coalesce((payload->>'third_place')::boolean, false),
    coalesce((payload->>'allow_draw')::boolean, false),
    coalesce(nullif(payload->>'score_label', ''), 'คะแนน'),
    coalesce(nullif(payload->>'points_win', '')::integer, 3),
    coalesce(nullif(payload->>'points_draw', '')::integer, 1),
    coalesce(nullif(payload->>'points_loss', '')::integer, 0),
    'registering',
    caller,
    encode(digest(new_id::text || ':' || admin_code, 'sha256'), 'hex')
  );
  insert into public.weston_tournament_admins(tournament_id, user_id) values (new_id, caller);
  return new_id;
end;
$$;

create or replace function public.claim_tournament_admin(tid uuid, admin_code text) returns boolean
language plpgsql security definer set search_path = extensions, public, pg_temp as $$
declare stored text;
begin
  if auth.uid() is null then raise exception 'Sign-in required'; end if;
  if admin_code is null or admin_code !~ '^[0-9]{6}$' then return false; end if;
  select admin_code_hash into stored from public.weston_tournaments where id = tid;
  if stored is null
    or stored <> encode(digest(tid::text || ':' || admin_code, 'sha256'), 'hex') then
    return false;
  end if;
  insert into public.weston_tournament_admins(tournament_id, user_id)
    values (tid, auth.uid())
    on conflict (tournament_id, user_id) do nothing;
  return true;
end;
$$;

revoke all on function public.create_tournament(jsonb, text),
  public.claim_tournament_admin(uuid, text) from public, anon, authenticated;
grant execute on function public.create_tournament(jsonb, text),
  public.claim_tournament_admin(uuid, text) to authenticated;

commit;
