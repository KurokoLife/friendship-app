// 2026-10-28: Rebuild stage 3, Suggestions. One suggestion at a time at the
// top of Your circle, for friends added outside Limen and Limen people, from
// the stage 1c next check-in rule. I reached out / Not now / Fewer
// suggestions; how often (Settings); pattern noticing; the web shows "Reach
// out however you usually do"; the chat's own check-in is retired; nobody
// else can read any of it. Also the "You" face in the circles picture.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
const API = 'http://localhost:54321';

async function tokenFor(user) {
  const s = await (await fetch(`${API}/__test/session?user=${user}`)).json();
  return s.access_token;
}
async function rest(user, path, opts = {}) {
  const token = await tokenFor(user);
  const r = await fetch(`${API}/rest/v1${path}`, {
    ...opts,
    headers: { apikey: 'x', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  const body = await r.text();
  try { return { status: r.status, json: JSON.parse(body) }; } catch { return { status: r.status, json: body }; }
}
const rpc = (user, fn, args) => rest(user, `/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
// "Nov 8" for a day N days from today (LA time), the way the app writes it.
function dayLabel(addDays) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + addDays);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}

(async () => {
  await L.start();
  const all = Object.values(U);
  const ME = U.priya;
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`delete from outside_friends where user_id = any($1)`, [all]);
  await q(`delete from circle_suggestions where user_id = any($1)`, [all]);
  await q(`delete from circle_suggestion_settings where user_id = any($1)`, [all]);
  await q(`delete from circle_pattern_answers where user_id = any($1)`, [all]);
  await q(`delete from limen_person_settings where user_id = any($1)`, [all]);
  await q(`delete from prompt_settings where user_id = any($1)`, [all]);
  await q(`update users set selfie_verified_at = now(), paused_until = null`);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile','tab_people','tab_settings']) k on conflict do nothing`, [all]).catch(() => {});
  const fresh = () => q(`delete from circle_suggestions where user_id = $1`, [ME]);
  const addFriend = async (name, circle, rhythm, daysAgo) =>
    (await q(`insert into outside_friends (user_id, name, circle, rhythm, created_at) values ($1,$2,$3,$4, now() - make_interval(days => $5)) returning id`, [ME, name, circle, rhythm, daysAgo]))[0].id;
  const open = async () => (await q(`select * from circle_suggestions where user_id = $1 and resolved_at is null`, [ME]))[0];
  const p = await L.as(ME, { viewport: { width: 390, height: 844 } });
  const t = () => text(p.page);
  const cardText = async () => {
    const c = p.page.getByLabel('Suggestion', { exact: true });
    return (await c.count()) ? (await c.first().innerText()).replace(/\s+/g, ' ') : '';
  };

  // ---- The "You" face in the middle -----------------------------------------
  const faceData = 'data:image/jpeg;base64,' + require('fs').readFileSync(require('path').join(__dirname, '..', '.local', 'face.jpg')).toString('base64');
  await q(`update profiles set photo_url = $2 where user_id = $1`, [ME, faceData]);
  await go(p.page, '/circle', 3500);
  const you = p.page.getByRole('button', { name: 'You. Open your profile', exact: true });
  check('"You" in the middle shows my own photo', (await p.page.locator('[aria-label="You. Open your profile"] img').count()) > 0 && (await you.innerText()).includes('You'));
  await you.click(); await p.page.waitForTimeout(2500);
  check('Tapping "You" opens You, Profile', p.page.url().includes('/profile') && /Your profile/.test(await t()), p.page.url());
  await q(`update profiles set photo_url = null where user_id = $1`, [ME]);
  await go(p.page, '/circle', 3500);
  check('No photo: the apricot "You" circle stays', (await p.page.locator('[aria-label="You. Open your profile"] img').count()) === 0 && (await you.innerText()).includes('You'));

  // ---- Who is due: the stage 1c date ----------------------------------------
  const ken = await addFriend('Ken', 'friends', 'month', 3);
  await go(p.page, '/circle', 3500);
  check('Nobody due: no suggestion', !(await p.page.getByLabel('Suggestion', { exact: true }).count()));
  const momo = await addFriend('Momo', 'close', 'week', 8);
  await go(p.page, '/circle', 3500);
  let s = await t();
  check('Due (added 8 days ago, every week): the card shows at the top', /You and Momo haven't been in touch for a while\./.test(s), s.slice(0, 400));
  check('Not due yet (every month, added 3 days ago): not suggested', !/Ken haven't/.test(s));
  check('Why line, plain', /People enjoy hearing from a friend more than we expect\./.test(s));
  await p.page.getByText('Why we say this', { exact: true }).click(); await p.page.waitForTimeout(500);
  check('"Why we say this" shows the source', /Liu, Rim, Min and Min \(2022\)/.test(await t()));
  check('Web: "Reach out however you usually do." and "I reached out"', /Reach out however you usually do\./.test(s) && /I reached out/.test(s));
  check('Web: no Text / Call / Email and no contact linking', (await p.page.getByRole('button', { name: 'Text', exact: true }).count()) === 0 && (await p.page.getByRole('button', { name: 'Call', exact: true }).count()) === 0 && !/Link to a contact/.test(s));
  check('Not now and Fewer suggestions are buttons', (await p.page.getByRole('button', { name: 'Not now', exact: true }).count()) > 0 && (await p.page.getByRole('button', { name: 'Fewer suggestions for Momo', exact: true }).count()) > 0);
  check('Same suggestion on every visit until acted on', (await q(`select count(*)::int n from circle_suggestions where user_id = $1`, [ME]))[0].n === 1);

  // I reached out: the next date counts from today.
  await p.page.getByRole('button', { name: 'I reached out', exact: true }).click(); await p.page.waitForTimeout(2000);
  s = await t();
  check('I reached out: noted, with the why and the next date', /Noted\. A check-in tells someone they matter to you\./.test(s) && s.includes(`Limen will bring Momo up again around ${dayLabel(7)}.`), s.slice(0, 500));
  check('I reached out saves the day for the next date', (await q(`select last_reached_at > now() - interval '1 minute' ok from outside_friends where id = $1`, [momo]))[0].ok);
  await p.page.getByLabel('Suggestion', { exact: true }).getByRole('button', { name: 'Got it', exact: true }).click(); await p.page.waitForTimeout(2500);
  check('Got it puts the card away', !(await cardText()), await cardText());

  // ---- How often: one at a time, with a gap ---------------------------------
  const nori = await addFriend('Nori', 'close', 'week', 9);
  await go(p.page, '/circle', 3500);
  check('Once a week (default): nobody new before a week has passed', !(await cardText()), await cardText());
  await q(`update circle_suggestions set shown_at = shown_at - interval '8 days', resolved_at = resolved_at - interval '8 days' where user_id = $1`, [ME]);
  await go(p.page, '/circle', 3500);
  check('After a week: the next person who is due', /Nori/.test(await cardText()), await cardText());
  // Settings: every two weeks.
  await go(p.page, '/profile?view=settings', 3000);
  s = await t();
  check('Settings: Suggestions in Your circle, four choices', /Suggestions in Your circle/.test(s) && /A couple of times a week/.test(s) && /Once a week/.test(s) && /Every two weeks/.test(s) && /No suggestions/.test(s));
  check('Settings: the old Check-ins switch is gone', !/Check-ins/.test(s));
  await p.page.getByRole('radio', { name: 'Every two weeks', exact: true }).click(); await p.page.waitForTimeout(1500);
  check('Every two weeks is saved', (await q(`select frequency from circle_suggestion_settings where user_id = $1`, [ME]))[0]?.frequency === 'two_weeks');
  await q(`update circle_suggestions set resolved_at = now(), outcome = 'reached', shown_at = now() - interval '8 days' where user_id = $1 and resolved_at is null`, [ME]);
  await q(`update outside_friends set last_reached_at = null, created_at = now() - interval '20 days' where id = $1`, [nori]);
  let r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('Every two weeks: nothing 8 days after the last one', r.json === null, JSON.stringify(r.json));
  await q(`update circle_suggestions set shown_at = now() - interval '15 days' where user_id = $1`, [ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('Every two weeks: one after 15 days', r.json && r.json.name === 'Nori', JSON.stringify(r.json));
  await rpc(ME, 'resolve_circle_suggestion', { p_id: r.json.id, p_outcome: 'reached', p_tz: 'UTC' });
  await q(`update circle_suggestions set shown_at = now() - interval '30 days' where user_id = $1`, [ME]);
  await q(`update outside_friends set last_reached_at = null, created_at = now() - interval '20 days' where id = $1`, [nori]);
  await q(`update circle_suggestion_settings set frequency = 'off' where user_id = $1`, [ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('No suggestions: nothing at all', r.json === null);
  await q(`update circle_suggestion_settings set frequency = 'twice_week' where user_id = $1`, [ME]);
  await q(`update circle_suggestions set shown_at = now() - interval '4 days' where user_id = $1`, [ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('A couple of times a week: one after 3 days', r.json && r.json.name === 'Nori');

  // ---- Not now: comes back in about a week -----------------------------------
  await go(p.page, '/circle', 3500);
  await p.page.getByRole('button', { name: 'Not now', exact: true }).first().click(); await p.page.waitForTimeout(1500);
  check('Not now: a calm line', /Okay\. Limen will bring Nori up again another time\./.test(await t()));
  await q(`update circle_suggestions set shown_at = shown_at - interval '4 days' where user_id = $1`, [ME]);
  await q(`update outside_friends set last_reached_at = now() - interval '30 days' where id = $1`, [momo]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('After Not now, someone else who is due gets the next turn', r.json && r.json.name === 'Momo', JSON.stringify(r.json));
  await rpc(ME, 'resolve_circle_suggestion', { p_id: r.json.id, p_outcome: 'reached', p_tz: 'UTC' });
  await q(`update circle_suggestions set shown_at = shown_at - interval '4 days' where user_id = $1`, [ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('Within a week of Not now, that person waits', r.json === null);
  await q(`update circle_suggestions set resolved_at = resolved_at - interval '8 days', shown_at = shown_at - interval '8 days' where user_id = $1`, [ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('A week after Not now, they come back', r.json && r.json.name === 'Nori');

  // ---- Fewer suggestions: one step slower within the circle -----------------
  await go(p.page, '/circle', 3500);
  await p.page.getByRole('button', { name: 'Fewer suggestions for Nori', exact: true }).click(); await p.page.waitForTimeout(1500);
  check('Fewer: every week becomes every two weeks', /Limen will bring Nori up every two weeks from now on\./.test(await t()) && (await q(`select rhythm from outside_friends where id = $1`, [nori]))[0].rhythm === 'two_weeks');
  const fewerOnce = async () => {
    await q(`update circle_suggestions set shown_at = now() - interval '40 days', resolved_at = coalesce(resolved_at, now()) - interval '40 days' where user_id = $1`, [ME]);
    await q(`update outside_friends set last_reached_at = now() - interval '200 days' where id = $1`, [nori]);
    await q(`update outside_friends set last_reached_at = now() where id <> $1 and user_id = $2`, [nori, ME]);
    const g = await rpc(ME, 'get_circle_suggestion', { p_tz: 'UTC' });
    return (await rpc(ME, 'resolve_circle_suggestion', { p_id: g.json.id, p_outcome: 'fewer', p_tz: 'UTC' })).json;
  };
  let f = await fewerOnce();
  check('Fewer again: every month (the slowest for Close)', f.status === 'fewer' && f.rhythm === 'month');
  f = await fewerOnce();
  check('At the slowest for the circle: says so, rhythm unchanged', f.status === 'slowest' && (await q(`select rhythm from outside_friends where id = $1`, [nori]))[0].rhythm === 'month');

  // ---- Limen people ------------------------------------------------------------
  await q(`update outside_friends set last_reached_at = now() where user_id = $1`, [ME]);
  await q(`update circle_suggestion_settings set frequency = 'week' where user_id = $1`, [ME]);
  await fresh();
  const C = await L.makeChat(ME, U.robert, [[ME, 'Hi Robert', 8 * 24 + 2], [U.robert, 'Hi Priya!', 8 * 24]]);
  await L.makeChat(ME, U.david, [[ME, 'Hello David', 10 * 24]]);
  await go(p.page, '/circle', 3500);
  s = await t();
  check('A Limen chat quiet for over a week (Getting to know, every week) is suggested', /You and Robert haven't been in touch for a while\./.test(s), s.slice(0, 400));
  check('A chat where only one person wrote is never suggested', !/David/.test(s.slice(0, 400)));
  check('Limen person: "Open chat" and "I reached out", no "Reach out however"', /Open chat/.test(s) && !/Reach out however you usually do/.test(s.slice(0, 600)));
  await p.page.getByRole('button', { name: 'Open chat', exact: true }).click(); await p.page.waitForTimeout(2500);
  check('Open chat opens their chat', p.page.url().includes(`/thread/${C}`), p.page.url());
  check('The chat shows no "It\'s been quiet" check-in', !/It's been quiet with Robert/.test(await t()));
  // Writing in the chat counts as being in touch: the card closes on its own.
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'How was your week?','text')`, [C, ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('A new message closes the suggestion as reached', r.json === null && (await q(`select outcome from circle_suggestions where user_id = $1 order by shown_at desc limit 1`, [ME]))[0].outcome === 'reached');
  // Your own "Next time, ask" note comes back, quoted, never rewritten.
  await q(`delete from messages where connection_id = $1 and content = 'How was your week?'`, [C]);
  await fresh();
  await q(`insert into remember_entries (connection_id, user_id, raw_text, ask_next) values ($1,$2,'Robert','how the new job is going')`, [C, ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('From your own Next time note: the interest line', r.json && r.json.kind === 'interest' && r.json.detail === 'how the new job is going');
  await go(p.page, '/circle', 3500);
  check('Card quotes your note', (await t()).includes('You wanted to ask Robert: “how the new job is going”') && /A follow-up question shows you were listening\./.test(await t()));
  // Paused, planned or turned off for that chat: never suggested.
  const check3 = async (label, setup, undo) => {
    await fresh();
    await setup();
    const g = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
    check(label, g.json === null || g.json.name !== 'Robert', JSON.stringify(g.json));
    await undo();
  };
  await check3('Paused chat: not suggested', () => q(`update connections set status = 'paused' where id = $1`, [C]), () => q(`update connections set status = 'active' where id = $1`, [C]));
  await check3('Reminders off for that chat: not suggested',
    () => rpc(ME, 'set_prompt_setting', { p_connection_id: C, p_kind: 'check_in', p_enabled: false }),
    () => rpc(ME, 'set_prompt_setting', { p_connection_id: C, p_kind: 'check_in', p_enabled: true }));
  // Fewer for a Limen person stores their rhythm privately.
  await fresh();
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  f = (await rpc(ME, 'resolve_circle_suggestion', { p_id: r.json.id, p_outcome: 'fewer', p_tz: 'UTC' })).json;
  check('Fewer for a Limen person: every week becomes every two weeks', f.status === 'fewer' && f.rhythm === 'two_weeks' && (await q(`select rhythm from limen_person_settings where user_id = $1 and other_user_id = $2`, [ME, U.robert]))[0]?.rhythm === 'two_weeks');

  // ---- Pattern noticing --------------------------------------------------------
  await fresh();
  await q(`insert into circle_suggestions (user_id, person_kind, person_id, kind, shown_at, resolved_at, outcome)
           select $1, 'outside', $2, 'in_touch', now() - make_interval(days => d + 10), now() - make_interval(days => d), 'not_now' from unnest(array[2, 9, 16]) d`, [ME, ken]);
  await go(p.page, '/circle', 3500);
  s = await t();
  check('After 3 Not nows in 4 weeks: one optional question', /You've put off a few check-ins lately\. What usually gets in the way\?/.test(s) && /A busy stretch/.test(s) && /Not sure what to say/.test(s) && /Worried it'll feel awkward/.test(s) && /The friendship feels different now/.test(s) && /Something else/.test(s), s.slice(0, 600));
  await tap(p.page, 'A busy stretch', { wait: 1500 });
  check('Each answer gets one line', /Busy stretches pass\. Two lines still count as being in touch\./.test(await t()));
  check('The answer is saved privately', (await q(`select answer from circle_pattern_answers where user_id = $1`, [ME]))[0]?.answer === 'busy');
  await go(p.page, '/profile', 3000);
  s = await t();
  check('You, Profile shows it back, privately', /When you put off a check-in/.test(s) && /A busy stretch/.test(s) && /Only you see this\./.test(s));
  await q(`update circle_suggestions set shown_at = now() - interval '20 days' where user_id = $1 and person_kind = 'pattern'`, [ME]);
  await q(`update circle_suggestions set shown_at = now() - interval '20 days' where user_id = $1`, [ME]);
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('Not asked again within 60 days', !r.json || r.json.kind !== 'pattern');

  // ---- The chat's own check-in is retired ---------------------------------------
  const C2 = await L.makeChat(U.maria, U.jordan, [[U.maria, 'Hey', 7 * 24], [U.jordan, 'Hey!', 6 * 24]]);
  await q(`select run_friendship_journey_sweep_all(now())`);
  check('A quiet chat no longer gets "It\'s been quiet" check-ins', (await q(`select count(*)::int n from connection_interventions where connection_id = $1 and intervention_type = 'conversation_restart_prompt' and status in ('pending','snoozed')`, [C2]))[0].n === 0);
  check('The old check-in function is retired', (await q(`select run_conversation_restart_check_v2($1) r`, [C2]))[0].r === 'retired');

  // ---- Privacy ---------------------------------------------------------------------
  const peek = async (table) => (await rest(U.maria, `/${table}?select=*&user_id=eq.${ME}`)).json;
  for (const table of ['circle_suggestions', 'circle_pattern_answers', 'limen_person_settings', 'circle_suggestion_settings']) {
    const rows = await peek(table);
    check(`Another person reads none of my ${table}`, Array.isArray(rows) && rows.length === 0, JSON.stringify(rows).slice(0, 200));
  }
  const mine = await open() || (await q(`select * from circle_suggestions where user_id = $1 order by shown_at desc limit 1`, [ME]))[0];
  await q(`update circle_suggestions set resolved_at = null, outcome = null where id = $1`, [mine.id]).catch(() => {});
  const theirs = await rpc(U.maria, 'resolve_circle_suggestion', { p_id: mine.id, p_outcome: 'reached', p_tz: 'UTC' });
  check('Another person can\'t act on my suggestion', theirs.json && theirs.json.status === 'not_open', JSON.stringify(theirs.json));
  const write = await rest(U.maria, `/circle_suggestions`, { method: 'POST', body: JSON.stringify({ user_id: ME, person_kind: 'pattern', kind: 'pattern' }) });
  check('Nobody can write suggestions directly', write.status >= 400);

  // ---- Person page: reach out on the web ------------------------------------------
  await go(p.page, `/friend/${ken}`, 3000);
  s = await t();
  check('Person page (web): "Reach out however you usually do" and "I reached out"', /Reach out however you usually do\./.test(s) && /I reached out/.test(s) && !/Link to a contact/.test(s));
  await p.page.getByRole('button', { name: 'I reached out', exact: true }).click(); await p.page.waitForTimeout(2000);
  s = await t();
  check('Person page: I reached out saves, and the next date moves', /Noted\./.test(s) && /Limen will bring Ken up again around /.test(s) && (await q(`select last_reached_at > now() - interval '1 minute' ok from outside_friends where id = $1`, [ken]))[0].ok, s.slice(0, 600));
  check('Limen never stores a number or email for a friend', (await q(`select count(*)::int n from information_schema.columns where table_name = 'outside_friends' and column_name ~ 'phone|email'`))[0].n === 0);

  // ---- Laptop -------------------------------------------------------------------------
  await fresh();
  await q(`update outside_friends set last_reached_at = now() - interval '30 days' where id = $1`, [momo]);
  const lap = await L.as(ME, { viewport: { width: 1280, height: 900 } });
  await go(lap.page, '/circle', 3500);
  const box = await lap.page.getByLabel('Suggestion', { exact: true }).boundingBox();
  check('Laptop: the card sits in the centered column', box && box.x > 250 && box.width <= 660, JSON.stringify(box));
  check('Phone: no sideways scroll on Your circle', await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // ---- Test tab tool --------------------------------------------------------------------
  await fresh();
  await q(`update outside_friends set last_reached_at = now() where user_id = $1`, [ME]);
  const tool = await rpc(U.mochi, 'test_circle_suggestion_now', {});
  check('Test tab tool: says to add someone when the list is empty', tool.json === 'no_friends', JSON.stringify(tool.json));
  const tool2 = await rpc(ME, 'test_circle_suggestion_now', {});
  r = await rpc(ME, 'get_circle_suggestion', { p_tz: 'America/Los_Angeles' });
  check('Test tab tool: a suggestion shows right away', tool2.json === 'ready' && r.json && r.json.person_kind === 'outside', JSON.stringify([tool2.json, r.json]));

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
