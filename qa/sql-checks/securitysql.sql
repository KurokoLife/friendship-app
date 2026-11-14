-- 2026-11-13: Security checks (migration 20261113000000).
-- Each attempt below is something a person could try from a browser.
-- Every result line should end in "true". Nothing is kept (rolls back).
\set ON_ERROR_STOP 0
\set A '10000000-0000-0000-0000-000000000001'
\set V '10000000-0000-0000-0000-000000000007'
begin;
delete from connections where (user_a_id = :'A' and user_b_id = :'V') or (user_a_id = :'V' and user_b_id = :'A');
update public.users set is_premium = false, premium_until = null, ai_credits = 0 where id = :'A';
update public.users set selfie_verified_at = null where id = :'A';

-- 1. A person can't give themselves premium, credits or admin.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
update public.users set is_premium = true, premium_until = now() + interval '1 year', ai_credits = 999,
  is_admin = true, selfie_verified_at = now(), referral_code = 'HACKED' where id = :'A';
reset role;
select 'own premium, credits, admin, selfie flags can''t be edited: ' ||
  (select not is_premium and premium_until is null and ai_credits = 0 and not is_admin
          and selfie_verified_at is null and referral_code is distinct from 'HACKED'
   from public.users where id = :'A') as result;

-- 2. Ordinary settings on your own row still save.
set local role authenticated;
update public.users set readiness_status = 'paused' where id = :'A';
reset role;
select 'ordinary settings still save: ' || ((select readiness_status from public.users where id = :'A') = 'paused') as result;
update public.users set readiness_status = 'ready' where id = :'A';

-- 3. A normal account can't pass as a test account.
insert into auth.users (id, phone) values ('20000000-0000-0000-0000-000000000001', '+14155550199');
select set_config('request.jwt.claims', '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into public.users (id, phone, is_premium, ai_credits) values (auth.uid(), '+15555500101', true, 50);
update public.users set phone = '+15555500102' where id = auth.uid();
savepoint s1;
select public.dev_mark_selfie_verified(true);
rollback to savepoint s1;
reset role;
select 'phone on the account comes from sign-in, not from the app: ' ||
  ((select phone from public.users where id = '20000000-0000-0000-0000-000000000001') = '+14155550199') as result;
select 'a new account starts without premium or credits: ' ||
  (select not is_premium and ai_credits = 0 from public.users where id = '20000000-0000-0000-0000-000000000001') as result;
select 'a normal account can''t mark its own selfie as checked: ' ||
  ((select selfie_verified_at from public.users where id = '20000000-0000-0000-0000-000000000001') is null) as result;

-- 4. Nobody can open a chat with someone by writing the row themselves.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
savepoint s2;
insert into connections (user_a_id, user_b_id, status, meetup_count) values (:'A', :'V', 'active', 50);
rollback to savepoint s2;
reset role;
select 'an open chat can''t be created directly: ' ||
  ((select count(*) from connections where user_a_id = :'A' and user_b_id = :'V') = 0) as result;

-- "Not now" on someone Limen may show still works, and starts clean.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select user_id as shown from browse_profiles limit 1 \gset
insert into connections (user_a_id, user_b_id, status, meetup_count, friendship_stage)
  values (:'A', :'shown', 'passed', 9, 'graduation_eligible')
  on conflict (user_a_id, user_b_id) do update set status = excluded.status;
reset role;
select '"Not now" still works: ' ||
  ((select status from connections where user_a_id = :'A' and user_b_id = :'shown') = 'passed') as result;

-- A blocked or ended chat can't be switched back on by the person who started it.
insert into connections (id, user_a_id, user_b_id, status, meetup_count)
  values ('aaaaaaaa-0000-0000-0000-00000000000b', :'A', :'V', 'blocked', 0);
set local role authenticated;
update connections set status = 'active', meetup_count = 12 where id = 'aaaaaaaa-0000-0000-0000-00000000000b';
update connections set saved = true where id = 'aaaaaaaa-0000-0000-0000-00000000000b';
reset role;
select 'a blocked chat stays blocked, meetup count can''t be edited: ' ||
  (select status = 'blocked' and meetup_count = 0 from connections where id = 'aaaaaaaa-0000-0000-0000-00000000000b') as result;
select 'saving still works: ' || (select saved from connections where id = 'aaaaaaaa-0000-0000-0000-00000000000b') as result;

-- 5. A message can't be rewritten by the person who received it.
update connections set status = 'active' where id = 'aaaaaaaa-0000-0000-0000-00000000000b';
insert into messages (id, connection_id, sender_id, content)
  values ('bbbbbbbb-0000-0000-0000-00000000000b', 'aaaaaaaa-0000-0000-0000-00000000000b', :'V', 'See you Saturday');
set local role authenticated;
savepoint s3;
update messages set content = 'changed' where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
rollback to savepoint s3;
update messages set read_at = now() where id = 'bbbbbbbb-0000-0000-0000-00000000000b';
reset role;
select 'a received message can''t be rewritten: ' ||
  ((select content from messages where id = 'bbbbbbbb-0000-0000-0000-00000000000b') = 'See you Saturday') as result;
select 'marking it read still works: ' ||
  ((select read_at from messages where id = 'bbbbbbbb-0000-0000-0000-00000000000b') is not null) as result;

-- 6. Usage limits can be read, not changed.
set local role authenticated;
savepoint s4;
update ai_function_caps set free_limit = 100000;
rollback to savepoint s4;
reset role;
select 'usage limits can''t be changed: ' || ((select max(free_limit) from ai_function_caps) < 100000) as result;

-- 7. Internal functions: not for members, and nothing at all for signed-out visitors.
select 'a member can''t run payment credits or background jobs: ' || (
  not has_function_privilege('authenticated', 'public.credit_ai_purchase(uuid, integer, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.grant_premium_days(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.run_pause_auto_resume_sweep(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.batch_refresh_eligible_users(integer)', 'execute')) as result;
select 'the server can still run them: ' ||
  has_function_privilege('service_role', 'public.credit_ai_purchase(uuid, integer, text)', 'execute') as result;
select 'a signed-out visitor can run nothing but the version check: ' || (
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname <> 'limen_db_version' and has_function_privilege('anon', p.oid, 'execute')) = 0) as result;

