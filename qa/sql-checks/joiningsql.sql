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
-- "Not now" on the Your circle card (2026-10-27): back in 30 days, never after the third.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select 'first Not now: later: ' || (meet_offer_not_now() = 'later') as result;
select 'back in 30 days: ' || ((select (meet_offer_back_at - now()) between interval '29 days 23 hours' and interval '30 days 1 minute' from joining_answers) ) as result;
select 'second Not now: later: ' || (meet_offer_not_now() = 'later') as result;
select 'third Not now: never: ' || (meet_offer_not_now() = 'never') as result;
select 'hidden for good: ' || ((select meet_offer_hidden_at is not null and meet_offer_back_at is null and meet_offer_not_now_count = 3 from joining_answers)) as result;
reset role;
select 'another person''s Not now never touches my card: ' || ((select meet_offer_not_now_count from joining_answers where user_id = '10000000-0000-0000-0000-000000000001') is distinct from 3) as result;
rollback;
