-- F7/F8: etiquette module completion tracking.
-- Keyed by module id so F8's later modules (3+) don't need a schema
-- change, just another key in this object, e.g. {"module_1": true,
-- "module_2": true, "module_3": true, ...}.
alter table public.users
  add column if not exists etiquette_modules jsonb not null default '{}'::jsonb;
