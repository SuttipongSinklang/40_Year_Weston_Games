alter table public.weston_runs
  add column distance_source text not null default 'gps' check (distance_source in ('gps','manual','phone_steps')),
  add column steps integer not null default 0 check (steps between 0 and 1000000),
  add column stride_m double precision check (stride_m between 0.3 and 2);
update public.weston_runs set distance_source='manual' where activity='treadmill';
alter table public.weston_runs add constraint run_measurement_source check (
  (activity='outdoor' and distance_source='gps' and steps=0 and stride_m is null)
  or (activity='treadmill' and distance_source='manual' and steps=0 and stride_m is null)
  or (activity='treadmill' and distance_source='phone_steps' and stride_m is not null
      and abs(distance_m - steps * stride_m) <= 0.001)
);
comment on column public.weston_runs.distance_source is 'GPS, manually entered console distance, or estimated steps times configured stride. Phone estimates are not console measurements.';
