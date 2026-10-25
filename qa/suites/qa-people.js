// 2026-10-25: Your people (rebuild stage 1). Empty state, adding a friend
// from outside Limen (rhythm choices fit each circle), the detail page,
// editing, moving, removing, Limen people placed on their own, hand moves,
// phone width, and that nobody else can ever read your list.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
const API = 'http://localhost:54321/rest/v1';

async function tokenFor(user) {
  const s = await (await fetch(`http://localhost:54321/__test/session?user=${user}`)).json();
  return s.access_token;
}
async function rest(user, path, opts = {}) {
  const token = await tokenFor(user);
  const r = await fetch(`${API}${path}`, {
    ...opts,
    headers: { apikey: 'x', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
  const body = await r.text();
  let json = null;
  try { json = JSON.parse(body); } catch { json = body; }
  return { status: r.status, json };
}

(async () => {
  await L.start();
  const all = Object.values(U);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`delete from blocks where blocker_id = any($1) or blocked_id = any($1)`, [all]);
  await q(`delete from outside_friends where user_id = any($1)`, [all]);
  await q(`delete from people_circle_choices where user_id = any($1)`, [all]);
  await q(`update users set selfie_verified_at = now(), paused_until = null`);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile']) k on conflict do nothing`, [all]).catch(() => {});
  await q(`delete from coach_marks_seen where user_id = $1 and mark_key = 'tab_people'`, [U.priya]);

  // ---- Empty state, the tip and the tab bar -----------------------------
  const p = await L.as(U.priya, { viewport: { width: 375, height: 812 } });
  await go(p.page, '/people', 3500);
  let t = await text(p.page);
  check('Your people is reachable and titled', t.startsWith('Your people'), t.slice(0, 200));
  check('Tip explains Your people', /Tip · Your people/i.test(t) && t.includes('Only you see this list.'), t.slice(0, 500));
  check('Empty state invites adding someone', t.includes('Who would you like to keep up with?') && t.includes("A first name is enough, and only you see this list.") && t.includes('People you meet on Limen will show up here too.'), t.slice(0, 800));
  const tail = t.slice(-60);
  check('Tab bar: Your people first, then Chats, Discover, You', ['Your people', 'Chats', 'Discover', 'You'].every((x, i, arr) => i === 0 || tail.lastIndexOf(x) > tail.lastIndexOf(arr[i - 1])), JSON.stringify(tail));
  check('Phone width: no sideways scroll (empty)', await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await tap(p.page, 'Got it', { wait: 800 });

  // ---- Add someone ------------------------------------------------------
  await tap(p.page, 'Add someone', { wait: 2000 });
  check('Add opens a form', p.page.url().includes('/friend/new') && (await text(p.page)).includes('Which circle?'), p.page.url());
  t = await text(p.page);
  check('No phone or email fields', !/phone|e-?mail/i.test(t) && (await p.page.locator('input[type="tel"], input[type="email"]').count()) === 0, t);
  check('Rhythm question waits for a circle', !t.includes('How often would you like to be in touch?'));
  const expectRhythms = async (circle, shown, line) => {
    await tap(p.page, circle, { wait: 500 });
    const tt = await text(p.page);
    const hidden = ['Every few days', 'Every week', 'Every two weeks', 'Every month', 'Every few months', 'A few times a year', 'No suggestions'].filter((r) => !shown.includes(r));
    check(`${circle}: choices and line`, shown.every((r) => tt.includes(r)) && hidden.every((r) => !tt.includes(r)) && tt.includes(line), tt.slice(-700));
  };
  await expectRhythms('Getting to know', ['Every few days', 'Every week', 'Every two weeks'], "New friendships grow fastest when you're in touch every week or so.");
  await expectRhythms('Friends', ['Every two weeks', 'Every month', 'Every few months'], 'Most people catch up with good friends about once a month.');
  await expectRhythms('Want to reconnect', ['Every few days', 'Every week', 'Every two weeks', 'Every month', 'Every few months', 'A few times a year', 'No suggestions'], 'A check-in tells someone they matter to you.');
  await expectRhythms('Close', ['Every week', 'Every two weeks', 'Every month'], 'Most people are in touch with their closest friends about once a week.');
  const sel = async (label) => p.page.getByRole('radio', { name: label, exact: true }).getAttribute('aria-checked').catch((e) => e.message.slice(0, 120));
  const wk = await sel('Every week');
  check('Each circle starts at its own usual rhythm (Close: every week)', wk === 'true', wk);
  await tap(p.page, 'Friends', { wait: 300 });
  check('Friends starts at every month', (await sel('Every month')) === 'true');
  await tap(p.page, 'Want to reconnect', { wait: 300 });
  check('Want to reconnect starts at a few times a year', (await sel('A few times a year')) === 'true');
  await tap(p.page, 'Every two weeks', { wait: 300 });
  await tap(p.page, 'Close', { wait: 300 });
  check('A rhythm the person picked is kept when it fits the new circle', (await sel('Every two weeks')) === 'true');
  await tap(p.page, 'Friends', { wait: 300 });
  check('...and kept again (fits Friends too)', (await sel('Every two weeks')) === 'true');
  await tap(p.page, 'Close', { wait: 300 });
  await tap(p.page, 'Add', { wait: 1500 });
  check('A name is needed', (await text(p.page)).includes('Add a name, even just a first name.'));
  await p.page.getByPlaceholder('A first name is enough').fill('Sam Outside');
  await tap(p.page, 'Every month', { wait: 300 });
  await p.page.getByPlaceholder("Anything you'd like to remember about them. Only you see this.").fill('Loves bread baking');
  await tap(p.page, 'Add', { wait: 2500 });
  let rows = await q(`select * from outside_friends where user_id = $1`, [U.priya]);
  check('Saved: name, circle, rhythm, note', rows.length === 1 && rows[0].name === 'Sam Outside' && rows[0].circle === 'close' && rows[0].rhythm === 'month' && rows[0].note === 'Loves bread baking', JSON.stringify(rows));
  t = await text(p.page);
  check('Back on Your people, in Close with the rhythm', p.page.url().endsWith('/people') && /CLOSE · 1 Sam Outside Every month/i.test(t), t.slice(0, 600));
  check('No "last talked" dates on the list', !/last talked|ago\b|last seen|haven't talked/i.test(t), t);
  const F = rows[0].id;

  // ---- Detail page, edit ------------------------------------------------
  await tap(p.page, 'Sam Outside', { wait: 2000 });
  t = await text(p.page);
  check('Detail page: name, circle, rhythm, note, Edit', p.page.url().includes(`/friend/${F}`) && t.includes('Sam Outside') && t.includes('Close') && t.includes('Every month') && t.includes('Loves bread baking') && t.includes('Edit'), t.slice(0, 600));
  check('Detail page: no Text / Call / Email yet', !/\b(Text|Call|Email)\b/.test(t.replace('Edit', '')), t);
  await tap(p.page, 'Edit', { wait: 1000 });
  await p.page.getByPlaceholder('A first name is enough').fill('Sam O.');
  await p.page.getByPlaceholder("Anything you'd like to remember about them. Only you see this.").fill('');
  await tap(p.page, 'Save', { wait: 2000 });
  rows = await q(`select * from outside_friends where id = $1`, [F]);
  check('Edit saved, empty note stored as nothing', rows[0].name === 'Sam O.' && rows[0].note === null, JSON.stringify(rows[0]));
  check('Detail shows the change', (await text(p.page)).includes('Sam O.') && (await text(p.page)).includes('No note yet'));

  // ---- Move an outside friend: rhythm kept if it fits, else the circle's usual one
  await go(p.page, '/people', 3000);
  await tap(p.page, 'Move', { wait: 800 });
  t = await text(p.page);
  check('Move sheet lists the four circles', t.includes('Move Sam to') && ['Close', 'Friends', 'Getting to know', 'Want to reconnect'].every((c) => t.includes(c)), t.slice(-500));
  await tap(p.page, 'Friends', { wait: 2000 });
  rows = await q(`select circle, rhythm from outside_friends where id = $1`, [F]);
  check('Moved to Friends, every month kept (fits)', rows[0].circle === 'friends' && rows[0].rhythm === 'month', JSON.stringify(rows[0]));
  await tap(p.page, 'Move', { wait: 800 });
  await tap(p.page, 'Getting to know', { wait: 2000 });
  rows = await q(`select circle, rhythm from outside_friends where id = $1`, [F]);
  check("Moved to Getting to know, rhythm becomes that circle's usual (every week)", rows[0].circle === 'getting_to_know' && rows[0].rhythm === 'week', JSON.stringify(rows[0]));
  const bad = await q(`select public.rhythm_fits_circle('close','few_days') a, public.rhythm_fits_circle('friends','week') b, public.rhythm_fits_circle('reconnect','none') c`);
  check('Database refuses a rhythm that does not fit the circle', bad[0].a === false && bad[0].b === false && bad[0].c === true);
  let refused = false;
  try { await q(`update outside_friends set circle='close', rhythm='few_days' where id=$1`, [F]); } catch { refused = true; }
  check('Database check holds on a direct write', refused);

  // ---- Limen people, placed on their own -------------------------------
  const Cchat = await L.makeChat(U.priya, U.maria, [[U.priya, 'Hi', 30], [U.maria, 'Hello', 29]]);
  const Cpause = await L.makeChat(U.priya, U.robert, [[U.priya, 'Hi', 30], [U.robert, 'Hello', 29]]);
  await q(`update connections set status='paused' where id=$1`, [Cpause]);
  const Cgrad = await L.makeChat(U.priya, U.aisha, [[U.priya, 'Hi', 300], [U.aisha, 'Hello', 299]]);
  await q(`update connections set status='graduated', graduated_at=now() where id=$1`, [Cgrad]);
  const Cend = await L.makeChat(U.priya, U.marcus, [[U.priya, 'Hi', 30]]);
  await q(`update connections set status='ended' where id=$1`, [Cend]);
  const Cclosed = await L.makeChat(U.priya, U.sam, [[U.priya, 'Hi', 30]]);
  await q(`update connections set status='inactive' where id=$1`, [Cclosed]);
  const Cblock = await L.makeChat(U.priya, U.elena, [[U.priya, 'Hi', 30], [U.elena, 'Hey', 29]]);
  await q(`update connections set status='blocked' where id=$1`, [Cblock]);
  await q(`insert into blocks (blocker_id, blocked_id) values ($1,$2) on conflict do nothing`, [U.elena, U.priya]);
  // Said Interested, no chat yet
  await q(`insert into interests (from_user_id, to_user_id) values ($1,$2) on conflict do nothing`, [U.priya, U.jordan]);
  // A saved-only profile is not one of your people
  await q(`insert into connections (user_a_id, user_b_id, saved, saved_at) values ($1,$2,true,now())`, [U.priya, U.david]);

  await go(p.page, '/people', 3500);
  t = await text(p.page);
  const section = (name, next) => {
    const up = t.toUpperCase();
    const a = up.indexOf(name.toUpperCase());
    const b = next ? up.indexOf(next.toUpperCase(), a + 1) : up.length;
    return t.slice(a, b);
  };
  const gtk = section('Getting to know', 'Want to reconnect');
  const fr = section('Friends ·', 'Getting to know');
  check('Open chat: Getting to know, "Chat on Limen"', /Maria S\. Chat on Limen Move/.test(gtk), gtk);
  check('Paused chat: Getting to know, paused', /Robert K\. Chat on Limen, paused/.test(gtk), gtk);
  check('Said Interested: Getting to know, waiting to connect, why', /Jordan B\. Waiting to connect Waiting for Jordan\. If Jordan says Interested too, you can say hello\./.test(gtk), gtk);
  check('Graduated: Friends', /Aisha \w\. Met on Limen/.test(fr), fr);
  check('Ended, closed and blocked people never appear', !t.includes('Marcus') && !t.includes('Sam S') && !t.includes('Elena'), t);
  check('A saved-only profile is not listed', !t.includes('David'), t);
  check('Limen people and added friends together, by name', gtk.indexOf('Jordan') < gtk.indexOf('Maria') && gtk.indexOf('Maria') < gtk.indexOf('Robert') && gtk.includes('Sam O.'), gtk);
  check('Phone width: no sideways scroll (full)', await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // Tapping a Limen person opens their chat; waiting opens their profile
  await tap(p.page, 'Maria S.', { wait: 2500 });
  check('Tap a Limen person: their chat', p.page.url().includes(`/thread/${Cchat}`), p.page.url());
  await go(p.page, '/people', 3000);
  await p.page.getByText(/^Aisha /).first().click(); await p.page.waitForTimeout(2500);
  check('Tap a graduated friend: their chat', p.page.url().includes(`/thread/${Cgrad}`), p.page.url());
  await go(p.page, '/people', 3000);
  await tap(p.page, 'Jordan B.', { wait: 2500 });
  check('Tap someone waiting: their profile', p.page.url().includes(`/candidate/${U.jordan}`), p.page.url());

  // Chats no longer lists graduated friends; they live in Your people
  await go(p.page, '/inbox', 3000);
  t = await text(p.page);
  check('Chats: graduated chat not listed', !t.includes('Aisha'), t.slice(0, 600));

  // ---- Moving a Limen person by hand ------------------------------------
  await go(p.page, '/people', 3000);
  await p.page.locator('[aria-label="Move Maria S."]').click(); await p.page.waitForTimeout(800);
  t = await text(p.page);
  check('Move sheet explains Limen also moves people', t.includes('Limen also moves people on its own'), t.slice(-400));
  await tap(p.page, 'Close', { wait: 2500 });
  let mv = await q(`select circle, auto_circle from people_circle_choices where user_id=$1 and other_user_id=$2`, [U.priya, U.maria]);
  check('Hand move stored privately', mv.length === 1 && mv[0].circle === 'close' && mv[0].auto_circle === 'getting_to_know', JSON.stringify(mv));
  t = await text(p.page);
  check('Maria now in Close', /CLOSE · 1 Maria S\./i.test(t), t.slice(0, 500));
  // Moving back to where Limen placed them clears the hand move
  await p.page.locator('[aria-label="Move Maria S."]').click(); await p.page.waitForTimeout(800);
  await tap(p.page, 'Getting to know', { wait: 2500 });
  mv = await q(`select 1 from people_circle_choices where user_id=$1 and other_user_id=$2`, [U.priya, U.maria]);
  check('Moving back clears the hand move', mv.length === 0);
  // A hand move holds until Limen's placement changes (here: the chat graduates)
  await p.page.locator('[aria-label="Move Maria S."]').click(); await p.page.waitForTimeout(800);
  await tap(p.page, 'Want to reconnect', { wait: 2500 });
  await q(`update connections set status='graduated', graduated_at=now() where id=$1`, [Cchat]);
  await go(p.page, '/people', 3000);
  t = await text(p.page);
  check('After graduating, Limen moves them to Friends on its own', /FRIENDS · 2/i.test(t) && section('Friends ·', 'Getting to know').includes('Maria S.'), t.slice(0, 600));
  const notInList = await rest(U.priya, '/rpc/set_person_circle', { method: 'POST', body: JSON.stringify({ p_other_user_id: U.david, p_circle: 'close' }) });
  check('Cannot place someone who is not on your list', notInList.json === 'not_in_list', JSON.stringify(notInList));

  // ---- Remove an outside friend ----------------------------------------
  await go(p.page, `/friend/${F}`, 2500);
  await tap(p.page, 'Edit', { wait: 800 });
  await tap(p.page, 'Remove from Your people', { wait: 800 });
  check('Remove asks first', (await text(p.page)).includes('Remove Sam O. from Your people? Your note goes too.'));
  await tap(p.page, 'Remove', { wait: 2500 });
  check('Removed', (await q(`select count(*)::int n from outside_friends where id=$1`, [F]))[0].n === 0 && p.page.url().endsWith('/people'));

  // ---- Nobody else can ever read or change my list ---------------------
  const [mine] = await q(`insert into outside_friends (user_id, name, circle, rhythm, note) values ($1,'Private Pat','friends','month','secret note') returning id`, [U.priya]);
  await q(`insert into people_circle_choices (user_id, other_user_id, circle, auto_circle) values ($1,$2,'close','getting_to_know') on conflict do nothing`, [U.priya, U.robert]);
  let r = await rest(U.maria, `/outside_friends?select=*`);
  check('Another person reads none of my added friends', r.status === 200 && Array.isArray(r.json) && r.json.length === 0, JSON.stringify(r));
  r = await rest(U.maria, `/outside_friends?id=eq.${mine.id}&select=*`);
  check('Not even by id', Array.isArray(r.json) && r.json.length === 0, JSON.stringify(r));
  r = await rest(U.maria, `/people_circle_choices?select=*`);
  check("Another person reads none of my circle moves", Array.isArray(r.json) && r.json.length === 0, JSON.stringify(r));
  r = await rest(U.maria, `/outside_friends?id=eq.${mine.id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Hacked' }) });
  check('Another person cannot change my friend', (await q(`select name from outside_friends where id=$1`, [mine.id]))[0].name === 'Private Pat', JSON.stringify(r));
  r = await rest(U.maria, `/outside_friends?id=eq.${mine.id}`, { method: 'DELETE' });
  check('Another person cannot remove my friend', (await q(`select count(*)::int n from outside_friends where id=$1`, [mine.id]))[0].n === 1, JSON.stringify(r));
  r = await rest(U.maria, `/outside_friends`, { method: 'POST', body: JSON.stringify({ user_id: U.priya, name: 'Planted', circle: 'close', rhythm: 'week' }) });
  check('Another person cannot add to my list', r.status >= 400 && (await q(`select count(*)::int n from outside_friends where name='Planted'`))[0].n === 0, JSON.stringify(r));
  r = await rest(U.maria, `/rpc/my_people`, { method: 'POST', body: '{}' });
  check("my_people only ever returns the caller's own list", Array.isArray(r.json) && !r.json.some((x) => x.other_user_id === U.robert && x.circle === 'close'), JSON.stringify(r).slice(0, 300));
  r = await rest(U.priya, `/outside_friends?select=name`);
  check('I can read my own', Array.isArray(r.json) && r.json.some((x) => x.name === 'Private Pat'), JSON.stringify(r));
  r = await fetch(`${API}/outside_friends?select=*`, { headers: { apikey: 'x' } }).then(async (x) => ({ status: x.status, json: await x.json().catch(() => null) }));
  check('Signed out: nothing', r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), JSON.stringify(r));

  // ---- Reset all test accounts clears Your people ----------------------
  const reset = await rest(U.mochi, '/rpc/test_reset_all_test_accounts', { method: 'POST', body: '{}' });
  check('Test reset clears added friends and moves', (await q(`select count(*)::int n from outside_friends where user_id=$1`, [U.priya]))[0].n === 0 && (await q(`select count(*)::int n from people_circle_choices where user_id=$1`, [U.priya]))[0].n === 0, JSON.stringify(reset).slice(0, 300));

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
