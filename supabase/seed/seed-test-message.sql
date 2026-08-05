-- F16/inbox verification: seeds a real connection + a short message
-- exchange between two seeded test profiles (Robert Kim and Aisha Bello,
-- a confirmed mutual match, man seeking woman <-> woman seeking man) so
-- the inbox has something real to display without needing a live two-
-- session messaging test first. Plain public-schema data (connections,
-- messages), not auth.users, applied directly.
--
-- Robert's message is pre-marked read (read_at set), Aisha's reply is
-- left unread (read_at null), so switching into Robert's account via the
-- Dev tab shows a genuine unread conversation in his inbox, exercising
-- that visual state, not just the read one.
do $$
declare
  robert_id uuid;
  aisha_id uuid;
  conn_id uuid;
begin
  select id into robert_id from public.users where phone = '+15555500104';
  select id into aisha_id from public.users where phone = '+15555500103';

  insert into public.connections (user_a_id, user_b_id, status)
  values (robert_id, aisha_id, 'pending')
  on conflict (user_a_id, user_b_id) do update set status = excluded.status
  returning id into conn_id;

  insert into public.messages (connection_id, sender_id, content, type, read_at, created_at)
  values
    (
      conn_id, robert_id,
      'Hi Aisha, I saw we''re both into hiking and reading. Would love to grab coffee sometime if you''re up for it.',
      'text', now() - interval '50 minutes', now() - interval '1 hour'
    ),
    (
      conn_id, aisha_id,
      'I''d like that. I''m usually free on weekends, what works for you?',
      'text', null, now() - interval '45 minutes'
    );
end $$;
