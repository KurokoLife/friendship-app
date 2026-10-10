-- 2026-10-10: "Did you meet?" answers that never fail quietly, and free
-- notes with topics in Remember (docs/DECISIONS.md section 9).
-- Safe to run twice.
--
--   A. report_meetup_occurrence: tapping "Yes, we met" / "No, that's not
--      right" (or Yes / No) showed "That didn't go through" in some chats.
--      The function stopped with an error whenever the card was older than
--      the meetup behind it (the meetup was already counted, let go,
--      removed, or its date moved by a test tool), and it compared dates
--      in UTC only. Now:
--        - a card whose meetup is no longer waiting for an answer is simply
--          put away (returns resolved, status 'stale') instead of failing;
--        - "has the day passed" uses the meetup's own time zone as well as
--          the server's date, whichever is later;
--        - errors that can still happen carry a short code the app turns
--          into plain words.
--   B. remember_entries.topics: optional topic chips on free notes, from a
--      fixed list only (family, work, loves, going_through, ideas). No
--      custom tags. Own-row RLS is unchanged.
--   C. limen_db_version() -> 20261010000004.

-- ---------------------------------------------------------------------
-- A. "Did you meet?" answers
-- ---------------------------------------------------------------------

create or replace function public.report_meetup_occurrence(
  p_meetup_id uuid, p_reported_yes boolean, p_reported_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_meetup record;
  v_other_id uuid;
  v_my_report record;
  v_other_report record;
  v_other_found boolean;
  v_today date;
begin
  if v_caller is null then raise exception 'not_signed_in'; end if;

  select m.*, c.user_a_id, c.user_b_id into v_meetup
  from public.meetups m join public.connections c on c.id = m.connection_id
  where m.id = p_meetup_id;

  -- The meetup behind this card is gone: put the card away.
  if not found then
    update public.connection_interventions
    set status = 'resolved', resolved_at = now()
    where target_user_id = v_caller and intervention_type = 'meetup_occurrence_check'
      and status = 'pending' and payload->>'meetup_id' = p_meetup_id::text;
    return jsonb_build_object('resolved', true, 'status', 'stale');
  end if;

  if v_meetup.user_a_id <> v_caller and v_meetup.user_b_id <> v_caller then
    raise exception 'not_in_chat';
  end if;

  -- Already counted, let go, or cancelled: nothing left to answer.
  if v_meetup.status not in ('confirmed', 'unresolved') then
    update public.connection_interventions
    set status = 'resolved', resolved_at = now()
    where target_user_id = v_caller and intervention_type = 'meetup_occurrence_check'
      and status = 'pending' and payload->>'meetup_id' = p_meetup_id::text;
    return jsonb_build_object('resolved', true, 'status', 'stale');
  end if;

  v_today := greatest(current_date, (now() at time zone public.meetup_tz(v_meetup.time_zone))::date);
  if v_meetup.confirmed_date is null or v_meetup.confirmed_date > v_today then
    raise exception 'not_yet';
  end if;
  if p_reported_yes and p_reported_date is not null and p_reported_date > v_today then
    raise exception 'not_yet';
  end if;

  v_other_id := case when v_meetup.user_a_id = v_caller then v_meetup.user_b_id else v_meetup.user_a_id end;

  insert into public.meetup_occurrence_reports (meetup_id, reporter_id, reported_yes, reported_date)
  values (p_meetup_id, v_caller, p_reported_yes, case when p_reported_yes then p_reported_date else null end)
  on conflict (meetup_id, reporter_id)
  do update set reported_yes = excluded.reported_yes, reported_date = excluded.reported_date, created_at = now();

  update public.connection_interventions
  set status = 'resolved', resolved_at = now()
  where connection_id = v_meetup.connection_id and target_user_id = v_caller
    and intervention_type = 'meetup_occurrence_check' and status = 'pending';

  select * into v_other_report from public.meetup_occurrence_reports
  where meetup_id = p_meetup_id and reporter_id = v_other_id;
  v_other_found := found;

  if not v_other_found then
    return jsonb_build_object('resolved', false, 'waiting_on_other', true);
  end if;

  select * into v_my_report from public.meetup_occurrence_reports
  where meetup_id = p_meetup_id and reporter_id = v_caller;

  if v_my_report.reported_yes and v_other_report.reported_yes then
    if v_my_report.reported_date is not distinct from v_other_report.reported_date then
      update public.meetups
      set status = 'occurred', date_status = 'confirmed',
          occurred_date = coalesce(v_my_report.reported_date, v_meetup.confirmed_date)
      where id = p_meetup_id;
    else
      update public.meetups
      set status = 'occurred', date_status = 'disputed', occurred_date = null
      where id = p_meetup_id;
    end if;

    perform public.record_friendship_event(v_meetup.connection_id, 'meetup_occurred', null,
      jsonb_build_object('meetup_id', p_meetup_id, 'sequence_number', v_meetup.sequence_number));

    perform public.raise_intervention(v_meetup.connection_id, 'post_meetup_reflection', v_meetup.user_a_id,
      jsonb_build_object('meetup_id', p_meetup_id));
    perform public.raise_intervention(v_meetup.connection_id, 'post_meetup_reflection', v_meetup.user_b_id,
      jsonb_build_object('meetup_id', p_meetup_id));

    return jsonb_build_object('resolved', true, 'status', 'occurred');

  elsif not v_my_report.reported_yes and not v_other_report.reported_yes then
    update public.meetups set status = 'not_occurred' where id = p_meetup_id;
    perform public.record_friendship_event(v_meetup.connection_id, 'meetup_not_occurred', null,
      jsonb_build_object('meetup_id', p_meetup_id));
    return jsonb_build_object('resolved', true, 'status', 'not_occurred');

  else
    update public.meetups set status = 'unresolved' where id = p_meetup_id;
    perform public.record_friendship_event(v_meetup.connection_id, 'meetup_occurrence_unresolved', null,
      jsonb_build_object('meetup_id', p_meetup_id));
    return jsonb_build_object('resolved', true, 'status', 'unresolved');
  end if;
end;
$$;

grant execute on function public.report_meetup_occurrence(uuid, boolean, date) to authenticated;

-- ---------------------------------------------------------------------
-- B. Topics on free notes (fixed list, no custom tags)
-- ---------------------------------------------------------------------

alter table public.remember_entries
  add column if not exists topics text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'remember_entries_topics_fixed') then
    alter table public.remember_entries add constraint remember_entries_topics_fixed check (
      topics <@ array['family', 'work', 'loves', 'going_through', 'ideas']::text[]
    );
  end if;
end $$;

-- ---------------------------------------------------------------------
-- C. Version
-- ---------------------------------------------------------------------

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261010000004'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
