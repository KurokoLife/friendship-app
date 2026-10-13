\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- 2026-10-13: graduation ready check no longer needs a meeting pace.
begin;
\set A '10000000-0000-0000-0000-000000000003'
\set D '10000000-0000-0000-0000-000000000002'
delete from connections where (user_a_id=:'A' and user_b_id=:'D') or (user_a_id=:'D' and user_b_id=:'A');
insert into connections (id,user_a_id,user_b_id,status,created_at) values ('20000000-0000-0000-0000-0000000000c1',:'A',:'D','active', now()-interval '90 days');
insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date)
select '20000000-0000-0000-0000-0000000000c1', g, current_date - (70 - g*10), case when g % 2 = 0 then :'A'::uuid else :'D'::uuid end, 'occurred', current_date - (70 - g*10), current_date - (70 - g*10)
from generate_series(1,6) g;
delete from rhythm_preferences where connection_id='20000000-0000-0000-0000-0000000000c1';
select 'G1 6 meetups over 10 weeks, both planned 3, no pace set (ready_check):', graduation_stage('20000000-0000-0000-0000-0000000000c1', :'A');
update meetups set proposed_by = :'A' where connection_id='20000000-0000-0000-0000-0000000000c1';
select 'G2 only one person planned (null):', coalesce(graduation_stage('20000000-0000-0000-0000-0000000000c1', :'A'), 'null');
update meetups set proposed_by = case when sequence_number % 2 = 0 then :'A'::uuid else :'D'::uuid end where connection_id='20000000-0000-0000-0000-0000000000c1';
update meetups set occurred_date = current_date - 20 where connection_id='20000000-0000-0000-0000-0000000000c1' and sequence_number = 1;
update meetups set occurred_date = current_date - 30 where connection_id='20000000-0000-0000-0000-0000000000c1';
select 'G3 first meetup only 4 weeks ago (null):', coalesce(graduation_stage('20000000-0000-0000-0000-0000000000c1', :'A'), 'null');
rollback;
