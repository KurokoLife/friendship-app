\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- Invites
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '5 days'),('20000000-0000-0000-0000-000000000031','10000000-0000-0000-0000-000000000002','hey','text', now() - interval '4 days');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select start_plan_board('20000000-0000-0000-0000-000000000031') as board \gset
select plan_add_fallback_ideas(:'board') \gset x
select id as easy from plan_ideas where board_id=:'board' and slot='easy' \gset
select id as newi from plan_ideas where board_id=:'board' and slot='new' \gset
select 'I1 my_plan_turns drafting for Maria:', stage, waiting_on_me from my_plan_turns();
select 'I2 no picks -> error:'; savepoint a; select send_plan_invite(:'board', 'hi'); rollback to savepoint a;
select plan_toggle_pick(:'easy') \gset x
select plan_toggle_pick(:'newi') \gset x
select 'I3 no times -> error:'; savepoint b; select send_plan_invite(:'board', null); rollback to savepoint b;
select plan_set_times(:'board', jsonb_build_array(jsonb_build_object('day', current_date+3, 'part','afternoon'), jsonb_build_object('day', current_date+5, 'part','morning'))) \gset x
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'I4 David has no drafting row (expect 0):', count(*) from my_plan_turns();
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select send_plan_invite(:'board', 'Would love to see you!') as inv \gset
select 'I5 message content:', content, type from messages where connection_id='20000000-0000-0000-0000-000000000031' and type='plan_invite';
select 'I6 invite ideas/times counts (2,2):', jsonb_array_length(ideas), jsonb_array_length(times), status from plan_invites where id=:'inv';
select 'I7 board closed invited:', status, close_reason from plan_boards where id=:'board';
select 'I8 sender cannot accept:'; savepoint c; select accept_plan_invite(:'inv', current_date+3, '14:00'); rollback to savepoint c;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}',true) \gset x
select 'I9 outsider sees no invites (0):', count(*) from plan_invites where id=:'inv';
savepoint d; select 'I9b outsider accept fails:'; select accept_plan_invite(:'inv', current_date+3, '14:00'); rollback to savepoint d;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'I10 David sees invite:', count(*) from plan_invites where id=:'inv';
select 'I11 David accepts offered time (expect confirmed):', accept_plan_invite(:'inv', current_date+3, '15:00', 'Blue Bottle', 'Coffee', 'America/Los_Angeles')->>'status';
select 'I12 meetup confirmed, proposer Maria:', status, proposed_by = '10000000-0000-0000-0000-000000000001', confirmed_by='10000000-0000-0000-0000-000000000002', activity, place from meetups where connection_id='20000000-0000-0000-0000-000000000031';
select 'I13 invite accepted:', status, accepted_part, accepted_confirmed from plan_invites where id=:'inv';
select 'I14 accept again fails:'; savepoint e; select accept_plan_invite(:'inv', current_date+3, '15:00'); rollback to savepoint e;
-- Calendar asks
select 'I15 calendar ask insert:'; insert into meetup_calendar_asks (meetup_id, user_id, details_key, answer) select id, '10000000-0000-0000-0000-000000000002', 'k1', 'added' from meetups where connection_id='20000000-0000-0000-0000-000000000031';
select 'I16 cannot insert for Maria:'; savepoint f; insert into meetup_calendar_asks (meetup_id, user_id, details_key, answer) select id, '10000000-0000-0000-0000-000000000001', 'k1', 'added' from meetups where connection_id='20000000-0000-0000-0000-000000000031'; rollback to savepoint f;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'I17 Maria does not see David calendar ask (0):', count(*) from meetup_calendar_asks;
rollback;

-- Not-offered time goes back to the sender; a new invite replaces the old
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000032','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '5 days');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select start_plan_board('20000000-0000-0000-0000-000000000032') as b \gset
select plan_add_fallback_ideas(:'b') \gset x
select plan_toggle_pick((select id from plan_ideas where board_id=:'b' and slot='easy')) \gset x
select plan_set_times(:'b', jsonb_build_array(jsonb_build_object('day', current_date+3, 'part','morning'))) \gset x
select send_plan_invite(:'b', null) as inv1 \gset
select 'J1 content without note starts with Ideas:', content like 'Ideas:%' from messages where type='plan_invite' and connection_id='20000000-0000-0000-0000-000000000032';
select start_plan_board('20000000-0000-0000-0000-000000000032') as b2 \gset
select 'J2 new board is a new one:', :'b2' <> :'b';
select plan_add_fallback_ideas(:'b2') \gset x
select plan_toggle_pick((select id from plan_ideas where board_id=:'b2' and slot='easy')) \gset x
select plan_set_times(:'b2', jsonb_build_array(jsonb_build_object('day', current_date+4, 'part','evening'))) \gset x
select send_plan_invite(:'b2', 'Second try') as inv2 \gset
select 'J3 first invite replaced:', status, closed_reason from plan_invites where id=:'inv1';
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'J4 David picks a different day (expect proposed):', accept_plan_invite(:'inv2', current_date+6, '18:00', null, 'Walk')->>'status';
select 'J5 meetup proposed by David:', status, proposed_by='10000000-0000-0000-0000-000000000002' from meetups where connection_id='20000000-0000-0000-0000-000000000032';
select 'J6 same day wrong part also proposed:';
rollback;

