const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
const ELENA = '10000000-0000-0000-0000-000000000009';
const PRIYA = '10000000-0000-0000-0000-000000000005';

// Runs an RPC as a given user straight in Postgres (like the app would).
async function rpcAs(user, sql, params = []) {
  const { Client } = require('pg');
  const cl = new Client({ host: 'localhost', port: 5433, user: 'postgres', database: 'limen' });
  await cl.connect();
  try {
    await cl.query('begin');
    await cl.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: user, role: 'authenticated' })]);
    await cl.query('set local role authenticated');
    const r = await cl.query(sql, params);
    await cl.query('commit');
    return { rows: r.rows };
  } catch (e) {
    await cl.query('rollback').catch(() => {});
    return { error: e.message };
  } finally {
    await cl.end();
  }
}

(async () => {
  await L.start();
  const all = [U.maria, U.david, U.aisha, U.robert, ELENA, PRIYA];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from blocks where blocker_id = any($1) or blocked_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`delete from friendship_events where actor_user_id = any($1)`, [all]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium']) k on conflict do nothing`, [all.concat(U.mochi)]).catch(() => {});
  await q(`update users set selfie_verified_at = null where id = $1`, [U.aisha]);
  await q(`delete from selfie_checks where user_id = any($1)`, [all]);
  await q(`update users set selfie_verified_at = now() where id = any($1)`, [[U.david, U.robert, ELENA]]);

  // ---- 1. Reconnecting needs no second selfie ----
  const C1 = await L.makeChat(U.aisha, U.maria, [[U.aisha, 'Hi Maria', 30], [U.maria, 'Hi Aisha!', 29]]);
  await q(`update connections set status='inactive' where id=$1`, [C1]);
  await q(`insert into interests (from_user_id,to_user_id) values ($1,$2),($2,$1) on conflict do nothing`, [U.aisha, U.maria]);
  const a = await L.as(U.aisha);
  await go(a.page, `/candidate/${U.maria}`, 3500);
  let t = await text(a.page);
  check('Past chat profile shows "Say hello again"', t.includes('Say hello again'));
  await tap(a.page, 'Say hello again', { wait: 3000 });
  check('Unverified Aisha is not sent to the selfie page', !a.page.url().includes('selfie'), a.page.url());
  check('Say hello again opens the chat', a.page.url().includes(`/thread/${C1}`), a.page.url());
  check('Chat is open again', (await q(`select status from connections where id=$1`, [C1]))[0].status === 'pending');

  // Ended chat: Start over, still no selfie
  await q(`update connections set status='ended' where id=$1`, [C1]);
  await go(a.page, `/candidate/${U.maria}`, 3500);
  await tap(a.page, 'Say hello again', { wait: 2500 });
  t = await text(a.page);
  check('Ended chat asks to start over (not selfie)', !a.page.url().includes('selfie') && /start over/i.test(t), a.page.url());
  await tap(a.page, 'Start over', { wait: 3000 });
  check('Start over opens the chat', a.page.url().includes(`/thread/${C1}`) && (await q(`select status from connections where id=$1`, [C1]))[0].status === 'pending');

  // Someone she never talked to still needs the selfie check
  const r1 = await rpcAs(U.aisha, `select express_interest($1)`, [PRIYA]);
  check('New person still needs the selfie check', r1.error && r1.error.includes('not_verified'), r1.error);

  // ---- 2. Capacity wording ----
  const m = await L.as(U.maria);
  await go(m.page, '/inbox', 3000);
  t = await text(m.page);
  check('Inbox capacity line is calm and clear', /of 3 active conversations · room for \d more/.test(t), t.match(/\d of 3 active[^·]*· room for \d more/)?.[0]);
  // Fill to 3 active
  await L.makeChat(U.maria, U.david, [[U.maria, 'a', 5], [U.david, 'b', 4]]);
  await L.makeChat(U.maria, U.robert, [[U.maria, 'a', 5], [U.robert, 'b', 4]]);
  await q(`update connections set status='active' where id=$1`, [C1]);
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'back again','text')`, [C1, U.maria]);
  await go(m.page, '/inbox', 3000);
  t = await text(m.page);
  check('At the limit, wording explains why and what to do', t.includes('3 of 3 active conversations. Limen keeps it to 3 at a time') && t.includes('pause or end one'));
  const cap = await rpcAs(U.maria, `select create_connection_with_capacity_check($1)`, [PRIYA]);
  check('A 4th conversation is refused at the limit', cap.error && cap.error.includes('active_cap_reached'), cap.error);
  // Reopening a closed chat also respects the limit
  const C2 = await L.makeChat(U.maria, ELENA, [[U.maria, 'x', 50], [ELENA, 'y', 49]]);
  await q(`update connections set status='inactive' where id=$1`, [C2]);
  const reopen = await rpcAs(U.maria, `select create_connection_with_capacity_check($1)`, [ELENA]);
  check('Reopening a closed chat is refused at the limit', reopen.error && reopen.error.includes('active_cap_reached'), reopen.error);
  // Graduated chats don't count
  await q(`update connections set status='graduated' where user_a_id=$1 and user_b_id=$2`, [U.maria, U.robert]);
  const cnt = await rpcAs(U.maria, `select * from my_connection_capacity()`);
  check('Graduated chat no longer counts', cnt.rows && cnt.rows[0].active_count === 2, JSON.stringify(cnt.rows));

  // ---- 3. Matches with no hello ----
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`update users set selfie_verified_at = now() where id = $1`, [U.aisha]);
  await q(`insert into interests (from_user_id,to_user_id) values ($1,$2),($2,$1)`, [U.maria, ELENA]);
  const [c3] = await q(`insert into connections (user_a_id, user_b_id, status, opened_at) values ($1,$2,'pending', now() - interval '1 day') returning id`, [U.maria, ELENA]);
  const C3 = c3.id;
  await go(m.page, `/thread/${C3}`, 3500);
  t = await text(m.page);
  check('Day 1: no nudge yet', !t.includes('A short hello is plenty'));
  await go(m.page, '/inbox', 3000);
  check('Day 1: Inbox says say hello when ready', (await text(m.page)).includes("Say hello when you're ready"));
  await q(`update connections set opened_at = now() - interval '3 days' where id=$1`, [C3]);
  await go(m.page, `/thread/${C3}`, 3500);
  t = await text(m.page);
  check('Day 3: chat shows the gentle hello nudge with a close date', t.includes('A short hello is plenty') && t.includes('this match closes quietly'));
  const e = await L.as(ELENA);
  await go(e.page, `/thread/${C3}`, 3500);
  check('The other person sees the same nudge', (await text(e.page)).includes('A short hello is plenty'));
  await go(m.page, '/inbox', 3000);
  check('Day 3: Inbox mentions the quiet close', (await text(m.page)).includes('this match closes quietly'));
  await q(`select run_friendship_journey_sweep_all(now())`);
  check('Sweep leaves a 3-day match open', (await q(`select status from connections where id=$1`, [C3]))[0].status === 'pending');
  // Test tool, as admin acting as Maria
  const mo = await L.as(U.mochi);
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Maria Santos', { wait: 3000 });
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Elena T.', { wait: 1500 });
  t = await text(mo.page);
  check('Test tab shows the no-hello tools', t.includes('Match with no hello yet') && t.includes('Make it 14 days old'));
  await tap(mo.page, 'Make it 14 days old', { wait: 2000 });
  t = await text(mo.page);
  check('14 days: test tool says it closed', t.includes('closed quietly'), t.match(/The match[^.]*\./)?.[0]);
  check('Match is now inactive', (await q(`select status from connections where id=$1`, [C3]))[0].status === 'inactive');
  await go(m.page, '/inbox', 3000);
  check('Closed match leaves Inbox', !(await text(m.page)).includes('You both chose to connect'));
  // Saying hello again gives a fresh 14 days
  const again = await rpcAs(ELENA, `select express_interest($1)`, [U.maria]);
  check('Saying hello again reopens the match', !again.error, again.error);
  const fresh = await q(`select status, opened_at > now() - interval '1 minute' as fresh from connections where id=$1`, [C3]);
  check('Reopened match gets a fresh 14 days', fresh[0].status === 'pending' && fresh[0].fresh, JSON.stringify(fresh));
  await q(`select run_friendship_journey_sweep_all(now())`);
  check('Fresh match is not closed by the next check', (await q(`select status from connections where id=$1`, [C3]))[0].status === 'pending');
  await q(`update connections set opened_at = now() - interval '15 days' where id=$1`, [C3]);
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'Hello!','text')`, [C3, ELENA]);
  await q(`select run_friendship_journey_sweep_all(now())`);
  check('A match where someone said hello never auto-closes this way', (await q(`select status from connections where id=$1`, [C3]))[0].status === 'pending');

  // ---- 4. Pause rules ----
  const C4 = await L.makeChat(U.maria, U.david, [[U.david, 'How was your week?', 30], [U.maria, 'Good! Yours?', 29], [U.david, 'Busy but fine', 28]]);
  await go(m.page, `/thread/${C4}`, 3500);
  t = await text(m.page);
  check('Header shows Pause · End · Report · Block', ['Pause', 'End', 'Report', 'Block'].every((w) => t.includes(w)));
  await tap(m.page, 'Pause', { wait: 1200 });
  t = await text(m.page);
  check('Pause explains the rules', t.includes('Pause this chat?') && t.includes("doesn't count toward your 3 active conversations") && t.includes('will see your note'));
  check('Pause offers 3 days / 1 week / 2 weeks only', t.includes('3 days') && t.includes('1 week') && t.includes('2 weeks') && !t.includes("when I'm ready"));
  await tap(m.page, '3 days', { wait: 600 });
  check('Pause asks for a short note', t.includes('A short note to David C.'));
  await tap(m.page, 'Pause and send', { wait: 1200 });
  check('Pause without a note does nothing', (await q(`select status from connections where id=$1`, [C4]))[0].status !== 'paused');
  await m.page.getByPlaceholder('Write it in your own words').fill('Work is wild this week, back after the weekend!');
  await tap(m.page, 'Pause and send', { wait: 2500 });
  t = await text(m.page);
  check('The note is sent as a message', t.includes('Work is wild this week, back after the weekend!'));
  check('Pauser sees "You paused this chat until"', t.includes('You paused this chat until'));
  check('Pauser can resume', t.includes('Resume now'));
  check('No compose box while paused', !(await m.page.getByPlaceholder('Write a message').count()));
  const pd = await q(`select paused_until between now() + interval '71 hours' and now() + interval '73 hours' as ok from connection_pause_details where connection_id=$1`, [C4]);
  check('Pause ends in 3 days', pd[0]?.ok);
  const d = await L.as(U.david);
  await go(d.page, `/thread/${C4}`, 3500);
  t = await text(d.page);
  check('Other person sees who paused and until when', t.includes('Maria S. paused this chat until'));
  check('Other person sees the note', t.includes('Work is wild this week, back after the weekend!'));
  check('Other person can end instead of waiting', t.includes('End the connection') && !t.includes('Resume now'));
  check('Other person has no compose box while paused', !(await d.page.getByPlaceholder('Write a message').count()));
  await go(d.page, '/inbox', 3000);
  check('Inbox shows "Paused until"', /Paused until \w+ \d+/.test(await text(d.page)));
  const sendWhilePaused = await rpcAs(U.david, `insert into messages (connection_id, sender_id, content, type) values ($1,$2,'hi','text')`, [C4, U.david]);
  check('Database refuses messages while paused', sendWhilePaused.error && /row-level security/.test(sendWhilePaused.error), sendWhilePaused.error);
  const otherResume = await rpcAs(U.david, `select resume_connection_early($1)`, [C4]);
  check('Only the pauser can resume early', otherResume.error && otherResume.error.includes('only_pauser_can_resume'), otherResume.error);
  const oldPause = await rpcAs(U.david, `select resume_connection($1)`, [C4]);
  check('Old resume shortcut is closed', oldPause.error && /permission denied/.test(oldPause.error), oldPause.error);
  const capP = await rpcAs(U.maria, `select active_count from my_connection_capacity()`);
  check('Paused chat does not count as active', capP.rows && capP.rows[0].active_count === 0, JSON.stringify(capP.rows));
  const tooLong = await rpcAs(U.maria, `select pause_connection_with_duration($1, now() + interval '30 days', 'x')`, [C4]);
  check('Cannot pause twice at once', tooLong.error && tooLong.error.includes('already_paused'), tooLong.error);

  // Resume now, then try long and repeated pauses
  await go(m.page, `/thread/${C4}`, 3500);
  await tap(m.page, 'Resume now', { wait: 2500 });
  t = await text(m.page);
  check('Resume now reopens the chat', !t.includes('You paused this chat') && (await m.page.getByPlaceholder('Write a message').count()) > 0);
  const noNote = await rpcAs(U.maria, `select pause_connection_with_duration($1, now() + interval '7 days', '   ')`, [C4]);
  check('A pause without a note is refused', noNote.error && noNote.error.includes('pause_note_required'), noNote.error);
  const oldSig = await rpcAs(U.maria, `select pause_connection_with_duration($1, now() + interval '7 days')`, [C4]);
  check('The old no-note pause is gone', oldSig.error && /does not exist/.test(oldSig.error), oldSig.error);
  const long = await rpcAs(U.maria, `select pause_connection_with_duration($1, now() + interval '30 days', 'note')`, [C4]);
  check('A pause longer than 2 weeks is refused', long.error && long.error.includes('pause_length'), long.error);
  const p2 = await rpcAs(U.maria, `select pause_connection_with_duration($1, now() + interval '7 days', 'Need a week')`, [C4]);
  check('Second pause in a month is allowed', !p2.error, p2.error);
  await rpcAs(U.maria, `select resume_connection_early($1)`, [C4]);
  const p3 = await rpcAs(U.maria, `select pause_connection_with_duration($1, now() + interval '7 days', 'again')`, [C4]);
  check('Third pause in a month is refused', p3.error && p3.error.includes('pause_limit'), p3.error);
  const p3d = await rpcAs(U.david, `select pause_connection_with_duration($1, now() + interval '3 days', 'Short break')`, [C4]);
  check('The other person can still pause it themselves', !p3d.error, p3d.error);

  // A long-quiet chat that comes back from a pause doesn't instantly close
  await q(`update messages set created_at = created_at - interval '10 days' where connection_id=$1`, [C4]);
  await q(`update connection_pause_details set paused_until = now() - interval '1 minute' where connection_id=$1`, [C4]);
  await q(`select run_friendship_journey_sweep_all(now())`);
  const after = await q(`select status, resumed_at is not null as resumed from connections where id=$1`, [C4]);
  check('Pause ends on its own on the end date', after[0].status === 'active' && after[0].resumed, JSON.stringify(after));
  const rem = await q(`select count(*)::int n from connection_interventions where connection_id=$1 and status='pending' and intervention_type like 'no_ghost%'`, [C4]);
  check('No instant reminders or auto-close right after a pause ends', rem[0].n === 0);
  await q(`select run_friendship_journey_sweep_all(now() + interval '25 hours')`);
  const rem2 = await q(`select intervention_type from connection_interventions where connection_id=$1 and status='pending' and intervention_type like 'no_ghost%'`, [C4]);
  check('Both have written: no reply reminders after the pause either (2026-10-10)', rem2.length === 0, JSON.stringify(rem2));
  await q(`select run_friendship_journey_sweep_all(now() + interval '5 days 1 hour')`);
  const ci = await q(`select count(*)::int n from connection_interventions where connection_id=$1 and status='pending' and intervention_type='conversation_restart_prompt'`, [C4]);
  check('Check-in counts from the end of the pause, not before', ci[0].n === 2, ci[0].n);

  // Old pause with no end date resumes after 2 weeks
  await q(`update connections set status='paused' where id=$1`, [C4]);
  await q(`insert into connection_pause_details (connection_id, paused_by, paused_until, created_at) values ($1,$2,null, now() - interval '15 days') on conflict (connection_id) do update set paused_until=null, created_at = now() - interval '15 days'`, [C4, U.maria]);
  await q(`select run_pause_auto_resume_sweep(now())`);
  check('Old open-ended pauses end after 2 weeks', (await q(`select status from connections where id=$1`, [C4]))[0].status === 'active');

  // Pausing from the header offers the same choices (2026-10-10: the
  // reminder card's "I need more time" is gone with the second reminder).
  await q(`delete from connection_interventions where connection_id=$1`, [C4]);
  await q(`delete from friendship_events where connection_id=$1`, [C4]);
  await go(m.page, `/thread/${C4}`, 3500);
  await tap(m.page, 'Pause', { nth: 0, wait: 1200 });
  t = await text(m.page);
  check('Pause offers 3 days / 1 week / 2 weeks', t.includes('3 days') && t.includes('2 weeks') && t.includes('will see your note'));
  await tap(m.page, '2 weeks', { wait: 600 });
  await tap(m.page, 'I need a little time,', { exact: false, wait: 600 });
  await tap(m.page, 'Pause and send', { wait: 1000 });
  check('A starter alone is not enough', (await q(`select status from connections where id=$1`, [C4]))[0].status !== 'paused');
  await m.page.getByPlaceholder('Write it in your own words').fill('I need a little time, family stuff. Talk soon.');
  await tap(m.page, 'Pause and send', { wait: 2500 });
  check('Pauses for 2 weeks', (await q(`select paused_until > now() + interval '13 days' as ok from connection_pause_details where connection_id=$1`, [C4]))[0]?.ok);

  // Test tool: End the pause now
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Maria Santos', { wait: 3000 });
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'David C. (paused)', { wait: 1500 });
  await tap(mo.page, 'End the pause now', { wait: 2000 });
  check('Test tool ends the pause', (await text(mo.page)).includes('The pause has ended') && (await q(`select status from connections where id=$1`, [C4]))[0].status === 'active');

  await q(`update users set selfie_verified_at = null where id = $1`, [U.aisha]);
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
