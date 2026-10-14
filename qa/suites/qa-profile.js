// 2026-10-14: Profile tab and everything linked from it.
const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
const SHOTS = process.env.SHOTS || '';
(async () => {
  await L.start();
  const seedAll = (await q(`select id from users where _is_seed_account(id)`)).map((r) => r.id);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile']) k on conflict do nothing`, [seedAll]).catch(() => {});
  await q(`update profiles set values = array['Honesty','Humor'], personal_statement = 'Learning to cook for one', extra_photo_urls = array[photo_url, photo_url],
             connection_summary = '{"connectionStyle":"You warm up slowly.","whatHelped":"Small plans.","whenUncertain":"You ask.","created_at":"2026-10-14T00:00:00Z"}'::jsonb,
             big_five_scores = '{"responses":{"1":"a"}}'::jsonb
           where user_id = $1`, [U.maria]);
  await q(`update users set paused_until = null where id = $1`, [U.maria]);
  const m = await L.as(U.maria, { viewport: { width: 390, height: 844 } });

  // Profile tab
  await go(m.page, '/profile', 4000);
  let t = await text(m.page);
  if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/profile.png` });
  const box = await m.page.locator('[aria-label="See photos larger"]').first().boundingBox();
  const img = box ? box.width : 0;
  check('Photo is small (80px), not the whole width', img > 0 && img <= 90, img);
  check('Says how many photos to see', t.includes('See 3 photos'), t.slice(0, 400));
  await tap(m.page, 'See 3 photos', { wait: 1000 });
  t = await text(m.page);
  if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/photos.png` });
  check('Photo viewer opens larger, can be closed', t.includes('Swipe to see more (3 photos)') && t.includes('Close'), t.slice(-300));
  await tap(m.page, 'Close', { wait: 800 });
  check('One completion number, same as Edit', /\d+% complete/.test(t));
  const tabPct = (await text(m.page)).match(/(\d+)% complete/)[1];
  check('Only one preview button, Settings has none', (await text(m.page)).includes('See exactly what others see'));
  check('Full name note has one period', (await text(m.page)).includes('last initial: Maria S.') && !(await text(m.page)).includes('Maria S..'));
  t = await text(m.page);
  check('Renamed: connection summary, no "personality reflection"', t.includes('Your connection summary') && t.includes('never used to pick who you meet') && !t.toLowerCase().includes('personality reflection'), t.slice(-900));
  await tap(m.page, 'See my connection summary', { wait: 1500 });
  t = await text(m.page);
  check('Shows the saved summary at once', t.includes('You warm up slowly.') && t.includes('Retake the questions for a new summary'), t.slice(-600));
  await tap(m.page, 'Close', { wait: 600 });

  // Edit profile
  await go(m.page, '/profile-build?from=profile', 4000);
  t = await text(m.page);
  if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/edit.png`, fullPage: true });
  check('Edit profile title and short list', t.includes('Edit profile') && !t.includes('Build your profile') && t.includes('What brings you here') && t.includes('Photos') && !t.includes('Honesty'), t.slice(0, 900));
  check('Same completion number as the tab', t.includes(`${tabPct}% complete.`), t.slice(0, 300));
  check('Each part says if it is used for matching', t.includes('Used for matching') && t.includes('Not used for matching') && t.includes('Partly used for matching') && t.includes('never used to pick who you meet'), t.slice(0, 1500));
  await tap(m.page, 'What matters to you', { wait: 1000 });
  t = await text(m.page);
  if (SHOTS) await m.page.screenshot({ path: `${SHOTS}/edit-values.png` });
  check('Opens just that part, with its matching line', t.includes('Used for matching. This counts a lot.') && t.includes('Honesty') && !t.includes("Where you're based") && t.includes('Done with this part'), t.slice(0, 900));
  await tap(m.page, 'Done with this part', { wait: 800 });
  await tap(m.page, 'Friendship type, pace and free times', { wait: 1000 });
  t = await text(m.page);
  check('Reply pace says it is not used for matching', t.includes('Not used for matching. Sets when the one gentle note comes') && !t.includes('Required for matching'), t.slice(0, 1500));
  await tap(m.page, 'All sections', { wait: 800 });
  check('Back to the list', (await text(m.page)).includes('Undo my changes since I opened this'));

  // Settings
  await go(m.page, '/settings', 4000);
  t = await text(m.page);
  check('Settings: no preview, no invite, has sign-in and take a break', !t.includes('Preview my public profile') && !t.includes('Invite a friend'.toUpperCase()) && !t.toLowerCase().includes('share your code') && t.includes('Sign-in and recovery') && t.toLowerCase().includes('take a break'), t.slice(0, 1500));
  await tap(m.page, '2 weeks', { wait: 1500 });
  t = await text(m.page);
  const until = (await q(`select paused_until from users where id=$1`, [U.maria]))[0].paused_until;
  check('Break set for 2 weeks', until && Math.abs(new Date(until) - Date.now() - 14 * 864e5) < 36e5 && t.includes("You're taking a break until"), t.slice(0, 1600));
  await go(m.page, '/home', 4000);
  t = await text(m.page);
  check('Discover says you are on a break, nobody new', t.includes("You're taking a break until") && !t.includes('Not for me'), t.slice(0, 600));
  const r = await q(`select count(*)::int n from compatible_candidates_for($1) c where c.user_id = $2`, [U.david, U.maria]);
  check('On a break: not suggested to anyone new', r[0].n === 0, JSON.stringify(r));
  await go(m.page, '/settings', 4000);
  await tap(m.page, 'End my break now', { wait: 1500 });
  check('Break ended', (await q(`select paused_until from users where id=$1`, [U.maria]))[0].paused_until === null);
  await tap(m.page, 'Sign-in and recovery', { wait: 2500 });
  t = await text(m.page);
  check('Sign-in page from Settings', t.includes('Sign-in and recovery') && t.includes('You sign in with your phone number.') && t.includes('Back to Settings'), t.slice(0, 600));
  await tap(m.page, 'Back to Settings', { wait: 2000 });
  check('Back goes to Settings', m.page.url().includes('/settings'), m.page.url());

  // Selfie and privacy wording
  await q(`update users set selfie_verified_at = null where id=$1`, [U.maria]);
  await q(`insert into selfie_checks (user_id,pose,status,consent_at) values ($1,'x','pending',now()) on conflict (user_id) do update set status='pending'`, [U.maria]);
  await go(m.page, '/selfie-check', 3500);
  t = await text(m.page);
  check('Selfie page: you can still say Interested while waiting', t.includes('You can still say Interested while you wait') && !t.includes("can't say Interested"), t.slice(0, 600));
  await q(`delete from selfie_checks where user_id=$1`, [U.maria]);
  await q(`update users set selfie_verified_at = now() where id=$1`, [U.maria]);
  await go(m.page, '/privacy', 3000);
  t = await text(m.page);
  check('Privacy: no "behavioral signals", says chats are not read', !t.includes('behavioral') && t.includes('reads your chats'), t.slice(0, 600));
  await q(`update profiles set values = null, personal_statement = null, extra_photo_urls = '{}', connection_summary = null, big_five_scores = null where user_id = $1`, [U.maria]);
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
