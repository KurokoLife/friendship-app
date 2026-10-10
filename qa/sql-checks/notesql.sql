\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
-- 2026-10-10: Remember in the chat. Privacy and meetup rules.
begin;
delete from connections where (user_a_id, user_b_id) in (('10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'),('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004'),('10000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001'));
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','active');
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000072','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000004','active');
insert into meetups (id, connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date)
 values ('30000000-0000-0000-0000-000000000071','20000000-0000-0000-0000-000000000071',1,current_date-2,'10000000-0000-0000-0000-000000000003','occurred',current_date-2,current_date-2),
        ('30000000-0000-0000-0000-000000000072','20000000-0000-0000-0000-000000000072',1,current_date-2,'10000000-0000-0000-0000-000000000001','occurred',current_date-2,current_date-2);

-- As Aisha
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
insert into remember_entries (connection_id,user_id,meetup_id,learned,ask_next) values ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000071','Learning guitar','How the gig went');
select 'N1 Aisha sees her note (1):', count(*) from remember_entries;
savepoint s1;
insert into remember_entries (connection_id,user_id,meetup_id,learned) values ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000071','Second note same meetup');
select 'N2 FAIL second note for one meetup was allowed';
rollback to savepoint s1;
select 'N2 one note per meetup (refused above if no FAIL line)';
savepoint s2;
insert into remember_entries (connection_id,user_id,meetup_id,learned) values ('20000000-0000-0000-0000-000000000071','10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000072','Other chat meetup');
select 'N3 FAIL meetup from another chat was allowed';
rollback to savepoint s2;
select 'N3 meetup must be from the same chat (refused above if no FAIL line)';
savepoint s3;
insert into remember_asks (user_id, meetup_id) values ('10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000072');
select 'N4 FAIL could mark a meetup asked in a chat she is not in';
rollback to savepoint s3;
insert into remember_asks (user_id, meetup_id) values ('10000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000071');
select 'N5 Aisha marks her own meetup asked (1):', count(*) from remember_asks;
select set_prompt_setting('20000000-0000-0000-0000-000000000071','notes',false);
select 'N6 notes setting off for this chat only (all true, chat false):', (get_prompt_settings(null)->'notes'->>'all'), (get_prompt_settings('20000000-0000-0000-0000-000000000071')->'notes'->>'chat');

-- As David (the other person)
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select 'N7 David sees none of Aisha''s notes (0):', count(*) from remember_entries where connection_id='20000000-0000-0000-0000-000000000071';
select 'N8 David sees none of Aisha''s asks (0):', count(*) from remember_asks;
update remember_entries set learned='changed' where connection_id='20000000-0000-0000-0000-000000000071';
delete from remember_entries where connection_id='20000000-0000-0000-0000-000000000071';
reset role;
select 'N9 David could not change or delete it (Learning guitar):', learned from remember_entries where connection_id='20000000-0000-0000-0000-000000000071';
rollback;
