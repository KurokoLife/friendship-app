-- 2026-10-28: Notifications, stage 3b. What creates a notification, what it
-- says (never the message text), who can read any of it, quiet hours.
-- Every result line should end in "true".
\set ON_ERROR_STOP 0
begin;
delete from connections where user_a_id = '10000000-0000-0000-0000-000000000001' or user_b_id = '10000000-0000-0000-0000-000000000001';
delete from notification_outbox;
insert into connections (id, user_a_id, user_b_id, status)
values ('00000000-0000-0000-0000-00000000cc01', '10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'active');

insert into messages (connection_id, sender_id, content, type) values ('00000000-0000-0000-0000-00000000cc01', '10000000-0000-0000-0000-000000000001', 'My secret words', 'text');
select 'first message: "said hello" to the other person: ' || ((select title from notification_outbox where user_id = '10000000-0000-0000-0000-000000000002' and type = 'hi') = 'Maria S. said hello') as result;
select 'never the message text: ' || (not exists (select 1 from notification_outbox where title ilike '%secret%')) as result;
select 'the sender gets nothing: ' || (not exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000001')) as result;
insert into messages (connection_id, sender_id, content, type) values ('00000000-0000-0000-0000-00000000cc01', '10000000-0000-0000-0000-000000000001', 'More words', 'text');
select 'within the hour: no second notification for that chat: ' || ((select count(*) from notification_outbox where user_id = '10000000-0000-0000-0000-000000000002') = 1) as result;
update notification_outbox set created_at = now() - interval '2 hours';
insert into messages (connection_id, sender_id, content, type) values ('00000000-0000-0000-0000-00000000cc01', '10000000-0000-0000-0000-000000000001', 'Later words', 'text');
select 'an hour later: "New message from Maria S.": ' || exists (select 1 from notification_outbox where type = 'message' and title = 'New message from Maria S.') as result;
insert into messages (connection_id, sender_id, content, type) values ('00000000-0000-0000-0000-00000000cc01', '10000000-0000-0000-0000-000000000001', 'invite', 'plan_invite');
select 'an invite: "invited you to plan something": ' || exists (select 1 from notification_outbox where type = 'plan' and title = 'Maria S. invited you to plan something') as result;

-- Plans
insert into meetups (id, connection_id, sequence_number, proposed_date, proposed_by, status)
values ('00000000-0000-0000-0000-00000000ee01', '00000000-0000-0000-0000-00000000cc01', 1, current_date + 3, '10000000-0000-0000-0000-000000000002', 'proposed');
select 'a time suggested: the other person hears: ' || exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000001' and title = 'David C. suggested a time to meet') as result;
update meetups set status = 'confirmed', confirmed_by = '10000000-0000-0000-0000-000000000001', confirmed_date = current_date + 3, confirmed_at = now() where id = '00000000-0000-0000-0000-00000000ee01';
select 'a plan set: the other person hears, not the one who set it: ' || (exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000002' and title = 'Your plan with Maria S. is set')
  and not exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000001' and title like 'Your plan with%is set')) as result;

-- Privacy
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select 'members can''t read the outbox, even their own: ' || (not has_table_privilege('authenticated', 'public.notification_outbox', 'select')) as result;
select 'members can''t run the sender''s functions: ' || (not has_function_privilege('authenticated', 'public.notifications_to_send(integer, timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.queue_suggestion_notifications()', 'execute')
  and not has_function_privilege('authenticated', 'public.mark_notification_sent(uuid, boolean, boolean, text)', 'execute')) as result;
select register_push_token('ExponentPushToken[david-phone]', 'ios');
select 'own push token readable: ' || ((select count(*) from push_tokens) = 1) as result;
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select 'another person reads none of my push tokens: ' || ((select count(*) from push_tokens) = 0) as result;
insert into notification_settings (user_id) values ('10000000-0000-0000-0000-000000000003') on conflict do nothing;
select 'another person reads none of my settings: ' || ((select count(*) from notification_settings) = 1) as result;
-- The same phone signs in as someone else: the token moves to them.
select register_push_token('ExponentPushToken[david-phone]', 'ios');
reset role;
select 'a phone''s token follows whoever signs in: ' || ((select user_id from push_tokens where token = 'ExponentPushToken[david-phone]') = '10000000-0000-0000-0000-000000000003') as result;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
savepoint bad;
select register_push_token('not a token', 'ios');
rollback to savepoint bad;
reset role;
select 'only real Expo tokens are kept: ' || (not exists (select 1 from push_tokens where token = 'not a token')) as result;
select set_config('request.jwt.claims', '', true);
set local role anon;
select 'signed out: no access: ' || (not has_table_privilege('anon', 'public.push_tokens', 'select') and not has_table_privilege('anon', 'public.notification_settings', 'select')) as result;
reset role;

-- Quiet hours (9pm to 8am by default, the person's own clock)
select 'quiet at 11pm: ' || _in_quiet_hours(true, 21::smallint, 8::smallint, 'America/Los_Angeles', '2026-10-28 23:00 America/Los_Angeles') as result;
select 'quiet at 3am: ' || _in_quiet_hours(true, 21::smallint, 8::smallint, 'America/Los_Angeles', '2026-10-28 03:00 America/Los_Angeles') as result;
select 'not quiet at 8am: ' || (not _in_quiet_hours(true, 21::smallint, 8::smallint, 'America/Los_Angeles', '2026-10-28 08:00 America/Los_Angeles')) as result;
select 'not quiet at 2pm: ' || (not _in_quiet_hours(true, 21::smallint, 8::smallint, 'America/Los_Angeles', '2026-10-28 14:00 America/Los_Angeles')) as result;
select 'quiet hours off: never quiet: ' || (not _in_quiet_hours(false, 21::smallint, 8::smallint, 'America/Los_Angeles', '2026-10-28 03:00 America/Los_Angeles')) as result;
select 'follows the person''s time zone: ' || (_in_quiet_hours(true, 21::smallint, 8::smallint, 'Asia/Tokyo', '2026-10-28 14:00 America/Los_Angeles')) as result;

-- What goes out, and where
update users set email = 'david@example.com' where id = '10000000-0000-0000-0000-000000000002';
update users set email = null where id = '10000000-0000-0000-0000-000000000001';
delete from push_tokens where user_id = '10000000-0000-0000-0000-000000000001';
insert into notification_settings (user_id, quiet_on, message_email) values ('10000000-0000-0000-0000-000000000002', false, false)
on conflict (user_id) do update set quiet_on = false, message_email = false;
create temp table _send as select * from notifications_to_send(100);
select 'email goes to the person''s address: ' || exists (select 1 from _send where user_id = '10000000-0000-0000-0000-000000000002' and type = 'hi' and email = 'david@example.com') as result;
select 'a type turned off for email isn''t emailed: ' || (not exists (select 1 from _send where type = 'message' and email is not null)) as result;
select 'no phone and no email: put away, not sent: ' || (not exists (select 1 from _send where user_id = '10000000-0000-0000-0000-000000000001')
  and exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000001' and last_error = 'nowhere_to_send')) as result;
update notification_settings set quiet_on = true, quiet_start = 0, quiet_end = 23 where user_id = '10000000-0000-0000-0000-000000000002';
update notification_settings set time_zone = 'UTC' where user_id = '10000000-0000-0000-0000-000000000002';
select 'during quiet hours nothing goes out, it waits: ' || ((select count(*) from notifications_to_send(100, date_trunc('day', now()) + interval '12 hours') where user_id = '10000000-0000-0000-0000-000000000002') = 0
  and exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000002' and done_at is null)) as result;
update notification_outbox set created_at = now() - interval '3 days' where user_id = '10000000-0000-0000-0000-000000000002';
select count(*) >= 0 as ran from notifications_to_send(100);
select 'older than 2 days: let go: ' || (true
  and not exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000002' and done_at is null)) as result;

-- A suspended person gets nothing
update users set suspended_at = now() where id = '10000000-0000-0000-0000-000000000002';
insert into messages (connection_id, sender_id, content, type) values ('00000000-0000-0000-0000-00000000cc01', '10000000-0000-0000-0000-000000000001', 'x', 'plan_invite');
select 'suspended: nothing queued: ' || (not exists (select 1 from notification_outbox where user_id = '10000000-0000-0000-0000-000000000002' and done_at is null)) as result;
rollback;
