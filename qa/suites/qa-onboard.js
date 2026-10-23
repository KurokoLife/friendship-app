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
  // Intro, two screens (2026-10-18)
  check('intro screen 1: making friends as an adult is hard', /Making friends as an adult is hard/.test(await t()));
  check('intro has side margins', (await margin("Making friends as an adult is hard. It's not just you.")) >= 16);
  // 2026-10-22: one intro screen (was two).
  check('intro does not promise friends', /helps with the parts that can feel awkward/.test(await t()) && !/simply friends/.test(await t()));
  check('one intro screen keeps the liking-gap line', /underestimate how much the other person liked them/.test(await t()) && /No swiping/.test(await t()));
  check('intro leads straight to joining', /Join Limen/.test(await t()) && /Already a member\? Sign in/.test(await t()));
  await tap('Join Limen', true, 2000);
  // 2026-10-19: sign-up comes first (phone and code), then Basics, then Start with you.
  check('sign-up comes right after the intro', /What's your number\?/.test(await t()));
  check('phone screen has Back', (await page.getByText('Back', { exact: true }).filter({ visible: true }).count()) > 0);
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
  await tap('Continue', true, 3500);
  // Start with you, right after Basics
  check('Basics goes to Start with you', /Start with you/.test(await t()) && /What brings you to Limen\?/.test(await t()));
  check('Start with you says it saves as you go, phone or computer', /on your phone or a computer/.test(await t()));
  check('no word count or step counter', !/80 to 200 words|Step \d of/.test(await t()));
  check('five story guides to start from', /A moment from your life\./.test(await t()) && /Start with "I remember\.\.\." and keep going\./.test(await t()));
  await page.getByLabel('What brings you to Limen?').fill('Most of my old friends moved away and I want people to walk with.');
  await page.getByLabel('What brings you to Limen?').blur();
  await tap('A day you remember well.', true, 600);
  check('picked guide stays above the box as a guide', /A day you remember well\. Any day at all/.test(await t()));
  await page.getByLabel('Story 1').fill('The day the power went out on our street, everyone brought their food outside and we had a block party by candlelight. I met three neighbors I had waved at for years.');
  await page.getByLabel('Story 1').blur();
  await page.waitForTimeout(800);
  const midway = (await q("select p.life_transitions_other, p.stories from profiles p join auth.users a on a.id = p.user_id where a.phone = $1", ['+1' + PHONE]))[0];
  check('writing is saved to the account as you go (before Continue)', /old friends moved away/.test(midway?.life_transitions_other || '') && (midway?.stories || []).length === 1, JSON.stringify(midway).slice(0, 200));
  // Another device: no copy on this device, open the app again, the writing is there.
  await page.evaluate(() => localStorage.removeItem('limen.start_draft.v1'));
  await page.goto('http://localhost:8099/'); await page.waitForTimeout(3500);
  check('coming back (or on another device) returns to Start with you', /Start with you/.test(await t()), page.url() + ' ' + (await t()).slice(0, 200));
  check('what was written comes back from the account', (await page.getByLabel('What brings you to Limen?').inputValue()).includes('old friends moved away') && (await page.getByLabel('Story 1').inputValue()).includes('power went out'));
  await tap('Add another story (up to 3)', false, 800);
  check('can add a second story', (await page.getByLabel('Story 2').count()) > 0);
  await page.getByLabel('Story 2').fill('I remember learning to bake bread during a snowy week. It was terrible and I loved it.');
  await page.getByLabel('Story 2').blur();
  await page.waitForTimeout(500);
  await tap('Continue', true, 3000);
  const savedStart = (await q("select p.life_transitions_other, p.stories from profiles p join auth.users a on a.id = p.user_id where a.phone = $1", ['+1' + PHONE]))[0];
  check('Start with you is saved to the profile', /old friends moved away/.test(savedStart?.life_transitions_other || '') && (savedStart?.stories || []).length === 2, JSON.stringify(savedStart).slice(0, 200));
  check('the guide key is stored, not shown', (savedStart?.stories || [])[0]?.prompt_key === 'day');
  // What you enjoy
  check('then: what you enjoy (no Step N of 10)', /What you enjoy/.test(await t()) && !/Step \d+ of/.test(await t()));
  check('no "Required" labels', !/\bRequired\b/.test(await t()));
  await tap('Coffee culture', true, 600);
  check('each interest has its own example line', (await page.getByPlaceholder('Optional. Like "I know every cafe within a mile of home"').count()) > 0 && (await page.getByPlaceholder('talking to my tomatoes', { exact: false }).count()) === 0);
  await page.getByLabel('Coffee culture in your own words').fill('A new cafe every Saturday');
  await page.getByLabel('Coffee culture in your own words').blur();
  await tap('Continue', true, 1500);
  check('practical: where you are based', /Where you're based/.test(await t()));
  await fill('e.g. 90012', '90012'); await tap('Confirm location', true, 2500);
  await tap('Continue', true, 1500);
  await tap('Deep 1-on-1 connection', true, 300); await tap('Every 2 weeks', true, 300); await tap('Same day', true, 300); await tap('Weekends', true, 300);
  await tap('Continue', true, 1500);
  const more = await t();
  check('values, opening up and hangout style are gone', !/What matters to you|share personal things|How you like to hang out/.test(more));
  check('bars question reworded', /Are bars or drinks okay when you meet\?/.test(more) && /Fine with me/.test(more) && /I'd rather not/.test(more));
  check('Good to know about me replaces Hard nos', /Good to know about me/.test(more) && !/Hard nos/.test(more));
  await tap("I'd rather not", true, 400);
  await tap('Continue', true, 1500);
  check('languages step', /Languages I am comfortable connecting in/.test(await t()));
  await tap('English', true, 400);
  await tap('Continue', true, 1000);
  // English starts selected, so tapping it once deselects it.
  check('English starts selected (tapping it deselects, then a language is needed)', /At least one language/.test(await t()));
  await tap('English', true, 400); await tap('Continue', true, 2500);
  // Who you'd like to meet comes after the practical bits
  check('gender screen has side margins', (await margin("What's your gender?")) >= 16);
  await tap('Woman'); await tap('Continue', true, 2000);
  await tap('Everyone'); await tap('Done', true, 3000);
  // How you connect: six questions, no summary
  const hyc = await t();
  check('How you connect: six friendship questions', /How you connect/.test(hyc) && /When someone takes a while to reply, I usually think/.test(hyc) && !/After a full day of social plans/.test(hyc));
  check('every How you connect question takes several answers', ((await t()).match(/Choose any that fit/g) || []).length === 6);
  await tap('It depends', false, 200);
  for (const a of ['We saw each other regularly', 'We talked but never made plans', 'We may both just need more time', "They're probably just busy", 'Want to reach out, but wait', 'Suggesting a meetup']) await tap(a, true, 250);
  check('a share choice comes after the questions, with two equal options', /Share with people you connect with\?/.test(await t()) && /Keep private/.test(await t()));
  await tap('Share with people I connect with', true, 300);
  await tap('Continue', true, 3000);
  const exp = (await q("select p.friendship_experience e from profiles p join auth.users a on a.id = p.user_id where a.phone = $1", ['+1' + PHONE]))[0]?.e || {};
  check('the share choice is saved', (await q("select p.share_friendship_experience s from profiles p join auth.users a on a.id = p.user_id where a.phone = $1", ['+1' + PHONE]))[0]?.s === true);
  check('several answers are saved for one question', Array.isArray(exp.afterPositiveMeetupBehavior) && exp.afterPositiveMeetupBehavior.length === 2, JSON.stringify(exp).slice(0, 200));
  check('no summary screen; photo comes next', /A photo of you/.test(await t()) && !/A little about how you connect/.test(await t()));
  const [fc] = await Promise.all([page.waitForEvent('filechooser', { timeout: 8000 }), tap('Add a photo', true, 300)]);
  await fc.setFiles(require('path').join(__dirname, '..', '.local', 'face.jpg'));
  await page.waitForTimeout(4000);
  await tap('Continue', true, 3000);
  // Ground rules instead of the videos
  check('ground rules screen replaces the videos', /Before you start/.test(await t()) && !/Begin With Curiosity/.test(await t()));
  check('readiness screen has side margins', (await margin('Before you start')) >= 16);
  check('Before you start reads warmly', /Everyone here agrees to the same few things/.test(await t()) && /Friendship only/.test(await t()) && /Honest is kinder than quiet/.test(await t()));
  check('the reply rule is spelled out', /Answer every hello, even with a "no thanks"/.test(await t()) && /twice within two months/.test(await t()));
  await tap('Sounds good', true, 3500);
  check('preview shows a 5-year age range', /Tess W\., (45-49|50-54)/.test(await t()));
  check('preview has Back', (await page.getByText('Back', { exact: true }).filter({ visible: true }).count()) > 0);
  check("preview: here's what people will see", /Here's what people will see/.test(await t()) && /old friends moved away/.test(await t()));
  check('preview shows the story but not the guide', /power went out on our street/.test(await t()) && !/A day you remember well/.test(await t()));
  check('preview shows the own line for an interest', /A new cafe every Saturday/.test(await t()));
  check('preview: Good to know replaces Hard nos, bars reworded', /I'd rather not/.test(await t()) && !/Hard nos|Opening up|Hangout style/.test(await t()));
  await tap('Looks good', true, 3000);
  // Account recovery moved near the end (2026-10-19), still optional.
  check('then: keep your account safe (optional)', /Keep your account safe/.test(await t()) && /lose or change your phone number/.test(await t()));
  await tap('Skip for now', true, 2500);
  check('All set screen', /You're all set/.test(await t()));
  check('All set has side margins', (await margin("You're all set")) >= 16);
  check('All set says Interested works while the selfie is checked', /You can say Interested while it's checked/.test(await t()));
  await tap("I'll do it later", true, 4000);
  check('lands on Discover', page.url().endsWith('/home'));
  const me = (await q('select id from auth.users where phone = $1', ['+1' + PHONE]))[0].id;

  // Tips: a card in the page, and it never covers a button.
  check('Discover tip is a card with a heading', /Tip · One new person a day/i.test(await t()));
  // Someone on Discover today, then Save.
  await q("delete from match_suggestions where user_id = $1", [me]);
  await q("insert into match_suggestions (user_id,candidate_id,reasoning,suggested_date) values ($1,'10000000-0000-0000-0000-000000000003','You might enjoy getting to know each other.', current_date) on conflict do nothing", [me]);
  await page.reload(); await page.waitForTimeout(3500);
  check('Discover card shows their own words, no app-written lines', !/You might enjoy getting to know each other|You'll likely connect/.test(await t()));
  await tap('Save', true, 2500);
  check('Save says saved', /Saved\. Aisha is in Saved/.test(await t()));
  await page.goto('http://localhost:8099/saved'); await page.waitForTimeout(3000);
  check('Saved lists the person', /Aisha/.test(await t()) && /SAVED · 1 OF 5/i.test(await t()));
  await tap('Aisha', false, 3000);
  check('profile page tip shows', /Tip · Notice something\?/i.test(await t()));
  await tap('Interested', true, 3000);
  check('Interested is saved to Pending', /under Pending/.test(await t()));
  await page.goto('http://localhost:8099/inbox'); await page.waitForTimeout(3500);
  check('Inbox tip explains the tabs', /Tip · Your Inbox/i.test(await t()) && /Pending is people you said Interested to/.test(await t()));
  // The Pending tip waits until the Inbox tip is closed (2026-10-22).
  await tap('Pending (1)', true, 2000);
  check('Pending tip waits for the Inbox tip', !/Tip · Pending/i.test(await t()));
  await tap('Got it', true, 1500);
  check('Pending tip shows', /Tip · Pending/i.test(await t()));
  // Aisha says Interested back, the selfie is approved: the chat opens.
  await q("insert into interests (from_user_id,to_user_id) values ('10000000-0000-0000-0000-000000000003',$1) on conflict do nothing", [me]);
  await q("insert into selfie_checks (user_id,pose,status,consent_at,reviewed_at) values ($1,'three fingers','approved',now(),now()) on conflict (user_id) do update set status='approved'", [me]);
  // Aisha's selfie may have been changed by an earlier test; make sure it's approved.
  await q("insert into selfie_checks (user_id,pose,status,consent_at,reviewed_at) values ('10000000-0000-0000-0000-000000000003','three fingers','approved',now(),now()) on conflict (user_id) do update set status='approved'");
  await page.goto('http://localhost:8099/inbox'); await page.waitForTimeout(4500);
  check('chat opens once both are ready', /YOU BOTH CHOSE TO CONNECT/i.test(await t()) && (await q("select count(*)::int n from connections where status is not null and $1 in (user_a_id,user_b_id)", [me]))[0].n === 1);
  // Aisha shares her answers: Tess (now connected) sees them on Aisha's profile.
  await q(`update profiles set share_friendship_experience = true, friendship_experience = '{"hardestCurrentStep":["Suggesting a meetup"],"slowReplyThought":["They''re probably just busy"],"growthFactors":["We saw each other regularly"]}'::jsonb where user_id = '10000000-0000-0000-0000-000000000003'`);
  await tap('Aisha', false, 3500);
  check('chat header links to how they approach new friendships', /How Aisha approaches new friendships/.test(await t()));
  await page.goto('http://localhost:8099/candidate/10000000-0000-0000-0000-000000000003'); await page.waitForTimeout(3500);
  const shared = await t();
  check('connected: their shared answers show on their profile', /How Aisha approaches new friendships/.test(shared) && /What feels hardest for Aisha right now/.test(shared) && /Suggesting a meetup/.test(shared), shared.slice(-500));
  check('past-friendship answers are never shared', !/We saw each other regularly/.test(shared));
  await q("update profiles set share_friendship_experience = false where user_id = '10000000-0000-0000-0000-000000000003'");
  await page.reload(); await page.waitForTimeout(3500);
  check('not shown once they keep it private', !/approaches new friendships/.test(await t()));
  await page.goBack(); await page.waitForTimeout(3500);
  check('empty chat: a short hello is plenty', /A short hello is plenty\. Something from their profile is an easy place to start\./.test(await t()));
  check('chat tips wait until the first message', !/Tip · This chat/i.test(await t()));
  await page.locator('textarea').filter({ visible: true }).last().fill('Hi Aisha! What do you like to do on weekends?');
  await tap('Send', true, 2500);
  check('first message sends', /What do you like to do on weekends\?/.test(await t()));
  check('chat tip explains Pause / End / Report / Block', /Tip · This chat/i.test(await t()));
  await tap('Got it', true, 1500);
  check('second chat tip follows', /Tip · Plan and remember/i.test(await t()));
  check('one line under the box: a stage tip', /Asking one question back keeps things going\./.test(await t()) && !/Not sure what they meant/.test(await t()));

  // Profile tab: with its tip showing, Settings and Guide still open.
  await page.goto('http://localhost:8099/profile'); await page.waitForTimeout(3000);
  check('Profile tip shows', /Tip · Your profile/i.test(await t()));
  check('own profile lists How you connect answers (no summary)', /You as a friend/.test(await t()) && /They're probably just busy/.test(await t()) && !/connection summary/i.test(await t()));
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
