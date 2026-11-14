-- 2026-11-13: Security hardening. No change to how the app looks or works.
-- Safe to run twice. Run 20261028000001_notifications.sql first.
--
-- What it closes (found in the Nov 11 security review):
--  1. Premium, credits and other trusted flags on your own account could be
--     edited from a browser, and the payment-credit functions could be called
--     by anyone, even signed out.
--  2. A person could rewrite the text and time of a message they received.
--  3. A normal account could pass as a test account and skip the selfie check.
--  4. A person could create an open chat row with anyone.
--  5. The usage-limits table had no protection.
--  6. Background jobs and helper functions could be run by anyone.
--  7. Other people's map coordinates were sent to every signed-in member.

do $$
begin
  if public.limen_db_version() < '20261028000001' then
    raise exception 'Run 20261028000001_notifications.sql first, then run this file again.';
  end if;
end $$;

-- 1. Trusted columns on public.users -----------------------------------------
-- Phone and email are always taken from the sign-in system, never from what
-- the app sends. Returns only the caller's own values.
create or replace function public._my_auth_contact()
returns table (phone text, email text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select u.phone::text,
         case when u.email_confirmed_at is not null then nullif(trim(u.email::text), '') end
  from auth.users u
  where u.id = auth.uid();
$$;

create or replace function public.protect_user_safety_columns()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_phone text;
  v_email text;
begin
  -- Only people using the app are limited. Server functions and the SQL
  -- Editor (which run as the database owner) are not.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.selfie_verified_at := null;
      new.is_admin := false;
      new.suspended_at := null;
      new.is_premium := false;
      new.premium_until := null;
      new.ai_credits := 0;
      new.premium_pool_period_start := null;
      new.premium_pool_spent_usd := 0;
      new.verified := false;
      new.referral_code := null;  -- users_set_referral_code fills it in next
      new.referred_by := null;
      new.was_referred_reward_claimed := false;
      new.referred_someone_reward_claimed := false;
      select c.phone, c.email into v_phone, v_email from public._my_auth_contact() c;
      new.phone := v_phone;
      new.email := v_email;
    else
      new.id := old.id;
      new.selfie_verified_at := old.selfie_verified_at;
      new.is_admin := old.is_admin;
      new.suspended_at := old.suspended_at;
      new.is_premium := old.is_premium;
      new.premium_until := old.premium_until;
      new.ai_credits := old.ai_credits;
      new.premium_pool_period_start := old.premium_pool_period_start;
      new.premium_pool_spent_usd := old.premium_pool_spent_usd;
      new.verified := old.verified;
      new.referral_code := old.referral_code;
      new.referred_by := old.referred_by;
      new.was_referred_reward_claimed := old.was_referred_reward_claimed;
      new.referred_someone_reward_claimed := old.referred_someone_reward_claimed;
      if new.phone is distinct from old.phone or new.email is distinct from old.email then
        select c.phone, c.email into v_phone, v_email from public._my_auth_contact() c;
        if new.phone is distinct from old.phone then new.phone := v_phone; end if;
        if new.email is distinct from old.email then new.email := v_email; end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- 3. A test account is decided by the sign-in system's phone number, which a
-- person can't edit, not by the copy on their own row.
create or replace function public._is_seed_account(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from auth.users
    where id = p_user_id
      and ltrim(coalesce(phone::text, ''), '+') in (
        '15555500101', '15555500102', '15555500103', '15555500104', '15555500105',
        '15555500106', '15555500107', '15555500108', '15555500109'
      )
  );
$$;

-- 2. Messages ----------------------------------------------------------------
-- The only thing a reader may change on a message is "read".
revoke update on public.messages from public, anon, authenticated;
grant update (read_at) on public.messages to authenticated;

-- A message sent from the app is always a plain text message, dated now.
create or replace function public.guard_client_message_insert()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if current_user in ('authenticated', 'anon') then
    new.type := 'text';
    new.created_at := now();
    new.read_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_guard_client_insert on public.messages;
create trigger messages_guard_client_insert
  before insert on public.messages
  for each row execute function public.guard_client_message_insert();

-- 4. Connections ---------------------------------------------------------------
-- From the app, a person can only do two things directly: "Not now" on
-- someone Limen may show them, and remove a save. Everything else (opening a
-- chat, pausing, ending, blocking, counting meetups) goes through Limen's
-- own functions, which check the rules.
create or replace function public.guard_client_connection_write()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_exists boolean;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is not null and new.status <> 'passed' then
      raise exception 'not_allowed';
    end if;
    select exists (
      select 1 from public.connections c
      where c.user_a_id = new.user_a_id and c.user_b_id = new.user_b_id
    ) into v_exists;
    -- A brand-new row is only for someone Limen may show this person
    -- (same rules as the profile lists: gender, ages, distance, breaks, blocks).
    if not v_exists and not exists (
      select 1 from public.browse_profiles b where b.user_id = new.user_b_id
    ) then
      raise exception 'not_allowed';
    end if;
    new.meetup_count := 0;
    new.created_at := now();
    new.updated_at := now();
    new.last_plan_activity_at := null;
    new.next_meetup_date := null;
    new.next_meetup_status := null;
    new.next_meetup_proposed_by := null;
    new.graduated_at := null;
    new.graduation_dismissed_at_count := 0;
    new.graduation_30_day_checked := false;
    new.graduation_90_day_checked := false;
    new.friendship_stage := null;
    new.friendship_stage_changed_at := null;
    new.is_self_sustaining := false;
    new.is_self_sustaining_updated_at := null;
    new.opened_at := now();
    new.resumed_at := null;
    return new;
  end if;

  -- UPDATE: only "saved", and "Not now" on a row that never became a chat.
  if new.status is distinct from old.status
     and not (new.status = 'passed' and old.status is null) then
    new.status := old.status;
  end if;
  new.id := old.id;
  new.user_a_id := old.user_a_id;
  new.user_b_id := old.user_b_id;
  new.meetup_count := old.meetup_count;
  new.created_at := old.created_at;
  new.last_plan_activity_at := old.last_plan_activity_at;
  new.next_meetup_date := old.next_meetup_date;
  new.next_meetup_status := old.next_meetup_status;
  new.next_meetup_proposed_by := old.next_meetup_proposed_by;
  new.graduated_at := old.graduated_at;
  new.graduation_dismissed_at_count := old.graduation_dismissed_at_count;
  new.graduation_30_day_checked := old.graduation_30_day_checked;
  new.graduation_90_day_checked := old.graduation_90_day_checked;
  new.friendship_stage := old.friendship_stage;
  new.friendship_stage_changed_at := old.friendship_stage_changed_at;
  new.is_self_sustaining := old.is_self_sustaining;
  new.is_self_sustaining_updated_at := old.is_self_sustaining_updated_at;
  new.opened_at := old.opened_at;
  new.resumed_at := old.resumed_at;
  return new;
end;
$$;

-- Named to run before connections_set_saved_at (triggers run in name order).
drop trigger if exists connections_guard_client_write on public.connections;
create trigger connections_guard_client_write
  before insert or update on public.connections
  for each row execute function public.guard_client_connection_write();

-- The app never adds suggestion rows itself; the server does.
drop policy if exists "Users can insert their own suggestions" on public.match_suggestions;

-- 5. Usage limits table ----------------------------------------------------------
alter table public.ai_function_caps enable row level security;
revoke all on public.ai_function_caps from public, anon, authenticated;
grant select on public.ai_function_caps to authenticated;
drop policy if exists "Usage limits: read only" on public.ai_function_caps;
create policy "Usage limits: read only" on public.ai_function_caps
  for select to authenticated using (true);

-- 7. Other people's map coordinates stay on the server -----------------------
-- The app only needs the distance, which these lists already work out.
do $$
declare
  v_view text;
  v_cols text;
begin
  foreach v_view in array array['browse_profiles', 'discovery_profiles', 'connected_profiles'] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v_view) then
      select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
      into v_cols
      from information_schema.columns
      where table_schema = 'public' and table_name = v_view
        and column_name not in ('location_lat', 'location_lng');
      execute format('revoke all on public.%I from public, anon, authenticated', v_view);
      execute format('grant select (%s) on public.%I to authenticated', v_cols, v_view);
    end if;
  end loop;
