// 2026-10-14: Interested always saves to Inbox, Pending. The chat opens
// when both said Interested and both selfies are approved.
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
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_profile']) k on conflict do nothing`, [seedAll]).catch(() => {});

  // A (Aisha, selfie waiting) says Interested to B (David)
  const a = await L.as(U.aisha);
  await go(a.page, `/candidate/${U.david}`, 3500);
  await tap(a.page, 'Interested', { wait: 2500 });
  let t = await text(a.page);
  check('A: told it is saved in Inbox, Pending, and the selfie is waiting', t.includes("You'll find them in Inbox, under Pending.") && t.includes('waiting for our review'), t.slice(0, 900));
  await go(a.page, '/inbox', 3500);
  await tap(a.page, 'Pending (1)', { wait: 1500 });
  t = await text(a.page);
  check('A: David is under Pending, waiting', t.includes('David') && t.includes('Waiting for David. If David says Interested too, you can say hello.'), t.slice(0, 900));
  check('A: selfie note at the top', t.includes('Your selfie is waiting for our review'), t.slice(0, 600));

  // B doesn't know yet
  const d = await L.as(U.david);
  await go(d.page, '/inbox', 3500);
  t = await text(d.page);
  check("B: nothing about A's interest", !t.includes('Aisha') && t.includes('Pending') && !t.includes('Pending (1)'), t.slice(0, 600));

  // B says Interested back: mutual, but A's selfie isn't approved yet
  await go(d.page, `/candidate/${U.aisha}`, 3500);
  await tap(d.page, 'Interested', { wait: 2500 });
  t = await text(d.page);
  check("B: both interested, opens once Aisha's selfie check is done", t.includes("You and Aisha both said Interested. Your chat opens once Aisha's selfie check is done."), t.slice(0, 900));
  check('No chat yet', (await q(`select count(*)::int n from connections where (user_a_id=$1 and user_b_id=$2) or (user_a_id=$2 and user_b_id=$1)`, [U.aisha, U.david]))[0].n === 0);
  await go(d.page, '/inbox', 3500);
  await tap(d.page, 'Pending (1)', { wait: 1500 });
  t = await text(d.page);
  check("B's Pending: waiting on Aisha's selfie", t.includes("Your chat opens once Aisha's selfie check is done."), t.slice(0, 900));
  await go(a.page, '/inbox', 3500);
  await tap(a.page, 'Pending (1)', { wait: 1500 });
  t = await text(a.page);
  check("A's Pending: opens once your selfie is approved", t.includes('You both said Interested. Your chat opens once your selfie is approved.'), t.slice(0, 900));

  // A's selfie approved: the chat opens on the next Inbox visit
  await q(`update selfie_checks set status='approved' where user_id=$1`, [U.aisha]);
  await go(a.page, '/inbox', 3500);
  t = await text(a.page);
  const conn = (await q(`select id, status from connections where (user_a_id=$1 and user_b_id=$2) or (user_a_id=$2 and user_b_id=$1)`, [U.aisha, U.david]))[0];
  check('Approved: the chat opens', conn?.status === 'pending', JSON.stringify(conn));
  check('A: shows under "You both chose to connect"', t.toLowerCase().includes('you both chose to connect') && t.includes('David'), t.slice(0, 900));
  await tap(a.page, 'Pending', { wait: 1200 });
  check('A: Pending is empty now', (await text(a.page)).includes('When you say Interested in someone, they wait here'));
  await go(d.page, '/inbox', 3500);
  t = await text(d.page);
  check('B: the chat shows for David too', t.toLowerCase().includes('you both chose to connect') && t.includes('Aisha'), t.slice(0, 900));
  // Hello works
  await go(a.page, `/thread/${conn.id}`, 3500);
  await a.page.locator('textarea').first().fill('Hi David!');
  await tap(a.page, 'Send', { nth: 0, wait: 2000 });
  check('A can say hello', (await q(`select count(*)::int n from messages where connection_id=$1`, [conn.id]))[0].n === 1);

  // Phone width: the four tabs fit
  const p = await L.as(U.maria, { viewport: { width: 375, height: 800 } });
  await go(p.page, '/inbox', 3500);
  const wide = await p.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check('Phone width: no sideways scroll with four tabs', wide);
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); });
