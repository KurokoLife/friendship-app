// 2026-10-10: "Remind me later" on the after-a-good-meetup card.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [[U.aisha, U.david]]);
  await q(`delete from prompt_settings where user_id = any($1)`, [[U.aisha, U.david]]);
  // Video offers have their own "Not now"; mark them seen so taps hit this card.
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium','video_show_up','video_friendship_grows','video_first_meetup']) k on conflict do nothing`, [[U.aisha, U.david, U.mochi]]).catch(() => {});
  const E = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hi!', 100], [U.david, 'Hello!', 99]]);
  const [mt] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date, time_zone)
           values ($1, 1, current_date - 1, $2, 'occurred', current_date - 1, current_date - 1, 'America/Los_Angeles') returning id`, [E, U.aisha]);
  await q(`select raise_intervention($1, 'post_meetup_reflection', $2, jsonb_build_object('meetup_id', $3::text))`, [E, U.aisha, mt.id]);
  const rows = () => q(`select status, snoozed_until from connection_interventions where connection_id=$1 and intervention_type='share_reminder' order by created_at`, [E]);

  const a = await L.as(U.aisha);
  await go(a.page, `/thread/${E}`, 3500);
  await tap(a.page, "Really good, I'd like to see David C. again", { wait: 1500 });
  let t = await text(a.page);
  check('Choices include Remind me later', t.includes('Tell David C.') && t.includes('Remind me later') && t.includes('Plan another meetup') && t.includes('Not now'), t.slice(-700));
  await tap(a.page, 'Remind me later', { wait: 800 });
  t = await text(a.page);
  check('Asks when', t.includes('When should we ask you again?') && t.includes('Tomorrow') && t.includes('In 3 days') && t.includes('In a week') && t.includes('Back'));
  await tap(a.page, 'Back', { wait: 600 });
  check('Back returns to the choices', (await text(a.page)).includes('Would you like to tell David C. how it was'));
  await tap(a.page, 'Remind me later', { wait: 800 });
  await tap(a.page, 'In 3 days', { wait: 1500 });
  t = await text(a.page);
  check('Confirms the day, private', t.includes("this chat will ask again if you'd like to tell David C. how it was") && t.includes("Only you'll see it."), t.slice(-500));
  let r = await rows();
  const hrs = r[0] ? (new Date(r[0].snoozed_until) - Date.now()) / 3600000 : 0;
  check('One waiting reminder, about 3 days out', r.length === 1 && r[0].status === 'snoozed' && hrs > 71 && hrs < 73, JSON.stringify(r));
  await tap(a.page, 'Close', { wait: 1500 });
  await go(a.page, `/thread/${E}`, 3500);
  t = await text(a.page);
  check('Not shown before its day', !t.includes('You asked to be reminded') && !t.includes('Would you like to tell'));
  await q(`select run_friendship_journey_sweep_all(now() + interval '1 day')`);
  await go(a.page, `/thread/${E}`, 3500);
  check('Sweep does not bring it early', !(await text(a.page)).includes('You asked to be reminded'));

  // Test tab button, acting as Aisha
  const mo = await L.as(U.mochi);
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Aisha Bello', { wait: 3000 });
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'David C.');
  await tap(mo.page, 'Reminder due now', { wait: 1500 });
  t = await text(mo.page);
  check('Test tab: reminder due now', t.includes('The reminder is due now.'), t.slice(-600));

  await go(a.page, `/thread/${E}`, 3500);
  t = await text(a.page);
  check('Comes back on its day', t.includes('You asked to be reminded. Would you like to tell David C. how your meetup on') && t.includes('If you already have, you can close this.'), t.slice(-700));
  r = await rows();
  check('Now pending', r.length === 1 && r[0].status === 'pending', JSON.stringify(r));
  const d = await L.as(U.david);
  await go(d.page, `/thread/${E}`, 3500);
  check('David never sees it', !(await text(d.page)).includes('You asked to be reminded'));

  // Remind me later again: replaces, doesn't pile up
  await tap(a.page, 'Remind me later', { wait: 800 });
  await tap(a.page, 'Tomorrow', { wait: 1500 });
  r = await rows();
  check('Again: old one put away, one new waiting', r.length === 2 && r[0].status === 'dismissed' && r[1].status === 'snoozed', JSON.stringify(r));
  await tap(a.page, 'Close', { wait: 1200 });
  check('Gone after Close', !(await text(a.page)).includes('You asked to be reminded'));

  // Due again: Tell David, in her own words
  await q(`update connection_interventions set snoozed_until = now() - interval '1 minute' where connection_id=$1 and status='snoozed'`, [E]);
  await go(a.page, `/thread/${E}`, 3500);
  await tap(a.page, 'Tell David C.', { wait: 1000 });
  for (const inp of await a.page.locator('textarea').all()) {
    if ((await inp.inputValue().catch(() => 'x')) === '') { await inp.fill('Thanks again for the walk, it was lovely.'); break; }
  }
  await tap(a.page, 'Send', { nth: 0, wait: 2500 });
  const msg = await q(`select content from messages where connection_id=$1 and sender_id=$2 order by created_at desc limit 1`, [E, U.aisha]);
  check('Shared in her own words', msg[0]?.content === 'Thanks again for the walk, it was lovely.', msg[0]?.content);
  r = await rows();
  check('Reminder put away after telling', r.every((x) => x.status !== 'pending' && x.status !== 'snoozed'), JSON.stringify(r));
  await go(a.page, `/thread/${E}`, 3500);
  check('Not shown again', !(await text(a.page)).includes('You asked to be reminded'));

  // Not now
  await q(`insert into connection_interventions (connection_id, target_user_id, intervention_type, status, snoozed_until, payload)
           values ($1, $2, 'share_reminder', 'snoozed', now() - interval '1 minute', jsonb_build_object('meetup_id', $3::text, 'meetup_date', (current_date - 1)::text))`, [E, U.aisha, mt.id]);
  await go(a.page, `/thread/${E}`, 3500);
  t = await text(a.page);
  check('Due reminder shows (for Not now)', t.includes('You asked to be reminded'), t.slice(-600));
  await tap(a.page, 'Not now', { wait: 1500 });
  r = await rows();
  check('Not now: dismissed', r[r.length - 1].status === 'dismissed', JSON.stringify(r));
  await go(a.page, `/thread/${E}`, 3500);
  check('"Not now" puts it away for good', !(await text(a.page)).includes('You asked to be reminded'));

  // A closed chat drops a waiting reminder
  await q(`insert into connection_interventions (connection_id, target_user_id, intervention_type, status, snoozed_until, payload)
           values ($1, $2, 'share_reminder', 'snoozed', now() + interval '2 days', jsonb_build_object('meetup_id', $3::text))`, [E, U.aisha, mt.id]);
  await q(`update connections set status='ended' where id=$1`, [E]);
  r = await rows();
  check('Ending the chat drops the waiting reminder', !r.some((x) => x.status === 'snoozed'), JSON.stringify(r));

  // Bad input
  const bad = await q(`select 1`).then(async () => {
    try { await q(`select remind_me_to_share($1, 30)`, [mt.id]); return 'no error'; } catch (e) { return e.message; }
  });
  check('Days limited (and needs a signed-in person)', bad !== 'no error', bad);

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e); process.exit(1); });