end $$;

-- 6. Functions -----------------------------------------------------------------
-- (a) Nobody who is signed out can run any Limen function.
-- (b) Internal functions (background jobs, payment credits, helpers that trust
--     the ids they are given) can only be run by the server.
--     Not on the list on purpose: the yes/no helpers used by the message rules
--     and mutual_interest_exists (the inbox view new_mutual_connections calls
--     it; a view's functions run with the reader's own permissions).
do $$
declare
  r record;
  v_internal text[] := array[
    '_both_have_written', '_is_seed_account', '_last_meetup', '_meet_anchor', '_notify_name',
    '_paused_between', '_plan_has_upcoming', '_plan_home_hosts', '_plan_shared_count',
    '_plan_shared_time_count', '_plan_touch', '_queue_notification', '_talking_days', '_try_open_pair',
    'advance_friendship_stage', 'batch_refresh_eligible_users', 'check_and_grant_referral_reward_for',
    'check_connection_capacity', 'compatible_candidates_for', 'connection_counts',
    'credit_ai_purchase', 'credit_premium_purchase', 'discover_add', 'discover_can_add',
    'discover_next_candidates', 'discover_open_suggestions', 'evaluate_self_sustaining',
    'evaluate_self_sustaining_all', 'expire_premium_grants', 'first_message_allowed_by_preference',
    'forget_push_token', 'graduation_stage', 'grant_premium_days', 'has_room', 'interest_is_open',
    'is_ghosting_penalized', 'mark_notification_sent',
    'notifications_to_send', 'pair_had_chat', 'pair_had_real_chat', 'pair_is_connected',
    'pair_selfies_ok', 'plan_idea_context',
    'prompt_enabled', 'prune_ineligible_saves', 'queue_suggestion_notifications',
    'raise_intervention', 'raise_intervention_once', 'record_friendship_event',
    'referral_reward_qualifies', 'run_conversation_restart_check_v2',
    'run_conversation_restart_check_v2_all', 'run_curiosity_prompt_check', 'run_day_of_checkin_check',
    'run_follow_up_reflection_check', 'run_follow_up_reflection_check_all',
    'run_friendship_journey_sweep_all', 'run_meetup_checkin_check', 'run_meetup_checkin_check_all',
    'run_meetup_occurrence_check_v2', 'run_meetup_occurrence_check_v2_all', 'run_no_ghost_check',
    'run_no_ghost_check_all', 'run_no_ghost_check_v2', 'run_no_ghost_check_v2_all',
    'run_pause_auto_resume_sweep', 'run_plan_board_check_all', 'run_referral_reward_check_all',
    'run_rhythm_reminder_check', 'run_rhythm_reminder_check_all', 'run_say_hello_check',
    'run_say_hello_check_all', 'save_is_open', 'save_plan_ideas', 'users_have_chatted',
    'wants_to_meet_new'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname,
           has_function_privilege('authenticated', p.oid, 'execute') as authd
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
    if r.proname = any (v_internal) then
      execute format('revoke all on function %s from authenticated', r.sig);
    elsif r.authd then
      -- Keep exactly what signed-in people could already run.
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end $$;

-- New functions from now on: not open to signed-out visitors unless a
-- migration says so.
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public grant execute on functions to authenticated, service_role;

-- The version check also runs before sign-in.
create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261113000000'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
