-- Apply once in project jlweqxpkqgnjcwcgisfj SQL Editor.
-- Sports tournament tables: any custom sport, single/team, male/female/mixed,
-- single elimination bracket + round robin league with a points table.
-- Public read (brackets and scores are shareable); writes are admin-gated.
begin;

create extension if not exists pgcrypto with schema extensions;

create table public.weston_tournaments (
  id uuid primary key,
  title text not null check (char_length(title) between 1 and 80),
  sport text not null check (char_length(sport) between 1 and 40),
  sport_icon text not null default '🏆' check (char_length(sport_icon) between 1 and 8),
  category text not null check (category in ('single','team')),
  gender text not null check (gender in ('male','female','mixed')),
  format text not null check (format in ('single_elim','round_robin')),
  description text check (char_length(coalesce(description,'')) <= 500),
  max_participants integer check (max_participants is null or max_participants between 2 and 256),
  third_place boolean not null default false,
  allow_draw boolean not null default false,
  score_label text not null default 'คะแนน' check (char_length(score_label) between 1 and 20),
  points_win integer not null default 3 check (points_win >= 0),
  points_draw integer not null default 1 check (points_draw >= 0),
  points_loss integer not null default 0 check (points_loss >= 0),
  check (points_win >= points_draw and points_draw >= points_loss),
  status text not null default 'registering' check (status in ('registering','ongoing','completed','cancelled')),
  created_by uuid not null references auth.users(id) on delete cascade,
  admin_code_hash text not null,
  created_at timestamptz not null default now()
);
create index weston_tournaments_list_idx on public.weston_tournaments(status, created_at desc);

create table public.weston_participants (
  id uuid primary key,
  tournament_id uuid not null references public.weston_tournaments(id) on delete cascade,
  -- null = added manually by a tournament admin (walk-in entry).
  user_id uuid references auth.users(id) on delete set null,
  name text not null check (char_length(name) between 1 and 60),
  members jsonb check (members is null or jsonb_typeof(members) = 'array'),
  seed integer check (seed is null or seed >= 1),
  created_at timestamptz not null default now()
);
create index weston_participants_tournament_idx on public.weston_participants(tournament_id, created_at);
create unique index weston_participants_self_join_idx on public.weston_participants(tournament_id, user_id)
  where user_id is not null;

create table public.weston_matches (
  id uuid primary key,
  tournament_id uuid not null references public.weston_tournaments(id) on delete cascade,
  round integer not null check (round >= 1),
  match_no integer not null check (match_no >= 1),
  round_label text not null default 'รอบ 1' check (char_length(round_label) between 1 and 40),
  slot_a uuid references public.weston_participants(id) on delete set null,
  slot_b uuid references public.weston_participants(id) on delete set null,
  score_a integer check (score_a is null or score_a between 0 and 9999),
  score_b integer check (score_b is null or score_b between 0 and 9999),
  winner_id uuid references public.weston_participants(id) on delete set null,
  -- single elimination: winner of this match feeds this slot of the next match.
  next_match_id uuid references public.weston_matches(id) on delete set null,
  next_slot smallint check (next_slot in (1,2)),
  status text not null default 'pending' check (status in ('pending','ready','completed','bye')),
  scheduled_at timestamptz,
  completed_at timestamptz,
  check ((score_a is null) = (score_b is null)),
  check (status <> 'completed' or score_a is not null),
  check (winner_id is null or winner_id = slot_a or winner_id = slot_b),
  check (winner_id is null or score_a is distinct from score_b),
  unique (tournament_id, round, match_no)
);
create index weston_matches_tournament_idx on public.weston_matches(tournament_id, round, match_no);

-- Tournament managers: seeded with the creator, joined via the 6-digit admin code RPC.
create table public.weston_tournament_admins (
  tournament_id uuid not null references public.weston_tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (tournament_id, user_id)
);

