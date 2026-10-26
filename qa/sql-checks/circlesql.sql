-- 2026-10-26: Your circle, stage 1c. The next check-in date rule and the
-- privacy of friends' photos. Every result line should end in "true".
\set ON_ERROR_STOP 0
begin;
-- The rule: from + rhythm.
select 'few days = +3: ' || (circle_next_check_in('2026-10-26', 'few_days') = date '2026-10-29') as result;
select 'week = +7: ' || (circle_next_check_in('2026-10-26', 'week') = date '2026-11-02') as result;
select 'two weeks = +14: ' || (circle_next_check_in('2026-10-26', 'two_weeks') = date '2026-11-09') as result;
select 'month (month end): ' || (circle_next_check_in('2026-01-31', 'month') = date '2026-02-28') as result;
select 'few months = +3 months: ' || (circle_next_check_in('2026-10-26', 'few_months') = date '2027-01-26') as result;
select 'few times a year = +4 months: ' || (circle_next_check_in('2026-10-26', 'few_times_year') = date '2027-02-26') as result;
select 'no suggestions = no date: ' || (circle_next_check_in('2026-10-26', 'none') is null) as result;

-- Where the count starts: the day added, then the last reach-out.
insert into outside_friends (id, user_id, name, circle, rhythm, created_at)
values ('00000000-0000-0000-0000-00000000c1c1', '10000000-0000-0000-0000-000000000005', 'Rule test', 'close', 'week', '2026-10-01 18:00+00');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select 'from the day added: ' || (outside_friend_next_check_in('00000000-0000-0000-0000-00000000c1c1', 'America/Los_Angeles') = date '2026-10-08') as result;
select 'preview another rhythm: ' || (outside_friend_next_check_in('00000000-0000-0000-0000-00000000c1c1', 'America/Los_Angeles', 'month') = date '2026-11-01') as result;
select 'day is in the person''s own time zone: ' || (outside_friend_next_check_in('00000000-0000-0000-0000-00000000c1c1', 'Asia/Tokyo') = date '2026-10-09') as result;
reset role;
update outside_friends set last_reached_at = '2026-10-20 18:00+00' where id = '00000000-0000-0000-0000-00000000c1c1';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select 'from the last reach-out once there is one: ' || (outside_friend_next_check_in('00000000-0000-0000-0000-00000000c1c1', 'America/Los_Angeles') = date '2026-10-27') as result;
reset role;
-- Someone else never gets a date for my friend.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select 'another person gets nothing: ' || (outside_friend_next_check_in('00000000-0000-0000-0000-00000000c1c1', 'UTC') is null) as result;
reset role;

-- Photos: only the owner can see, add, replace or remove them.
insert into storage.objects (bucket_id, name, owner) values ('friend-photos', '10000000-0000-0000-0000-000000000005/rule-test.jpg', '10000000-0000-0000-0000-000000000005');
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
set local role authenticated;
select 'owner sees own photo: ' || ((select count(*) from storage.objects where bucket_id = 'friend-photos') = 1) as result;
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select 'another person sees none: ' || ((select count(*) from storage.objects where bucket_id = 'friend-photos') = 0) as result;
update storage.objects set name = name where bucket_id = 'friend-photos';
select 'another person can''t replace: ' || ((select count(*) from storage.objects where bucket_id = 'friend-photos') = 0) as result;
delete from storage.objects where bucket_id = 'friend-photos';
reset role;
select 'another person can''t remove: ' || ((select count(*) from storage.objects where bucket_id = 'friend-photos' and name like '10000000-0000-0000-0000-000000000005/%') = 1) as result;
savepoint s1;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into storage.objects (bucket_id, name, owner) values ('friend-photos', '10000000-0000-0000-0000-000000000005/planted.jpg', '10000000-0000-0000-0000-000000000001');
rollback to savepoint s1;
reset role;
select 'another person can''t add to my folder: ' || ((select count(*) from storage.objects where name like '%planted%') = 0) as result;
select set_config('request.jwt.claims', '', true);
set local role anon;
select 'signed out sees none: ' || ((select count(*) from storage.objects where bucket_id = 'friend-photos') = 0) as result;
reset role;
select 'bucket is private: ' || ((select public from storage.buckets where id = 'friend-photos') = false) as result;
rollback;
