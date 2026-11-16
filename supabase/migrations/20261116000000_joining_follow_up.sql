-- 2026-11-16: Copy update for built screens (docs/context/02_PLAN_AND_STATUS.md).
-- 1. One new column so the joining follow-up lines show once in Your circle:
--   "Not sure people want to hear from me" -> "If a friend got in touch with
--   you, would you mind?"
--   "I'm usually the one who reaches out" -> "If it matters to you, keep
--   reaching out. You could also ask them how they like to keep in touch."
-- The card shows from the day after the person answered What's hardest, and
-- never again after "Got it". The row is the person's own (the existing
-- own-row rules on joining_answers apply); nobody else can read it.
-- 2. The support suggestion's notification line asks instead of guessing.
-- Safe to run twice. Run 20261113000001_test_tools_and_place_limit.sql first.

do $$
begin
  if public.limen_db_version() < '20261113000001' then
    raise exception 'Run 20261113000001_test_tools_and_place_limit.sql first, then run this file again.';
  end if;
end $$;

alter table public.joining_answers add column if not exists follow_up_seen_at timestamptz;

-- The support suggestion's notification asks instead of guessing, in step
-- with the card ("... Want to ask how it's going?"). Notes are never quoted
-- in a notification. Same function as 20261028000001, one line changed.
create or replace function public._suggestion_notify_line(p_kind text, p_name text)
returns text
language sql
immutable
as $$
  select case p_kind
    when 'interest' then 'You wanted to ask ' || p_name || ' something.'
    when 'support' then 'Want to ask ' || p_name || ' how it''s going?'
    when 'positivity' then 'Anything ' || p_name || ' did lately that you''d tell them was good?'
    when 'openness' then 'Anything going on with you that ' || p_name || ' doesn''t know yet?'
    when 'time_together' then 'When did you and ' || p_name || ' last get together?'
    when 'pattern' then 'A short question about your check-ins.'
    else 'You and ' || p_name || ' haven''t been in touch for a while.'
  end;
$$;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261116000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
