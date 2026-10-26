// 2026-10-26: Your circle fixes (rebuild stage 1c). Tapping a face in the
// circles picture opens that person; an empty part of a ring jumps to the
// list. The person page for a friend outside Limen (face, name, circle,
// rhythm, next check-in date, note, Edit). The next-date line under the
// rhythm choice. Private photos for friends outside Limen, which nobody else
// can ever read. Phone and laptop sizes.
const path = require('path');
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
const API = 'http://localhost:54321';

async function tokenFor(user) {
  const s = await (await fetch(`${API}/__test/session?user=${user}`)).json();
  return s.access_token;
}
// "Nov 8" for a day N days from today, the way the app writes it (LA time).
function dayLabel(addDays, addMonths = 0) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const d = new Date(now.getFullYear(), now.getMonth() + addMonths, now.getDate() + addDays);
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-US', opts);
}
const pickedIso = (daysAgo) => new Date(Date.now() - daysAgo * 864e5).toISOString();

(async () => {
  await L.start();
  const all = Object.values(U);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`delete from outside_friends where user_id = any($1)`, [all]);
  await q(`delete from storage.objects where bucket_id = 'friend-photos'`);
  await q(`update users set selfie_verified_at = now(), paused_until = null`);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile','tab_people']) k on conflict do nothing`, [all]).catch(() => {});

  const p = await L.as(U.priya, { viewport: { width: 390, height: 844 } });

  // ---- Adding: the next-date line under the rhythm choice ----------------
  await go(p.page, '/friend/new', 2500);
  await p.page.getByPlaceholder('A first name is enough').fill('Momo');
  await tap(p.page, 'Close', { wait: 1200 });
  let t = await text(p.page);
  check('Adding: line under the rhythm, every week from today', t.includes(`Limen will bring Momo up again around ${dayLabel(7)}.`), t.slice(0, 900));
  await tap(p.page, 'Every month', { wait: 1200 });
  t = await text(p.page);
  check('The line updates when the rhythm changes (every month)', t.includes(`Limen will bring Momo up again around ${dayLabel(0, 1)}.`), t.slice(0, 900));
  await tap(p.page, 'Want to reconnect', { wait: 800 });
  await tap(p.page, 'No suggestions', { wait: 1200 });
  t = await text(p.page);
  check('No suggestions: says Limen will not bring them up', t.includes("Limen won't bring Momo up on its own."), t.slice(0, 900));
  await tap(p.page, 'Close', { wait: 800 });
  await tap(p.page, 'Every two weeks', { wait: 1000 });

  // A photo, from the photo library (a file on the web)
  const [fc] = await Promise.all([p.page.waitForEvent('filechooser', { timeout: 8000 }), tap(p.page, 'Choose a photo', { wait: 300 })]);
  await fc.setFiles(path.join(__dirname, '..', '.local', 'face.jpg'));
  await p.page.waitForTimeout(1500);
  t = await text(p.page);
  check('Photo picked: the form says it is private and offers to remove it', t.includes("Only you see it, and it's used for nothing else.") && t.includes('Remove photo'), t.slice(0, 1200));
  await tap(p.page, 'Add', { wait: 3000 });
  let row = (await q(`select * from outside_friends where user_id = $1 and name = 'Momo'`, [U.priya]))[0];
  check('Saved: Close, every two weeks', row && row.circle === 'close' && row.rhythm === 'two_weeks', JSON.stringify(row));
  check("Photo stored in Priya's own private folder", row && row.photo_path && row.photo_path.startsWith(`${U.priya}/`), row && row.photo_path);
  const obj = await q(`select owner from storage.objects where bucket_id = 'friend-photos' and name = $1`, [row.photo_path]);
  check('The photo file is recorded with Priya as owner', obj.length === 1 && obj[0].owner === U.priya, JSON.stringify(obj));
  const bucket = await q(`select public from storage.buckets where id = 'friend-photos'`);
  check('The photo bucket is private', bucket[0] && bucket[0].public === false);

  // ---- Your circle: the face shows the photo; tapping a face opens the person
  await go(p.page, '/circle', 3500);
  check('Your circle shows the private photo (row and picture)', (await p.page.locator('img[src*="/object/sign/friend-photos/"]').count()) >= 2);
  check('No dates on the list', !/around|Limen will bring/i.test(await text(p.page)));
  await p.page.getByRole('button', { name: 'Momo, Close', exact: true }).click();
  await p.page.waitForTimeout(2500);
  check('Tapping Momo’s face in the circles opens Momo', p.page.url().includes(`/friend/${row.id}`), p.page.url());

  // ---- The person page ---------------------------------------------------
  t = await text(p.page);
  // (Your circle stays in the page behind a pushed screen on the web, so count only visible photos.)
  const visiblePhotos = await p.page.evaluate(() => [...document.querySelectorAll('img[src*="/object/sign/friend-photos/"]')].filter((i) => i.getBoundingClientRect().width > 50 && i.offsetParent).length);
  check('Person page: a large face with the photo', visiblePhotos >= 1, visiblePhotos);
  check('Person page: name, circle, rhythm, next date and note',
    t.includes('Momo') && t.includes('Circle: Close') && t.includes('Every two weeks') &&
    t.includes(`Limen will bring Momo up again around ${dayLabel(14)}.`) && t.includes('No note yet'), t.slice(0, 900));
  check('Person page: an Edit button', (await p.page.getByRole('button', { name: 'Edit', exact: true }).filter({ visible: true }).count()) === 1);
  check('Person page: no Text / Call / Email yet (stage 3)', !/\b(Text|Call|Email)\b/.test(t.replace(/Edit/g, '')), t);

  // Next date counts from the last time you reached out (stage 3 fills it in)
  await q(`update outside_friends set last_reached_at = $2 where id = $1`, [row.id, pickedIso(3)]);
  await go(p.page, `/friend/${row.id}`, 3000);
  t = await text(p.page);
  check('Counts from the last time you reached out (3 days ago + two weeks)', t.includes(`Limen will bring Momo up again around ${dayLabel(11)}.`), t.slice(0, 900));
  await q(`update outside_friends set last_reached_at = $2 where id = $1`, [row.id, pickedIso(20)]);
  await go(p.page, `/friend/${row.id}`, 3000);
  check('A date already passed reads "soon"', (await text(p.page)).includes('Limen will bring Momo up again soon.'));
  await q(`update outside_friends set last_reached_at = null where id = $1`, [row.id]);

  // Edit: the line follows the rhythm before saving
  await go(p.page, `/friend/${row.id}`, 3000);
  await tap(p.page, 'Edit', { wait: 1000 });
  await tap(p.page, 'Every week', { wait: 1200 });
  t = await text(p.page);
  check('Editing: the line follows the new rhythm before saving', t.includes(`Limen will bring Momo up again around ${dayLabel(7)}.`), t.slice(0, 900));
  await tap(p.page, 'Cancel', { nth: 0, wait: 1000 });
  check('Cancel keeps the saved rhythm', (await q(`select rhythm from outside_friends where id = $1`, [row.id]))[0].rhythm === 'two_weeks');

  // ---- Photo privacy -----------------------------------------------------
  const mine = await tokenFor(U.priya);
  const theirs = await tokenFor(U.maria);
  const sign = async (token) => {
    const r = await fetch(`${API}/storage/v1/object/sign/friend-photos/${row.photo_path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, apikey: 'x', 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const own = await sign(mine);
  check('The owner can get a short-lived link to the photo', own.status === 200 && own.json && own.json.signedURL, JSON.stringify(own));
  const other = await sign(theirs);
  check('Another person can never get a link to my friend’s photo', other.status >= 400 && !(other.json && other.json.signedURL), JSON.stringify(other));
  const anon = await sign('');
  check('Signed out: no link either', anon.status >= 400, JSON.stringify(anon));
  const direct = await fetch(`${API}/storage/v1/object/friend-photos/${row.photo_path}`);
  check('The photo is never readable without a link (private bucket)', direct.status >= 400, direct.status);
  const plant = await fetch(`${API}/storage/v1/object/friend-photos/${row.photo_path}`, { method: 'POST', headers: { Authorization: `Bearer ${theirs}`, apikey: 'x', 'Content-Type': 'image/jpeg', 'x-upsert': 'true' }, body: Buffer.from('not a photo') });
  check('Another person cannot replace a photo in my folder', plant.status >= 400, plant.status);
  const viaRest = await fetch(`${API}/rest/v1/outside_friends?select=photo_path`, { headers: { Authorization: `Bearer ${theirs}`, apikey: 'x' } }).then((r) => r.json());
  check('Another person cannot read my friends (or their photo paths)', Array.isArray(viaRest) && viaRest.length === 0, JSON.stringify(viaRest));
  let refused = false;
  try { await q(`update outside_friends set photo_path = $2 where id = $1`, [row.id, `${U.maria}/x.jpg`]); } catch { refused = true; }
  check('A photo path must sit in the owner’s own folder', refused);

  // ---- Limen people: tapping their face opens their chat ------------------
  const C = await L.makeChat(U.priya, U.robert, [[U.priya, 'Hi', 30], [U.robert, 'Hello', 29]]);
  await go(p.page, '/circle', 3500);
  await p.page.getByRole('button', { name: 'Robert K., Getting to know', exact: true }).click();
  await p.page.waitForTimeout(2500);
  check('Tapping a Limen person’s face opens their chat', p.page.url().includes(`/thread/${C}`), p.page.url());

  // An empty part of a ring jumps to that part of the list
  await go(p.page, '/circle', 3500);
  const scrollTop = () => p.page.evaluate(() => [...document.querySelectorAll('div')].filter((d) => d.scrollHeight > d.clientHeight + 20 && ['auto', 'scroll'].includes(getComputedStyle(d).overflowY)).map((d) => d.scrollTop)[0] ?? -1);
  const before = await scrollTop();
  const pic = await p.page.locator('[aria-label^="Your circles."]').boundingBox();
  await p.page.mouse.click(pic.x + pic.width / 2, pic.y + pic.height * 0.04); // top of the outer ring, no face there
  await p.page.waitForTimeout(1200);
  check('Tapping an empty part of a ring jumps to the list', (await scrollTop()) > before, `${before} -> ${await scrollTop()}`);
  check('...and stays on Your circle', p.page.url().endsWith('/circle'), p.page.url());

  // ---- Remove: the photo goes too -----------------------------------------
  await go(p.page, `/friend/${row.id}`, 3000);
  await tap(p.page, 'Edit', { wait: 800 });
  await tap(p.page, 'Remove from Your circle', { wait: 800 });
  check('Remove says the photo goes too', (await text(p.page)).includes('Remove Momo from Your circle? Your note and photo go too.'));
  await tap(p.page, 'Remove', { wait: 2500 });
  check('Removing the friend removes the photo file', (await q(`select count(*)::int n from storage.objects where bucket_id = 'friend-photos' and name = $1`, [row.photo_path]))[0].n === 0);

  // ---- Laptop width -------------------------------------------------------
  await q(`insert into outside_friends (user_id, name, circle, rhythm, note) values ($1, 'Pochi', 'friends', 'month', 'Likes hiking')`, [U.priya]);
  const pochi = (await q(`select id from outside_friends where user_id = $1 and name = 'Pochi'`, [U.priya]))[0].id;
  const lap = await L.as(U.priya, { viewport: { width: 1280, height: 900 } });
  await go(lap.page, '/circle', 3500);
  await lap.page.getByRole('button', { name: 'Pochi, Friends', exact: true }).click();
  await lap.page.waitForTimeout(2500);
  t = await text(lap.page);
  check('Laptop: a face opens the person page', lap.page.url().includes(`/friend/${pochi}`) && t.includes(`Limen will bring Pochi up again around ${dayLabel(0, 1)}.`) && t.includes('Likes hiking'), t.slice(0, 600));
  const left = await lap.page.evaluate(() => {
    const h = [...document.querySelectorAll('[role="heading"]')].find((d) => d.innerText.trim() === 'Pochi');
    return h ? Math.round(h.getBoundingClientRect().left) : -1;
  });
  check('Laptop: the person page sits in the centered column', left > 300, left);
  check('Phone width: no sideways scroll on the person page', await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
