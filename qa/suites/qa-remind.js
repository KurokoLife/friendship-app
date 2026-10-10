// 2026-10-10: quieter reminders, check-ins, reminder settings, phone layout,
// sharing how a meetup went, safety tips.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const seedAll = (await q(`select id from users where _is_seed_account(id)`)).map((r) => r.id);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [seedAll]);
  await q(`delete from prompt_settings`);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium','video_show_up','video_friendship_grows','video_first_meetup']) k on conflict do nothing`, [[...seedAll, U.mochi]]).catch(() => {});
  await q(`update profiles set response_time='1-2 days' where user_id = any($1)`, [seedAll]);
  const sweep = () => q(`select run_friendship_journey_sweep_all(now())`);

  // ---- A. Getting started: one gentle note, at their pace ----
  const A = await L.makeChat(U.aisha, U.robert, [[U.aisha, 'Hi Robert! I saw you like hiking too.', 30]]);
  await sweep();
  let iv = await q(`select intervention_type from connection_interventions where connection_id=$1 and status='pending'`, [A]);
  check('30h, Robert replies in 1-2 days: no note yet', iv.length === 0, JSON.stringify(iv));
  await q(`update messages set created_at = now() - interval '50 hours' where connection_id=$1`, [A]);
  await sweep();
  const r = await L.as(U.robert);
  await go(r.page, `/thread/${A}`, 3500);
  let t = await text(r.page);
  check('50h: gentle hello note for Robert', t.includes("Aisha B. said hello and hasn't heard back yet") && t.includes("it won't ask again"), t.slice(0, 900));
  check('No "your turn" wording', !/your turn/i.test(t));
  check('Note offers Reply, Later, Not for me', t.includes('Reply') && t.includes('Later') && t.includes('Not for me'));
  await go(r.page, '/inbox', 3000);
  t = await text(r.page);
  check('Inbox: New hellos section', t.includes('NEW HELLOS') || t.includes('New hellos'), t.slice(0, 600));
  check('Inbox: label is not "your turn"', t.includes('New hello, waiting to hear back') && !/your turn/i.test(t));
  await go(r.page, `/thread/${A}`, 3500);
  await tap(r.page, 'Later', { wait: 1500 });
  await q(`update messages set created_at = now() - interval '100 hours' where connection_id=$1`, [A]);
  await sweep();
  await go(r.page, `/thread/${A}`, 3500);
  t = await text(r.page);
  check('Later: no second or third reminder', !t.includes("hasn't heard back yet"), t.slice(0, 500));
  iv = await q(`select intervention_type from connection_interventions where connection_id=$1 and status='pending'`, [A]);
  check('Still only one reminder ever raised for Robert', iv.length === 0, JSON.stringify(iv));

  // ---- B. Both wrote, then quiet: check-in, never closes ----
  const B = await L.makeChat(U.maria, U.david, [[U.david, 'That was fun to talk about!', 200], [U.maria, 'Good night!', 192]]);
  await sweep();
  iv = await q(`select intervention_type, target_user_id from connection_interventions where connection_id=$1 and status='pending' order by 1`, [B]);
  check('8 quiet days after both wrote: no reply reminders', !iv.some((i) => i.intervention_type.startsWith('no_ghost')), JSON.stringify(iv));
  check('Check-in for both people', iv.filter((i) => i.intervention_type === 'conversation_restart_prompt').length === 2, JSON.stringify(iv));
  const st = await q(`select status from connections where id=$1`, [B]);
  check('Chat did not close on its own', st[0].status === 'active', st[0].status);
  const m = await L.as(U.maria, { viewport: { width: 390, height: 844 } });
  await go(m.page, `/thread/${B}`, 3500);
  t = await text(m.page);
  check("Maria's check-in: calm, no turn", t.includes("It's been quiet with David C. for a bit. That's normal.") && !/your turn/i.test(t), t.slice(0, 900));
  check('No "waiting" line for Maria once both wrote', !t.includes('Sometimes it takes a few days'), '');
  await tap(m.page, 'Say hi', { wait: 1200 });
  t = await text(m.page);
  check('Say hi: starters to finish in own words', t.includes('Hi! Just checking in,') || t.includes('Thinking of you,'), t.slice(-900));
  await tap(m.page, 'Hi! Just checking in, ', { exact: false, nth: 0, wait: 800 });
  const box = m.page.locator('textarea, input[type="text"]').filter({ hasText: '' });
  const inputs = await m.page.locator('textarea').all();
  let typed = false;
  for (const inp of inputs) {
    const v = await inp.inputValue().catch(() => '');
    if (v.startsWith('Hi! Just checking in')) { await inp.fill(v + 'how was the trip?'); typed = true; break; }
  }
  check('Starter is in the box', typed);
  await tap(m.page, 'Send', { nth: 0, wait: 2500 });
  const sent = await q(`select content from messages where connection_id=$1 and sender_id=$2 order by created_at desc limit 1`, [B, U.maria]);
  check('Check-in message sent in her own words', sent[0]?.content === 'Hi! Just checking in, how was the trip?', sent[0]?.content);
  iv = await q(`select count(*)::int n from connection_interventions where connection_id=$1 and status='pending' and intervention_type='conversation_restart_prompt'`, [B]);
  check('A new message puts check-ins away for both', iv[0].n === 0, iv[0].n);

  // David turns check-ins off for this chat from the card
  await q(`update messages set created_at = created_at - interval '7 days' where connection_id=$1`, [B]);
  await q(`delete from connection_interventions where connection_id=$1`, [B]);
  await sweep();
  const d = await L.as(U.david);
  await go(d.page, `/thread/${B}`, 3500);
  t = await text(d.page);
  check('David sees a check-in', t.includes("It's been quiet with Maria S. for a bit"), t.slice(0, 700));
  await tap(d.page, 'Turn off check-ins for this chat', { wait: 2000 });
  t = await text(d.page);
  check('Turned off: card gone', !t.includes("It's been quiet with Maria S."), '');
  const ps = await q(`select kind, connection_id from prompt_settings where user_id=$1`, [U.david]);
  check('Saved as off for this chat only', ps.length === 1 && ps[0].kind === 'check_in' && ps[0].connection_id === B, JSON.stringify(ps));

  // ---- C. Reminders for this chat, and Settings ----
  await tap(d.page, 'Reminders', { wait: 1500 });
  t = await text(d.page);
  check('Reminders sheet shows the five kinds', ['Check-ins', 'Nudges to meet in person', 'Morning-of check', 'Calendar question', 'Short guides'].every((k) => t.includes(k)), t.slice(-1200));
  check('Says the hello note stays on', t.includes('Always on: when someone says hello'));
  const switches = d.page.getByRole('switch');
  check('Check-ins switch shows off', (await switches.nth(0).isChecked()) === false);
  await switches.nth(1).click();
  await d.page.waitForTimeout(1200);
  const ps2 = await q(`select kind from prompt_settings where user_id=$1 and connection_id=$2 order by 1`, [U.david, B]);
  check('Meet nudges turned off for this chat', ps2.map((x) => x.kind).join(',') === 'check_in,meet_nudge', JSON.stringify(ps2));
  await tap(d.page, 'Done', { wait: 800 });
  await go(d.page, '/settings', 3000);
  t = await text(d.page);
  check('Settings: Reminders and nudges section', (t.includes('REMINDERS AND NUDGES') || t.includes('Reminders and nudges')) && t.includes('Calendar question'), t.slice(0, 600));
  const sSwitches = d.page.getByRole('switch');
  await sSwitches.nth(3).click();
  await d.page.waitForTimeout(1500);
  const ps3 = await q(`select kind from prompt_settings where user_id=$1 and connection_id is null`, [U.david]);
  check('Calendar question off for all chats', ps3.length === 1 && ps3[0].kind === 'calendar', JSON.stringify(ps3));

  // ---- D. Phone layout: slim plan bar, messages in view ----
  await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, confirmed_at, confirmed_by, start_time, place, activity, time_zone)
           values ($1, 1, current_date + 5, $2, 'confirmed', current_date + 5, now(), $3, '14:00', 'Blue Bottle Coffee', 'Coffee', 'America/Los_Angeles')`, [B, U.maria, U.david]);
  await go(m.page, `/thread/${B}`, 4000, { expand: false });
  t = await text(m.page);
  check('Plan bar: one line with the plan', t.includes('Next meetup:') && t.includes('Blue Bottle Coffee'), t.slice(0, 600));
  check('Plan bar: calendar question in the bar', t.includes('Add it to your calendar?'));
  check('Plan details hidden until opened', !t.includes('Change plan'));
  check("Plan exists: no 'Let's plan something'", !t.includes("Let's plan something"));
  check('Reminders link in the chat', t.includes('Reminders'));
  const last = m.page.getByText('Hi! Just checking in, how was the trip?');
  const bb = await last.boundingBox();
  check('Latest message visible on a phone screen', bb && bb.y > 0 && bb.y + bb.height < 844, JSON.stringify(bb));
  await m.page.screenshot({ path: require('path').join(__dirname, '../.local/r1-phone-bar.png') });
  await L.openPlan(m.page);
  t = await text(m.page);
  check('Open: full plan with actions', t.includes('Change plan') && t.includes('Cancel plan') && t.includes("You're both set. Add it to your calendar?"), t.slice(0, 900));
  check('First meetup: safety tips link', t.includes('Safety tips for meeting someone new'));
  await tap(m.page, 'Safety tips for meeting someone new', { wait: 1200 });
  t = await text(m.page);
  check('Safety tips: calm, mention sharing location', t.includes('Pick a public place') && t.includes('share your location with a friend') && t.includes('Call 911'), t.slice(-1500));
  await m.page.screenshot({ path: require('path').join(__dirname, '../.local/r2-tips.png') });
  await tap(m.page, 'Close', { wait: 800 });
  await tap(m.page, 'Hide', { wait: 800 });
  check('Hide: back to the slim bar', !(await text(m.page)).includes('Change plan'));
  await go(d.page, `/thread/${B}`, 4000, { expand: false });
  t = await text(d.page);
  check('David turned the calendar question off: not asked', t.includes('Next meetup:') && !t.includes('Add it to your calendar?'), t.slice(0, 500));

  // ---- E. After a good meetup: tell them how it was (optional) ----
  const E = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hi!', 100], [U.david, 'Hello!', 99]]);
  const [mt] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date, time_zone)
           values ($1, 1, current_date - 1, $2, 'occurred', current_date - 1, current_date - 1, 'America/Los_Angeles') returning id`, [E, U.aisha]);
  await q(`select raise_intervention($1, 'post_meetup_reflection', $2, jsonb_build_object('meetup_id', $3::text))`, [E, U.aisha, mt.id]);
  const a = await L.as(U.aisha);
  await go(a.page, `/thread/${E}`, 3500);
  await tap(a.page, "Really good, I'd like to see David C. again", { wait: 1500 });
  t = await text(a.page);
  check('Asks whether to tell David, equal choices', t.includes('Would you like to tell David C. how it was for you? Only if you want to.') && t.includes('Tell David C.') && t.includes('Plan another meetup') && t.includes('Not now'), t.slice(-900));
  check('No push to plan', !t.includes('grow fastest'));
  await tap(a.page, 'Tell David C.', { wait: 1000 });
  for (const inp of await a.page.locator('textarea').all()) {
    if ((await inp.inputValue().catch(() => 'x')) === '') { await inp.fill('I really enjoyed the walk, thank you!'); break; }
  }
  await tap(a.page, 'Send', { nth: 0, wait: 2500 });
  const share = await q(`select content from messages where connection_id=$1 and sender_id=$2 order by created_at desc limit 1`, [E, U.aisha]);
  check('Shared in her own words', share[0]?.content === 'I really enjoyed the walk, thank you!', share[0]?.content);

  // ---- F. First meetup plan: safety tips and the home note ----
  const F = await L.makeChat(U.robert, U.maria, [[U.robert, 'Hey!', 10], [U.maria, 'Hi!', 9]]);
  const rb = await L.as(U.robert);
  await go(rb.page, `/thread/${F}`, 3500);
  await tap(rb.page, 'Plan a meetup', { nth: 0, wait: 1500 });
  t = await text(rb.page);
  check('Editor: safety tips link for a first meetup', t.includes('Safety tips'), t.slice(0, 900));
  const placeInput = rb.page.getByPlaceholder(/place|search/i).first();
  await placeInput.fill('my place');
  await rb.page.waitForTimeout(1200);
  t = await text(rb.page);
  check('Home place: gentle note, nothing blocked', t.includes('a public place can make it easier for both of you to relax'), t.slice(0, 1200));
  await rb.page.screenshot({ path: require('path').join(__dirname, '../.local/r3-home-note.png') });

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e); process.exit(1); });
