const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;

const localDate = (n) => {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function tool(page, label) {
  await go(page, '/dev', 3000);
  await tap(page, 'David C.', { exact: false, nth: 0 });
  await tap(page, label, { wait: 1800 });
  const t = await text(page);
  return t.slice(t.indexOf('Add a past meetup'), t.indexOf('Add a past meetup') + 260);
}

(async () => {
  await L.start();
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [[U.maria, U.david]]);
  await q(`delete from coach_marks_seen where user_id = any($1)`, [[U.maria, U.david]]);
  const C = await L.makeChat(U.maria, U.david, [[U.maria, 'Hi David!', 3], [U.david, 'Hi Maria, coffee sometime?', 2], [U.maria, 'Yes please!', 1]]);

  // Maria = admin acting as Maria (has Test tools). David = plain session.
  const m = await L.as(U.mochi);
  await go(m.page, '/dev', 3000);
  await tap(m.page, 'Maria Santos', { wait: 3000 });
  check('Admin is now acting as Maria', (await text(m.page)).includes('Testing as Maria Santos'));
  const d = await L.as(U.david);

  // 1. Plan a meetup with full details
  await go(m.page, `/thread/${C}`, 3500);
  await tap(m.page, 'Plan a meetup');
  let t = await text(m.page);
  check('Editor: title and nudge', t.includes('Plan your 1st meetup') && t.includes('Add a time and place'));
  await m.page.locator('input[type=date]').fill(localDate(4));
  await m.page.locator('input[type=time]').fill('10:30');
  await m.page.getByPlaceholder('Search for a cafe, park, or address').fill('Blue Bottle on 3rd');
  await m.page.getByPlaceholder('e.g. Coffee, then a walk').fill('Coffee, then a walk');
  await tap(m.page, 'Send to David C.', { wait: 2000 });
  t = await text(m.page);
  check('Proposer sees her plan waiting', t.includes('Waiting for David C. to confirm') && t.includes('10:30 AM') && t.includes('Blue Bottle on 3rd'));

  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('David sees the suggestion with details', t.includes('Maria S. suggested a meetup') && t.includes('Blue Bottle on 3rd') && t.includes('Does this work for you?'));
  await go(d.page, '/inbox', 3000);
  t = await text(d.page);
  check('David Inbox: Coming up · Waiting for you', t.includes('COMING UP') && t.includes('Waiting for you') && t.includes('Coffee, then a walk at Blue Bottle on 3rd'));
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'Confirm');
  t = await text(d.page);
  check('After confirm: Next meetup card', t.includes('Next meetup') && t.includes('Change plan') && t.includes('Add to calendar') && t.includes('Cancel plan'));
  await go(m.page, '/inbox', 3000);
  check('Maria Inbox: Confirmed', (await text(m.page)).includes('Confirmed'));

  // Calendar choices
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'Add to calendar');
  t = await text(d.page);
  check('Calendar choices show', t.includes('Google Calendar') && t.includes('Apple or Outlook'));
  const [dl] = await Promise.all([d.page.waitForEvent('download', { timeout: 4000 }).catch(() => null), tap(d.page, 'Apple or Outlook')]);
  check('Apple/Outlook file downloads', !!dl);

  // 2. Change plan -> being moved -> confirm
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'Change plan');
  check('Change editor explains confirm', (await text(d.page)).includes('will need to confirm the new plan'));
  await d.page.locator('input[type=date]').fill(localDate(5));
  await tap(d.page, 'Send to Maria S.', { wait: 2000 });
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('Maria sees "Plan being moved" with old plan', t.includes('Plan being moved') && t.includes('Reminders are paused until you both agree') && t.includes('Moved once'));
  await tap(m.page, 'Confirm');
  check('Moved plan confirmed', (await text(m.page)).includes('Next meetup'));

  // Many moves: two more moves (each confirmed) -> note at 3
  for (let i = 0; i < 2; i++) {
    const page = i % 2 ? m.page : d.page;
    const other = i % 2 ? d.page : m.page;
    await go(page, `/thread/${C}`, 3000);
    await tap(page, 'Change plan');
    await page.locator('input[type=date]').fill(localDate(6 + i));
    await tap(page, i % 2 ? 'Send to David C.' : 'Send to Maria S.', { wait: 1800 });
    await go(other, `/thread/${C}`, 3000);
    await tap(other, 'Confirm');
  }
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('After 3 moves: private note', t.includes("Plans shift, that's normal") && t.includes('Moved 3 times'));
  await tap(m.page, 'Still want to meet', { wait: 1800 });
  check('Note goes away after answering', !(await text(m.page)).includes("Plans shift, that's normal"));

  // 3. Tomorrow -> Still on?
  let msg = await tool(m.page, 'Make it tomorrow');
  check('Tool: tomorrow', msg.includes('now tomorrow'), msg);
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('Maria sees "Still on?"', t.includes('Tomorrow with David C.. Still on?') || t.includes('Tomorrow with David C. Still on?'), t.slice(0, 400));
  await tap(m.page, 'Still on', { wait: 1800 });
  check('"Still on" card goes away', !(await text(m.page)).includes('Still on?'));
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('David sees "Maria said it\'s still on"', t.includes("Maria S. said it's still on"));
  await tap(d.page, 'Need to move it');
  t = await text(d.page);
  check('Need to move it: starters', t.includes('I need to move our plan'));
  await tap(d.page, 'Just pick a new day', { wait: 1500 });
  check('Opens the change editor', (await text(d.page)).includes('Change the plan'));
  await tap(d.page, 'Cancel', { nth: 0 });

  // 4. Today -> morning of
  msg = await tool(m.page, 'Make it today');
  check('Tool: today', msg.includes('now today'), msg);
  await go(d.page, `/thread/${C}`, 3500);
  t = await text(d.page);
  check('David sees morning-of check', t.includes('How are you feeling about meeting Maria S. today?') && t.includes('Only you see this'));
  check('Plan card says Meeting today + Running late', t.includes('Meeting today') && t.includes('Running late?'));
  await tap(d.page, 'A little nervous', { wait: 1800 });
  t = await text(d.page);
  check('Nervous: real support + guide', t.includes('Most people enjoy meeting more than they expect') && t.includes('Watch a 2-minute guide'));
  await tap(d.page, 'Watch a 2-minute guide', { wait: 2500 });
  t = await text(d.page);
  check('Guide page opens', t.includes('The First Meetup Does Not Need to Be Perfect') || d.page.url().includes('/guide/'), d.page.url());
  const vw = await d.page.evaluate(() => { const v = document.querySelector('video'); return v ? v.getBoundingClientRect().width : null; });
  check('Video is small (<= 260px wide)', vw !== null && vw <= 261, vw);
  await go(d.page, `/thread/${C}`, 3500);
  check('Morning-of card answered, stays gone', !(await text(d.page)).includes('How are you feeling about meeting'));

  await go(m.page, `/thread/${C}`, 3500);
  await tap(m.page, 'Thinking about cancelling');
  check('Asks nerves or came up', (await text(m.page)).includes('Is it nerves, or did something come up?'));
  await tap(m.page, 'Something came up');
  await tap(m.page, 'Cancel', { nth: 0 });
  t = await text(m.page);
  check('Cancelling needs a message', t.includes('The plan is cancelled when you send it'));
  await tap(m.page, "Something came up and I can't make it today", { exact: false, nth: 0, wait: 300 });
  await m.page.getByPlaceholder('Write it in your own words').fill("Something came up and I can't make it today, my sister is in town. Next week?");
  await tap(m.page, 'Send and cancel', { wait: 2500 });
  const st = await q(`select status from meetups where connection_id=$1 order by created_at desc limit 1`, [C]);
  check('Plan cancelled after message', st[0].status === 'cancelled', st[0].status);
  check('Cancel message was sent', (await q(`select count(*)::int n from messages where connection_id=$1 and content like '%sister is in town%'`, [C]))[0].n === 1);

  // 5. Yesterday -> Did you meet? -> both yes -> How did it go
  msg = await tool(m.page, 'Make it yesterday');
  check('Tool: yesterday makes a test plan when none', msg.includes('now yesterday'), msg);
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('Maria sees "Did you meet?" with time', /Did you meet David C\. on .*\?/.test(t), t.match(/Did you meet[^?]*\?/)?.[0]);
  await go(m.page, '/inbox', 3000);
  check('Inbox tag: How did it go?', (await text(m.page)).includes('How did it go?'));
  await go(m.page, `/thread/${C}`, 3500);
  await tap(m.page, 'Yes', { wait: 1800 });
  check('First yes: waiting on the other person', (await text(m.page)).includes('It counts once David C. says yes too. If they don\'t answer within a week, it counts anyway.'));
  await tap(m.page, 'Close');
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'Yes', { wait: 2000 });
  t = await text(d.page);
  check('Second yes: "How did it go?" right away', t.includes('How did it go with Maria S.?'));
  check('Met 1 time shown', t.includes('Met 1 time'));
  await tap(d.page, "I'm not sure yet", { wait: 1500 });
  check('Not sure: calm note', (await text(d.page)).includes("That's normal. There's no rush"));
  await tap(d.page, 'Close');
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('Maria also gets "How did it go?"', t.includes('How did it go with David C.?'));
  await tap(m.page, "Really good, I'd like to see David C. again", { wait: 1800 });
  t = await text(m.page);
  check('Good answer: asks about telling David, or planning, equally', t.includes('Would you like to tell David C. how it was for you?') && t.includes('Plan another meetup') && t.includes('Not now'));
  await tap(m.page, 'Plan another meetup', { wait: 1500 });
  check('Opens the plan editor (2nd meetup)', (await text(m.page)).includes('Plan your 2nd meetup'));
  await tap(m.page, 'Cancel', { nth: 0 });
  await q(`select run_friendship_journey_sweep_all(now())`);
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  check('No repeat "a little more time" question', !t.includes('a little more time'));

  // history
  await tap(m.page, 'See history', { exact: false, wait: 2500 });
  t = await text(m.page);
  check('History numbers the first meetup "Meetup 1"', t.includes('Meetup 1') && !t.includes('Meetup 7'), t.slice(0, 200));
  check('No "This date looks wrong" link', !t.includes('This date looks wrong'));

  // 6. Yesterday again -> didn't show up
  msg = await tool(m.page, 'Make it yesterday');
  await go(d.page, `/thread/${C}`, 3500);
  await tap(d.page, 'No');
  check('No: three choices', (await text(d.page)).includes("Maria S. didn't show up"));
  await tap(d.page, "Maria S. didn't show up", { wait: 2000 });
  t = await text(d.page);
  check("Didn't show up: kind note", t.includes("it isn't on you") && t.includes('Suggest another day') && t.includes('End kindly'));
  check('No-show recorded privately', (await q(`select count(*)::int n from meetup_cancellation_reasons where reason='no_show'`))[0].n === 1);
  await tap(d.page, 'Suggest another day', { wait: 1500 });
  check('Suggest another day opens the editor', (await text(d.page)).includes('Plan your 2nd meetup'));

  // 7. cancelled branch
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  if (t.includes('Did you meet')) {
    await tap(m.page, 'No');
    await tap(m.page, 'It was cancelled');
    check('Cancelled: asks why', (await text(m.page)).includes('Why was it cancelled?'));
    await tap(m.page, 'Something came up', { wait: 600 });
    await tap(m.page, 'Yes', { wait: 1500 });
    check('Wants to reschedule: message box', (await text(m.page)).includes('Write what you'));
  } else check('Maria had Did you meet card for cancelled branch', false, t.slice(0, 200));

  // 8. past meetup
  msg = await tool(m.page, 'Add a past meetup');
  check('Tool: add past meetup', msg.includes('Added a meetup'), msg);
  await go(m.page, `/thread/${C}`, 3500);
  check('Met 2 times', (await text(m.page)).includes('Met 2 times'));

  // 9. Rhythm reminder after 2 meetups
  await q(`select run_friendship_journey_sweep_all(now())`);
  await go(m.page, `/thread/${C}`, 3500);
  t = await text(m.page);
  // 2026-10-10: the separate pace card is retired; the plan card asks.
  check('Pace question in the plan card, no separate card', t.includes('How often would you like to meet?') && t.includes('Set your pace') && !t.includes('How often would you like to get together? Only you see'), t.slice(0, 300));
  await tap(m.page, 'Set your pace', { wait: 1000 });
  await tap(m.page, 'Every few weeks', { wait: 1800 });
  t = await text(m.page);
  check('Pace saved', t.includes('Your pace: every few weeks'), t.slice(0, 400));

  await L.finish();
})().catch(async (e) => {
  console.log('CRASH', e.message);
  await L.finish();
});
