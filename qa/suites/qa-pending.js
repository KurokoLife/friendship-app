// 2026-10-14: Interested always saves the person (Inbox Pending until
// 2026-10-25, now Your circle, Getting to know, "Waiting to connect").
// The chat opens when both said Interested and both selfies are approved.
const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const seedAll = (await q(`select id from users where _is_seed_account(id)`)).map((r) => r.id);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [seedAll]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [seedAll]);
  await q(`delete from selfie_checks where user_id = any($1)`, [seedAll]);
  await q(`update users set selfie_verified_at = now() where id = any($1)`, [seedAll]);
  await q(`update users set selfie_verified_at = null where id = $1`, [U.aisha]);
  await q(`insert into selfie_checks (user_id, pose, status, consent_at) values ($1,'thumbs up','pending', now())`, [U.aisha]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile','tab_people']) k on conflict do nothing`, [seedAll]).catch(() => {});

  // A (Aisha, selfie waiting) says Interested to B (David)
  const a = await L.as(U.aisha);
  await go(a.page, `/candidate/${U.david}`, 3500);
  await tap(a.page, 'Interested', { wait: 2500 });
  let t = await text(a.page);
  check('A: told it is saved in Your circle, and the selfie is waiting', t.includes("You'll find them in Your circle, under Getting to know.") && t.includes('waiting for our review'), t.slice(0, 900));
  await go(a.page, '/circle', 3500);
  t = await text(a.page);
  check('A: David is in Your circle, waiting to connect', t.includes('Waiting to connect') && t.includes('David') && t.includes('Waiting for David. If David says Interested too, you can say hello.'), t.slice(0, 900));
  check('A: selfie note with the waiting people', t.includes('Your selfie is waiting for our review'), t.slice(0, 600));

  // B doesn't know yet
  const d = await L.as(U.david);
  await go(d.page, '/circle', 3500);
  t = await text(d.page);
  check("B: nothing about A's interest in Your circle", !t.includes('Aisha'), t.slice(0, 600));
  await go(d.page, '/inbox', 3500);
  check("B: nothing about A's interest in Chats", !(await text(d.page)).includes('Aisha'));

  // B says Interested back: mutual, but A's selfie isn't approved yet
  await go(d.page, `/candidate/${U.aisha}`, 3500);
  await tap(d.page, 'Interested', { wait: 2500 });
  t = await text(d.page);
  check("B: both interested, opens once Aisha's selfie check is done", t.includes("You and Aisha both said Interested. Your chat opens once Aisha's selfie check is done."), t.slice(0, 900));
  check('No chat yet', (await q(`select count(*)::int n from connections where (user_a_id=$1 and user_b_id=$2) or (user_a_id=$2 and user_b_id=$1)`, [U.aisha, U.david]))[0].n === 0);
  await go(d.page, '/circle', 3500);
  t = await text(d.page);
  check("B's Your circle: waiting on Aisha's selfie", t.includes("Your chat opens once Aisha's selfie check is done."), t.slice(0, 900));
  await go(a.page, '/circle', 3500);
  t = await text(a.page);
  check("A's Your circle: opens once your selfie is approved", t.includes('You both said Interested. Your chat opens once your selfie is approved.'), t.slice(0, 900));

  // A's selfie approved: the chat opens on the next Inbox visit
  await q(`update selfie_checks set status='approved' where user_id=$1`, [U.aisha]);
  await go(a.page, '/inbox', 3500);
  t = await text(a.page);
  const conn = (await q(`select id, status from connections where (user_a_id=$1 and user_b_id=$2) or (user_a_id=$2 and user_b_id=$1)`, [U.aisha, U.david]))[0];
  check('Approved: the chat opens', conn?.status === 'pending', JSON.stringify(conn));
  check('A: shows under "You both chose to connect"', t.toLowerCase().includes('you both chose to connect') && t.includes('David'), t.slice(0, 900));
  await go(a.page, '/circle', 3500);
  t = await text(a.page);
  check('A: David is now a chat in Getting to know, no longer waiting', t.includes('David') && t.includes('Chat on Limen') && !t.includes('Waiting to connect'), t.slice(0, 900));
  await go(d.page, '/inbox', 3500);
  t = await text(d.page);
  check('B: the chat shows for David too', t.toLowerCase().includes('you both chose to connect') && t.includes('Aisha'), t.slice(0, 900));
  // Hello works
  await go(a.page, `/thread/${conn.id}`, 3500);
  await a.page.locator('textarea').first().fill('Hi David!');
  await tap(a.page, 'Send', { nth: 0, wait: 2000 });
  check('A can say hello', (await q(`select count(*)::int n from messages where connection_id=$1`, [conn.id]))[0].n === 1);

  // Phone width: the four tabs fit, on every tab
  const p = await L.as(U.maria, { viewport: { width: 375, height: 800 } });
  for (const path of ['/circle', '/inbox', '/home', '/profile', '/profile?view=settings']) {
    await go(p.page, path, 3000);
    const wide = await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    check(`Phone width: no sideways scroll on ${path}`, wide);
  }
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
