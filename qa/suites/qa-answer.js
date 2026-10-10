// 2026-10-10: "Yes, we met" / "No, that's not right" never fail on an old
// card, and the chat layout at a laptop window size.
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const people = [U.aisha, U.david];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [people]);
  const C = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hi!', 300], [U.david, 'Hello!', 299]]);
  await q(`update connections set created_at = now() - interval '12 days' where id=$1`, [C]);

  // David adds yesterday's coffee; then it gets counted some other way
  // before Aisha answers (an old card).
  const [{ mid }] = await q(`with s as (select set_config('request.jwt.claims', $2, true) x)
     select log_past_meetup($1, current_date - 1, 'Coffee', 'America/Los_Angeles') as mid from s`, [C, JSON.stringify({ sub: U.david, role: 'authenticated' })]);
  const a = await L.as(U.aisha, { viewport: { width: 1257, height: 758 } });
  await go(a.page, `/thread/${C}`, 3500);
  let t = await text(a.page);
  check('Aisha sees the card', t.includes('David C. added a meetup') && t.includes('Yes, we met'), t.slice(0, 600));
  await a.page.screenshot({ path: 'qa/.local/answer-card.png' });
  await q(`update meetups set status='occurred', occurred_date=current_date-1 where id=$1`, [mid]);
  await tap(a.page, 'Yes, we met', { wait: 2500 });
  t = await text(a.page);
  check('Old card: no error, card goes away', !t.includes("That didn't go through") && !t.includes('David C. added a meetup'), t.slice(0, 900));

  // A fresh one: No works
  await q(`delete from meetups where connection_id=$1`, [C]);
  await q(`delete from connection_interventions where connection_id=$1`, [C]);
  await q(`with s as (select set_config('request.jwt.claims', $2, true) x)
     select log_past_meetup($1, current_date - 1, 'Coffee', 'America/Los_Angeles') from s`, [C, JSON.stringify({ sub: U.david, role: 'authenticated' })]);
  await go(a.page, `/thread/${C}`, 3500);
  await tap(a.page, "No, that's not right", { wait: 2500 });
  t = await text(a.page);
  check('No works', t.includes("Okay, it won't be counted") && !t.includes("That didn't go through"), t.slice(0, 900));
  await a.page.screenshot({ path: 'qa/.local/answer-no.png' });

  await L.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