-- Log a past meetup, other confirms; one-sided counts after a week
begin;
insert into connections (id,user_a_id,user_b_id,status,created_at) values ('20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active', now() - interval '60 days');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '50 days'),('20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000002','hey','text', now() - interval '49 days');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'L1 future date fails:'; savepoint g; select log_past_meetup('20000000-0000-0000-0000-000000000033', current_date + 2); rollback to savepoint g;
select log_past_meetup('20000000-0000-0000-0000-000000000033', current_date - 3, 'Coffee') as m1 \gset
select 'L2 second log while waiting fails:'; savepoint h; select log_past_meetup('20000000-0000-0000-0000-000000000033', current_date - 2); rollback to savepoint h;
select 'L3 Maria nudge hidden while waiting (true):', get_meet_nudge('20000000-0000-0000-0000-000000000033') is null;
select 'L3b Maria has no card for it (0):', count(*) from get_active_intervention('20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'L4 David card:', intervention_type, payload->>'logged_by' = '10000000-0000-0000-0000-000000000001' from get_active_intervention('20000000-0000-0000-0000-000000000033','10000000-0000-0000-0000-000000000002');
select 'L5 David confirms:', report_meetup_occurrence(:'m1', true, current_date - 3);
reset role;
select 'L6 occurred, count 1:', m.status, c.meetup_count from meetups m join connections c on c.id=m.connection_id where m.id=:'m1';
-- nudges now count from the meetup
select 'L7 just met -> no nudge:'; set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select get_meet_nudge('20000000-0000-0000-0000-000000000033') is null;
reset role;
update meetups set occurred_date = current_date - 25, confirmed_date = current_date - 25 where id=:'m1';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'L8 25 days since met -> three_weeks, met:', get_meet_nudge('20000000-0000-0000-0000-000000000033')->>'stage', get_meet_nudge('20000000-0000-0000-0000-000000000033')->>'met';
select answer_meet_nudge('20000000-0000-0000-0000-000000000033','three_weeks','not_yet') \gset x
select 'L9 after Not yet hidden (true):', get_meet_nudge('20000000-0000-0000-0000-000000000033') is null;
-- one-sided: log another meetup, David never answers
select log_past_meetup('20000000-0000-0000-0000-000000000033', current_date - 1, null) as m2 \gset
reset role;
select 'L10 sweep before a week:', run_meetup_occurrence_check_v2('20000000-0000-0000-0000-000000000033', now() + interval '2 days');
select 'L11 sweep after a week:', run_meetup_occurrence_check_v2('20000000-0000-0000-0000-000000000033', now() + interval '8 days');
select 'L12 occurred, count 2:', m.status, c.meetup_count from meetups m join connections c on c.id=m.connection_id where m.id=:'m2';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'L13 new round after a new meetup: no nudge yet (true):', get_meet_nudge('20000000-0000-0000-0000-000000000033') is null;
reset role;
update meetups set occurred_date = current_date - 22, confirmed_date = current_date - 22 where id=:'m2';
update meetups set occurred_date = current_date - 30, confirmed_date = current_date - 30 where id=:'m1';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'L14 new round asks again even though Not yet was said last round:', get_meet_nudge('20000000-0000-0000-0000-000000000033')->>'stage';
-- David says no to a logged meetup
select log_past_meetup('20000000-0000-0000-0000-000000000033', current_date - 1, null) as m3 \gset
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'L15 David says no:', report_meetup_occurrence(:'m3', false)->>'status';
reset role;
select 'L16 count still 2:', meetup_count from connections where id='20000000-0000-0000-0000-000000000033';
rollback;

-- Planned meetup, nobody answers for two weeks
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000034','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active');
insert into meetups (connection_id, proposed_date, proposed_by, status, confirmed_date, confirmed_at) values ('20000000-0000-0000-0000-000000000034', current_date - 1, '10000000-0000-0000-0000-000000000001','confirmed', current_date - 1, now() - interval '3 days');
select 'N1 fires:', run_meetup_occurrence_check_v2('20000000-0000-0000-0000-000000000034', now());
select 'N2 two weeks later lets go:', run_meetup_occurrence_check_v2('20000000-0000-0000-0000-000000000034', now() + interval '15 days');
select 'N3 status:', status from meetups where connection_id='20000000-0000-0000-0000-000000000034';
rollback;
