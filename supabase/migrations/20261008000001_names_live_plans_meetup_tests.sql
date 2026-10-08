-- 2026-10-08, follow-up to 20261008000000_meetup_plans.sql:
-- 1. First and last name, shown to others as "Maria S."
-- 2. Meetup plans update live in an open chat
-- 3. Test tools for meetups (admins and test accounts only)

-- ------------------------------------------------------------------
-- 1. Names
-- ------------------------------------------------------------------
-- People now enter a first and a last name. Everyone else only ever sees
-- the first name and last initial, which stays in display_name (every view
-- and screen already reads display_name). The full last name is private:
-- profiles' own select policy is the person's own row only, and no view
-- exposes last_name.
alter table public.profiles add column if not exists first_name text;
alter table public.profiles add column if not exists last_name text;

create or replace function public.profiles_set_display_name()
returns trigger
language plpgsql
as $$
begin
  if nullif(btrim(coalesce(new.first_name, '')), '') is not null then
    new.first_name := btrim(new.first_name);
    new.last_name := nullif(btrim(coalesce(new.last_name, '')), '');
    new.display_name := new.first_name
      || case when new.last_name is not null then ' ' || upper(left(new.last_name, 1)) || '.' else '' end;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_set_display_name on public.profiles;
create trigger profiles_set_display_name
  before insert or update on public.profiles
  for each row execute function public.profiles_set_display_name();

-- Existing people: split the name they entered ("David Chen" becomes
-- first "David", last "Chen", shown as "David C."). A single name stays
-- as it is.
update public.profiles
set first_name = split_part(btrim(display_name), ' ', 1),
    last_name = nullif(btrim(substr(btrim(display_name), length(split_part(btrim(display_name), ' ', 1)) + 1)), '')
where first_name is null and nullif(btrim(coalesce(display_name, '')), '') is not null;

-- ------------------------------------------------------------------
-- 2. Live plan updates
-- ------------------------------------------------------------------
-- Lets an open chat hear when the other person proposes, confirms,
-- changes or cancels a plan. Row security still applies: each person only
-- hears about meetups in their own chats.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'meetups'
  ) then
    alter publication supabase_realtime add table public.meetups;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 3. Meetup test tools
