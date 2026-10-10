const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
const ELENA = '10000000-0000-0000-0000-000000000009';
const localDate = (n) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
async function hitIs(page, label) {
  const box = await page.getByText(label, { exact: true }).first().boundingBox();
  return page.evaluate(([x, y, l]) => { const e = document.elementFromPoint(x, y); return !!e && e.textContent.trim() === l; }, [box.x + box.width / 2, box.y + box.height / 2, label]);
}
const PHOTON = { features: [
  { geometry: { coordinates: [-122.2712, 37.8044] }, properties: { osm_type: 'N', osm_id: 1, name: 'Blue Bottle Coffee', housenumber: '300', street: 'Webster Street', city: 'Oakland', state: 'California' } },
  { geometry: { coordinates: [-122.27, 37.80] }, properties: { osm_type: 'N', osm_id: 2, name: 'Blue Bottle Coffee', street: 'Broadway', city: 'Oakland', state: 'California' } },
] };
(async () => {
  await L.start();
  const all = [U.maria, U.david, U.aisha, ELENA];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from blocks where blocker_id = any($1) or blocked_id = any($1)`, [all]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [all]);
  await q(`delete from coach_marks_seen where user_id = any($1)`, [all.concat(U.mochi)]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium']) k on conflict do nothing`, [all.concat(U.mochi)]).catch(() => {});

  // ---- 1. Test banner no longer blocks the header ----
  const C = await L.makeChat(U.maria, U.david, [[U.maria, 'Hi David!', 3], [U.david, 'Hi Maria', 2]]);
  const m = await L.as(U.mochi, { viewport: { width: 1260, height: 760 } });
  await go(m.page, '/dev', 3000);
  await tap(m.page, 'Maria Santos', { wait: 3000 });
  await go(m.page, '/inbox', 2500);
  await m.page.getByText('David C.', { exact: false }).first().click();
  await m.page.waitForTimeout(3000);
  check('Testing: Back is tappable (not covered by banner)', await hitIs(m.page, 'Back'));
  check('Testing: Report is tappable', await hitIs(m.page, 'Report'));
  check('Testing: Block is tappable', await hitIs(m.page, 'Block'));
  check('Testing: banner still shown', (await text(m.page)).includes('Back to me'));
  await m.page.getByText('Report', { exact: true }).first().click(); await m.page.waitForTimeout(1200);
  check('Report opens while testing', /What happened|Report/i.test(await text(m.page)) && (await text(m.page)).length > 0);
  await m.page.keyboard.press('Escape'); await go(m.page, '/inbox', 2000);
  await m.page.getByText('David C.', { exact: false }).first().click(); await m.page.waitForTimeout(2500);
  await m.page.getByText('Back', { exact: true }).first().click(); await m.page.waitForTimeout(1500);
  check('Thread Back returns to Inbox', m.page.url().includes('/inbox'), m.page.url());

  // ---- 2. Meetup history Back works, even opened directly ----
  await q(`update connections set meetup_count = 1 where id = $1`, [C]);
  await q(`insert into meetups (connection_id, proposed_date, confirmed_date, proposed_by, status) values ($1, current_date - 10, current_date - 10, $2, 'occurred')`, [C, U.maria]);
  await go(m.page, `/meetup-history/${C}`, 2500);
  check('History opened directly shows meetup', (await text(m.page)).includes('Meetup 1'));
  await m.page.getByText('Back', { exact: true }).first().click(); await m.page.waitForTimeout(2500);
  check('History Back (no earlier page) goes to the chat', m.page.url().includes(`/thread/${C}`), m.page.url());
  await L.openPlan(m.page);
  await m.page.getByText('See history', { exact: false }).first().click(); await m.page.waitForTimeout(2000);
  await m.page.getByText('Back', { exact: true }).last().click(); await m.page.waitForTimeout(2000);
  check('History Back from chat returns to chat', m.page.url().includes(`/thread/${C}`), m.page.url());

  // ---- 3. Pace in the chat ----
  let t = await text(m.page);
  check('Pace prompt shows after a meetup', t.includes('How often would you like to meet?') && t.includes('Set your pace'));
  await tap(m.page, 'Set your pace');
  await tap(m.page, 'Every few weeks', { wait: 2000 });
  t = await text(m.page);
  check('Own pace shown, marked private', t.includes('Your pace: every few weeks (only you see this)'));
  const d = await L.as(U.david, { viewport: { width: 1260, height: 900 } });
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check("David doesn't see Maria's pace", !t.includes('every few weeks') && t.includes('Set your pace'));
  await tap(d.page, 'Set your pace'); await tap(d.page, 'About once a month', { wait: 2000 });
  t = await text(d.page);
  check('Different paces: each sees only their own', t.includes('Your pace: about once a month') && !t.includes('You both said'));
  await tap(d.page, 'Change'); await tap(d.page, 'Every few weeks', { wait: 2000 });
  t = await text(d.page);
  check('Same pace: David sees you both said', t.includes('You both said: every few weeks'));
  await go(m.page, `/thread/${C}`, 3500);
  check('Same pace: Maria sees you both said', (await text(m.page)).includes('You both said: every few weeks'));

  // ---- 4. Place search + maps + activity-only change ----
  await m.page.route('https://photon.komoot.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(PHOTON) }));
  await tap(m.page, 'Plan a meetup');
  await m.page.locator('input[type=date]').fill(localDate(5));
  await m.page.locator('input[type=time]').fill('10:30');
  await m.page.getByPlaceholder('Search for a cafe, park, or address').fill('blue bottle');
  await m.page.waitForTimeout(1500);
  t = await text(m.page);
  check('Place search shows suggestions with address', t.includes('300 Webster Street, Oakland, California') && t.includes('OpenStreetMap'));
  await m.page.getByText('300 Webster Street, Oakland, California', { exact: true }).first().click();
  await m.page.waitForTimeout(600);
  check('Picked place shows its address', (await text(m.page)).includes('📍 300 Webster Street'));
  await m.page.getByPlaceholder('e.g. Coffee, then a walk').fill('Coffee');
  await tap(m.page, 'Send to David C.', { wait: 2000 });
  t = await text(m.page);
  check('Plan card shows place, address, map links', t.includes('Blue Bottle Coffee') && t.includes('300 Webster Street, Oakland') && t.includes('Google Maps') && t.includes('Apple Maps'));
  let [row] = await q(`select place, place_address, place_lat, place_lng, id from meetups where connection_id = $1 and status = 'proposed'`, [C]);
  check('Saved name, address and position', row && row.place === 'Blue Bottle Coffee' && Math.abs(row.place_lat - 37.8044) < 0.001, JSON.stringify(row));
  const opened = [];
  m.page.context().on('request', (r) => { if (/google\.com\/maps|maps\.apple\.com/.test(r.url())) opened.push(r.url()); });
  await m.page.getByText('Google Maps', { exact: true }).first().click(); await m.page.waitForTimeout(1500);
  await m.page.getByText('Apple Maps', { exact: true }).first().click(); await m.page.waitForTimeout(1500);
  const g = opened.find((u) => u.includes('google.com/maps')), ap = opened.find((u) => u.includes('maps.apple.com'));
  check('Google Maps opens the place', g && decodeURIComponent(g).includes('Blue Bottle Coffee, 300 Webster Street'), g);
  check('Apple Maps opens the place with its position', ap && decodeURIComponent(ap).includes('ll=37.8044,-122.2712'), ap);
  for (const pg of m.page.context().pages()) if (pg !== m.page) await pg.close();
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'Confirm', { wait: 2000 });
  // Typed place without picking still works
  await go(m.page, `/thread/${C}`, 3500);
  await tap(m.page, 'Change plan');
  await m.page.getByPlaceholder('e.g. Coffee, then a walk').fill('Coffee and a walk');
  await tap(m.page, 'Send to David C.', { wait: 2000 });
  t = await text(m.page);
  [row] = await q(`select status, move_count, activity from meetups where connection_id = $1 and status in ('proposed','confirmed')`, [C]);
  check('Changing only "what you\'ll do" keeps it confirmed, not moved', row.status === 'confirmed' && row.move_count === 0 && row.activity === 'Coffee and a walk' && !t.includes('Plan being moved') && !t.includes('Moved once'), JSON.stringify(row));
  await tap(m.page, 'Change plan');
  await m.page.getByPlaceholder('Search for a cafe, park, or address').fill('My place');
  await m.page.unroute('https://photon.komoot.io/**');
  await m.page.route('https://photon.komoot.io/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"features":[]}' }));
  await m.page.waitForTimeout(1500);
  check('No results: can keep typed text', (await text(m.page)).includes('No places found. You can keep what you typed.'));
  await tap(m.page, 'Send to David C.', { wait: 2000 });
  t = await text(m.page);
  [row] = await q(`select status, place, place_address from meetups where connection_id = $1 and status = 'proposed'`, [C]);
  check('Changing the place does need a re-confirm', row && row.place === 'My place' && row.place_address === null && t.includes('Plan being moved'), JSON.stringify(row));

  // ---- 5. Block: only the blocker sees "Blocked" ----
  await q(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [U.maria, U.david]);
  await q(`update connections set status = 'blocked' where id = $1`, [C]);
  await go(d.page, '/inbox', 3000);
  t = await text(d.page);
  check("Blocked person's Inbox: Not available under Closed, never 'Blocked'", t.includes('Not available') && t.includes('CLOSED') && !/blocked/i.test(t), t.slice(0, 300));
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check("Blocked person's chat never says blocked", t.includes("isn't available anymore") && !/\bblocked\b/i.test(t));
  await go(m.page, '/inbox', 3000);
  t = await text(m.page);
  check("Blocker's Inbox says Blocked", t.includes('BLOCKED') && t.includes('Blocked'));

  // ---- 6. Reconnect: profile opens even when no longer matching ----
  await q(`update users set selfie_verified_at = now() where id = any($1)`, [[U.aisha, ELENA]]);
  await q(`update profiles set location_lat = 40.71, location_lng = -74.0 where user_id = $1`, [ELENA]);
  const E = await L.makeChat(U.aisha, ELENA, [[U.aisha, 'hi', 30], [ELENA, 'hey', 29]]);
  await q(`update connections set status = 'ended' where id = $1`, [E]);
  await q(`insert into interests (from_user_id, to_user_id) values ($1,$2),($2,$1) on conflict do nothing`, [U.aisha, ELENA]);
  const [inDisc] = await q(`select count(*)::int n from discovery_profiles where user_id = $1`, [ELENA]); // as postgres: no auth.uid, just sanity
  const a = await L.as(U.aisha, { viewport: { width: 1260, height: 900 } });
  await go(a.page, `/thread/${E}`, 3500);
  await tap(a.page, 'View profile', { wait: 3500 });
  t = await text(a.page);
  check('Ended chat: View profile opens Elena (no longer in search range)', t.includes('Elena T.') && !t.includes("isn't available anymore"), t.slice(0, 200));
  check('Ended chat: button says Say hello again', t.includes('Say hello again'));
  await tap(a.page, 'Say hello again', { wait: 2500 });
  t = await text(a.page);
  check('Say hello again on an ended chat asks to start over', /Start over/i.test(t), t.slice(-300));
  await tap(a.page, 'Start over', { wait: 3500 });
  let [er] = await q(`select status from connections where id = $1`, [E]);
  check('Start over reopens the chat', a.page.url().includes('/thread/') && er.status === 'pending', er.status + ' ' + a.page.url());
  // Inactive (closed after silence) chat reopens straight away
  await q(`update users set selfie_verified_at = now() where id = any($1)`, [[U.david, U.robert]]);
  const R = await L.makeChat(U.david, U.robert, [[U.david, 'yo', 300]]);
  await q(`update connections set status = 'inactive' where id = $1`, [R]);
  await q(`insert into interests (from_user_id, to_user_id) values ($1,$2),($2,$1) on conflict do nothing`, [U.david, U.robert]);
  await go(d.page, `/candidate/${U.robert}`, 3500);
  await tap(d.page, 'Say hello again', { wait: 3500 });
  [er] = await q(`select status from connections where id = $1`, [R]);
  check('Inactive chat: Say hello again reopens it', d.page.url().includes(`/thread/${R}`) && er.status === 'pending', er.status + ' ' + d.page.url());
  await q(`delete from connections where id = $1`, [R]);
  await q(`insert into blocks (blocker_id, blocked_id) values ($1, $2)`, [ELENA, U.aisha]);
  await go(a.page, `/candidate/${ELENA}`, 3500);
  t = await text(a.page);
  check('Blocked: profile hidden, with a way back', t.includes("isn't available anymore") && t.includes('Go back'));
  await tap(a.page, 'Go back', { wait: 2000 });
  check('Go back leaves the dead end', !a.page.url().includes('/candidate/'), a.page.url());
  await q(`update profiles set location_lat = 34.05, location_lng = -118.24 where user_id = $1`, [ELENA]);

  // ---- 7. Test tab: chat tools hint and database notice ----
  await go(m.page, '/dev', 3000);
  t = await text(m.page);
  check('Test tab: hint to pick a chat for meetup tools', t.includes('Pick a chat above first') && t.includes('Make it tomorrow'));
  check('Test tab: no database notice when up to date', !t.includes('The database needs an update'));
  await q(`alter function public.limen_db_version() rename to limen_db_version_x`); await q(`notify pgrst, 'reload schema'`);
  await m.page.waitForTimeout(1500);
  await go(m.page, '/home', 1500); await go(m.page, '/dev', 3000);
  t = await text(m.page);
  check('Test tab: database notice when an update is missing', t.includes('The database needs an update') && t.includes('20261009000000_places_pace_profiles.sql'));
  await q(`alter function public.limen_db_version_x() rename to limen_db_version`); await q(`notify pgrst, 'reload schema'`);
  await L.finish();
})();
