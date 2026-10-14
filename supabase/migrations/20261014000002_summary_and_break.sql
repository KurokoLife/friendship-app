-- 2026-10-14: saved connection summary, and taking a break from Discover.
-- Safe to run twice.
--
-- 1. profiles.connection_summary: the short summary written from the
--    "How you connect" answers is saved once (it used to be rewritten from
--    scratch, differently, every time it was opened, and was refused after
--    one view a day). Retaking the questions replaces it. Private: only the
--    person's own row can read it (profiles is own-row; the public views
--    never include this column).
-- 2. Take a break: users.paused_until (already used to hide people from
--    Discover) can now be set from Settings. While on a break: you are not
--    shown to anyone new, and nobody new is added to your Discover. Chats,
--    Pending and Saved carry on as normal. Ends on its own, or anytime.
-- limen_db_version() -> 20261014000002.

alter table public.profiles add column if not exists connection_summary jsonb;

create or replace function public.set_my_break(p_days integer)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_until timestamptz;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  if p_days is null or p_days <= 0 then
    update public.users set paused_until = null where id = auth.uid();
    return null;
  end if;
  if p_days not in (7, 14, 30) then raise exception 'bad_length'; end if;
  v_until := now() + make_interval(days => p_days);
  update public.users set paused_until = v_until where id = auth.uid();
  return v_until;
end;
$$;
grant execute on function public.set_my_break(integer) to authenticated;

create or replace function public.my_break_until()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when paused_until > now() then paused_until end from public.users where id = auth.uid();
$$;
grant execute on function public.my_break_until() to authenticated;

create or replace function public.discover_can_add(p_user uuid, p_tz text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.has_room(p_user)
     and not exists (select 1 from public.users u where u.id = p_user and u.paused_until > now())
     and not exists (
       select 1 from public.match_suggestions s
       where s.user_id = p_user
         and s.created_at >= (date_trunc('day', now() at time zone public._safe_tz(p_tz)) at time zone public._safe_tz(p_tz))
     );
$$;

revoke execute on function public.discover_can_add(uuid, text) from public, anon, authenticated;

create or replace function public.get_discover(p_tz text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_user uuid := auth.uid();
  v_tz text := public._safe_tz(p_tz);
  v_items jsonb;
begin
  if v_user is null then return jsonb_build_object('full', false, 'can_add', false, 'items', '[]'::jsonb); end if;
  -- Taking a break (2026-10-14): nobody new, and the screen says until when.
  if exists (select 1 from public.users where id = v_user and paused_until > now()) then
    return jsonb_build_object('full', false, 'can_add', false, 'items', '[]'::jsonb,
      'on_break_until', (select paused_until from public.users where id = v_user));
  end if;
  if not public.has_room(v_user) then
    return jsonb_build_object('full', true, 'can_add', false, 'items', '[]'::jsonb);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'candidate_id', o.candidate_id, 'reasoning', o.reasoning,
           'human_detail', o.human_detail, 'created_at', o.created_at)
           order by o.created_at desc), '[]'::jsonb)
    into v_items
  from public.discover_open_suggestions(v_user) o;
  return jsonb_build_object(
    'full', false,
    'can_add', public.discover_can_add(v_user, v_tz),
    'items', v_items,
    'next_at', (date_trunc('day', now() at time zone v_tz) + interval '1 day') at time zone v_tz
  );
end;
$$;

grant execute on function public.get_discover(text) to authenticated;

-- Reset all test accounts also ends a test account's break.
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
  -- 2026-10-14: and end any break from Discover.
  update public.users set paused_until = null where public._is_seed_account(id) and paused_until is not null;
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
as $function$ select '20261014000002'::text $function$;
grant execute on function public.limen_db_version() to anon, authenticated;
