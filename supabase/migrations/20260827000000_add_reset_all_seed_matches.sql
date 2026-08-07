-- "Reset ALL seed accounts" (Dev tab, __DEV__-only), alongside the
-- existing dev_reset_my_matches (which only ever resets the currently
-- signed-in account). Built because clearing all 9 seed accounts today
-- means signing in as each one individually and tapping the existing
-- button 9 times, real, repeated friction documented across this
-- project's own testing history.
--
-- Investigated first: read dev_reset_my_matches live via
-- pg_get_functiondef before writing this (a plain delete from
-- connections/match_suggestions, nothing else), then queried every real
-- foreign key in this schema referencing connections/meetup_checkins/
-- users via pg_constraint (not assumed from memory) to know precisely
-- what already cascades away when a connections row is deleted versus
-- what genuinely needs its own explicit delete here.
--
-- Confirmed live to CASCADE from connections, so no separate statement
-- is needed for any of these: activity_suggestion_pool,
-- connection_end_reasons, first_meetup_feelings, follow_up_reflections,
-- meetup_checkins (which itself cascades meetup_outcome_dismissals),
-- meetup_confirmation_requests, meetup_log, meetup_suggestion_state,
-- messages, next_meetup_feelings, no_ghost_prompts, remember_entries,
-- rhythm_mismatch_dismissals. Graduation state (graduated_at,
-- graduation_dismissed_at_count, graduation_30/90_day_checked) lives as
-- plain columns on connections itself, so it disappears with the row,
-- no separate handling needed either.
--
-- Confirmed live to need their own explicit clearing, since they don't
-- cascade from a connections delete: match_suggestions (user_id, no FK
-- to connections at all), reports and blocks (both reference
-- auth.users directly, not connections; reports.connection_id is only
-- ON DELETE SET NULL, the report row itself survives otherwise),
-- coach_marks_seen, profiles.friendship_experience, and ai_usage_events.
--
-- Deliberately NOT touched, a real scoping decision, not an oversight:
-- ai_credit_ledger/ai_credit_purchases/ai_pool_ledger (real purchase/
-- spend history, more sensitive than plain match-testing residue, and
-- the Time Travel panel itself never built a reset tool for these
-- either), the premium pool columns and behavioral_tracking_disclosed_at
-- on users (each already has its own dedicated, per-account Time Travel
-- tool, treated as a separate concern from match/connection testing),
-- and onboarding_device_ids/fraud_signals (onboarding/fraud-detection
-- artifacts, unrelated to matching/messaging/meetup testing).
create or replace function public.dev_reset_all_seed_matches()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_seed_ids uuid[];
  v_connections_count integer;
  v_match_suggestions_count integer;
  v_reports_count integer;
  v_blocks_count integer;
  v_coach_marks_count integer;
  v_friendship_experience_count integer;
  v_ai_usage_count integer;
begin
  -- Same authentication bar as dev_reset_my_matches (a real signed-in
  -- session, nothing more), not "caller must specifically be a seed
  -- account": the affected rows are always exactly the 9 known,
  -- fictional seed accounts regardless of who calls this, hardcoded
  -- below, never derived from the caller's own identity, so there's no
  -- meaningful extra risk in the broader check.
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select array_agg(id) into v_seed_ids
  from public.users
  where phone in (
    '+15555500101', '+15555500102', '+15555500103', '+15555500104', '+15555500105',
    '+15555500106', '+15555500107', '+15555500108', '+15555500109'
  );

  if v_seed_ids is null or array_length(v_seed_ids, 1) is null then
    return jsonb_build_object('error', 'No seed accounts found');
  end if;

  with deleted as (
    delete from public.connections
    where user_a_id = any(v_seed_ids) or user_b_id = any(v_seed_ids)
    returning 1
  )
  select count(*) into v_connections_count from deleted;

  with deleted as (
    delete from public.match_suggestions
    where user_id = any(v_seed_ids)
    returning 1
  )
  select count(*) into v_match_suggestions_count from deleted;

  with deleted as (
    delete from public.reports
    where reporter_id = any(v_seed_ids) or reported_id = any(v_seed_ids)
    returning 1
  )
  select count(*) into v_reports_count from deleted;

  with deleted as (
    delete from public.blocks
    where blocker_id = any(v_seed_ids) or blocked_id = any(v_seed_ids)
    returning 1
  )
  select count(*) into v_blocks_count from deleted;

  with deleted as (
    delete from public.coach_marks_seen
    where user_id = any(v_seed_ids)
    returning 1
  )
  select count(*) into v_coach_marks_count from deleted;

  with updated as (
    update public.profiles
    set friendship_experience = null
    where user_id = any(v_seed_ids) and friendship_experience is not null
    returning 1
  )
  select count(*) into v_friendship_experience_count from updated;

  with deleted as (
    delete from public.ai_usage_events
    where user_id = any(v_seed_ids)
    returning 1
  )
  select count(*) into v_ai_usage_count from deleted;

  return jsonb_build_object(
    'seed_accounts', array_length(v_seed_ids, 1),
    'connections_deleted', v_connections_count,
    'match_suggestions_deleted', v_match_suggestions_count,
    'reports_deleted', v_reports_count,
    'blocks_deleted', v_blocks_count,
    'coach_marks_deleted', v_coach_marks_count,
    'friendship_experience_cleared', v_friendship_experience_count,
    'ai_usage_events_deleted', v_ai_usage_count
  );
end;
$$;
