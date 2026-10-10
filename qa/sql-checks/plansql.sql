\set ON_ERROR_STOP 0
begin;
insert into connections (id,user_a_id,user_b_id,status) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','active');
insert into messages (connection_id,sender_id,content,type) values ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','hi','text');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select start_plan_board('20000000-0000-0000-0000-000000000001') as board \gset
select plan_add_fallback_ideas(:'board');
select get_plan_board('20000000-0000-0000-0000-000000000001')->'board'->'ideas' is not null as has_ideas, jsonb_array_length(get_plan_board('20000000-0000-0000-0000-000000000001')->'board'->'ideas') n;
select title, slot from plan_ideas;
select id as idea from plan_ideas where slot='easy' \gset
select plan_toggle_pick(:'idea');
select plan_add_fallback_ideas(:'board');
select count(*) filter (where not retired) live, count(*) total from plan_ideas;
select get_plan_board('20000000-0000-0000-0000-000000000001')->'board'->>'refreshes_left' left_;
select plan_set_times(:'board', '[{"day":"2026-10-12","part":"afternoon"},{"day":"2026-10-13","part":"evening"}]');
select set_config('request.jwt.claims','{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select * from my_plan_turns();
select plan_toggle_pick(:'idea');
select plan_choose_idea(:'board', :'idea');
select plan_set_times(:'board', '[{"day":"2026-10-12","part":"afternoon"}]');
select plan_choose_time(:'board','2026-10-12','afternoon');
select set_plan_prefs('under_15','hour',30);
select get_plan_board('20000000-0000-0000-0000-000000000001')->'board'->>'chosen_part' part, get_plan_board('20000000-0000-0000-0000-000000000001')->>'my_prefs' prefs;
reset role;
select (plan_idea_context(:'board','10000000-0000-0000-0000-000000000002'))::text;
insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date) values ('20000000-0000-0000-0000-000000000001',1,'2026-10-12','10000000-0000-0000-0000-000000000001','confirmed','2026-10-12');
select status, close_reason from plan_boards;
rollback;
