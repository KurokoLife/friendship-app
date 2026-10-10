// The founder's report: after both said yes, only David saw "How did it go?".
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  await q(`delete from connections where (user_a_id=$1 and user_b_id=$2) or (user_a_id=$2 and user_b_id=$1)`, [U.mochi, U.david]);
  // David sent 3 messages Mochi hasn't answered (2 days), and they met yesterday.
  const C = await L.makeChat(U.mochi, U.david, [[U.david, 'hey, how are you ?', 50], [U.david, 'Do you want to meet?', 49], [U.david, 'Just got here, see you soon', 48]]);
  await q(`select run_no_ghost_check_v2($1, now())`, [C]);
  const mo = await L.as(U.mochi);
  await go(mo.page, `/thread/${C}`, 3500);
  check('Mochi has the hello note first', (await text(mo.page)).includes("said hello and hasn't heard back yet"));
  // Test tool as Mochi (admin, own account)
  await go(mo.page, '/dev', 3000);
  await tap(mo.page, 'David C.', { exact: false, nth: 0 });
  await tap(mo.page, 'Make it yesterday', { wait: 2000 });
  const d = await L.as(U.david);
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'Yes', { wait: 1500 });
  await go(mo.page, `/thread/${C}`, 3500);
  let t = await text(mo.page);
  check('Mochi now sees "Did you meet?" before the reply reminder', t.includes('Did you meet David C.') && !t.includes("hasn't heard back yet"));
  await tap(mo.page, 'Yes', { wait: 2500 });
  t = await text(mo.page);
  check('Mochi gets "How did it go?" right away', t.includes('How did it go with David C.?'));
  check('Plan card updates to "Met 1 time" without reloading', t.includes('Met 1 time'));
  await tap(mo.page, 'Good, I', { exact: false, nth: 0, wait: 1500 });
  await tap(mo.page, 'Not now', { wait: 1500 });
  t = await text(mo.page);
  check('After answering, the hello note comes back', t.includes("hasn't heard back yet"));
  await go(d.page, `/thread/${C}`, 3500);
  check('David also has "How did it go?"', (await text(d.page)).includes('How did it go with Mochi W.?'));
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish(); });
