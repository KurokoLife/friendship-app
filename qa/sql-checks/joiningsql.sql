-- 2026-10-26: Joining, stage 2. The "What's hardest" answers are private,
-- and only people who chose "Meet someone new" are suggested.
-- Every result line should end in "true".
\set ON_ERROR_STOP 0
begin;
insert into joining_answers (user_id, hardest, hardest_other, goals)
values ('10000000-0000-0000-0000-000000000005', '{not_sure_wanted,other}', 'Private words', '{keep_in_touch}')
on conflict (user_id) do update set hardest = excluded.hardest, hardest_other = excluded.hardest_other, goals = excluded.goals;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select 'owner reads own answers: ' || ((select count(*) from joining_answers) = 1) as result;
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select 'another person reads nothing: ' || ((select count(*) from joining_answers) = 0) as result;
update joining_answers set hardest = '{}' where user_id = '10000000-0000-0000-0000-000000000005';
delete from joining_answers where user_id = '10000000-0000-0000-0000-000000000005';
reset role;
select 'another person can''t change or remove them: ' || ((select hardest_other from joining_answers where user_id = '10000000-0000-0000-0000-000000000005') = 'Private words') as result;
savepoint s1;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into joining_answers (user_id, hardest) values ('10000000-0000-0000-0000-000000000005', '{}');
rollback to savepoint s1;
reset role;
select 'another person can''t add answers for me: ' || ((select count(*) from joining_answers where user_id = '10000000-0000-0000-0000-000000000005') = 1) as result;
select 'signed out has no access at all: ' || (not has_table_privilege('anon', 'public.joining_answers', 'select')) as result;
select 'the meet check is not callable by members: ' || (not has_function_privilege('authenticated', 'public.wants_to_meet_new(uuid)', 'execute')) as result;
create temp table _r (ok boolean);
do $$ begin
  begin
    update joining_answers set hardest = '{made_up}' where user_id = '10000000-0000-0000-0000-000000000005';
    insert into _r values (false);
  exception when check_violation then insert into _r values (true);
  end;
end $$;
select 'unknown keys are refused: ' || (select ok from _r) as result;
select 'no row = joined before stage 2 = meets new people: ' || public.wants_to_meet_new('10000000-0000-0000-0000-000000000001') as result;
select 'without Meet someone new: not suggested: ' || (not public.wants_to_meet_new('10000000-0000-0000-0000-000000000005')) as result;
update joining_answers set goals = '{keep_in_touch,meet_new}' where user_id = '10000000-0000-0000-0000-000000000005';
select 'with it: suggested: ' || public.wants_to_meet_new('10000000-0000-0000-0000-000000000005') as result;
rollback;
