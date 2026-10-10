\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- Getting started: one note at the person's pace
begin;
update profiles set response_time = '1-2 days' where user_id = '10000000-0000-0000-0000-000000000004';
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000041','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000041','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '30 hours');
select 'R1 30h, David replies in 1-2 days (expect none):', run_no_ghost_check_v2('20000000-0000-0000-0000-000000000041');
update messages set created_at = now() - interval '50 hours' where connection_id='20000000-0000-0000-0000-000000000041';
select 'R2 50h (expect r1):', run_no_ghost_check_v2('20000000-0000-0000-0000-000000000041');
select 'R3 only one reminder for David (r1 count 1, others 0):', count(*) filter (where intervention_type='no_ghost_r1'), count(*) filter (where intervention_type<>'no_ghost_r1') from connection_interventions where connection_id='20000000-0000-0000-0000-000000000041';
update messages set created_at = now() - interval '100 hours' where connection_id='20000000-0000-0000-0000-000000000041';
select 'R4 100h still only r1 (expect r1, 1 row):', run_no_ghost_check_v2('20000000-0000-0000-0000-000000000041'), (select count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000041');
update messages set created_at = now() - interval '126 hours' where connection_id='20000000-0000-0000-0000-000000000041';
select 'R5 126h (expect s1 for Maria):', run_no_ghost_check_v2('20000000-0000-0000-0000-000000000041'), (select target_user_id='10000000-0000-0000-0000-000000000001' from connection_interventions where connection_id='20000000-0000-0000-0000-000000000041' and intervention_type='no_ghost_s1');
update messages set created_at = now() - interval '170 hours' where connection_id='20000000-0000-0000-0000-000000000041';
select 'R6 170h (expect auto_closed, inactive):', run_no_ghost_check_v2('20000000-0000-0000-0000-000000000041'), (select status from connections where id='20000000-0000-0000-0000-000000000041');
rollback;

-- Talking: no reply reminders, never closes, check-in for both
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active');
insert into messages (connection_id,sender_id,content,type,created_at) values
 ('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000004','hey','text', now() - interval '9 days'),
 ('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000001','good night!','text', now() - interval '8 days');
insert into connection_interventions (connection_id, target_user_id, intervention_type) values ('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000004','no_ghost_r2');
select 'T1 no-ghost (expect talking):', run_no_ghost_check_v2('20000000-0000-0000-0000-000000000042');
select 'T2 still active, old r2 put away (active, 0):', (select status from connections where id='20000000-0000-0000-0000-000000000042'), (select count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042' and status='pending' and intervention_type like 'no_ghost%');
select 'T3 check-in (expect fired):', run_conversation_restart_check_v2('20000000-0000-0000-0000-000000000042');
select 'T4 two check-ins:', count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042' and intervention_type='conversation_restart_prompt' and status='pending';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}',true) \gset x
select 'T5 David sees check-in card:', intervention_type from get_active_intervention('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000004');
select set_prompt_setting('20000000-0000-0000-0000-000000000042','check_in',false) \gset x
select 'T6 David turned it off for this chat -> card gone (expect empty):', coalesce((select intervention_type from get_active_intervention('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000004')),'none');
select 'T7 settings chat off, all on:', get_prompt_settings('20000000-0000-0000-0000-000000000042')->'check_in';
select 'T8 settings without chat:', get_prompt_settings(null)->'check_in';
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'T9 Maria does not see David settings (0):', count(*) from prompt_settings;
select 'T10 Maria still sees her check-in:', intervention_type from get_active_intervention('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000001');
select dismiss_intervention((select id from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042' and target_user_id='10000000-0000-0000-0000-000000000001' and status='pending')) \gset x
reset role;
select 'T11 rerun: no new card for Maria this quiet stretch (0 pending):', run_conversation_restart_check_v2('20000000-0000-0000-0000-000000000042'), (select count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042' and status='pending');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000042','10000000-0000-0000-0000-000000000004','hi again','text', now() - interval '6 days');
select 'T12 new quiet stretch -> Maria again, David off (fired, 1 pending for Maria):', run_conversation_restart_check_v2('20000000-0000-0000-0000-000000000042'),
  (select count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042' and status='pending' and target_user_id='10000000-0000-0000-0000-000000000001'),
  (select count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042' and status='pending' and target_user_id='10000000-0000-0000-0000-000000000004');
insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status) values ('20000000-0000-0000-0000-000000000042', 1, current_date + 3, '10000000-0000-0000-0000-000000000001', 'proposed');
delete from connection_interventions where connection_id='20000000-0000-0000-0000-000000000042';
select 'T13 plan set -> no check-in (meetup_already_scheduled):', run_conversation_restart_check_v2('20000000-0000-0000-0000-000000000042');
rollback;

-- Turning check-ins off for all chats, and the setting being validated
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000043','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','active');
insert into messages (connection_id,sender_id,content,type,created_at) values
 ('20000000-0000-0000-0000-000000000043','10000000-0000-0000-0000-000000000003','hey','text', now() - interval '9 days'),
 ('20000000-0000-0000-0000-000000000043','10000000-0000-0000-0000-000000000001','ok','text', now() - interval '8 days');
select run_conversation_restart_check_v2('20000000-0000-0000-0000-000000000043') \gset x
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select set_prompt_setting(null,'check_in',false) \gset x
select 'S1 all-chats off dismisses waiting check-in (0):', count(*) from connection_interventions where connection_id='20000000-0000-0000-0000-000000000043' and status='pending' and target_user_id='10000000-0000-0000-0000-000000000001';
select 'S2 chat value follows all-off:', get_prompt_settings('20000000-0000-0000-0000-000000000043')->'check_in';
select 'S3 bad kind fails:'; savepoint a; select set_prompt_setting(null,'reply',false); rollback to savepoint a;
select 'S4 outsider chat fails:'; savepoint b; select set_prompt_setting('20000000-0000-0000-0000-000000000043','check_in',false) from (select 1) x where false; rollback to savepoint b;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}',true) \gset x
savepoint c; select 'S5 David cannot set for a chat he is not in:'; select set_prompt_setting('20000000-0000-0000-0000-000000000043','check_in',false); rollback to savepoint c;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select set_prompt_setting(null,'check_in',true) \gset x
select 'S6 back on:', get_prompt_settings(null)->'check_in';
rollback;

-- Meet nudges: off switch, and pace after meeting
begin;
insert into connections (id,user_a_id,user_b_id,status,meetup_count) values ('20000000-0000-0000-0000-000000000044','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active',1);
insert into messages (connection_id,sender_id,content,type,created_at) values
 ('20000000-0000-0000-0000-000000000044','10000000-0000-0000-0000-000000000004','hey','text', now() - interval '20 days'),
 ('20000000-0000-0000-0000-000000000044','10000000-0000-0000-0000-000000000001','ok','text', now() - interval '13 days');
insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, occurred_date, confirmed_date) values ('20000000-0000-0000-0000-000000000044', 1, current_date - 12, '10000000-0000-0000-0000-000000000001', 'occurred', current_date - 12, current_date - 12);
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'M1 12 days after meeting, no pace (expect null):', coalesce(get_meet_nudge('20000000-0000-0000-0000-000000000044')::text,'null');
reset role;
insert into rhythm_preferences (connection_id, user_id, cadence) values ('20000000-0000-0000-0000-000000000044','10000000-0000-0000-0000-000000000001','weekly');
set local role authenticated;
select 'M2 Maria picked every week or two (expect three_weeks, weekly):', get_meet_nudge('20000000-0000-0000-0000-000000000044')->>'stage', get_meet_nudge('20000000-0000-0000-0000-000000000044')->>'pace';
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}',true) \gset x
select 'M3 David has no pace (expect null):', coalesce(get_meet_nudge('20000000-0000-0000-0000-000000000044')::text,'null');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select set_prompt_setting('20000000-0000-0000-0000-000000000044','meet_nudge',false) \gset x
select 'M4 Maria turned meet nudges off (expect null):', coalesce(get_meet_nudge('20000000-0000-0000-0000-000000000044')::text,'null');
rollback;

-- Morning-of can be turned off; first_meetup flag
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000045','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000045','10000000-0000-0000-0000-000000000004','hey','text', now() - interval '2 days'),('20000000-0000-0000-0000-000000000045','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '1 days');
with o as (select ((10 - extract(hour from now() at time zone 'utc')::int + 36) % 24) - 12 as x)
select case when x = 0 then 'Etc/GMT' when x > 0 then 'Etc/GMT-' || x else 'Etc/GMT+' || (-x) end as tzname from o \gset
insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, confirmed_at, time_zone)
values ('20000000-0000-0000-0000-000000000045', 1, (now() at time zone :'tzname')::date, '10000000-0000-0000-0000-000000000001', 'confirmed', (now() at time zone :'tzname')::date, now() - interval '2 days', :'tzname');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'D1 morning-of shows, first meetup flag:', intervention_type, payload->>'first_meetup' from get_active_intervention('20000000-0000-0000-0000-000000000045','10000000-0000-0000-0000-000000000001');
select set_prompt_setting(null,'morning_of',false) \gset x
select 'D2 turned off for all chats (expect none):', coalesce((select intervention_type from get_active_intervention('20000000-0000-0000-0000-000000000045','10000000-0000-0000-0000-000000000001')),'none');
rollback;

-- Inbox: invite waiting
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000046','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000046','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '5 days'),('20000000-0000-0000-0000-000000000046','10000000-0000-0000-0000-000000000004','hey','text', now() - interval '4 days');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select start_plan_board('20000000-0000-0000-0000-000000000046') as board \gset
select plan_add_fallback_ideas(:'board') \gset x
select plan_toggle_pick((select id from plan_ideas where board_id=:'board' and slot='easy')) \gset x
select plan_set_times(:'board', jsonb_build_array(jsonb_build_object('day', current_date+3, 'part','afternoon'))) \gset x
select send_plan_invite(:'board', null) \gset x
select 'P1 Maria inbox stage:', stage, waiting_on_me from my_plan_turns() where connection_id='20000000-0000-0000-0000-000000000046';
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}',true) \gset x
select 'P2 David inbox stage:', stage, waiting_on_me from my_plan_turns() where connection_id='20000000-0000-0000-0000-000000000046';
rollback;
