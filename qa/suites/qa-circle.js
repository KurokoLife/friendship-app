// 2026-10-25: Your circle (rebuild stage 1; design pass 1b the same day:
// circles picture, faces, rows with chevrons, moving from the person's page). Empty state, adding a friend
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
  await go(p.page, '/circle', 3500);
  let t = await text(p.page);
  check('Your circle is reachable and titled', t.startsWith('Your circle'), t.slice(0, 200));
  check('Header: "Only you see this." and a filled Add someone button', t.includes('Only you see this.') && (await p.page.getByRole('button', { name: 'Add someone' }).count()) === 1, t.slice(0, 300));
  check('Tip is short, with a "Got it" button', /Tip · Your circle/i.test(t) && t.includes("People you meet on Limen show up here on their own. Add anyone else you'd like to keep up with.") && (await p.page.getByRole('button', { name: 'Got it' }).count()) === 1, t.slice(0, 500));
  check('Circles picture: You in the middle and the four rings', (await p.page.locator('[aria-label^="Your circles."]').count()) === 1 && /You Close Friends Getting to know Want to reconnect/.test(t), t.slice(0, 600));
  check('Headings in sentence case, never all caps', !/CLOSE|GETTING TO KNOW/.test(await p.page.innerText('body')));
  check('Empty state invites adding someone', t.includes('Who would you like to keep up with?') && t.includes("A first name is enough, and only you see this list.") && t.includes('People you meet on Limen will show up here too.'), t.slice(0, 800));
  const tail = t.slice(-60);
  check('Tab bar: Your circle first, then Chats, Discover, You', ['Your circle', 'Chats', 'Discover', 'You'].every((x, i, arr) => i === 0 || tail.lastIndexOf(x) > tail.lastIndexOf(arr[i - 1])), JSON.stringify(tail));
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
  check('Back on Your circle, in Close with the rhythm', p.page.url().endsWith('/circle') && /Close · 1 S Sam Outside Every month/.test(t), t.slice(0, 900));
  check('A friend from outside Limen has a colored initial face', (await p.page.locator('[aria-label="Your circles. Close: Sam. Friends: nobody yet. Getting to know: nobody yet. Want to reconnect: nobody yet."]').count()) === 1);
  check('No "Move" word on the list; the row opens their page', (await p.page.getByText('Move', { exact: true }).count()) === 0 && (await p.page.getByRole('button', { name: 'Open Sam Outside' }).count()) === 1);
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

  // ---- Move an outside friend from their own page: rhythm kept if it fits, else the circle's usual one
  const moveTo = async (page, circle) => {
    await page.getByRole('button', { name: /Move to another circle$/ }).click(); await page.waitForTimeout(800);
    await page.getByRole('radio', { name: circle, exact: true }).click(); await page.waitForTimeout(2000);
  };
  t = await text(p.page);
  check('Their page has a circle row with a chevron', t.includes('Circle: Close Move to another circle'), t.slice(0, 400));
  await p.page.getByRole('button', { name: /Move to another circle$/ }).click(); await p.page.waitForTimeout(800);
  t = await text(p.page);
  check('Circle sheet lists the four circles', t.includes('Which circle is Sam in?') && ['Close', 'Friends', 'Getting to know', 'Want to reconnect'].every((c) => t.includes(c)), t.slice(-500));
  await p.page.getByRole('radio', { name: 'Friends', exact: true }).click(); await p.page.waitForTimeout(2000);
  rows = await q(`select circle, rhythm from outside_friends where id = $1`, [F]);
  check('Moved to Friends, every month kept (fits)', rows[0].circle === 'friends' && rows[0].rhythm === 'month', JSON.stringify(rows[0]));
  check('Their page shows the new circle', (await text(p.page)).includes('Circle: Friends'));
  await moveTo(p.page, 'Getting to know');
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
  // A saved-only profile is not one of your circle
  await q(`insert into connections (user_a_id, user_b_id, saved, saved_at) values ($1,$2,true,now())`, [U.priya, U.david]);

  await go(p.page, '/circle', 3500);
  t = await text(p.page);
  // The list comes after the circles picture (whose labels end with "Want to reconnect").
  const section = (name, next) => {
    const list = t.slice(t.indexOf('Want to reconnect') + 17);
    const a = list.indexOf(name);
    const b = next ? list.indexOf(next, a + 1) : list.length;
    return list.slice(a, b);
  };
  const gtk = section('Getting to know', 'Want to reconnect');
  const fr = section('Friends ·', 'Getting to know');
  check('Open chat: Getting to know, "Chatting on Limen"', /Maria S\. Chatting on Limen/.test(gtk) && !/Chatting on Limen, paused M/.test(gtk), gtk);
  check('Paused chat: Getting to know, paused', /Robert K\. Chatting on Limen, paused/.test(gtk), gtk);
  check('Said Interested: Getting to know, waiting to connect', /Jordan B\. Waiting to connect/.test(gtk), gtk);
  // Seed photos live on the internet, which the test copy can't reach; use one the local server has.
  const oldPhoto = (await q(`select photo_url from profiles where user_id=$1`, [U.maria]))[0].photo_url;
  await q(`update profiles set photo_url = 'http://localhost:8099/favicon.ico' where user_id=$1`, [U.maria]);
  await go(p.page, '/circle', 3500);
  check('Limen people show their photo', (await p.page.locator('img[src*="favicon.ico"]').count()) > 0);
  check('A photo that does not load falls back to their initial', /\bR Robert K\./.test(await text(p.page)), (await text(p.page)).slice(0, 800));
  await q(`update profiles set photo_url = $2 where user_id=$1`, [U.maria, oldPhoto]);
  t = await text(p.page);
  check('Graduated: Friends', /Aisha \w\. Met on Limen/.test(fr), fr);
  check('Ended, closed and blocked people never appear', !t.includes('Marcus') && !t.includes('Sam S') && !t.includes('Elena'), t);
  check('A saved-only profile is not listed', !t.includes('David'), t);
  check('Limen people and added friends together, by name', gtk.indexOf('Jordan') < gtk.indexOf('Maria') && gtk.indexOf('Maria') < gtk.indexOf('Robert') && gtk.includes('Sam O.'), gtk);
  check('Phone width: no sideways scroll (full)', await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  // Tapping a Limen person opens their chat; waiting opens their profile
  await tap(p.page, 'Maria S.', { wait: 2500 });
  check('Tap a Limen person: their chat', p.page.url().includes(`/thread/${Cchat}`), p.page.url());
  await go(p.page, '/circle', 3000);
  await p.page.getByText(/^Aisha /).first().click(); await p.page.waitForTimeout(2500);
  check('Tap a graduated friend: their chat', p.page.url().includes(`/thread/${Cgrad}`), p.page.url());
  await go(p.page, '/circle', 3000);
  await tap(p.page, 'Jordan B.', { wait: 2500 });
  check('Tap someone waiting: their profile', p.page.url().includes(`/candidate/${U.jordan}`), p.page.url());
  t = await text(p.page);
  check('Their profile says which circle and why it waits', t.includes('In your circle: Getting to know') && t.includes('Waiting for Jordan. If Jordan says Interested too, you can say hello.'), t.slice(0, 700));

  // Chats no longer lists graduated friends; they live in Your circle
  await go(p.page, '/inbox', 3000);
  t = await text(p.page);
  check('Chats: graduated chat not listed', !t.includes('Aisha'), t.slice(0, 600));

  // ---- Moving a Limen person by hand, from their profile ------------------
  await go(p.page, `/candidate/${U.maria}`, 3500);
  await p.page.getByRole('button', { name: /Move to another circle$/ }).click(); await p.page.waitForTimeout(800);
  t = await text(p.page);
  check('Circle sheet explains Limen also moves people', t.includes('Limen also moves people on its own'), t.slice(-400));
  await p.page.getByRole('radio', { name: 'Close', exact: true }).click(); await p.page.waitForTimeout(2500);
  let mv = await q(`select circle, auto_circle from people_circle_choices where user_id=$1 and other_user_id=$2`, [U.priya, U.maria]);
  check('Hand move stored privately', mv.length === 1 && mv[0].circle === 'close' && mv[0].auto_circle === 'getting_to_know', JSON.stringify(mv));
  check('Their profile shows the new circle', (await text(p.page)).includes('In your circle: Close'));
  await go(p.page, '/circle', 3000);
  t = await text(p.page);
  check('Maria now in Close', /Close · 1 \S+ Maria S\./.test(section('Close', 'Friends')), section('Close', 'Friends'));
  // Moving back to where Limen placed them clears the hand move
  await go(p.page, `/candidate/${U.maria}`, 3500);
  await moveTo(p.page, 'Getting to know');
  mv = await q(`select 1 from people_circle_choices where user_id=$1 and other_user_id=$2`, [U.priya, U.maria]);
  check('Moving back clears the hand move', mv.length === 0);
  // A hand move holds until Limen's placement changes (here: the chat graduates)
  await moveTo(p.page, 'Want to reconnect');
  await q(`update connections set status='graduated', graduated_at=now() where id=$1`, [Cchat]);
  await go(p.page, '/circle', 3000);
  t = await text(p.page);
  check('After graduating, Limen moves them to Friends on its own', t.includes('Friends · 2') && section('Friends ·', 'Getting to know').includes('Maria S.'), t.slice(0, 900));
  // Tapping a ring jumps to that part of the list
  const before = await p.page.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 20 && getComputedStyle(d).overflowY !== 'visible')?.scrollTop ?? -1);
  const pic = await p.page.locator('[aria-label^="Your circles."]').boundingBox();
  await p.page.mouse.click(pic.x + pic.width / 2, pic.y + pic.height * 0.04);
  await p.page.waitForTimeout(1200);
  const after = await p.page.evaluate(() => [...document.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 20 && getComputedStyle(d).overflowY !== 'visible')?.scrollTop ?? -1);
  check('Tapping the outer ring jumps down to that part of the list', after > before, `${before} -> ${after}`);
  const notInList = await rest(U.priya, '/rpc/set_person_circle', { method: 'POST', body: JSON.stringify({ p_other_user_id: U.david, p_circle: 'close' }) });
  check('Cannot place someone who is not on your list', notInList.json === 'not_in_list', JSON.stringify(notInList));

  // ---- Design shell: phone and laptop -----------------------------------
  const font = await p.page.evaluate(() => getComputedStyle([...document.querySelectorAll('div[dir="auto"]')].find((d) => d.innerText.trim() === 'Your circle')).fontFamily);
  check('Text uses Figtree', /Figtree/.test(font), font);
  const bg = await p.page.evaluate(() => [...document.querySelectorAll('div')].map((d) => getComputedStyle(d).backgroundColor).find((c) => c === 'rgb(251, 247, 242)'));
  check('Cream background', bg === 'rgb(251, 247, 242)', bg);
  const small = await p.page.evaluate(() => [...document.querySelectorAll('[role="button"]')].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 43.5).map((b) => b.innerText || b.getAttribute('aria-label')));
  check('Buttons on Your circle are at least 44px tall', small.length === 0, JSON.stringify(small));
  const lap = await L.as(U.priya, { viewport: { width: 1280, height: 900 } });
  await go(lap.page, '/circle', 3500);
  t = await text(lap.page);
  check('Laptop: tabs in a top bar with "Limen"', t.startsWith('Limen Your circle Chats Discover You'), t.slice(0, 120));
  const col = await lap.page.evaluate(() => {
    const h = [...document.querySelectorAll('div[dir="auto"]')].find((d) => d.innerText.trim() === 'Your circle' && parseFloat(getComputedStyle(d).fontSize) > 30);
    return h ? Math.round(h.getBoundingClientRect().left) : -1;
  });
  check('Laptop: content sits in a centered column', col > 300 && col < 360, col);
  const heads = await lap.page.evaluate(() => ['Close', 'Friends'].map((h) => {
    const el = [...document.querySelectorAll('[role="heading"]')].find((d) => d.innerText.trim().split(' ·')[0] === h);
    return el ? Math.round(el.getBoundingClientRect().top) : null;
  }));
  check('Laptop: two columns (Close and Friends side by side)', heads[0] !== null && heads[0] === heads[1], JSON.stringify(heads));
  await lap.ctx.close();

  // ---- Remove an outside friend ----------------------------------------
  await go(p.page, `/friend/${F}`, 2500);
  await tap(p.page, 'Edit', { wait: 800 });
  await tap(p.page, 'Remove from Your circle', { wait: 800 });
  check('Remove asks first', (await text(p.page)).includes('Remove Sam O. from Your circle? Your note goes too.'));
  await tap(p.page, 'Remove', { wait: 2500 });
  check('Removed', (await q(`select count(*)::int n from outside_friends where id=$1`, [F]))[0].n === 0 && p.page.url().endsWith('/circle'));

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

  // ---- Reset all test accounts clears Your circle ----------------------
  const reset = await rest(U.mochi, '/rpc/test_reset_all_test_accounts', { method: 'POST', body: '{}' });
  check('Test reset clears added friends and moves', (await q(`select count(*)::int n from outside_friends where user_id=$1`, [U.priya]))[0].n === 0 && (await q(`select count(*)::int n from people_circle_choices where user_id=$1`, [U.priya]))[0].n === 0, JSON.stringify(reset).slice(0, 300));

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
