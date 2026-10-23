// 2026-10-10: cards and notes survive a page refresh.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const people = [U.aisha, U.david];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [people]);
  const C = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hi!', 300], [U.david, 'Hello!', 299]]);
  const [m] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date, activity, time_zone)
     values ($1, 1, current_date - 1, $2, 'occurred', current_date - 1, current_date - 1, 'Coffee', 'America/Los_Angeles') returning id`, [C, U.aisha]);
  await q(`update connections set meetup_count = 1 where id=$1`, [C]);
  await q(`select raise_intervention($1, 'post_meetup_reflection', $2, jsonb_build_object('meetup_id', $3::text))`, [C, U.aisha, m.id]);
  await q(`insert into remember_asks (user_id, meetup_id) values ($1, $2) on conflict do nothing`, [U.aisha, m.id]);

  const a = await L.as(U.aisha);
  // 1. "How did it go?" then refresh
  await go(a.page, `/thread/${C}`, 3500);
  let t = await text(a.page);
  check('How did it go shows', t.includes('How did it go with David C.?'), t.slice(0, 600));
  await a.page.getByText("Really good, I'd like to see David C. again").click();
  await a.page.waitForTimeout(2000);
  check('Follow-up shows', (await text(a.page)).includes('Glad it went well'));
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('After refresh: follow-up still there', t.includes('Glad it went well') && t.includes('Tell David C.'), t.slice(0, 900));
  await tap(a.page, 'Not now', { nth: 0, wait: 2000 });
  await go(a.page, `/thread/${C}`, 3500);
  check('After Not now and refresh: gone', !(await text(a.page)).includes('Glad it went well'));

  // 2. "Did you meet?" No > We moved it, then refresh
  await q(`delete from connection_interventions where connection_id=$1`, [C]);
  const [m2] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, activity, time_zone)
     values ($1, 2, current_date - 1, $2, 'confirmed', current_date - 1, 'Walk', 'America/Los_Angeles') returning id`, [C, U.david]);
  await q(`select raise_intervention($1, 'meetup_occurrence_check', $2, jsonb_build_object('meetup_id', $3::text, 'confirmed_date', (current_date - 1)::text))`, [C, U.aisha, m2.id]);
  await go(a.page, `/thread/${C}`, 3500);
  await tap(a.page, 'No', { exact: true, wait: 1000 });
  await tap(a.page, 'We moved it', { wait: 2000 });
  check('Moved: add the new day', (await text(a.page)).includes('Add the new day to the plan'));
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('After refresh: still asks to add the new day', t.includes('Add the new day to the plan'), t.slice(0, 900));
  await tap(a.page, 'Later', { nth: 0, wait: 2000 });
  await go(a.page, `/thread/${C}`, 3500);
  check('After Later and refresh: gone', !(await text(a.page)).includes('Add the new day to the plan'));

  // 3. A note being written, then refresh
  await go(a.page, `/remember/${C}`, 3000);
  if (await a.page.getByRole('tab', { name: /^Notes/ }).count()) { await a.page.getByRole('tab', { name: /^Notes/ }).click(); await a.page.waitForTimeout(800); }
  await tap(a.page, 'Write something down', { nth: 0, wait: 1000 });
  await a.page.fill('textarea[aria-label="Your note"]', 'Half written thought about his sister');
  await a.page.waitForTimeout(500);
  await go(a.page, `/remember/${C}`, 3000);
  const val = await a.page.locator('textarea[aria-label="Your note"]').inputValue().catch(() => '');
  check('After refresh: note still open with its text', val === 'Half written thought about his sister', val);
  await tap(a.page, 'Cancel', { wait: 1000 });
  await go(a.page, `/remember/${C}`, 3000);
  check('After Cancel and refresh: closed', (await a.page.locator('textarea[aria-label="Your note"]').count()) === 0);

  // The word "AI" never appears in the app (2026-10-10)
  for (const path of ['/home', '/inbox', '/settings', '/premium', `/thread/${C}`, `/remember/${C}`, '/profile']) {
    await go(a.page, path, 2500, { expand: false });
    const tx = await text(a.page);
    check(`No "AI" on ${path.split('/')[1]}`, !/\bAI\b/.test(tx), (tx.match(/.{0,60}\bAI\b.{0,60}/) || [''])[0]);
  }
  await go(a.page, `/thread/${C}`, 2500, { expand: false });
  await tap(a.page, 'Reminders', { wait: 1000 });
  const tx = await text(a.page);
  check('Reminders sheet: no "your turn", no "Settings for all chats"', tx.includes('Reminders for this chat') && !/your turn/i.test(tx) && !tx.includes('Settings for all chats'), tx.slice(0, 600));
  await go(a.page, '/premium', 2500);
  const px = await text(a.page);
  check('Payment page: no "after the pilot" section', px.includes('Free during the pilot') && !px.includes('What comes after the pilot') && !px.includes('$30'), px.slice(0, 500));

  await L.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
