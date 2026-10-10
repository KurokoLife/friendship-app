// 2026-10-10: Discover one a day, Saved and Interested for 30 days, Inbox tabs.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const all = Object.values(U);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`delete from match_suggestions where user_id = any($1)`, [all]);
  await q(`update users set selfie_verified_at = now(), paused_until = null`);
  await q(`insert into coach_marks_seen (user_id, mark_key) select $1, k from unnest(array['tab_discover','tab_saved','tab_inbox']) k on conflict do nothing`, [U.aisha]).catch(() => {});

  const a = await L.as(U.aisha);
  await go(a.page, '/home', 4000);
  let t = await text(a.page);
  check('Heading and one person today', t.includes('People for you') && t.includes('One new person each day'), t.slice(0, 400));
  let n = await q(`select count(*)::int n from match_suggestions where user_id=$1`, [U.aisha]);
  check('One suggestion added', n[0].n === 1, n[0].n);
  await go(a.page, '/home', 3000);
  n = await q(`select count(*)::int n from match_suggestions where user_id=$1`, [U.aisha]);
  check('Opening again the same day adds nobody', n[0].n === 1, n[0].n);

  // Next day: yesterday's person stays, a new one arrives
  await q(`update match_suggestions set created_at = created_at - interval '1 day', suggested_date = suggested_date - 1 where user_id=$1`, [U.aisha]);
  await go(a.page, '/home', 4000);
  const cards = await a.page.getByText('Not for me', { exact: true }).count();
  check('Next day: 2 people waiting', cards === 2, cards);

  // Interested moves the person to Saved, with the 30-day note
  const rows = await q(`select s.candidate_id, p.display_name from match_suggestions s join profiles p on p.user_id = s.candidate_id where s.user_id=$1 order by s.created_at`, [U.aisha]);
  const first = rows[0].display_name.split(' ')[0];
  const second = rows[1].display_name.split(' ')[0];
  await a.page.getByText('Interested', { exact: true }).first().click();
  await a.page.waitForTimeout(2000);
  t = await text(a.page);
  check('Interested: the founder\'s wording with 30 days', t.includes('Sent privately. If') && t.includes('is only told if that happens') && t.includes("If it doesn't become mutual within 30 days, it closes on its own."), t.slice(0, 700));
  check('Interested: card leaves Discover', (await a.page.getByText('Not for me', { exact: true }).count()) === 1);
  await tap(a.page, 'Save', { wait: 2000 });
  t = await text(a.page);
  check('Save: card leaves Discover, note about 30 days', t.includes('is in Saved for the next 30 days') && (await a.page.getByText('Not for me', { exact: true }).count()) === 0, t.slice(0, 600));

  await go(a.page, '/saved', 3000);
  t = await text(a.page);
  check('Saved shows "You said Interested" waiting', t.toLowerCase().includes('you said interested') && t.includes('If it becomes mutual, the chat will open here.') && t.includes('Closes on its own on'), t.slice(0, 700));
  check('Saved shows the saved person, 1 of 5', t.toLowerCase().includes('saved · 1 of 5') && t.includes('Saved until'), t.slice(0, 700));

  // After 30 days the interest closes, shown once
  await q(`update interests set created_at = now() - interval '31 days' where from_user_id=$1`, [U.aisha]);
  await go(a.page, '/saved', 3000);
  t = await text(a.page);
  check('Closed interest: calm note shown', t.includes('has come to a close') && t.includes('New people are on the way.') && !t.toLowerCase().includes('you said interested'), t.slice(0, 700));
  await go(a.page, '/saved', 3000);
  check('Closed note shows only once', !(await text(a.page)).includes('has come to a close'));

  // A chat with someone: they never show in Discover; Inbox tabs
  const C1 = await L.makeChat(U.aisha, U.robert, [[U.aisha, 'Hi', 30], [U.robert, 'Hello', 29]]);
  const C2 = await L.makeChat(U.aisha, U.marcus || '10000000-0000-0000-0000-000000000006', [[U.aisha, 'Hi', 30], ['10000000-0000-0000-0000-000000000006', 'Hey', 29]]);
  const C3 = await L.makeChat(U.aisha, '10000000-0000-0000-0000-000000000007', [[U.aisha, 'Hi', 30], ['10000000-0000-0000-0000-000000000007', 'Hey', 29]]);
  await q(`update connections set status='active' where id = any($1)`, [[C1, C2]]);
  await q(`update connections set status='paused' where id=$1`, [C3]);
  await go(a.page, '/home', 3500);
  t = await text(a.page);
  check('3 active chats (one paused): nobody in Discover', t.includes("You're giving 3 people your attention right now.") && (await a.page.getByText('Not for me', { exact: true }).count()) === 0, t.slice(0, 500));

  await go(a.page, '/inbox', 3000);
  t = await text(a.page);
  check('Inbox opens on Active with tabs', t.includes('Active') && t.includes('Friends') && t.includes('Past') && t.includes('3 of 3 active conversations, paused ones included'), t.slice(0, 500));
  check('Paused chat is in Active', t.includes('Paused'), t.slice(0, 900));

  // End one, block another: both go to Past; the blocked one can be hidden
  await q(`update connections set status='ended' where id=$1`, [C1]);
  await q(`update connections set status='blocked' where id=$1`, [C2]);
  await q(`insert into blocks (blocker_id, blocked_id) values ($1, $2) on conflict do nothing`, [U.aisha, '10000000-0000-0000-0000-000000000006']);
  await go(a.page, '/inbox', 3000);
  await tap(a.page, 'Past', { wait: 1200 });
  t = await text(a.page);
  check('Past shows ended and blocked chats', t.includes('Ended') && t.includes('Blocked') && t.includes('Hide this chat'), t.slice(0, 900));
  await tap(a.page, 'Hide this chat', { wait: 1500 });
  t = await text(a.page);
  check('Hidden: chat leaves the list, can be shown', !t.includes('Blocked') && t.includes('Hidden chats (1)'), t.slice(0, 900));
  const hid = await q(`select count(*)::int n from hidden_chats where user_id=$1`, [U.aisha]);
  check('Hide is saved', hid[0].n === 1);
  await tap(a.page, 'Friends', { wait: 800 });
  check('Friends tab, calm empty note', (await text(a.page)).includes('keep your friendship going outside Limen'));

  // The other side of the block only sees "Not available"
  const m = await L.as('10000000-0000-0000-0000-000000000006');
  await go(m.page, '/inbox', 3000);
  await tap(m.page, 'Past', { wait: 1000 });
  t = await text(m.page);
  check('Blocked person sees "Not available", never "Blocked"', t.includes('Not available') && !t.includes('Blocked'), t.slice(0, 600));

  await L.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
