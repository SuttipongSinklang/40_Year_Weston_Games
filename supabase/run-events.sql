ALTER TABLE public.weston_runs ADD COLUMN IF NOT EXISTS events jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.weston_runs ADD CONSTRAINT weston_runs_events_bound CHECK (jsonb_typeof(events)='array' AND jsonb_array_length(events)<=20000 AND octet_length(events::text)<=2097152);
