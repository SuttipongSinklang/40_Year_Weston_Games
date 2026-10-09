alter table public.weston_runs add column activity text not null default 'outdoor'
  check (activity in ('outdoor', 'treadmill'));
alter table public.weston_runs add constraint treadmill_no_gps
  check (activity <> 'treadmill' or (route = '[]'::jsonb and splits = '[]'::jsonb));
comment on column public.weston_runs.activity is 'Outdoor GPS or treadmill with manually entered total distance; no invented GPS/splits.';
