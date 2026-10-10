\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000019','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000019','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '5 days');
update profiles set availability = array['Weekends','Weekday evenings'] where user_id='10000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select start_plan_board('20000000-0000-0000-0000-000000000019') as board \gset
select plan_add_fallback_ideas(:'board') \gset x
select id as easy from plan_ideas where board_id=:'board' and slot='easy' \gset
select id as newi from plan_ideas where board_id=:'board' and slot='new' \gset
select 'U1 Maria sees David usual times (expect 2):', jsonb_array_length(get_plan_board('20000000-0000-0000-0000-000000000019')->'other_usual');
select 'U2 home idea before 1st meetup blocked:'; savepoint s1; select plan_add_own_idea(:'board','Dinner at my place'); rollback to savepoint s1;
select 'U3 homemade pasta allowed (expect uuid):', plan_add_own_idea(:'board','Homemade pasta class') is not null;
select plan_toggle_pick(:'easy') \gset x
select plan_set_times(:'board', jsonb_build_array(jsonb_build_object('day', current_date+3, 'part','afternoon'), jsonb_build_object('day', current_date+4, 'part','morning'))) \gset x
-- David cannot see Maria's draft times
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'U4 David sees Maria draft times (expect 0,0):', (select count(*) from plan_times where board_id=:'board'), jsonb_array_length(get_plan_board('20000000-0000-0000-0000-000000000019')->'board'->'other_times');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'U5 Maria saves:', plan_save_picks(:'board');
select 'U6 Maria my_saved_times (expect 2):', jsonb_array_length(get_plan_board('20000000-0000-0000-0000-000000000019')->'board'->'my_saved_times');
-- Maria changes draft times; David still sees saved ones
select plan_set_times(:'board', jsonb_build_array(jsonb_build_object('day', current_date+5, 'part','evening'))) \gset x
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'U7 David sees 2 saved times, not the draft:', jsonb_array_length(get_plan_board('20000000-0000-0000-0000-000000000019')->'board'->'other_times'), (select count(*) from plan_saved_times where board_id=:'board');
select 'U8 David turn (expect pick,t):', stage, waiting_on_me from my_plan_turns();
-- David picks same idea, different time -> no_time
select plan_toggle_pick(:'easy') \gset x
select plan_set_times(:'board', jsonb_build_array(jsonb_build_object('day', current_date+6, 'part','afternoon'))) \gset x
select 'U9 David saves (expect shared 1, shared_times 0):', plan_save_picks(:'board');
select 'U10 David turn (expect no_time,f):', stage, waiting_on_me from my_plan_turns();
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'U11 Maria turn (expect no_time,t):', stage, waiting_on_me from my_plan_turns();
select 'U12 Maria revert restores draft times (expect 2):'; select plan_revert_picks(:'board') \gset x
select jsonb_array_length(get_plan_board('20000000-0000-0000-0000-000000000019')->'board'->'my_times');
select plan_set_times(:'board', jsonb_build_array(jsonb_build_object('day', current_date+3, 'part','afternoon'), jsonb_build_object('day', current_date+6, 'part','afternoon'))) \gset x
select 'U13 Maria resaves (expect shared 1, shared_times 1):', plan_save_picks(:'board');
select 'U14 Maria turn (expect matched,t):', stage, waiting_on_me from my_plan_turns();
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'U15 David turn (expect matched,f):', stage, waiting_on_me from my_plan_turns();
-- No-match rounds still count by idea only
select 'U16 rounds (expect 0):', get_plan_board('20000000-0000-0000-0000-000000000019')->'board'->>'no_match_rounds';
rollback;

-- Meet nudges
begin;
insert into connections (id,user_a_id,user_b_id,status,opened_at) values ('20000000-0000-0000-0000-000000000029','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active', now() - interval '200 days');
insert into messages (connection_id,sender_id,content,type,created_at) values
 ('20000000-0000-0000-0000-000000000029','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '25 days'),
 ('20000000-0000-0000-0000-000000000029','10000000-0000-0000-0000-000000000002','hey','text', now() - interval '24 days'),
 ('20000000-0000-0000-0000-000000000029','10000000-0000-0000-0000-000000000001','ok','text', now() - interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'N1 24 days talking -> three_weeks:', get_meet_nudge('20000000-0000-0000-0000-000000000029')->>'stage';
select answer_meet_nudge('20000000-0000-0000-0000-000000000029','three_weeks','not_yet') \gset x
select 'N2 after Not yet (expect null):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'N3 David still sees his own (expect three_weeks):', get_meet_nudge('20000000-0000-0000-0000-000000000029')->>'stage';
select 'N4 David cannot read Maria answer (expect 0):', count(*) from meet_nudges where user_id='10000000-0000-0000-0000-000000000001';
reset role;
update meet_nudges set ask_again_at = now() - interval '1 minute';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'N5 3 weeks later asks again:', get_meet_nudge('20000000-0000-0000-0000-000000000029')->>'stage';
-- open plan board hides it
select start_plan_board('20000000-0000-0000-0000-000000000029') as b2 \gset
select 'N6 planning hides it (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
select close_plan_board(:'b2') \gset x
reset role;
-- 70 days, paused 15 of them -> 55 days counts as three_weeks
update messages set created_at = created_at - interval '46 days' where connection_id='20000000-0000-0000-0000-000000000029' and content in ('hi','hey');
insert into friendship_events (connection_id, event_type, created_at) values
 ('20000000-0000-0000-0000-000000000029','connection_paused', now() - interval '40 days'),
 ('20000000-0000-0000-0000-000000000029','connection_resumed', now() - interval '25 days');
select 'N7 talking days ~55 (paused excluded):', floor(_talking_days('20000000-0000-0000-0000-000000000029'));
delete from friendship_events where connection_id='20000000-0000-0000-0000-000000000029';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'N8 70 days -> two_months:', get_meet_nudge('20000000-0000-0000-0000-000000000029')->>'stage';
select answer_meet_nudge('20000000-0000-0000-0000-000000000029','two_months','keep_chatting') \gset x
select 'N9 after keep chatting (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
reset role;
update messages set created_at = created_at - interval '120 days' where connection_id='20000000-0000-0000-0000-000000000029' and content in ('hi','hey');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'N10 190 days -> six_months:', get_meet_nudge('20000000-0000-0000-0000-000000000029')->>'stage';
select answer_meet_nudge('20000000-0000-0000-0000-000000000029','six_months','keep_chatting') \gset x
select 'N11 never again (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'N12 David still six_months:', get_meet_nudge('20000000-0000-0000-0000-000000000029')->>'stage';
reset role;
update connections set meetup_count = 1 where id='20000000-0000-0000-0000-000000000029';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'N13 met once -> nothing (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
reset role;
update connections set meetup_count = 0, status='paused' where id='20000000-0000-0000-0000-000000000029';
set local role authenticated;
select 'N14 paused -> nothing (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
reset role;
update connections set status='active' where id='20000000-0000-0000-0000-000000000029';
delete from messages where connection_id='20000000-0000-0000-0000-000000000029' and content='hey';
set local role authenticated;
select 'N15 one-sided -> nothing (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
select 'N16 outsider answer fails:';
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',true) \gset x
savepoint s9; select answer_meet_nudge('20000000-0000-0000-0000-000000000029','two_months','plan'); rollback to savepoint s9;
select 'N17 outsider get (expect true):', get_meet_nudge('20000000-0000-0000-0000-000000000029') is null;
rollback;
