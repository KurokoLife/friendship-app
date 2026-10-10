\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- 2026-10-10: Discover one a day, Interested/Saved 30 days, paused counts toward 3.
begin;
\set A '10000000-0000-0000-0000-000000000003'
\set D '10000000-0000-0000-0000-000000000002'
\set M '10000000-0000-0000-0000-000000000001'
\set R '10000000-0000-0000-0000-000000000004'
\set P '10000000-0000-0000-0000-000000000005'
\set K '10000000-0000-0000-0000-000000000006'
delete from connections; delete from interests; delete from match_suggestions; delete from blocks;
update users set selfie_verified_at = now();
select 'D1 Aisha can get today''s person (t):', discover_can_add(:'A', 'America/Los_Angeles');
select 'D2 David is a candidate for Aisha (t):', exists(select 1 from discover_next_candidates(:'A','America/Los_Angeles') where candidate_id = :'D');
select 'D3 add David (t):', discover_add(:'A', :'D', 'r', null, 'America/Los_Angeles');
select 'D4 second add same day refused (f):', discover_add(:'A', :'M', 'r', null, 'America/Los_Angeles');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select 'D5 Discover shows David, no more today:', jsonb_array_length(get_discover('America/Los_Angeles')->'items'), get_discover('America/Los_Angeles')->>'can_add';
reset role;
-- Three earlier days: only the newest 3 stay
insert into match_suggestions (user_id, candidate_id, reasoning, suggested_date, created_at) values
 (:'A', :'M', 'r', current_date-1, now()-interval '1 day'),
 (:'A', :'R', 'r', current_date-2, now()-interval '2 days'),
 (:'A', :'P', 'r', current_date-3, now()-interval '3 days');
set local role authenticated;
select 'D6 at most 3 waiting (3), oldest let go (Priya gone t):', jsonb_array_length(get_discover('America/Los_Angeles')->'items'),
  not (get_discover('America/Los_Angeles')->'items')::text like '%000000000005%';
reset role;
-- A chat with David (ended): he leaves Discover and is never a candidate
insert into connections (user_a_id, user_b_id, status) values (:'D', :'A', 'ended') returning id as da \gset
set local role authenticated;
select 'D7 ended chat: David gone from Discover (t):', not (get_discover('America/Los_Angeles')->'items')::text like '%000000000002%';
reset role;
select 'D8 ended chat: never a candidate (f):', exists(select 1 from compatible_candidates_for(:'A') where user_id = :'D');
-- Marcus has 3 active chats (one paused): hidden from everyone
insert into connections (id, user_a_id, user_b_id, status) values
 ('20000000-0000-0000-0000-0000000000b1', :'K', '10000000-0000-0000-0000-000000000007', 'active'),
 ('20000000-0000-0000-0000-0000000000b2', :'K', '10000000-0000-0000-0000-000000000008', 'active'),
 ('20000000-0000-0000-0000-0000000000b3', :'K', '10000000-0000-0000-0000-000000000009', 'paused');
insert into messages (connection_id, sender_id, content, type) values
 ('20000000-0000-0000-0000-0000000000b1', :'K', 'hi','text'), ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000007', 'hi','text'),
 ('20000000-0000-0000-0000-0000000000b2', :'K', 'hi','text'), ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000008', 'hi','text'),
 ('20000000-0000-0000-0000-0000000000b3', :'K', 'hi','text'), ('20000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-000000000009', 'hi','text');
select 'D9 paused counts: Marcus has 3 active (3):', active_count from connection_counts(:'K');
select 'D10 full person never a candidate (f):', exists(select 1 from compatible_candidates_for(:'A') where user_id = :'K');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select 'D11 full person sees nobody (full=t):', get_discover('America/Los_Angeles')->>'full';
-- Interested: open, cap, closes after 30 days
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select 'I1 Maria says Interested in Robert (mutual f):', express_interest(:'R')->>'mutual';
select 'I2 Robert listed as waiting (open):', state from my_interests() where other_user_id = :'R';
reset role;
update interests set created_at = now() - interval '31 days' where from_user_id = :'M' and to_user_id = :'R';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select 'I3 after 30 days: closed, shown once (closed):', state from my_interests() where other_user_id = :'R';
select ack_interest_closures();
select 'I4 after it was shown: gone (0):', count(*) from my_interests() where other_user_id = :'R';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select 'I5 Robert says Interested later: no match from a closed one (f):', express_interest(:'M')->>'mutual';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select 'I6 Maria says Interested again: now mutual (t):', express_interest(:'R')->>'mutual';
-- Saved: at most 5, then full
select 'S1 five saves:', save_for_later('10000000-0000-0000-0000-000000000005'), save_for_later('10000000-0000-0000-0000-000000000006'),
  save_for_later('10000000-0000-0000-0000-000000000007'), save_for_later('10000000-0000-0000-0000-000000000008'), save_for_later('10000000-0000-0000-0000-000000000009');
select 'S2 sixth save (full):', save_for_later('10000000-0000-0000-0000-0000000000aa');
reset role;
update connections set saved_at = now() - interval '31 days' where user_a_id = :'M' and user_b_id = '10000000-0000-0000-0000-000000000009';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select 'S3 a save older than 30 days is gone from Saved (4):', count(*) from saved_profiles;
select 'S4 Robert (chat open) is not in Saved (0):', count(*) from saved_profiles where user_id = :'R';
-- Hidden chats: own rows only
savepoint h;
insert into hidden_chats (user_id, connection_id) values (:'M', :'da');
select 'H1 FAIL could hide a chat she is not in';
rollback to savepoint h;
select 'H1 cannot hide a chat you are not in (refused above if no FAIL line)';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
insert into hidden_chats (user_id, connection_id) values (:'A', :'da');
select 'H2 Aisha hides her own chat (1):', count(*) from hidden_chats;
rollback;
