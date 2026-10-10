\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- 2026-10-10: "Did you meet?" answers never fail on an old card; topics on notes.
begin;
delete from connections where (user_a_id, user_b_id) in (('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'));
insert into connections (id,user_a_id,user_b_id,status,created_at) values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','active', now()-interval '10 days');
set local role authenticated;
-- David adds a meetup from yesterday
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select log_past_meetup('20000000-0000-0000-0000-000000000091', current_date-1, 'coffee', 'America/Los_Angeles') as mid \gset
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
savepoint a;
select 'M1 Aisha says yes: counted (occurred):', report_meetup_occurrence(:'mid', true, current_date-1)->>'status';
rollback to savepoint a;
savepoint b;
select 'M2 Aisha says no (unresolved):', report_meetup_occurrence(:'mid', false)->>'status';
rollback to savepoint b;
-- The meetup was already counted elsewhere: the card is put away, no error
reset role;
update meetups set status='occurred', occurred_date=current_date-1 where id=:'mid';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select 'M3 old card after it already counted (stale):', report_meetup_occurrence(:'mid', true, current_date-1)->>'status';
reset role;
select 'M4 card put away (0 pending):', count(*) from connection_interventions where target_user_id='10000000-0000-0000-0000-000000000003' and intervention_type='meetup_occurrence_check' and status='pending' and payload->>'meetup_id'=:'mid';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select 'M5 meetup that no longer exists (stale):', report_meetup_occurrence('30000000-0000-0000-0000-0000000000ff', true)->>'status';
-- Someone outside the chat
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
savepoint c;
select 'M6 FAIL outsider could answer', report_meetup_occurrence(:'mid', true);
rollback to savepoint c;
select 'M6 outsider refused (not_in_chat above if no FAIL line)';
-- Topics: fixed list only
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
insert into remember_entries (connection_id,user_id,raw_text,topics) values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000003','Sister visiting in May', array['family','ideas']);
select 'T1 note with two topics saved (1):', count(*) from remember_entries where topics @> array['family'];
savepoint d;
insert into remember_entries (connection_id,user_id,raw_text,topics) values ('20000000-0000-0000-0000-000000000091','10000000-0000-0000-0000-000000000003','x', array['my own tag']);
select 'T2 FAIL a custom topic was allowed';
rollback to savepoint d;
select 'T2 custom topics refused (if no FAIL line)';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select 'T3 David sees none of Aisha''s notes (0):', count(*) from remember_entries where connection_id='20000000-0000-0000-0000-000000000091';
rollback;
