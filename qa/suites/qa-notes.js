// 2026-10-10: Remember moves into the chat ("What I want to remember about X").
const L = require('../qa-lib');
const { U, check, tap, text, go, q } = L;
(async () => {
  await L.start();
  const people = [U.aisha, U.david];
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [people]);
  await q(`delete from prompt_settings where user_id = any($1)`, [people]);
  await q(`insert into coach_marks_seen (user_id, mark_key) select u, k from unnest($1::uuid[]) u, unnest(array['tab_discover','tab_saved','tab_inbox','tab_remember','tab_profile','no_ghost_prompt','meetup_checkin','credits_premium','video_show_up','video_friendship_grows','video_first_meetup']) k on conflict do nothing`, [people]).catch(() => {});
  const E = await L.makeChat(U.aisha, U.david, [[U.aisha, 'Hi!', 300], [U.david, 'Hello!', 299]]);
  const [m1] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date, activity, time_zone)
     values ($1, 1, current_date - 9, $2, 'occurred', current_date - 9, current_date - 9, 'Coffee', 'America/Los_Angeles') returning id`, [E, U.aisha]);
  const [m2] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date, activity, time_zone)
     values ($1, 2, current_date - 2, $2, 'occurred', current_date - 2, current_date - 2, 'Walk by the lake', 'America/Los_Angeles') returning id`, [E, U.david]);
  await q(`update connections set meetup_count = 2, last_plan_activity_at = now() - interval '5 days' where id=$1`, [E]);

  const a = await L.as(U.aisha);
  await go(a.page, '/home', 2500);
  let t = await text(a.page);
  check('No Remember tab', !/\bRemember\b/.test(t.replace('What I want to remember', '')), t.slice(-200));

  // The bar in the chat, asking once after the newest meetup
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  t = await text(a.page);
  check('Bar in the chat', t.includes('What I want to remember about David'));
  check('Asks about the newest meetup', t.includes("Anything you'd like to remember about David?"));

  // Opening it goes straight to that meetup
  await a.page.getByRole('button', { name: /What I want to remember about David/ }).first().click();
  await a.page.waitForTimeout(2500);
  t = await text(a.page);
  check('Notes page, private', t.includes('What I want to remember about David') && t.includes('Only you can see this. David never sees your notes.'), t.slice(0, 300));
  check('Editor open for the 2nd meetup', t.includes('Your 2nd meetup') && t.includes('Walk by the lake') && t.includes('What did you learn about David?') && t.includes('What did you enjoy?') && t.includes("Next time, I'd love to ask David..."), t.slice(0, 600));
  check('No AI and no Premium', !/Organize|Summarize|Premium|credits/i.test(t));
  check('No work words', !/\b(entry|entries|timeline|follow-up)\b/i.test(t));
  const asked = await q(`select count(*)::int n from remember_asks where user_id=$1 and meetup_id=$2`, [U.aisha, m2.id]);
  check('Opening it counts as asked', asked[0].n === 1);

  await a.page.fill('textarea[aria-label="What did you learn about David?"]', 'He just started learning guitar');
  await a.page.fill(`textarea[aria-label="Next time, I'd love to ask David..."]`, 'How his first gig went');
  await tap(a.page, 'Save', { wait: 2000 });
  t = await text(a.page);
  check('Saved on the meetup card', t.includes('What I learned about David') && t.includes('He just started learning guitar'));
  check('Next time list', t.includes('Next time, ask David about...') && t.includes('How his first gig went'));
  check('1st meetup has its own card', t.includes('Your 1st meetup') && t.includes('Coffee'));
  let rows = await q(`select meetup_id, learned, ask_next from remember_entries where connection_id=$1`, [E]);
  check('One note on the 2nd meetup', rows.length === 1 && rows[0].meetup_id === m2.id, JSON.stringify(rows));

  // A note between meetups
  await tap(a.page, 'Write something down', { nth: 0, wait: 1000 });
  await a.page.fill('textarea[aria-label="What did you enjoy?"]', 'His story about the dog');
  await tap(a.page, 'Save', { wait: 2000 });
  t = await text(a.page);
  check('Note under "Since your last meetup"', t.includes('Since your last meetup') && t.includes('His story about the dog'));
  check('Order: since last, then 2nd, then 1st', t.indexOf('Since your last meetup') < t.indexOf('Your 2nd meetup') && t.indexOf('Your 2nd meetup') < t.indexOf('Your 1st meetup'));

  // Asked moves it off the list, Undo brings it back
  await tap(a.page, 'Asked', { exact: true, wait: 1500 });
  t = await text(a.page);
  check('Asked moves it off the list', !t.includes('Next time, ask David about...') && t.includes('Already asked'));
  await tap(a.page, 'Undo', { wait: 1500 });
  check('Undo puts it back', (await text(a.page)).includes('Next time, ask David about...'));

  // Edit
  await tap(a.page, 'Edit', { nth: 0, wait: 1000 });
  await a.page.fill('textarea[aria-label="What did you enjoy?"]', 'His story about the dog and the cat');
  await tap(a.page, 'Save', { wait: 2000 });
  check('Edit saves', (await text(a.page)).includes('His story about the dog and the cat'));

  // Back in the chat: no second ask, shows the next-time line
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  t = await text(a.page);
  check('Asked only once', !t.includes("Anything you'd like to remember about David?"));
  check('Bar shows next time', t.includes('Next time: How his first gig went'));

  // Planning card shows it
  await tap(a.page, "Let's plan something", { wait: 3000 });
  t = await text(a.page);
  check('Planning card shows your note', t.includes('From your notes: next time, you wanted to ask David about') && t.includes('How his first gig went'), t.slice(-600));
  check('No separate pop-up', !t.includes('Before you plan something'));

  // Check-in shows it
  await q(`delete from plan_boards where connection_id=$1`, [E]).catch(() => {});
  await q(`select raise_intervention($1, 'conversation_restart_prompt', $2, '{}'::jsonb)`, [E, U.aisha]);
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  t = await text(a.page);
  check('Check-in shows your note', t.includes("It's been quiet with David") && t.includes('From your notes'), t.slice(-500));

  // Turned off for this chat: nothing comes back, the bar stays
  await q(`insert into prompt_settings (user_id, connection_id, kind, enabled) values ($1,$2,'notes',false)`, [U.aisha, E]);
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  t = await text(a.page);
  check('Off: bar stays, no next-time line', t.includes('What I want to remember about David') && !t.includes('Next time: How his first gig went') && !t.includes('From your notes'));
  await q(`delete from prompt_settings where user_id=$1`, [U.aisha]);

  // "Not now" on a new meetup
  const [m3] = await q(`insert into meetups (connection_id, sequence_number, proposed_date, proposed_by, status, confirmed_date, occurred_date, time_zone)
     values ($1, 3, current_date - 1, $2, 'occurred', current_date - 1, current_date - 1, 'America/Los_Angeles') returning id`, [E, U.aisha]);
  await q(`update connection_interventions set status='dismissed' where connection_id=$1 and status='pending'`, [E]);
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  check('Asks about the 3rd meetup', (await text(a.page)).includes("Anything you'd like to remember about David?"));
  await tap(a.page, 'Not now', { wait: 1500 });
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  check('Not now: not asked again', !(await text(a.page)).includes("Anything you'd like to remember about David?"));
  const a3 = await q(`select count(*)::int n from remember_asks where meetup_id=$1`, [m3.id]);
  check('Not now recorded', a3[0].n === 1);

  // David sees nothing of Aisha's notes
  const d = await L.as(U.david);
  await go(d.page, `/remember/${E}`, 3000);
  t = await text(d.page);
  check("David's page has none of Aisha's notes", t.includes('What I want to remember about Aisha') && !t.includes('guitar') && !t.includes('dog'));

  // Ended chat: notes stay
  await q(`update connections set status='ended' where id=$1`, [E]);
  await go(a.page, `/thread/${E}`, 3500, { expand: false });
  t = await text(a.page);
  check('Ended chat still has the bar', t.includes('What I want to remember about David'));
  await go(a.page, `/remember/${E}`, 3000);
  t = await text(a.page);
  check('Ended: notes stay, says so', t.includes('Your notes stay here after a chat ends. You can delete them anytime.') && t.includes('guitar'));

  // Delete one, then everything
  await tap(a.page, 'Delete', { nth: 0, wait: 800 });
  await tap(a.page, 'Tap again to delete', { wait: 1800 });
  rows = await q(`select count(*)::int n from remember_entries where connection_id=$1`, [E]);
  check('Delete one (two taps)', rows[0].n === 1);
  await tap(a.page, 'Delete everything about David', { wait: 800 });
  await tap(a.page, 'Tap again to delete everything about David', { wait: 1800 });
  rows = await q(`select count(*)::int n from remember_entries where connection_id=$1`, [E]);
  check('Delete everything (two taps)', rows[0].n === 0);

  // Settings: download
  await go(a.page, '/settings', 3000);
  t = await text(a.page);
  check('Settings: download my notes', t.includes('Your notes about friends') && t.includes('Download my notes'));
  check('Settings: notes setting', t.includes('Your notes coming back'));
  const [dl] = await Promise.all([a.page.waitForEvent('download', { timeout: 8000 }).catch(() => null), tap(a.page, 'Download my notes', { wait: 1500 })]);
  check('Download works', !!dl);

  await L.finish();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
