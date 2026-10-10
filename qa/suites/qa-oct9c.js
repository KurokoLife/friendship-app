// 2026-10-09 (3): selfie once, fill-to-limit tool, account switch shows fresh data.
const L = require('../qa-lib'); const { U, check, tap, text, go, q } = L;
const ELENA = '10000000-0000-0000-0000-000000000009';
const PRIYA = '10000000-0000-0000-0000-000000000005';
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
(async () => {
  await L.start();
  const all = [U.maria, U.david, U.aisha, U.robert, ELENA, PRIYA];
  const seedAll = (await q(`select id from users where _is_seed_account(id)`)).map((r) => r.id);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [seedAll]);
  await q(`delete from interests where from_user_id = any($1) or to_user_id = any($1)`, [seedAll]);
  await q(`delete from blocks where blocker_id = any($1) or blocked_id = any($1)`, [seedAll]);
  await q(`delete from selfie_checks where user_id = any($1)`, [all]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium']) k on conflict do nothing`, [seedAll.concat(U.mochi)]).catch(() => {});
  await q(`update users set selfie_verified_at = null where id = $1`, [U.aisha]);

  // ---- Selfie once, approved only (2026-10-09 (3)) ----
  let r = await rpcAs(U.aisha, `select express_interest($1)`, [PRIYA]);
  check('No selfie sent yet: asked for the selfie check', r.error && r.error.includes('not_verified'), r.error);
  await q(`insert into selfie_checks (user_id, pose, status, consent_at) values ($1,'thumbs up','pending', now())`, [U.aisha]);
  r = await rpcAs(U.aisha, `select express_interest($1)`, [PRIYA]);
  check('Selfie waiting for review: cannot say Interested yet', r.error && r.error.includes('selfie_pending'), r.error);
  const a = await L.as(U.aisha);
  await go(a.page, `/candidate/${PRIYA}`, 3500);
  await tap(a.page, 'Interested', { wait: 2500 });
  let t = await text(a.page);
  check('Profile explains the selfie is waiting for review', t.includes('waiting for our review'), t.slice(0, 400));
  // A chat that already exists (Priya said Interested, a match from before)
  await q(`insert into interests (from_user_id,to_user_id) values ($1,$2),($2,$1) on conflict do nothing`, [PRIYA, U.aisha]);
  const cid = (await q(`insert into connections (user_a_id,user_b_id,status,opened_at) values ($1,$2,'pending',now()) returning id`, [PRIYA, U.aisha]))[0].id;
  await go(a.page, `/thread/${cid}`, 3500);
  t = await text(a.page);
  check('Chat explains the selfie is waiting for review', t.includes('waiting for our review') && t.includes('See my selfie check'), t.slice(0, 400));
  r = await rpcAs(U.aisha, `insert into messages (connection_id, sender_id, content, type) values ($1,$2,'Hi Priya!','text')`, [cid, U.aisha]);
  check('First message blocked while the selfie waits for review', Boolean(r.error), r.error);
  await go(a.page, '/selfie-check', 3000);
  t = await text(a.page);
  check('Selfie page says it is once per account and approval is needed', t.includes('You only do this once for your account') && t.includes("Until it's approved"), t.slice(0, 400));
  await q(`update selfie_checks set status='approved' where user_id=$1`, [U.aisha]);
  r = await rpcAs(U.aisha, `insert into messages (connection_id, sender_id, content, type) values ($1,$2,'Hi Priya!','text')`, [cid, U.aisha]);
  check('Approved: first message allowed', !r.error, r.error);
  r = await rpcAs(U.aisha, `select express_interest($1)`, [U.robert]);
  check('Approved: can say Interested to someone else (account level)', !r.error, r.error);
  await q(`update selfie_checks set status='rejected' where user_id=$1`, [U.aisha]);
  r = await rpcAs(U.aisha, `select express_interest($1)`, [ELENA]);
  check('Rejected selfie: asked for a new one', r.error && r.error.includes('not_verified'), r.error);
  r = await rpcAs(U.aisha, `select express_interest($1)`, [PRIYA]);
  check('Already talked: saying hello again needs no selfie', !r.error, r.error);
  const badge = await rpcAs(U.maria, `select selfie_verified from discovery_profiles where user_id=$1`, [U.aisha]);
  check('Badge only shows after approval', !badge.rows?.[0]?.selfie_verified);
  await q(`delete from selfie_checks where user_id=$1`, [U.aisha]);
  await q(`delete from interests where from_user_id=$1 and to_user_id=$2`, [U.aisha, U.robert]);

  // ---- Fill to the limit (Test tab) ----
  const mo = await L.as(U.mochi);
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Fill my chats to the limit', { wait: 2000 });
  check('Admin own account is never filled', (await text(mo.page)).includes('Act as a test account first'));
  await tap(mo.page, 'Maria Santos', { wait: 3000 });
  await go(mo.page, '/inbox', 3000);
  check('Inbox shows Maria\'s empty inbox', (await text(mo.page)).includes('0 of 3 active conversations'), (await text(mo.page)).slice(0, 200));
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Fill my chats to the limit', { wait: 3000 });
  t = await text(mo.page);
  check('Fill tool reports 3 of 3', t.includes('You now have 3 of 3 active conversations'), t.match(/Added chats[^.]*\./)?.[0]);
  const cap = await rpcAs(U.maria, `select active_count from my_connection_capacity()`);
  check('Maria really has 3 active chats', cap.rows?.[0]?.active_count === 3, JSON.stringify(cap.rows));
  await tap(mo.page, 'Inbox', { wait: 2500 });
  t = await text(mo.page);
  check('Inbox shows the limit', t.includes('3 of 3 active conversations') && t.includes('Limen keeps it to 3 at a time'), t.slice(0, 300));
  r = await rpcAs(U.maria, `select create_connection_with_capacity_check($1)`, [PRIYA]);
  check('A 4th chat is refused', r.error && r.error.includes('active_cap_reached'), r.error);
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'Fill my chats to the limit', { wait: 2500 });
  check('Filling again says already full', (await text(mo.page)).includes('You already have 3 active conversations'));

  // ---- Switching accounts never shows the previous account's chats ----
  // Maria's Inbox is now loaded and full. Switch to Aisha and look straight away.
  await tap(mo.page, 'Aisha Bello', { wait: 400 });
  await mo.page.waitForURL(/home/, { timeout: 10000 }).catch(() => {});
  await tap(mo.page, 'Inbox', { wait: 150 });
  const early = await text(mo.page);
  await mo.page.waitForTimeout(2500);
  const later = await text(mo.page);
  const mariaNames = ['David C.', 'Robert K.'];
  check('Right after switching, Inbox does not show the previous account\'s chats', !mariaNames.some((n) => early.includes(n)), early.slice(0, 300));
  check('Then shows the new account\'s own chats', later.includes('Priya N.') && !later.includes('3 of 3'), later.slice(0, 300));

  await L.finish?.();
  const pass = L.results ? L.results : null;
  process.exit(0);
})();
