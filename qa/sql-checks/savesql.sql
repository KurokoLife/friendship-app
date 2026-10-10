\set ON_ERROR_STOP 0
\set QUIET 1
\pset tuples_only on
\pset format unaligned
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active');
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','hi','text', now() - interval '5 days');
set local role authenticated;
-- Maria (A)
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select start_plan_board('20000000-0000-0000-0000-000000000009') as board \gset
select plan_add_fallback_ideas(:'board') \gset x
select id as easy from plan_ideas where board_id=:'board' and slot='easy' \gset
select id as newi from plan_ideas where board_id=:'board' and slot='new' \gset
select id as both from plan_ideas where board_id=:'board' and slot='both_like' \gset
select 'T1 save with no picks fails:', (select 'no' ) ; 
savepoint s1; select plan_save_picks(:'board'); rollback to savepoint s1;
select plan_toggle_pick(:'easy') \gset x
select plan_add_own_idea(:'board','Mini golf') as own \gset
select 'T2 turn before save (expect pick,t):', stage, waiting_on_me from my_plan_turns();
-- David (B): Maria's draft + own idea invisible
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'T3 David sees Maria drafts via table (expect 0):', count(*) from plan_picks where board_id=:'board';
select 'T4 David sees Maria own idea before save (expect 0,0):', (select count(*) from plan_ideas where id=:'own'), (select count(*) from jsonb_array_elements(get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->'ideas') e where e->>'title'='Mini golf');
select 'T5 David picked_by_other on easy before save (expect false):', e->>'picked_by_other' from jsonb_array_elements(get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->'ideas') e where e->>'id'=:'easy';
-- Maria saves
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'T6 Maria saves (expect other_saved false):', plan_save_picks(:'board');
select 'T7 Maria turn (expect waiting,f):', stage, waiting_on_me from my_plan_turns();
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'T8 David now sees own idea (expect 1) and Maria saved:', (select count(*) from jsonb_array_elements(get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->'ideas') e where e->>'title'='Mini golf' and (e->>'picked_by_other')::bool), get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->>'other_saved_at' is not null;
select 'T9 David turn (expect pick,t):', stage, waiting_on_me from my_plan_turns();
select 'T10 choose before match fails:'; savepoint s2; select plan_choose_idea(:'board',:'easy'); rollback to savepoint s2;
-- David picks only 'new' -> no match
select plan_toggle_pick(:'newi') \gset x
select 'T11 David saves no match:', plan_save_picks(:'board');
select 'T12 rounds=1:', get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->>'no_match_rounds';
select 'T13 David turn (expect no_match,f):', stage, waiting_on_me from my_plan_turns();
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'T14 Maria turn (expect no_match,t):', stage, waiting_on_me from my_plan_turns();
-- Maria edits draft (adds new) but doesn't save: David still sees old
select plan_toggle_pick(:'newi') \gset x
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'T15 David still no match visible (expect false):', e->>'picked_by_other' from jsonb_array_elements(get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->'ideas') e where e->>'id'=:'newi';
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select 'T16 revert puts draft back (expect false):'; select plan_revert_picks(:'board') \gset x
select e->>'picked_by_me' from jsonb_array_elements(get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->'ideas') e where e->>'id'=:'newi';
select plan_toggle_pick(:'newi') \gset x
select 'T17 Maria saves -> match:', plan_save_picks(:'board');
select 'T18 Maria turn (expect matched,t second saver):', stage, waiting_on_me from my_plan_turns();
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true) \gset x
select 'T19 David turn (expect matched,f):', stage, waiting_on_me from my_plan_turns();
select 'T20 David (first saver) chooses the match:'; select plan_choose_idea(:'board',:'newi');
select 'T21 chosen:', get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->>'chosen_idea_id' = :'newi';
select 'T22 turn (expect times,t):', stage, waiting_on_me from my_plan_turns();
-- David unsaves the chosen idea -> choice cleared
select plan_toggle_pick(:'newi') \gset x
select plan_toggle_pick(:'both') \gset x
select 'T23 David resaves w/o chosen:', plan_save_picks(:'board');
select 'T24 chosen cleared, rounds=2:', get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->>'chosen_idea_id' is null, get_plan_board('20000000-0000-0000-0000-000000000009')->'board'->>'no_match_rounds';
-- Refresh keeps saved picks
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true) \gset x
select plan_add_fallback_ideas(:'board') \gset x
select 'T25 saved ideas not retired (expect 0 retired among saved):', count(*) from plan_ideas i join plan_saved_picks s on s.idea_id=i.id where i.retired;
-- Messages keep board fresh
reset role;
update plan_boards set last_activity_at = now() - interval '10 days' where id=:'board';
insert into messages (connection_id,sender_id,content,type) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000002','which one?','text');
select 'T26 message touched board (expect true):', last_activity_at > now() - interval '1 minute' from plan_boards where id=:'board';
-- backdated message doesn't move it back
update plan_boards set last_activity_at = now() where id=:'board';
insert into messages (connection_id,sender_id,content,type,created_at) values ('20000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000002','old','text', now()-interval '20 days');
select 'T27 backdated message no regress (expect true):', last_activity_at > now() - interval '1 minute' from plan_boards where id=:'board';
-- Elena (not participant) sees nothing
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000009","role":"authenticated"}',true) \gset x
select 'T28 outsider saves/picks/ideas (expect 0 0 0):', (select count(*) from plan_saves), (select count(*) from plan_saved_picks), (select count(*) from plan_ideas where board_id=:'board');
select 'T29 outsider save fails:'; savepoint s3; select plan_save_picks(:'board'); rollback to savepoint s3;
rollback;
