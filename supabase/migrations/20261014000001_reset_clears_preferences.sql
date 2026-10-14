-- 2026-10-14: "Reset all test accounts" also clears each test account's own
-- choices that aren't tied to one chat, so planning starts fresh. Safe to
-- run twice.
--
-- Founder: after a reset, Plan something still showed the old spending,
-- length and travel answers. Those live in plan_prefs (per person, not per
-- chat), so deleting chats didn't touch them. Now also cleared, for test
-- accounts only: plan limits, reminder settings for all chats, curiosity
-- notes, the ghosting rule history and the one-time "notes coming back"
-- asks. Profiles and selfie checks stay as they are.
-- limen_db_version() -> 20261014000001.

create or replace function public.test_reset_all_test_accounts()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_interests integer;
  v_prefs integer;
  v_settings integer;
  v_curiosity integer;
  v_ghosting integer;
  v_asks integer;
begin
  if not public.is_test_operator() then raise exception 'Test tools are only for admins and test accounts'; end if;
  v_result := public.dev_reset_all_seed_matches();
  delete from public.interests
  where public._is_seed_account(from_user_id) or public._is_seed_account(to_user_id);
  get diagnostics v_interests = row_count;
  delete from public.plan_prefs where public._is_seed_account(user_id);
  get diagnostics v_prefs = row_count;
  delete from public.prompt_settings where public._is_seed_account(user_id);
  get diagnostics v_settings = row_count;
  delete from public.curiosity_notes where public._is_seed_account(user_id);
  get diagnostics v_curiosity = row_count;
  delete from public.ghosting_events where public._is_seed_account(user_id);
  get diagnostics v_ghosting = row_count;
  delete from public.remember_asks where public._is_seed_account(user_id);
  get diagnostics v_asks = row_count;
  return v_result || jsonb_build_object(
    'interests_deleted', v_interests,
    'plan_limits_deleted', v_prefs,
    'reminder_settings_deleted', v_settings,
    'curiosity_notes_deleted', v_curiosity,
    'ghosting_history_deleted', v_ghosting,
    'notes_asks_deleted', v_asks);
end;
$$;
grant execute on function public.test_reset_all_test_accounts() to authenticated;

create or replace function public.limen_db_version()
returns text
language sql
stable
as $function$ select '20261014000001'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