-- ------------------------------------------------------------------
-- Moves a chat's meetup in time so each prompt can be checked without
-- waiting a day. Only for admins and the 9 test accounts, and only on a
-- chat the caller is part of.
--   tomorrow  the plan becomes tomorrow, so "Still on?" shows
--   today     the plan becomes today, 2 hours from now, so the
--             morning-of card shows
--   happened  the plan becomes yesterday and "Did you meet?" is asked now
--   past      adds a meetup you both confirmed to the history
-- With no plan in the chat, a test plan is created first.
create or replace function public.dev_meetup_test(p_connection_id uuid, p_action text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_caller uuid := auth.uid();
  v_conn public.connections%rowtype;
  v_other uuid;
  v_m public.meetups%rowtype;
  v_tz text := 'America/Los_Angeles';
  v_local timestamp;
  v_today date;
  v_start time;
  v_date date;
  v_id uuid;
  v_created boolean := false;
  v_result text;
begin
  if v_caller is null then raise exception 'Not signed in'; end if;
  if not exists (select 1 from public.users where id = v_caller and is_admin)
     and not exists (
       select 1 from auth.users
       where id = v_caller
         and ltrim(coalesce(phone, ''), '+') in (
           '15555500101','15555500102','15555500103','15555500104','15555500105',
           '15555500106','15555500107','15555500108','15555500109')) then
    raise exception 'Test tools are only for admins and test accounts';
  end if;

  select * into v_conn from public.connections
  where id = p_connection_id and (user_a_id = v_caller or user_b_id = v_caller);
  if not found then raise exception 'You are not part of that chat'; end if;
  v_other := case when v_conn.user_a_id = v_caller then v_conn.user_b_id else v_conn.user_a_id end;

  if p_action = 'past' then
    v_date := (now() at time zone v_tz)::date - 7 * (coalesce(v_conn.meetup_count, 0) + 1);
    insert into public.meetups (connection_id, proposed_date, proposed_by, confirmed_date, confirmed_at, confirmed_by, time_zone, place, activity)
    values (p_connection_id, v_date, v_caller, v_date, now(), v_other, v_tz, 'Test meetup', 'Coffee')
    returning id into v_id;
    update public.meetups set plan_root_id = v_id, status = 'confirmed' where id = v_id;
    update public.meetups set status = 'occurred', occurred_date = v_date, date_status = 'confirmed' where id = v_id;
    perform public.record_friendship_event(p_connection_id, 'meetup_occurred', null,
      jsonb_build_object('meetup_id', v_id, 'test', true));
    return format('Added a meetup on %s to the history. Open the chat and tap "See history".', to_char(v_date, 'Mon DD'));
  end if;

  if p_action not in ('tomorrow', 'today', 'happened') then
    raise exception 'Unknown test';
  end if;

  select * into v_m from public.meetups
  where connection_id = p_connection_id and status in ('proposed','confirmed')
  order by created_at desc, id desc limit 1;

  if not found then
    insert into public.meetups (connection_id, proposed_date, proposed_by, time_zone, start_time, place, activity)
    values (p_connection_id, (now() at time zone v_tz)::date + 1, v_caller, v_tz, time '18:00', 'Test cafe', 'Coffee')
    returning * into v_m;
    update public.meetups set plan_root_id = v_m.id where id = v_m.id;
    v_created := true;
  end if;

  v_tz := public.meetup_tz(v_m.time_zone);
  v_local := now() at time zone v_tz;
  v_today := v_local::date;

  if p_action = 'tomorrow' then
    update public.meetups
    set status = 'confirmed', proposed_date = v_today + 1, confirmed_date = v_today + 1,
        confirmed_at = now() - interval '7 hours', confirmed_by = coalesce(confirmed_by, v_other)
    where id = v_m.id;
    delete from public.meetup_prompt_responses where meetup_id = v_m.id and prompt = 'still_on';
    v_result := 'The meetup is now tomorrow. Open the chat (as either person) to see "Still on?".';

  elsif p_action = 'today' then
    if v_local::time < time '05:00' then
      raise exception 'The morning-of card shows from 5am. Try again later today.';
    end if;
    if v_local::time >= time '23:00' then
      raise exception 'It is too late in the day to test this. Try again tomorrow morning.';
    end if;
    v_start := least((date_trunc('hour', v_local) + interval '2 hours')::time, time '23:55');
    update public.meetups
    set status = 'confirmed', proposed_date = v_today, confirmed_date = v_today, start_time = v_start,
        confirmed_at = now() - interval '1 day', confirmed_by = coalesce(confirmed_by, v_other)
    where id = v_m.id;
    delete from public.meetup_prompt_responses where meetup_id = v_m.id and prompt in ('still_on', 'feeling');
    v_result := format('The meetup is now today at %s. Open the chat to see the morning-of card.', to_char(v_start, 'HH12:MI AM'));

  else -- happened
    if not public.is_connection_automation_eligible(v_conn.status) then
      raise exception 'This chat is %, so "Did you meet?" is not asked here.', v_conn.status;
    end if;
    update public.meetups
    set status = 'confirmed', proposed_date = v_today - 1, confirmed_date = v_today - 1,
        confirmed_at = coalesce(confirmed_at, now() - interval '2 days'), confirmed_by = coalesce(confirmed_by, v_other)
    where id = v_m.id;
    delete from public.meetup_occurrence_reports where meetup_id = v_m.id;
    delete from public.connection_interventions
    where connection_id = p_connection_id and intervention_type = 'meetup_occurrence_check' and status = 'pending';
    perform public.run_meetup_occurrence_check_v2(p_connection_id, now() + interval '1 day');
    v_result := 'The meetup is now yesterday. Open the chat (as either person) to see "Did you meet?".';
  end if;

  if v_created then
    v_result := 'No plan in this chat, so a test plan was made. ' || v_result;
  end if;
  return v_result;
end;
$$;

grant execute on function public.dev_meetup_test(uuid, text) to authenticated;
