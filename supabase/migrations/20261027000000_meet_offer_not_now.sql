-- 2026-10-27: founder decision on the stage 2 drafts. The Your circle card
-- "Meet someone new, too?": "Not now" brings it back about 30 days later;
-- after the third "Not now" it never shows again. Setting up a profile also
-- ends it (the card only shows without Meet someone new). Safe to run twice.
-- limen_db_version() -> 20261027000000.

alter table public.joining_answers add column if not exists meet_offer_not_now_count integer not null default 0;
alter table public.joining_answers add column if not exists meet_offer_back_at timestamptz;

-- Stage 2 (20261026000001) treated "Not now" as for good. Anyone who tapped
-- it since then counts as one "Not now": the card comes back 30 days after.
update public.joining_answers
set meet_offer_not_now_count = 1,
    meet_offer_back_at = meet_offer_hidden_at + interval '30 days',
    meet_offer_hidden_at = null
where meet_offer_hidden_at is not null and meet_offer_not_now_count = 0;

-- "Not now" on the card, for the caller only (runs with their own rights, so
-- the own-row rules on joining_answers apply). Returns 'later' (back in about
-- 30 days) or 'never' (the third time).
create or replace function public.meet_offer_not_now()
returns text
language plpgsql
as $$
declare
  v_me uuid := auth.uid();
  v_count integer;
begin
  if v_me is null then raise exception 'Not authenticated'; end if;
  insert into public.joining_answers (user_id) values (v_me) on conflict (user_id) do nothing;
  update public.joining_answers
  set meet_offer_not_now_count = meet_offer_not_now_count + 1,
      updated_at = now()
  where user_id = v_me
  returning meet_offer_not_now_count into v_count;
  if v_count >= 3 then
    update public.joining_answers set meet_offer_hidden_at = now(), meet_offer_back_at = null where user_id = v_me;
    return 'never';
  end if;
  update public.joining_answers set meet_offer_back_at = now() + interval '30 days' where user_id = v_me;
  return 'later';
end;
$$;
revoke all on function public.meet_offer_not_now() from public, anon;
grant execute on function public.meet_offer_not_now() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261027000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
