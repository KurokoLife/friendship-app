const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [[U.maria, U.david, U.aisha]]);
  const C = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hello!', 2]]);

  const a = await L.as(U.mochi);
  await go(a.page, '/dev', 3000);
  let t = await text(a.page);
  check('Admin sees Test tools', t.includes('Act as a test account') && t.includes('All test accounts'));
  check('Old retired tools are gone', !t.includes('Quick Tests') && !t.includes('Time Travel') && !t.includes('No-ghost testing'));

  // Act as and come back, twice
  for (const [name, short] of [['David Chen', 'David'], ['Aisha Bello', 'Aisha']]) {
    await go(a.page, '/dev', 3000);
    await tap(a.page, name, { wait: 3000 });
    check(`Act as ${short}: banner shows`, (await text(a.page)).includes(`Testing as ${name}`));
    await tap(a.page, 'Back to me', { wait: 3000 });
    t = await text(a.page);
    check(`Back to my account from ${short}: home, no banner, still signed in`, a.page.url().includes('/home') && !t.includes('Testing as') && !a.page.url().includes('philosophy'), a.page.url());
  }
  const log = await (await fetch('http://localhost:54321/__test/log')).json();
  check('Admin session was never signed out on the server', !log.some((l) => l.includes(`logout`) && l.includes(U.mochi)), JSON.stringify(log));
  await go(a.page, '/profile', 3000);
  check('Admin is still Mochi after switching', (await text(a.page)).includes('Mochi'));

  // switch between two test accounts directly, then back
  await go(a.page, '/dev', 3000);
  await tap(a.page, 'David Chen', { wait: 3000 });
  await go(a.page, '/dev', 3000);
  await tap(a.page, 'Aisha Bello', { wait: 3000 });
  check('Switch David -> Aisha directly', (await text(a.page)).includes('Testing as Aisha Bello'));
  await tap(a.page, 'Back to me', { wait: 3000 });
  await go(a.page, '/profile', 3000);
  check('Back to Mochi after two switches', (await text(a.page)).includes('Mochi') && !(await text(a.page)).includes('Testing as'));

  // As Aisha: chat tools + safety + account tools
  await go(a.page, '/dev', 3000);
  await tap(a.page, 'Aisha Bello', { wait: 3000 });
  await go(a.page, '/dev', 3000);
  await tap(a.page, 'David C.', { exact: false, nth: 0 });
  await tap(a.page, 'Open this chat', { wait: 3000 });
  check('Open this chat goes to the chat', a.page.url().includes(`/thread/${C}`));
  await go(a.page, '/dev', 3000);
  await tap(a.page, 'David C.', { exact: false, nth: 0 });
  await tap(a.page, 'Mark me verified', { wait: 1500 });
  check('Mark me verified', (await text(a.page)).includes('now selfie-verified') && (await q(`select selfie_verified_at is not null v from users where id=$1`, [U.aisha]))[0].v);
  await tap(a.page, 'Remove my verification', { wait: 1500 });
  check('Remove my verification', (await q(`select selfie_verified_at is null v from users where id=$1`, [U.aisha]))[0].v);
  await tap(a.page, 'Make me and David C. both Interested', { wait: 1500 });
  t = await text(a.page);
  check('Make both Interested', t.includes('Both are now Interested'), t.match(/Safety.{0,300}/)?.[0]);
  await tap(a.page, 'Show tips and videos again', { wait: 1500 });
  check('Show tips and videos again', (await text(a.page)).includes('First-time tips and video offers will show again'));
  await q(`insert into ai_usage_events (user_id, function_name) values ($1, 'generate-reply-draft')`, [U.aisha]).catch((e) => console.log('   (ai insert)', e.message));
  await tap(a.page, 'Clear my AI limits', { wait: 1500 });
  check('Clear my AI limits', (await q(`select count(*)::int n from ai_usage_events where user_id=$1`, [U.aisha]))[0].n === 0);
  await q(`insert into match_suggestions (user_id, candidate_id, reasoning) values ($1,$2,'x')`, [U.aisha, U.maria]).catch((e) => console.log('   (sugg insert)', e.message));
  await tap(a.page, 'Get fresh suggestions', { wait: 1500 });
  check('Get fresh suggestions', (await text(a.page)).includes('Cleared') && (await q(`select count(*)::int n from match_suggestions where user_id=$1`, [U.aisha]))[0].n === 0);
  await tap(a.page, 'Open selfie check', { wait: 2500 });
  check('Open selfie check', a.page.url().includes('selfie-check'));

  // Reset this account
  await go(a.page, '/dev', 3000);
  await tap(a.page, "Reset this account's chats and matches");
  check('Reset asks to confirm', (await text(a.page)).includes("Can't be undone"));
  await tap(a.page, 'Yes, reset', { wait: 2000 });
  check("Reset this account's chats", (await q(`select count(*)::int n from connections where user_a_id=$1 or user_b_id=$1`, [U.aisha]))[0].n === 0);

  // Reset all
  await L.makeChat(U.maria, U.david, [[U.maria, 'hi', 1]]);
  await tap(a.page, 'Reset all test accounts');
  await tap(a.page, 'Yes, reset everything', { wait: 2500 });
  t = await text(a.page);
  check('Reset all test accounts', t.includes('Reset.') && (await q(`select count(*)::int n from connections where user_a_id=any($1) or user_b_id=any($1)`, [[U.maria, U.david]]))[0].n === 0, t.match(/Reset\.[^.]*\./)?.[0]);

  // Security: an ordinary user can't use test tools or the old dev functions
  const [{ id: plain }] = await q(`insert into auth.users (instance_id, aud, role, phone) values ('00000000-0000-0000-0000-000000000000','authenticated','authenticated','+14155550199') returning id`);
  await q(`insert into users (id) values ($1)`, [plain]);
  const s = await (await fetch(`http://localhost:54321/__test/session?user=${plain}`)).json();
  const call = async (fn, body) => {
    const r = await fetch(`http://localhost:54321/rest/v1/rpc/${fn}`, { method: 'POST', headers: { authorization: `Bearer ${s.access_token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return (await r.json()).message ?? 'ok';
  };
  check('Ordinary user blocked: send message as someone else', /only for admins|permission denied/.test(await call('test_send_message_as', { p_connection_id: C, p_sender_id: U.aisha, p_content: 'x', p_hours_ago: 0 })));
  check('Ordinary user blocked: old dev function', /permission denied/.test(await call('dev_send_backdated_message', { p_connection_id: C, p_sender_id: U.aisha, p_content: 'x', p_hours_ago: 0 })));
  check('Ordinary user blocked: reset all test accounts', /only for admins|permission denied/.test(await call('test_reset_all_test_accounts', {})));
  check('Ordinary user blocked: old reset all', /permission denied/.test(await call('dev_reset_all_seed_matches', {})));
  check('Ordinary user blocked: meetup test', /only for admins/.test(await call('dev_meetup_test', { p_connection_id: C, p_action: 'past' })));
  const b = await L.as(plain);
  await go(b.page, '/dev', 3000);
  check('Ordinary user does not see Test tools', (await text(b.page)).includes('only available to admins'));
  await q(`delete from auth.users where id=$1`, [plain]);
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish(); });
