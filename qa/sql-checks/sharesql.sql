-- 2026-10-22: shared friendship answers and care words need a real chat.
\set ON_ERROR_STOP 0
begin;
update profiles set share_friendship_experience = true, care_style = 'Ask me how my week went',
  friendship_experience = '{"hardestCurrentStep":["Suggesting a meetup"],"growthFactors":["x"]}'::jsonb
  where user_id = '10000000-0000-0000-0000-000000000003';
-- A stranger (no connection at all) sees nothing.
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;
select 'stranger sees nothing: ' || (public.get_connected_friendship_answers('10000000-0000-0000-0000-000000000003') is null) as result;
reset role;
-- Someone who only saved the profile sees nothing (answers or care words).
insert into connections (user_a_id, user_b_id, saved, saved_at) values ('10000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000003', true, now());
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;
select 'saved-only sees no answers: ' || (public.get_connected_friendship_answers('10000000-0000-0000-0000-000000000003') is null) as result;
select 'saved-only sees no care words: ' || (public.get_connection_care_style((select id from connections where user_a_id='10000000-0000-0000-0000-000000000009' and user_b_id='10000000-0000-0000-0000-000000000003')) is null) as result;
reset role;
-- A real chat: the four now-questions show, past ones never.
update connections set status = 'active', saved = false where user_a_id='10000000-0000-0000-0000-000000000009' and user_b_id='10000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
set local role authenticated;
select 'connected sees hardest: ' || (public.get_connected_friendship_answers('10000000-0000-0000-0000-000000000003') -> 'hardestCurrentStep' ->> 0 = 'Suggesting a meetup') as result;
select 'past answers never shared: ' || (not (public.get_connected_friendship_answers('10000000-0000-0000-0000-000000000003') ? 'growthFactors')) as result;
select 'connected sees care words: ' || (public.get_connection_care_style((select id from connections where user_a_id='10000000-0000-0000-0000-000000000009' and user_b_id='10000000-0000-0000-0000-000000000003')) is not null) as result;
reset role;
rollback;
