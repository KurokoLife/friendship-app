// 2026-10-17: joining from the very first screen to Discover as a brand-new
// phone number, then Save, Interested, Pending, the chat opening, and the
// first-time tips (cards in the page that never cover a button). Also checks
// the side margins on joining screens (they were missing on the web).
const L = require('../qa-lib'); const { check, text, q } = L;
const PHONE = '555555' + String(Date.now()).slice(-4);
(async () => {
  await L.start();
  const { page } = await L.as(null, { viewport: { width: 390, height: 844 } });
  const t = () => text(page);
  const tap = async (label, exact = true, wait = 1200) => {
    const loc = page.getByText(label, { exact }).filter({ visible: true });
    const n = await loc.count(); if (!n) throw new Error(`No visible "${label}"`);
    await loc.nth(n - 1).click(); await page.waitForTimeout(wait);
  };
  const fill = (ph, v) => page.getByPlaceholder(ph).filter({ visible: true }).last().fill(v);
  // Left edge of the main heading: should sit about 24px in, never at 0.
  const margin = async (label) => page.evaluate((l) => {
    const el = [...document.querySelectorAll('div')].filter((e) => e.offsetParent && e.innerText?.trim() === l).pop();
    return el ? Math.round(el.getBoundingClientRect().left) : -1;
  }, label);

  await q("delete from auth.users where phone like '+1555555%'");
  await page.goto('http://localhost:8099/'); await page.waitForTimeout(3000);
  check('signed-out visitor lands on the intro', /Meeting people is only the beginning/.test(await t()));
  check('intro has side margins', (await margin('Meeting people is only the beginning.')) >= 16, await margin('Meeting people is only the beginning.'));
  await tap('Continue', true, 2000);
  check('phone screen has side margins', (await margin("What's your number?")) >= 16);
  await page.getByPlaceholder('Phone number').fill(PHONE);
  await tap('Send code', true, 2000);
  await page.locator('input').filter({ visible: true }).last().fill('123456');
  await tap('Verify', true, 3500);
  check('new number goes to Basics (not Discover)', /A couple of basics/.test(await t()));
  check('Basics has side margins', (await margin('A couple of basics')) >= 16);
  await fill('First name', 'Tess'); await fill('Last name', 'Walker');
  await fill('MM', '04'); await fill('DD', '12'); await fill('YYYY', '1975');
  await page.getByText('I agree to the', { exact: false }).filter({ visible: true }).last().click({ position: { x: 4, y: 6 } });
  await page.waitForTimeout(400);
  await tap('Continue', true, 3000);
  check('Basics goes to account recovery', /recover your account/.test(await t()));
  await tap('Skip for now', true, 2500);
  check('gender screen has side margins', (await margin("What's your gender?")) >= 16);
  await tap('Woman'); await tap('Continue', true, 2000);
  await tap('Everyone'); await tap('Done', true, 3000);
  check('profile builder opens', /Step 1 of 10/.test(await t()));
  await fill('e.g. 90012', '90012'); await tap('Confirm location', true, 2500);
  await tap('Next', true, 1500);
  await tap('Relocation'); await tap('Next', true, 1500);
  await page.getByPlaceholder(/learning to cook for one/).filter({ visible: true }).fill('Learning the bus routes in a new city.');
  await tap('Add a story'); await tap('A time I showed up for someone');
  const chipOk = await page.evaluate(() => {
    const chip = [...document.querySelectorAll('div')].filter((e) => e.offsetParent && e.innerText?.trim() === 'A small moment that changed how I see something').pop();
    return !chip || chip.getBoundingClientRect().right <= window.innerWidth;
  });
  check('long story prompt stays inside the screen', chipOk);
  await page.getByPlaceholder(/Tell it the way/).fill('Last spring my neighbor had surgery and lived alone. I left soup at her door every few days and texted to ask if she needed anything. After a couple of weeks she invited me in for tea and we talked for two hours. Now we walk together on Sunday mornings.');
  await tap('Next', true, 1500);
  for (const v of ['Honesty', 'Humor', 'Kindness']) await tap(v, true, 300);
  await tap('Next', true, 1500);
  await tap('Coffee culture', true, 600); await tap('Next', true, 1500);
  await tap('Planned ahead', true, 400); await tap('Next', true, 1500);
  await tap('Deep 1-on-1 connection', true, 300); await tap('Every 2 weeks', true, 300); await tap('Same day', true, 300); await tap('Weekends', true, 300);
  await tap('Next', true, 1500);
  await tap('After a few conversations', true, 300); await tap('No preference', true, 300); await tap('Next', true, 1500);
  await tap('English', true, 300); await tap('Next', true, 1500);
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), tap('Add a photo', true, 300)]);
  await fc.setFiles(require('path').join(__dirname, '..', '.local', 'face.jpg'));
  await page.waitForTimeout(4000);
  await tap('Continue', true, 3000);
  check('profile done, How you connect opens', /How you connect/.test(await t()));
  for (const a of ['Pretty good, could do a bit more', 'Follow through unless something important comes up', 'Check in soon after I hear about it', 'Bring it up but try to keep it low-key', 'Slight disappointment but I move on quickly', 'We saw each other regularly', 'We talked but never made plans', 'We may both just need more time', 'Want to reach out, but wait', 'Suggesting a meetup']) await tap(a, true, 250);
  await tap('Continue', true, 5000);
  check('summary screen shows (or its calm fallback)', /A little about how you connect/.test(await t()));
  await tap('Continue', true, 3000);
  await tap('Ask a genuine question about something in their profile.', true, 800); await tap('Continue', true, 2500);
  await tap("Send a short, honest message that you're ending it.", true, 800); await tap('Done', true, 3000);
  check('readiness screen has side margins', (await margin('Limen is for friendship only')) >= 16);
  await tap("Yes, I'm ready", true, 3000);
  check('All set screen', /You're all set/.test(await t()));
  check('All set has side margins', (await margin("You're all set")) >= 16);
  await tap("I'll do it later", true, 4000);
  check('lands on Discover', page.url().endsWith('/home'));
  const me = (await q('select id from auth.users where phone = $1', ['+1' + PHONE]))[0].id;

  // Tips: a card in the page, and it never covers a button.
  check('Discover tip is a card with a heading', /Tip · One new person a day/i.test(await t()));
  // Someone on Discover today, then Save.
  await q("delete from match_suggestions where user_id = $1", [me]);
  await q("insert into match_suggestions (user_id,candidate_id,reasoning,suggested_date) values ($1,'10000000-0000-0000-0000-000000000003','You might enjoy getting to know each other.', current_date) on conflict do nothing", [me]);
  await page.reload(); await page.waitForTimeout(3500);
  await tap('Save', true, 2500);
  check('Save says saved', /Saved\. Aisha is in Saved/.test(await t()));
  await page.goto('http://localhost:8099/saved'); await page.waitForTimeout(3000);
  check('Saved lists the person', /Aisha/.test(await t()) && /SAVED · 1 OF 5/i.test(await t()));
  await tap('Aisha', false, 3000);
  check('profile page tip shows', /Tip · Getting to know someone/i.test(await t()));
  await tap('Interested', true, 3000);
  check('Interested is saved to Pending', /under Pending/.test(await t()));
  await page.goto('http://localhost:8099/inbox'); await page.waitForTimeout(3500);
  check('Inbox tip explains the tabs', /Tip · Your Inbox/i.test(await t()) && /Pending is people you said Interested to/.test(await t()));
  await tap('Pending (1)', true, 2000);
  check('Pending tip shows', /Tip · Pending/i.test(await t()));
  // Aisha says Interested back, the selfie is approved: the chat opens.
  await q("insert into interests (from_user_id,to_user_id) values ('10000000-0000-0000-0000-000000000003',$1) on conflict do nothing", [me]);
  await q("insert into selfie_checks (user_id,pose,status,consent_at,reviewed_at) values ($1,'three fingers','approved',now(),now()) on conflict (user_id) do update set status='approved'", [me]);
  await page.goto('http://localhost:8099/inbox'); await page.waitForTimeout(4500);
  check('chat opens once both are ready', /YOU BOTH CHOSE TO CONNECT/i.test(await t()));
  await tap('Aisha', false, 3500);
  check('chat tip explains Pause / End / Report / Block', /Tip · This chat/i.test(await t()));
  await tap('Got it', true, 1500);
  check('second chat tip follows', /Tip · Plan and remember/i.test(await t()));
  await page.locator('textarea').filter({ visible: true }).last().fill('Hi Aisha! What do you like to do on weekends?');
  await tap('Send', true, 2500);
  check('first message sends', /What do you like to do on weekends\?/.test(await t()));

  // Profile tab: with its tip showing, Settings and Guide still open.
  await page.goto('http://localhost:8099/profile'); await page.waitForTimeout(3000);
  check('Profile tip shows', /Tip · Your profile/i.test(await t()));
  await tap('Settings', true, 2500);
  check('Settings opens while the Profile tip is showing', page.url().includes('/settings'));
  check('Settings tip shows', /Tip · Settings/i.test(await t()));
  await page.goto('http://localhost:8099/profile'); await page.waitForTimeout(3000);
  await tap('Guide', true, 2500);
  check('Guide opens while the Profile tip is showing', page.url().includes('/guides'));
  check('Guide tip shows', /Tip · Guide/i.test(await t()));
  await tap('Got it', true, 1500);
  await page.reload(); await page.waitForTimeout(3000);
  check('a closed tip stays closed', !/Tip · Guide/i.test(await t()));
  check('no "AI" and no em dash anywhere in tips', !/\bAI\b|—/.test(await t()));
  await L.finish();
})().catch(async (e) => { console.log('FAIL  crashed:', e.message.split('\n')[0]); await L.finish(); });
