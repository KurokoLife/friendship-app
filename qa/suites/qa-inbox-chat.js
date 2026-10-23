// 2026-10-10: a full pass over Inbox and the chat, the founder's request
// ("check all features in Inbox"). Each step is one thing a person does.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const MOCHI = '10000000-0000-0000-0000-0000000000aa';
  const people = [U.david, MOCHI, U.maria];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [people]);
  await q(`delete from reports where reporter_id = $1`, [U.david]).catch(() => {});
  await q(`delete from blocks where blocker_id = any($1) or blocked_id = any($1)`, [people]);
  await q(`update users set selfie_verified_at = now() where id = any($1)`, [people]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile']) k on conflict do nothing`, [people]).catch(() => {});

  // David and Mochi: Mochi asks for money and to move to another app
  const C = await L.makeChat(U.david, MOCHI, [
    [U.david, 'Hi Mochi, nice to match!', 30],
    [MOCHI, 'money', 2],
    [MOCHI, "let's get off the app and talk on whatsup", 1],
  ]);
  // David and Maria: they've met twice, Maria wrote last
  const C2 = await L.makeChat(U.david, U.maria, [[U.david, 'Coffee again soon?', 5], [U.maria, 'Yes! Saturday?', 4]]);
  await q(`update connections set status='active' where id = any($1)`, [[C, C2]]);
  await q(`update connections set meetup_count = 2 where id = $1`, [C2]);

  await q(`update profiles set care_style = 'people showing up for me' where user_id = $1`, [MOCHI]);
  const d = await L.as(U.david);
  await go(d.page, '/inbox', 3500);
  let t = await text(d.page);
  check('Inbox: tabs, Active first', t.includes('Active') && t.includes('Friends') && t.includes('Past'));
  check('Inbox: capacity line', t.includes('2 of 3 active conversations'), t.slice(0, 400));
  check('Inbox: both chats with last message', t.includes('Mochi') && t.includes('talk on whatsup') && t.includes('Maria S.') && t.includes('Yes! Saturday?'), t.slice(0, 800));
  check('Inbox: meetup count on the row', (t.match(/Met 2 times/g) || []).length === 1);
  check('Inbox: no read receipts', !/\b(seen|read at|delivered)\b/i.test(t));

  // Open the chat with Mochi
  await d.page.getByText('talk on whatsup').first().click();
  await d.page.waitForTimeout(3500);
  t = await text(d.page);
  check('Chat opens from Inbox', d.page.url().includes(`/thread/${C}`));
  // 2026-10-23: calmer header; Pause / End / Report / Block in the ⋯ menu.
  check('Chat: header is just the name, reply pace and ⋯', t.includes('Mochi W. ›') && t.includes('⋯') && !t.includes('Pause End Report Block'));
  await d.page.getByLabel(/Chat options/).first().click(); await d.page.waitForTimeout(700);
  t = await text(d.page);
  check('Chat: ⋯ menu has Pause, End, Report, Block', ['Pause', 'End', 'Report', 'Block'].every((w) => t.includes(w)) && t.includes('Stop all contact right away.'));
  await tap(d.page, 'Cancel', { wait: 600 });
  t = await text(d.page);
  check('Chat: notes bar; no "Plan a meetup" bar', t.includes('What I want to remember about Mochi') && !t.includes('Plan a meetup') && !t.includes('No meetup planned yet'));
  check('Chat: meeting in person line', t.includes('Limen is for meeting in person. Chatting is how you get there.'));
  check('Chat: scam note shown once', (t.match(/Limen will never ask you for money/g) || []).length === 1, t.slice(0, 900));
  check('Chat: Reflect first, "ask them" line, Reminders; no "Another way to see it"', t.includes('More tips') && /Not sure what they meant\? Ask them\. Only they know\.|Asking one question back keeps things going\.|A follow-up question, like 'how did that go\?', helps people feel heard\./.test(t) && t.includes('Reminders') && !t.includes('Another way to see it'));
  check('Chat: no read receipts', !/\b(seen|read at|delivered)\b/i.test(t));
  check('Chat: no guide offer inside the chat', !t.includes('A short guide on showing up'));
  check('Chat: care words are no longer in the header', !t.includes('likes care'));
  await d.page.getByText('Mochi W. ›', { exact: false }).first().click(); await d.page.waitForTimeout(3500);
  t = await text(d.page);
  check('Their profile starts with how they like care', t.includes('How Mochi likes care') && t.includes('“people showing up for me”'), t.slice(0, 500));
  await go(d.page, `/thread/${C}`, 3500, { expand: false });

  // Send a message in your own words
  await d.page.locator('textarea[placeholder="Write a message"], input[placeholder="Write a message"]').first().fill('Limen is for meeting, how about a walk Sunday?');
  await tap(d.page, 'Send', { wait: 2500 });
  const sent = await q(`select count(*)::int n from messages where connection_id=$1 and sender_id=$2 and content like 'Limen is for meeting, how about%'`, [C, U.david]);
  check('Send: message saved', sent[0].n === 1);
  await d.page.waitForTimeout(1500);
  check('Send: shows in the chat', (await text(d.page)).includes('how about a walk Sunday?'), (await text(d.page)).slice(-600));

  // Reflect first shows the tips
  await d.page.locator('textarea[placeholder="Write a message"], input[placeholder="Write a message"]').first().fill('a draft');
  await d.page.waitForTimeout(400);
  check('No "Check" link, even with a draft (removed)', (await d.page.getByText('Check', { exact: true }).count()) === 0);
  await tap(d.page, 'More tips', { exact: false, wait: 800 });
  t = await text(d.page);
  check('One line under the box: the tip, then More tips', !t.includes('Reflect first'));
  check('Reflect first: "ask them" tip', t.includes('Not sure what they meant? Ask them, like "what do you mean?"'));
  check('Reflect first: tips for replying', t.includes('Hide tips') && t.includes('Notice') && t.includes('Keep it going') && t.includes('Reply to one thing they said before adding your own news.'), t.slice(-900));
  await d.page.locator('textarea[placeholder="Write a message"], input[placeholder="Write a message"]').first().fill('');
  await tap(d.page, 'Hide tips', { exact: false, wait: 500 });
  await go(d.page, `/thread/${C}`, 3000);

  // Reminders sheet
  await tap(d.page, 'Reminders', { wait: 1000 });
  t = await text(d.page);
  check('Reminders: one switch for this chat', t.includes('Reminders for this chat') && t.includes('Reminders and nudges with Mochi') && (await d.page.getByRole('switch').count()) === 1);
  await tap(d.page, 'Done', { wait: 800 });

  // The other side: Mochi sees David's new message in Inbox
  const m = await L.as(MOCHI);
  await go(m.page, '/inbox', 3000);
  t = await text(m.page);
  check("Mochi's Inbox shows David's new message", t.includes('David C.') && t.includes('how about a walk Sunday?'), t.slice(0, 500));
  await go(m.page, `/thread/${C}`, 3000);
  check('Sender of the money message sees no warning', !(await text(m.page)).includes('Limen will never ask you for money'));

  // After they meet, the scam note is no longer shown
  await q(`update connections set meetup_count = 1 where id=$1`, [C]);
  await go(d.page, `/thread/${C}`, 3000);
  check('After meeting: no scam note', !(await text(d.page)).includes('Limen will never ask you for money'));
  await q(`update connections set meetup_count = 0 where id=$1`, [C]);

  // Report
  await go(d.page, `/thread/${C}`, 3000);
  await L.chatAction(d.page, 'Report');
  t = await text(d.page);
  check('Report: 8 categories', ['Fake identity', 'Harassment', 'Romantic or sexual misuse', 'Hate', 'Scam', 'Unsafe meetup', 'Impersonation', 'Other'].every((c) => t.includes(c)), t.slice(0, 600));
  await tap(d.page, 'Scam', { wait: 500 });
  await tap(d.page, 'Submit report', { wait: 2000 });
  check('Report: submitted', (await text(d.page)).includes('Report submitted'));
  const rep = await q(`select count(*)::int n from reports where reporter_id=$1`, [U.david]);
  check('Report: saved', rep[0].n === 1);
  await tap(d.page, 'Done', { wait: 800 });

  // Block
  await go(d.page, `/thread/${C}`, 3000);
  await L.chatAction(d.page, 'Block');
  await tap(d.page, 'Block', { wait: 2500 });
  t = await text(d.page);
  check('Block: chat is read-only', t.includes('blocked') || t.includes('Messaging is unavailable'), t.slice(0, 600));
  const st = await q(`select status from connections where id=$1`, [C]);
  check('Block: saved', st[0].status === 'blocked', st[0].status);
  await go(d.page, '/inbox', 3000);
  await tap(d.page, 'Past', { wait: 1000 });
  check('Block: chat moves to Past', (await text(d.page)).includes('Blocked'));

  // Back button
  await go(d.page, `/thread/${C2}`, 3000);
  await tap(d.page, 'Back', { nth: 0, wait: 2000 });
  check('Back returns to Inbox', d.page.url().includes('/inbox'), d.page.url());

  await L.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
