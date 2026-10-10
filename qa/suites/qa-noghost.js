// Quiet chats (rebuilt 2026-10-10): one gentle note only while just one
// person has written; once both have, a check-in at 5 quiet days and
// nothing closes on its own. Driven through the Test tab like a tester would.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [[U.maria, U.david]]);
  await q(`delete from prompt_settings where user_id = any($1)`, [[U.maria, U.david]]);
  await q(`update profiles set response_time='1-2 days' where user_id = any($1)`, [[U.maria, U.david]]);
  // Only David has written so far.
  const C = await L.makeChat(U.maria, U.david, [[U.david, 'Hey Maria, how is your week going?', 1]]);

  const d = await L.as(U.mochi);
  await go(d.page, '/dev', 3000);
  check('Test tab loads for the admin', (await text(d.page)).includes('Act as a test account'));
  await tap(d.page, 'David Chen', { wait: 3000 });
  check('Acting as David lands on Home with the banner', d.page.url().includes('/home') && (await text(d.page)).includes('Testing as David Chen'), d.page.url());
  await go(d.page, '/dev', 3000);
  check("Test tab shows David's chats", (await text(d.page)).includes('Pick a chat') && (await text(d.page)).includes('Maria S.'));
  await tap(d.page, 'Maria S.');
  let t = await text(d.page);
  check('Picking a chat shows the quiet-chat tools', t.includes('Quiet chat') && t.includes('Meetups'), t.slice(0, 400));

  // 1 day: Maria replies in 1-2 days, so nothing yet
  await tap(d.page, '1 day', { wait: 1500 });
  t = await text(d.page);
  check('1 day: tool explains the one gentle note', t.includes('Only David C. has written so far') && t.includes('one gentle note'), t.match(/The last message[^]*?\)\./)?.[0]);
  const m = await L.as(U.maria);
  await go(m.page, `/thread/${C}`, 3500);
  check('1 day: Maria (replies in 1-2 days) sees nothing yet', !(await text(m.page)).includes("hasn't heard back yet"));

  // 1.5 days: calm note for David
  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Maria S.');
  await tap(d.page, '1.5 days', { wait: 1500 });
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('1.5 days: David sees the calm "few days" note', t.includes('Sometimes it takes a few days'), t.slice(0, 250));

  // 2 days: Maria's one gentle note
  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Maria S.');
  await tap(d.page, '2 days', { wait: 1500 });
  check('2 days: tool says Maria sees the note', (await text(d.page)).includes('Maria S. now sees a gentle note'));
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('Maria sees the gentle hello note', t.includes("David C. said hello and hasn't heard back yet.") && t.includes("won't ask again"), t.slice(0, 700));
  check('Never "your turn"', !/your turn/i.test(t));
  await go(m.page, '/inbox', 3000);
  t = await text(m.page);
  check('Inbox: New hellos', (t.includes('NEW HELLOS') || t.includes('New hellos')) && t.includes('New hello, waiting to hear back'), t.slice(0, 400));

  // Later -> gone for good
  await go(m.page, `/thread/${C}`, 3500);
  await tap(m.page, 'Later', { wait: 2000 });
  check('"Later" puts the note away', !(await text(m.page)).includes("hasn't heard back yet"));
  await q(`select run_friendship_journey_sweep_all(now() + interval '3 days')`);
  await go(m.page, `/thread/${C}`, 3500);
  check('No second or third reminder later', !(await text(m.page)).includes("hasn't heard back yet"));

  // Reply with a starter: a starter alone can't be sent
  await q(`delete from connection_interventions where connection_id=$1`, [C]);
  await q(`select run_no_ghost_check_v2($1, now() + interval '49 hours')`, [C]);
  await go(m.page, `/thread/${C}`, 3500);
  await tap(m.page, 'Reply');
  await tap(m.page, 'Hi! Sorry for the slow reply', { exact: false, nth: 0, wait: 400 });
  await tap(m.page, 'Send', { nth: 0, wait: 800 });
  check('Starter alone cannot be sent', (await q(`select count(*)::int n from messages where connection_id=$1`, [C]))[0].n === 1);
  await m.page.getByPlaceholder('Write it in your own words').fill('Hi! Sorry for the slow reply, work was a lot. Mine is going okay!');
  await tap(m.page, 'Send', { nth: 0, wait: 2000 });
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('Reply appears in the chat', t.includes('work was a lot'));
  check('Note clears after replying', !t.includes("hasn't heard back yet"));

  // Now both have written: quiet is just quiet
  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Maria S.');
  await tap(d.page, '3 days', { wait: 1500 });
  t = await text(d.page);
  check('Both wrote, 3 days: tool says no reply reminders', t.includes('You have both written, so there are no reply reminders'), t.match(/The last message[^]*?days\./)?.[0]);
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('No reminder card, no "waiting" line', !t.includes("hasn't heard back yet") && !t.includes('Sometimes it takes a few days'), t.slice(0, 400));

  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Maria S.');
  await tap(d.page, '5 days', { wait: 1500 });
  check('5 days: tool says both see a check-in', (await text(d.page)).includes('Both people now see a check-in card'));
  await go(d.page, `/thread/${C}`, 3500);
  check('David sees the check-in', (await text(d.page)).includes("It's been quiet with Maria S. for a bit. That's normal."));
  await go(m.page, `/thread/${C}`, 3500);
  check('Maria sees the check-in', (await text(m.page)).includes("It's been quiet with David C. for a bit."));
  await tap(m.page, 'Not now', { wait: 1500 });
  check('"Not now" puts it away', !(await text(m.page)).includes("It's been quiet with David C."));
  await q(`select run_friendship_journey_sweep_all(now())`);
  await go(m.page, `/thread/${C}`, 3500);
  check('It stays away for this quiet stretch', !(await text(m.page)).includes("It's been quiet with David C."));

  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Maria S.');
  await tap(d.page, '7 days', { wait: 1500 });
  const st = await q(`select status from connections where id=$1`, [C]);
  check('7 days after both wrote: chat stays open', st[0].status === 'active', st[0].status);
  await go(m.page, `/thread/${C}`, 3500);
  check('Compose box still there', (await m.page.getByPlaceholder('Write a message').count()) === 1);

  // A chat where nobody answered closes quietly at 7 days
  const C2 = await L.makeChat(U.david, U.aisha, [[U.david, 'Hi Aisha!', 1]]);
  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Aisha B.');
  await tap(d.page, '5+ days', { wait: 1500 });
  await go(d.page, `/thread/${C2}`, 3500);
  t = await text(d.page);
  check('Only David wrote, 5+ days: "It\'s been quiet" for David', t.includes("It's been quiet since your hello to Aisha B.") && t.includes('closes quietly after 7'), t.slice(0, 600));
  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Aisha B.');
  await tap(d.page, '7 days', { wait: 1500 });
  check('7 days: tool says it closed quietly', (await text(d.page)).includes('closed quietly'));
  check('Unanswered chat is now inactive', (await q(`select status from connections where id=$1`, [C2]))[0].status === 'inactive');
  await go(d.page, '/dev', 3000);
  await tap(d.page, 'Aisha B. (inactive)');
  await tap(d.page, 'Reopen this chat', { wait: 1500 });
  check('Reopen this chat works', (await q(`select status from connections where id=$1`, [C2]))[0].status === 'active');

  // Send as the other person
  await tap(d.page, 'Maria S.');
  await d.page.getByPlaceholder('A message from Maria S.').fill('Test message from Maria');
  await tap(d.page, 'Send as Maria S.', { wait: 1500 });
  const lastMsg = await q(`select sender_id, content from messages where connection_id=$1 order by created_at desc limit 1`, [C]);
  check('Send as the other person works', lastMsg[0].sender_id === U.maria && lastMsg[0].content === 'Test message from Maria');

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish(); });