-- Guard for future changes: every full-power function a member can run must
-- check who is calling (auth.uid(), is_test_operator(), or the planning
-- helper _plan_my_open_board()), except the four yes/no helpers the message
-- rules use and the one the inbox view uses.
select 'every member-callable full-power function checks the caller: ' || (
  (select count(*) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.prosecdef
     and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.prosrc !~* 'auth\.uid\(\)' and p.prosrc !~* 'is_test_operator\(\)' and p.prosrc !~* '_plan_my_open_board\('
     and p.proname not in ('connection_has_mutual_interest', 'selfie_check_done',
                           'connection_has_any_message', 'is_user_active',
                           'mutual_interest_exists')) = 0) as result;

-- A view's functions run with the reader's own permissions, so every function
-- a view uses must stay open to members (or the list breaks for them).
select 'every function used by a view can be run by members: ' || (
  (select count(*) from pg_proc p join pg_views v
     on v.schemaname = 'public' and v.definition ~ ('\m' || p.proname || '\(')
   where p.pronamespace = 'public'::regnamespace
     and not has_function_privilege('authenticated', p.oid, 'execute')) = 0) as result;

-- 8. Other people's map coordinates aren't sent to members.
select 'coordinates of other people are hidden: ' || (
  not has_column_privilege('authenticated', 'public.browse_profiles', 'location_lat', 'select')
  and not has_column_privilege('authenticated', 'public.discovery_profiles', 'location_lng', 'select')
  and not has_column_privilege('authenticated', 'public.connected_profiles', 'location_lat', 'select')
  and has_column_privilege('authenticated', 'public.discovery_profiles', 'distance_miles', 'select')) as result;

-- 9. Every table has row level security on.
select 'every table is protected: ' || (
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity) = 0) as result;
rollback;
