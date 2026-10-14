\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- 2026-10-14: Interested always saves to Pending; chat opens when both
-- said Interested and both selfies are approved.
begin;
\set A '10000000-0000-0000-0000-000000000003'
\set D '10000000-0000-0000-0000-000000000002'
\set M '10000000-0000-0000-0000-000000000001'
delete from connections; delete from interests; delete from blocks; delete from selfie_checks;
update users set selfie_verified_at = null where id in (:'A', :'D');
update users set selfie_verified_at = now() where id = :'M';
create temp table out (k text, v text);
grant all on out to authenticated;
-- Aisha, no selfie yet, says Interested to David
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select 'P1 no selfie: saved, not mutual, selfie none:', express_interest(:'D');
select 'P2 in Aisha''s Pending as waiting:', string_agg(state, ','), count(*) from my_pending();
-- David (also no selfie) says Interested back
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select 'P3 David: mutual, waiting my_selfie:', express_interest(:'A');
select 'P4 no chat yet (0):', count(*) from connections where status = 'pending';
select 'P5 David sees my_selfie:', string_agg(state, ',') from my_pending();
reset role;
-- David's selfie approved
update users set selfie_verified_at = now() where id = :'D';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select 'P6 David now sees their_selfie:', string_agg(state, ',') from my_pending();
select 'P7 open_ready does nothing yet (0):', open_ready_interests();
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select 'P8 Aisha sees my_selfie:', string_agg(state, ',') from my_pending();
reset role;
insert into selfie_checks (user_id, status, pose, consent_at) values (:'A', 'pending', 'x', now()) on conflict (user_id) do update set status='pending';
set local role authenticated;
select 'P9 still my_selfie while pending, my_selfie_state pending:', (select string_agg(state, ',') from my_pending()), my_selfie_state();
reset role;
update selfie_checks set status = 'approved' where user_id = :'A';
set local role authenticated;
select 'P10 open_ready opens the chat (1):', open_ready_interests();
select 'P11 chat is pending status, Pending list empty:', (select count(*) from connections where status='pending'), (select count(*) from my_pending());
-- Message from Aisha allowed now
insert into messages (connection_id, sender_id, content) select id, :'A', 'Hi!' from connections where status='pending';
select 'P12 Aisha can say hello (1):', count(*) from messages;
reset role;
-- One-sided stays hidden: Maria (approved) Interested in Aisha; Aisha sees nothing about it
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select 'P13 Maria approved, one-sided -> selfie approved, not mutual:', express_interest(:'A');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select 'P14 Aisha can''t see Maria''s interest (0):', count(*) from my_pending() where other_user_id = :'M';
select 'P15 Aisha can''t read the interests row (0):', count(*) from interests where from_user_id = :'M';
reset role;
-- Cap of 5
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select 'P16 interests 2-5:', express_interest('10000000-0000-0000-0000-000000000004')->>'mutual', express_interest('10000000-0000-0000-0000-000000000005')->>'mutual', express_interest('10000000-0000-0000-0000-000000000006')->>'mutual', express_interest('10000000-0000-0000-0000-000000000007')->>'mutual';
reset role;
do $$ begin
  perform set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  perform express_interest('10000000-0000-0000-0000-000000000008');
  raise notice 'P17 sixth allowed (BAD)';
exception when others then raise notice 'P17 sixth refused: %', sqlerrm; end $$;
-- Closed after 30 days shows once
update interests set created_at = now() - interval '31 days' where from_user_id = :'M' and to_user_id = '10000000-0000-0000-0000-000000000004';
set local role authenticated;
select 'P18 closed shows:', string_agg(state, ',' order by state) from my_pending();
select ack_interest_closures();
select 'P19 gone after ack (no closed):', string_agg(state, ',' order by state) from my_pending();
rollback;
