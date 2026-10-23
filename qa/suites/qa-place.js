// 2026-10-13: place search asks Google first (server function place-search),
// OpenStreetMap is the backup. Needs the local function on :8000 (see README).
const localDate = (n) => { const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const all = [U.maria, U.david];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`update profiles set location_lat = 34.05, location_lng = -118.24, search_radius_miles = 50 where user_id = $1`, [U.maria]);
  const C = await L.makeChat(U.maria, U.david, [[U.maria, 'Hi!', 30], [U.david, 'Hey', 29]]);
  const m = await L.as(U.maria);
  const calls = [];
  let googleUp = true;
  await m.page.route('**/functions/v1/place-search', async (r) => {
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push(body);
    if (!googleUp) return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"unavailable":true}' });
    const res = await r.fetch({ url: 'http://localhost:8000/' });
    return r.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
  });
  const photon = [];
  await m.page.route('https://photon.komoot.io/**', (r) => { photon.push(r.request().url()); return r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ features: [{ geometry: { coordinates: [-118.25, 34.05] }, properties: { osm_type: 'N', osm_id: 9, name: 'Grand Park', city: 'Los Angeles', state: 'California' } }] }) }); });
  await go(m.page, `/thread/${C}`, 3500);
  await L.setPlanDirect(m.page);
  const box = m.page.getByPlaceholder('Search for a cafe, park, or address');
  await box.fill('@Eatalian, gardena');
  await m.page.waitForTimeout(2500);
  let t = await text(m.page);
  check('Google results show, nearest first, with distance', t.includes('Eatalian Express') && t.includes('Eatalian Cafe') && t.indexOf('Eatalian Express') < t.indexOf('Eatalian Cafe') && t.includes('Under a mile away') && t.includes('14 mi away'), t.slice(-600));
  check('Says Powered by Google', t.includes('Powered by Google') && !t.includes('OpenStreetMap'));
  const ac = calls.find((c) => c.action === 'autocomplete');
  check('Sends cleaned words, her rough area and a session', ac && ac.input === 'Eatalian gardena' && ac.lat === 34.05 && ac.session, JSON.stringify(ac));
  check('OpenStreetMap not used while Google works', photon.length === 0);
  await m.page.getByText('Eatalian Cafe', { exact: true }).first().click();
  await m.page.waitForTimeout(2500);
  t = await text(m.page);
  const det = calls.find((c) => c.action === 'details');
  check('Picking it gets the full address with the same session', det && det.id === 'far1' && det.session === ac.session && t.includes('📍 1007 W 190th St, Gardena'), JSON.stringify(det) + ' ' + t.slice(-500));
  await m.page.locator('input[type=date]').fill(localDate(4));
  await m.page.locator('input[type=time]').fill('12:00');
  await m.page.getByPlaceholder('e.g. Coffee, then a walk').fill('Lunch');
  await tap(m.page, 'Send to David C.', { wait: 2500 });
  const [row] = await q(`select place, place_address, place_lat from meetups where connection_id=$1 order by created_at desc limit 1`, [C]);
  check('Plan saves the Google place with its position', row && row.place === 'Eatalian Cafe' && row.place_address.startsWith('1007 W 190th St') && Math.abs(row.place_lat - 33.858) < 0.001, JSON.stringify(row));
  // A new search starts a new session
  await q(`delete from meetups where connection_id=$1`, [C]);
  googleUp = false;
  await go(m.page, `/thread/${C}`, 3500);
  await L.setPlanDirect(m.page);
  await box.fill('grand park');
  await m.page.waitForTimeout(2500);
  t = await text(m.page);
  check('Google not set up: OpenStreetMap is used instead', t.includes('Grand Park') && t.includes('Place data © OpenStreetMap') && photon.length > 0, t.slice(-500));
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
