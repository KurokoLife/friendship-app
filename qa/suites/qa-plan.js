// 2026-10-10: "Let's plan something" ends in one invite sent into the chat.
const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
const ELENA = '10000000-0000-0000-0000-000000000009';
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
  } catch (e) { await cl.query('rollback').catch(() => {}); return { error: e.message }; } finally { await cl.end(); }
}
const msgs = (a, b) => [[a, 'Hi there!', 30], [b, 'Hey, nice to meet you', 29]];
async function board(cid) { return (await q(`select * from plan_boards where connection_id=$1 order by created_at desc limit 1`, [cid]))[0]; }
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
function nextDow(dow, from = 1) {
  const now = new Date();
  for (let i = from; i <= 14; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (d.getDay() === dow) return d;
  }
}

(async () => {
  await L.start();
  const seedAll = (await q(`select id from users where _is_seed_account(id)`)).map((r) => r.id);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [seedAll]);
  await q(`delete from plan_prefs where user_id = any($1)`, [seedAll]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium','video_first_meetup']) k on conflict do nothing`, [seedAll]).catch(() => {});
  await q(`update profiles set availability = array['Weekends'] where user_id = $1`, [U.david]);
  await q(`update profiles set availability = array['Weekday evenings'] where user_id = $1`, [U.maria]);

  // ---------- Main path: Maria invites David ----------
  const cid = await L.makeChat(U.maria, U.david, msgs(U.maria, U.david));
  await q(`update connections set last_plan_activity_at = now() - interval '1 day' where id=$1`, [cid]);
  const m = await L.as(U.maria);
  await go(m.page, `/thread/${cid}`, 3500);
  await tap(m.page, "Let's plan something", { wait: 2500 });
  let t = await text(m.page);
  check('Limits: one short, optional step', t.includes('So ideas fit you (optional)') && t.includes('Skip') && t.includes('never sees your answers'), t.slice(0, 500));
  await tap(m.page, 'Under $15', { wait: 300 });
  await tap(m.page, 'About an hour', { wait: 300 });
  await tap(m.page, '30 min', { wait: 300 });
  await tap(m.page, 'Show ideas', { wait: 4500 });
  t = await text(m.page);
  const ideas = await q(`select * from plan_ideas where connection_id=$1 order by created_at`, [cid]);
  check('Three ideas', ideas.length === 3, ideas.length);
  check('No drinking ideas', !ideas.some((i) => /wine|beer|bar\b|brewer|cocktail|pub\b/i.test(i.title + ' ' + (i.description ?? ''))));
  check('Ideas and times on one screen', t.includes('1. What') && t.includes('2. When are you free?'), t.slice(0, 900));
  check('Says plainly when David is usually free', t.includes('David is usually free: weekends') && t.includes('Those times have an orange outline below. Pick as many times as work for you.'), t.slice(0, 1500));
  const mDraft = await q(`select part, extract(dow from day)::int dow from plan_times where connection_id=$1 and user_id=$2`, [cid, U.maria]);
  check("Maria's usual times start filled in", mDraft.length > 0 && mDraft.every((r) => r.part === 'evening' && r.dow >= 1 && r.dow <= 5), JSON.stringify(mDraft.slice(0, 3)));
  check('Asking for help is offered while picking', t.includes('Not sure? Ask David in the chat'));
  const ideaA = ideas.find((i) => i.slot === 'easy');
  const ideaB = ideas.find((i) => i.slot === 'new');
  await tap(m.page, ideaA.title, { wait: 1800 });
  await tap(m.page, ideaB.title, { wait: 1800 });
  const sat = nextDow(6);
  await m.page.locator(`[aria-label="${dayLabel(sat)} Afternoon"]`).click();
  await m.page.waitForTimeout(1500);
  t = await text(m.page);
  const nTimes = mDraft.length + 1;
  check('Counts ideas and times, private until sent', t.includes(`2 ideas, ${nTimes} times. Only you see this until you send it.`), t.slice(-700));
  let r = await rpcAs(U.david, `select count(*)::int n from plan_times where connection_id=$1`, [cid]);
  check("Maria's draft times are private", r.rows[0].n === 0);
  r = await rpcAs(U.david, `select count(*)::int n from plan_picks where connection_id=$1`, [cid]);
  check("Maria's draft picks are private", r.rows[0].n === 0);
  const d = await L.as(U.david);
  await go(d.page, `/thread/${cid}`, 3500);
  t = await text(d.page);
  check("David doesn't see Maria's unsent draft", !t.includes('Plan something') && !t.includes('Your invite'), t.slice(0, 500));
  await go(m.page, '/inbox', 3500);
  t = await text(m.page);
  check('Inbox (Maria): invite not sent yet', t.includes('Your invite to meet is not sent yet'), t.slice(0, 600));
  await go(m.page, `/thread/${cid}`, 3500);
  t = await text(m.page);
  check('Chat shows her draft summary', t.includes('Plan something') && t.includes(`Your invite: 2 ideas, ${nTimes} times. Not sent yet.`), t.slice(0, 700));
  await tap(m.page, 'Open', { wait: 1500 });
  await tap(m.page, 'Next: add a note', { wait: 1200 });
  t = await text(m.page);
  check('Note step shows the invite: ideas and times', t.includes("Here's your invite.") && t.includes(`• ${ideaA.title}`) && t.includes(`• ${dayLabel(sat)}, afternoon`) && t.includes('Add a note (optional)'), t.slice(0, 1200));
  await tap(m.page, 'Would any of these work for you?...', { wait: 500 });
  t = await text(m.page);
  const sendBtn = m.page.getByText('Send invite to David', { exact: true });
  check('A starter alone is not enough', t.includes('Finish it in your own words, or clear it to send without a note.') && await sendBtn.evaluate((el) => !!el.closest('[aria-disabled="true"]')), t.slice(-600));
  const note = m.page.locator('textarea[placeholder="Write it in your own words"]');
  await note.click(); await note.press('End'); await note.type('Weekends are easiest for me.');
  await m.page.waitForTimeout(300);
  await sendBtn.click();
  await m.page.waitForTimeout(3000);
  const inv = (await q(`select * from plan_invites where connection_id=$1`, [cid]))[0];
  const invMsg = (await q(`select * from messages where id=$1`, [inv?.message_id]))[0];
  check('One invite sent into the chat', inv && inv.ideas.length === 2 && inv.times.length === nTimes && invMsg?.type === 'plan_invite', JSON.stringify(inv));
  check('Her own words lead the message', invMsg?.content.startsWith('Would any of these work for you? Weekends are easiest for me.\n\nIdeas: '), invMsg?.content);
  check('The planning card ends', (await board(cid)).close_reason === 'invited');
  t = await text(m.page);
  check('Maria sees her invite in the chat', t.includes('Your invite to meet') && t.includes('Weekends are easiest for me.') && t.includes('David can reply in the chat, or pick a time here.') && t.includes('Agreed on something in the chat? Set the plan') && !t.includes('Not sent yet'), t.slice(0, 1200));
  check('No "Pick a time" button for the sender', !t.includes('Pick a time that works'));

  // ---------- David picks a time from the invite ----------
  await go(d.page, `/thread/${cid}`, 3500);
  t = await text(d.page);
  check("David sees Maria's invite", t.includes("Maria's invite to meet") && t.includes(ideaB.title) && t.includes('Pick a time that works') && t.includes('Or just reply in the chat.'), t.slice(0, 1200));
  await tap(d.page, 'Pick a time that works', { wait: 800 });
  t = await text(d.page);
  check('Choose an idea and a time', t.includes('Which idea?') && t.includes('Which time?'), t.slice(-800));
  await tap(d.page, ideaB.title, { wait: 300 });
  await tap(d.page, `${dayLabel(sat)}, afternoon`, { wait: 300 });
  await tap(d.page, 'Next: exact time and place', { wait: 1500 });
  t = await text(d.page);
  const actVal = await d.page.locator('input[placeholder="e.g. Coffee, then a walk"]').inputValue();
  check('Plan editor opens filled in from the invite', t.includes("Set the plan from Maria S.'s invite") && actVal === ideaB.title && t.includes('Keep the day and part of the day Maria S. offered'), t.slice(0, 900));
  await tap(d.page, 'Set the plan', { wait: 3000 });
  const mt = (await q(`select * from meetups where connection_id=$1 order by created_at desc limit 1`, [cid]))[0];
  check('Plan is set right away (Maria offered it)', mt?.status === 'confirmed' && mt.proposed_by === U.maria && mt.confirmed_by === U.david && mt.activity === ideaB.title && String(mt.start_time).startsWith('14:00') && iso(mt.confirmed_date) === iso(sat), JSON.stringify(mt));
  const inv2 = (await q(`select * from plan_invites where id=$1`, [inv.id]))[0];
  check('Invite marked as picked', inv2.status === 'accepted' && inv2.accepted_confirmed === true && inv2.accepted_part === 'afternoon', JSON.stringify(inv2));
  await go(d.page, `/thread/${cid}`, 3500);
  t = await text(d.page);
  check('David: plan and calendar question', t.includes('Next meetup') && t.includes("You're both set. Add it to your calendar?") && t.includes(`${ideaB.title} with Maria S.`) && t.includes('Google Calendar') && t.includes('Apple or Outlook'), t.slice(0, 900));
  check('Invite says what was picked', t.includes(`✓ You picked ${dayLabel(sat)}, afternoon · ${ideaB.title}. It's in your plan above.`), t.slice(-900));
  check('Pick a time is gone', !t.includes('Pick a time that works'));
  await tap(d.page, 'Not now', { nth: 0, wait: 1500 });
  t = await text(d.page);
  check('Not now puts the calendar question away', !t.includes('Add it to your calendar?'), t.slice(0, 600));
  await go(d.page, `/thread/${cid}`, 3500);
  check('It stays away after reload', !(await text(d.page)).includes('Add it to your calendar?'));
  const askRows = await q(`select answer from meetup_calendar_asks where meetup_id=$1 and user_id=$2`, [mt.id, U.david]);
  check('Answer saved', askRows[0]?.answer === 'not_now', JSON.stringify(askRows));

  await go(m.page, `/thread/${cid}`, 3500);
  t = await text(m.page);
  check('Maria is asked too', t.includes("You're both set. Add it to your calendar?"), t.slice(0, 700));
  check("Maria's invite shows David's pick", t.includes(`✓ David picked ${dayLabel(sat)}, afternoon · ${ideaB.title}.`), t.slice(-900));
  await m.page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }; });
  await m.page.getByText('Google Calendar', { exact: true }).first().click();
  const opened = await m.page.evaluate(() => window.__opened);
  check('Google Calendar opens with the plan filled in', opened.length === 1 && /calendar\.google\.com/.test(opened[0]) && decodeURIComponent(opened[0].replace(/\+/g, ' ')).includes(ideaB.title), JSON.stringify(opened));
  await m.page.waitForTimeout(1200);
  check('Then the question goes away', !(await text(m.page)).includes('Add it to your calendar?'));
  check('Counted as added', (await q(`select answer from meetup_calendar_asks where meetup_id=$1 and user_id=$2`, [mt.id, U.maria]))[0]?.answer === 'added');

  // Plan moves: asked again
  r = await rpcAs(U.maria, `select propose_meetup($1, $2::date, '16:00', 'Lake Park', $3)`, [cid, iso(sat), ideaB.title]);
  const moved = r.rows?.[0]?.propose_meetup;
  r = await rpcAs(U.david, `select confirm_meetup($1)`, [moved]);
  check('Plan moved and confirmed', !r.error, r.error);
  await go(d.page, `/thread/${cid}`, 3500);
  t = await text(d.page);
  check('Plan changed: asked to update the calendar', t.includes('The plan changed. Update your calendar?') && t.includes('Lake Park'), t.slice(0, 800));
  r = await rpcAs(U.david, `select accept_plan_invite($1, $2::date, '14:00')`, [inv.id, iso(sat)]);
  check('An answered invite can’t be used again', r.error && r.error.includes('invite_closed'), r.error);

  // ---------- A different day goes back to the sender; a new invite replaces the old ----------
  const c2 = await L.makeChat(U.aisha, U.robert, msgs(U.aisha, U.robert));
  await q(`update connections set last_plan_activity_at = now() - interval '1 day' where id=$1`, [c2]);
  await q(`insert into plan_prefs (user_id,budget,duration,travel_minutes) values ($1,'free','hour',15),($2,'flexible','half_day',45) on conflict (user_id) do nothing`, [U.aisha, U.robert]);
  r = await rpcAs(U.aisha, `select start_plan_board($1) as id`, [c2]);
  const b2 = r.rows[0].id;
  await rpcAs(U.aisha, `select plan_add_fallback_ideas($1)`, [b2]);
  const ctx = (await q(`select plan_idea_context($1,$2) c`, [b2, U.robert]))[0].c;
  check('Ideas use the stricter limit of the two', ctx.budget === 'free' && ctx.duration === 'hour' && ctx.travel_minutes === 15, JSON.stringify(ctx));
  r = await rpcAs(U.aisha, `select plan_idea_context($1,$2)`, [b2, U.aisha]);
  check('The idea writer context is server-only', Boolean(r.error), r.error);
  const i2 = await q(`select * from plan_ideas where board_id=$1 order by created_at`, [b2]);
  const sun = nextDow(0);
  await rpcAs(U.aisha, `select plan_toggle_pick($1)`, [i2[0].id]);
  await rpcAs(U.aisha, `select plan_set_times($1, $2::jsonb)`, [b2, JSON.stringify([{ day: iso(sun), part: 'morning' }])]);
  r = await rpcAs(U.aisha, `select send_plan_invite($1, null) id`, [b2]);
  const firstInv = r.rows[0].id;
  // Aisha sends a new invite: the first one is replaced
  r = await rpcAs(U.aisha, `select start_plan_board($1) as id`, [c2]);
  const b2b = r.rows[0].id;
  await rpcAs(U.aisha, `select plan_add_fallback_ideas($1)`, [b2b]);
  const i3 = await q(`select * from plan_ideas where board_id=$1 order by created_at`, [b2b]);
  await rpcAs(U.aisha, `select plan_toggle_pick($1)`, [i3[0].id]);
  await rpcAs(U.aisha, `select plan_set_times($1, $2::jsonb)`, [b2b, JSON.stringify([{ day: iso(sun), part: 'afternoon' }])]);
  r = await rpcAs(U.aisha, `select send_plan_invite($1, null) id`, [b2b]);
  const secondInv = r.rows[0].id;
  const rb = await L.as(U.robert);
  await go(rb.page, `/thread/${c2}`, 3500);
  t = await text(rb.page);
  check('Older invite says it was replaced', t.includes('A newer invite replaced this one.') && (t.match(/Pick a time that works/g) ?? []).length === 1, t.slice(0, 1200));
  check('Invite without a note shows just the lists', t.includes("Aisha's invite to meet") && t.includes(i3[0].title), t.slice(0, 900));
  await tap(rb.page, 'Pick a time that works', { wait: 800 });
  await tap(rb.page, 'Next: exact time and place', { wait: 1500 });
  // Robert moves it to the evening: Aisha didn't offer that
  await rb.page.locator('input[aria-label="Time"]').fill('19:00');
  await rb.page.waitForTimeout(300);
  await tap(rb.page, 'Set the plan', { wait: 3000 });
  const mt2 = (await q(`select * from meetups where connection_id=$1 order by created_at desc limit 1`, [c2]))[0];
  check('A time not offered goes back to Aisha to confirm', mt2?.status === 'proposed' && mt2.proposed_by === U.robert && String(mt2.start_time).startsWith('19:00'), JSON.stringify(mt2));
  t = await text(rb.page);
  check('Robert is told why', t.includes("Sent to Aisha B. to confirm, since it's a different time from the invite.") || t.includes('Waiting for Aisha'), t.slice(0, 700));
  const a = await L.as(U.aisha);
  await go(a.page, `/thread/${c2}`, 3500);
  t = await text(a.page);
  check('Aisha sees the suggestion on her invite and the plan card', t.includes('Robert suggested') && t.includes('Confirm it in the plan above.') && t.includes('Robert K. suggested a meetup'), t.slice(0, 1200));
  await tap(a.page, 'Confirm', { wait: 3000 });
  t = await text(a.page);
  check('Aisha confirms; asked about the calendar', t.includes("You're both set. Add it to your calendar?"), t.slice(0, 700));
  r = await rpcAs(U.aisha, `select status from meetups where id=$1`, [mt2.id]);
  check('Plan confirmed', r.rows[0].status === 'confirmed');
  check('First invite still replaced, second accepted', (await q(`select status from plan_invites where id=$1`, [firstInv]))[0].status === 'closed' && (await q(`select status from plan_invites where id=$1`, [secondInv]))[0].status === 'accepted');
  await q(`update meetups set status='cancelled' where connection_id=$1`, [c2]);

  // ---------- Sender's "Set the plan" ----------
  r = await rpcAs(U.robert, `select start_plan_board($1) as id`, [c2]);
  const b4 = r.rows[0].id;
  await rpcAs(U.robert, `select plan_add_fallback_ideas($1)`, [b4]);
  const i4 = await q(`select * from plan_ideas where board_id=$1 order by created_at`, [b4]);
  await rpcAs(U.robert, `select plan_toggle_pick($1)`, [i4[0].id]);
  await rpcAs(U.robert, `select plan_set_times($1, $2::jsonb)`, [b4, JSON.stringify([{ day: iso(sun), part: 'morning' }])]);
  await rpcAs(U.robert, `select send_plan_invite($1, 'Up for this?')`, [b4]);
  await go(rb.page, `/thread/${c2}`, 3500);
  await tap(rb.page, 'Agreed on something in the chat? Set the plan', { wait: 1500 });
  t = await text(rb.page);
  const act4 = await rb.page.locator('input[placeholder="e.g. Coffee, then a walk"]').inputValue();
  check('Sender can set the plan after agreeing in the chat', t.includes('Plan your 1st meetup') && act4 === i4[0].title, t.slice(0, 600));
  await tap(rb.page, 'Cancel', { wait: 800 });

  // ---------- Home idea before the first meetup ----------
  r = await rpcAs(U.aisha, `select start_plan_board($1) as id`, [c2]);
  const b5 = r.rows[0].id;
  r = await rpcAs(U.aisha, `select plan_add_own_idea($1, 'Board games at my place')`, [b5]);
  check('Server refuses a home idea before the first meetup', r.error && r.error.includes('home_first_meetup'), r.error);
  r = await rpcAs(U.aisha, `select send_plan_invite($1, null)`, [b5]);
  check('Nothing picked: no invite', r.error && r.error.includes('no_picks'), r.error);
  // Robert opens his own planning while Aisha's draft is open: private drafts
  await go(rb.page, `/thread/${c2}`, 3500);
  check("Robert doesn't see Aisha's draft", !(await text(rb.page)).includes('Plan something'));
  await go(a.page, `/thread/${c2}`, 3500);
  await tap(a.page, 'Open', { wait: 1500 });
  await a.page.locator('input[placeholder="Add your own idea"]').fill('Cook dinner at my place');
  await a.page.waitForTimeout(400);
  t = await text(a.page);
  check('Home idea before first meetup: said kindly', t.includes('Before your first meetup, pick a public place'));
  // Refresh limit
  await q(`update plan_boards set refreshes_used = 9 where id=$1`, [b5]);
  await go(a.page, `/thread/${c2}`, 3500);
  await tap(a.page, 'Open', { wait: 2500 });
  t = await text(a.page);
  check('Refresh countdown shows 1 left', t.includes('Show new ideas (1 left)'), t.slice(0, 900));
  await tap(a.page, 'Show new ideas (1 left)', { wait: 3000 });
  check('After 10 sets: add your own or talk it over', (await text(a.page)).includes("That's all the new ideas for now"));
  r = await rpcAs(U.aisha, `select plan_add_fallback_ideas($1)`, [b5]);
  check('An 11th set is refused', r.error && r.error.includes('refresh_limit'), r.error);
  // Quiet draft, then Not now
  await rpcAs(U.aisha, `select test_plan_board_age($1, 3)`, [c2]);
  await go(a.page, `/thread/${c2}`, 3500);
  t = await text(a.page);
  check('After 3 quiet days: says when the draft closes', t.includes('Not sent yet. This draft closes quietly on'), t.slice(0, 600));
  await tap(a.page, 'Open', { wait: 1500 });
  await tap(a.page, 'Not now', { wait: 2000 });
  t = await text(a.page);
  check('Not now ends it', t.includes('No plan for now. Start again anytime.'), t.slice(0, 500));
  await go(rb.page, `/thread/${c2}`, 3500);
  check("The other person isn't told about a draft they never saw", !(await text(rb.page)).includes('No plan for now'));
  await tap(a.page, 'Start again', { wait: 3500 });
  check('Start again opens a fresh card', (await board(c2)).status === 'open');
  await rpcAs(U.aisha, `select test_plan_board_age($1, 14)`, [c2]);
  check('14 quiet days: closes quietly', (await board(c2)).close_reason === 'quiet');
  await go(a.page, `/thread/${c2}`, 3500);
  check('Quiet close explained', (await text(a.page)).includes('Your invite closed after 2 quiet weeks without being sent.'));

  // ---------- Privacy ----------
  r = await rpcAs(ELENA, `select count(*)::int n from plan_invites where connection_id=$1`, [c2]);
  check('Someone outside the chat sees no invites', r.rows[0].n === 0);
  r = await rpcAs(ELENA, `select accept_plan_invite($1, $2::date)`, [secondInv, iso(sun)]);
  check('Someone outside the chat cannot pick a time', Boolean(r.error), r.error);
  r = await rpcAs(U.robert, `select count(*)::int n from plan_prefs where user_id=$1`, [U.aisha]);
  check('Limits are private', r.rows[0].n === 0);

  // ---------- Home ideas, after the first meetup ----------
  await q(`update connections set meetup_count = 1 where id=$1`, [c2]);
  await go(a.page, `/thread/${c2}`, 3500);
  await tap(a.page, "Let's plan something", { wait: 3500 });
  t = await text(a.page);
  check('After the first meetup: home question, asked privately', t.includes('would you like ideas at home') && t.includes('Only you see this answer'), t.slice(0, 600));
  await tap(a.page, "I'm happy to host", { wait: 300 });
  await tap(a.page, 'Save', { wait: 3000 });
  check('Host alone does not allow home ideas', (await q(`select _plan_home_hosts($1) h`, [c2]))[0].h.length === 0);
  await rpcAs(U.robert, `select set_plan_home_pref($1, false, true)`, [c2]);
  const hosts2 = (await q(`select _plan_home_hosts($1) h`, [c2]))[0].h;
  check("Host + visit: home ideas at Aisha's allowed", hosts2.length === 1 && hosts2[0] === U.aisha, JSON.stringify(hosts2));

  // ---------- Chat closes: card closes ----------
  await q(`update connections set status='ended' where id=$1`, [c2]);
  await q(`select run_plan_board_check_all(now())`);
  check('Ended chat closes its card', (await board(c2)).close_reason === 'chat_closed');

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