alter table public.weston_tournaments enable row level security;
alter table public.weston_participants enable row level security;
alter table public.weston_matches enable row level security;
alter table public.weston_tournament_admins enable row level security;

revoke all on public.weston_tournaments, public.weston_participants,
  public.weston_matches, public.weston_tournament_admins from anon, authenticated;
grant select on public.weston_tournaments, public.weston_participants, public.weston_matches
  to anon, authenticated;
-- RLS on weston_tournament_admins only exposes the caller's own rows.
grant select on public.weston_tournament_admins to authenticated;
grant update on public.weston_tournaments to authenticated;
grant insert, update, delete on public.weston_participants to authenticated;
grant insert, update, delete on public.weston_matches to authenticated;

create function weston_private.is_tournament_admin(tid uuid) returns boolean
language sql security definer set search_path = '' as $$
  select exists (
    select 1 from public.weston_tournament_admins
    where tournament_id = tid and user_id = auth.uid()
  );
$$;
grant execute on function weston_private.is_tournament_admin(uuid) to authenticated;

create policy weston_tournaments_read on public.weston_tournaments
  for select to anon, authenticated using (true);
create policy weston_tournaments_admin_update on public.weston_tournaments
  for update to authenticated
  using ((select weston_private.is_tournament_admin(id)))
  with check ((select weston_private.is_tournament_admin(id)));

create policy weston_participants_read on public.weston_participants
  for select to anon, authenticated using (true);
create policy weston_participants_insert on public.weston_participants
  for insert to authenticated with check (
    (select weston_private.is_tournament_admin(tournament_id))
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.weston_tournaments t
        where t.id = tournament_id and t.status = 'registering'
          and (t.max_participants is null or t.max_participants > (
            select count(*) from public.weston_participants p where p.tournament_id = tournament_id
          ))
      )
    )
  );
create policy weston_participants_update on public.weston_participants
  for update to authenticated
  using ((select weston_private.is_tournament_admin(tournament_id)) or user_id = (select auth.uid()))
  with check ((select weston_private.is_tournament_admin(tournament_id)) or user_id = (select auth.uid()));
create policy weston_participants_delete on public.weston_participants
  for delete to authenticated using (
    (select weston_private.is_tournament_admin(tournament_id))
    or (
      user_id = (select auth.uid())
      and exists (
        select 1 from public.weston_tournaments t
        where t.id = tournament_id and t.status = 'registering'
      )
    )
  );

create policy weston_matches_read on public.weston_matches
  for select to anon, authenticated using (true);
create policy weston_matches_admin_insert on public.weston_matches
  for insert to authenticated
  with check ((select weston_private.is_tournament_admin(tournament_id)));
create policy weston_matches_admin_update on public.weston_matches
  for update to authenticated
  using ((select weston_private.is_tournament_admin(tournament_id)))
  with check ((select weston_private.is_tournament_admin(tournament_id)));
create policy weston_matches_admin_delete on public.weston_matches
  for delete to authenticated
  using ((select weston_private.is_tournament_admin(tournament_id)));

create policy weston_admins_own_read on public.weston_tournament_admins
  for select to authenticated using (user_id = (select auth.uid()));

-- The admin code is only ever stored as sha256(id || ':' || code); the hash itself
-- is public but cannot be reversed into the code. These RPCs must live in `public`
-- because PostgREST only serves the public/storage schemas to browsers.
create function public.create_tournament(payload jsonb, admin_code text) returns uuid
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

create function public.claim_tournament_admin(tid uuid, admin_code text) returns boolean
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

-- Live score updates in open tournaments, same channel pattern as live running.
do $$
begin
  alter publication supabase_realtime add table public.weston_tournaments;
  alter publication supabase_realtime add table public.weston_participants;
  alter publication supabase_realtime add table public.weston_matches;
exception when duplicate_object then null;
end $$;

comment on table public.weston_tournaments is
  'Sports tournaments (custom sport, single/team, bracket or league). Public read; admin writes via weston_tournament_admins.';
commit;
