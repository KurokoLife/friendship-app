// 2026-10-09 (6): gentle nudges to meet in person.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const seedAll = (await q(`select id from users where _is_seed_account(id)`)).map((r) => r.id);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [seedAll]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium']) k on conflict do nothing`, [[...seedAll, U.mochi]]).catch(() => {});
  const C = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hello!', 5], [U.david, 'Hi Aisha!', 4]]);
  await q(`update connections set last_plan_activity_at = now() - interval '1 day' where id=$1`, [C]);

  // A new chat: no card yet
  const a = await L.as(U.aisha);
  await go(a.page, `/thread/${C}`, 3500);
  let t = await text(a.page);
  check('New chat: no nudge yet', !t.includes('have been talking'), t.slice(0, 400));
  check('Chat says what Limen is for', t.includes('Limen is for meeting in person. Chatting is how you get there.'));

  // Test tab tool, as the admin acting as Aisha
  const m = await L.as(U.mochi);
  await go(m.page, '/dev', 3000);
  await tap(m.page, 'Aisha Bello', { wait: 3000 });
  await go(m.page, '/dev', 3000);
  await tap(m.page, 'David C.', { exact: false, nth: 0 });
  t = await text(m.page);
  check('Test tab: nudge tools shown for the chat', t.includes('Nudge to meet in person') && t.includes('3 weeks') && t.includes('6 months'), t.slice(0, 300));
  await tap(m.page, '3 weeks', { wait: 2000 });
  t = await text(m.page);
  check('Test tab: tool reports what it did', t.includes('talking for 22 days'), t.slice(-600));
  const after = await q(`select status from connections where id=$1`, [C]);
  check('Moving messages back did not close the chat', after[0].status === 'active' || after[0].status === null, after[0].status);
  await q(`select run_friendship_journey_sweep_all(now())`).catch(() => {});
  const iv = await q(`select intervention_type from connection_interventions where connection_id=$1 and status='pending'`, [C]);
  check('No reply reminder fired from the moved messages', iv.length === 0, JSON.stringify(iv));

  // 3 weeks: card, Not yet
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('3 weeks: gentle card', t.includes('You and David have been talking for a few weeks') && t.includes('meeting in person is where a friendship really grows') && t.includes('Not yet'), t.slice(0, 700));
  const d = await L.as(U.david);
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('David gets his own card', t.includes('You and Aisha have been talking for a few weeks'), t.slice(0, 600));
  await tap(a.page, 'Not yet', { wait: 1500 });
  t = await text(a.page);
  check('Not yet: card goes away', !t.includes('have been talking for a few weeks'), '');
  await go(a.page, `/thread/${C}`, 3500);
  check('Not yet: stays away after reload', !(await text(a.page)).includes('have been talking for a few weeks'));
  const ans = await q(`select answer, ask_again_at > now() + interval '20 days' later from meet_nudges where connection_id=$1 and user_id=$2`, [C, U.aisha]);
  check('Asks again in 3 weeks', ans[0]?.answer === 'not_yet' && ans[0]?.later, JSON.stringify(ans));
  await go(d.page, `/thread/${C}`, 3500);
  check("Aisha's answer doesn't hide David's card", (await text(d.page)).includes('have been talking for a few weeks'));

  // Let's plan something from the card opens planning
  await tap(d.page, "Let's plan something", { nth: 0, wait: 3000 });
  t = await text(d.page);
  check("Let's plan something opens the planning card", t.includes('So ideas fit you') || t.includes('Pick ideas'), t.slice(0, 500));
  const b = await q(`select status from plan_boards where connection_id=$1`, [C]);
  check('Planning card started', b[0]?.status === 'open');
  await go(a.page, `/thread/${C}`, 3500);
  check('While planning, no nudge for either person', !(await text(a.page)).includes('have been talking'));
  await q(`update plan_boards set status='closed', close_reason='not_now', closed_at=now() where connection_id=$1`, [C]);

  // 2 months: honest check
  await tap(m.page, '2 months', { wait: 2000 });
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('2 months: honest check', t.includes("You and David have been talking for about 2 months and haven't met yet") && t.includes("It's okay either way") && t.includes('Only you see this. This chat uses one of your 3 active chats.'), t.slice(0, 900));
  check('2 months: three equal choices', t.includes("Let's plan something") && t.includes("I'd like to keep chatting for now") && t.includes('End kindly'));
  await tap(a.page, "I'd like to keep chatting for now", { wait: 1500 });
  t = await text(a.page);
  check('Keep chatting: kind reply, nothing closes', t.includes("That's okay. Whenever you're ready") && !t.includes('ended'), t.slice(0, 600));
  await tap(a.page, 'OK', { wait: 1000 });
  await go(a.page, `/thread/${C}`, 3500);
  check('Keep chatting: card stays away', !(await text(a.page)).includes('about 2 months'));
  check('Chat still open', ['active', null].includes((await q(`select status from connections where id=$1`, [C]))[0].status));

  // 6 months: End kindly opens the end flow
  await tap(m.page, '6 months', { wait: 2000 });
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('6 months: asked once more', t.includes('talking for about 6 months'), t.slice(0, 600));
  await tap(a.page, 'End kindly', { wait: 1500 });
  t = await text(a.page);
  check('End kindly opens the honest ending', t.includes('End connection with David C.?') && t.includes('This is a real, deliberate choice'), t.slice(-700));

  // Close the end flow without ending
  await go(a.page, `/thread/${C}`, 3500);

  // "We've already met": David adds a meetup from his card
  await q(`delete from meet_nudges where connection_id=$1`, [C]);
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check("Card offers \"We've already met\"", t.includes("We've already met"), t.slice(0, 900));
  await tap(d.page, "We've already met", { wait: 1000 });
  t = await text(d.page);
  check('Asks when they met, and says Aisha will confirm', t.includes('Met up without planning it here? Add it, and Aisha will be asked to confirm.') && t.includes('When did you meet?'), t.slice(0, 900));
  const day3 = new Date(Date.now() - 3 * 86400000);
  const pad = (n) => String(n).padStart(2, '0');
  const iso3 = `${day3.getFullYear()}-${pad(day3.getMonth() + 1)}-${pad(day3.getDate())}`;
  await d.page.locator('input[aria-label="Date"]').fill(iso3);
  await d.page.locator('input[placeholder="e.g. Coffee"]').fill('Coffee');
  await tap(d.page, 'Add this meetup', { wait: 2500 });
  t = await text(d.page);
  check('Added, Aisha will confirm', t.includes("Added. Aisha will be asked to confirm, and it's counted once they do."), t.slice(0, 700));
  const logged = await q(`select * from meetups where connection_id=$1 and logged_after`, [C]);
  check('Meetup added, waiting for Aisha', logged.length === 1 && logged[0].status === 'confirmed' && logged[0].activity === 'Coffee', JSON.stringify(logged));
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('Aisha is asked to confirm it', t.includes('David C. added a meetup: you two met on') && t.includes('(Coffee). Is that right?') && t.includes("No, that's not right"), t.slice(0, 900));
  check('No nudge while it waits', !t.includes('have been talking'));
  await tap(a.page, 'Yes, we met', { wait: 2500 });
  const cnt = await q(`select meetup_count from connections where id=$1`, [C]);
  check('Both said yes: counted', cnt[0].meetup_count === 1, cnt[0].meetup_count);
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('Plan card shows the meetup count', t.includes('Met 1 time'), t.slice(0, 900));
  check('Just met: no nudge', !t.includes('since you and Aisha last met'));

  // After meeting: the nudges start over from the last meetup ("How did
  // it go?" comes first and is answered elsewhere)
  await go(a.page, `/thread/${C}`, 3500);
  check('After meeting, "How did it go?" comes first', (await text(a.page)).includes('How did it go with David C.?'));
  await q(`update connection_interventions set status='resolved' where connection_id=$1 and intervention_type='post_meetup_reflection'`, [C]);
  await tap(m.page, '3 weeks', { wait: 2000 });
  t = await text(m.page);
  check('Test tool moves the last meetup back', t.includes('Your last meetup in this chat now looks like it was 22 days ago'), t.slice(-500));
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('3 weeks after meeting: asked again', t.includes("It's been a few weeks since you and David last met.") && t.includes("We've met up since then"), t.slice(0, 900));
  await tap(m.page, '2 months', { wait: 2000 });
  await go(a.page, `/thread/${C}`, 3500);
  t = await text(a.page);
  check('2 months after meeting: honest check', t.includes("It's been about 2 months since you and David last met. Would you like to meet up again? It's okay either way."), t.slice(0, 900));

  // Privacy
  const { Client } = require('pg');
  const cl = new Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'limen' });
  await cl.connect();
  await cl.query('begin');
  await cl.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.david, role: 'authenticated' })]);
  await cl.query('set local role authenticated');
  const r = await cl.query(`select count(*)::int n from meet_nudges where user_id=$1`, [U.aisha]);
  await cl.query('rollback');
  await cl.end();
  check("David can't see Aisha's answers", r.rows[0].n === 0);

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
