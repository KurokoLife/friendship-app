// 2026-10-26 (rebuild stage 2): joining has two intro screens, then What's
// hardest, Think about your friends and Here's where Limen can help. This
// suite walks the Meet someone new branch first (full profile), then a
// second new number without it (no profile, Discover invitation).
// 2026-10-17: joining from the very first screen to the app as a brand-new
// phone number (lands in Your circle since 2026-10-25), then Save,
// Interested, waiting in Your circle, the chat opening, and the
// first-time tips (cards in the page that never cover a button). Also checks
// the side margins on joining screens (they were missing on the web).
const L = require('../qa-lib'); const { check, text, q } = L;
const PHONE = '555555' + String(Date.now()).slice(-4);
const PHONE2 = '555556' + String(Date.now()).slice(-4);
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

  await q("delete from auth.users where phone like '+1555555%' or phone like '+1555556%'");
  await page.goto('http://localhost:8099/'); await page.waitForTimeout(3000);
  // Intro, two screens again (2026-10-26, exact wording from 05)
  check("intro 1: friendships drift", /Most friendships don't end\. They drift\./.test(await t()) && /Busy weeks, moves, screens\. It's easy to lose touch without meaning to\./.test(await t()));
  check('intro has side margins', (await margin("Most friendships don't end. They drift.")) >= 16);
  check('intro 1 has Next, no Back', /Next/.test(await t()) && (await page.getByText('Back', { exact: true }).filter({ visible: true }).count()) === 0);
  await tap('Next', true, 800);
  const i2 = await t();
  check('intro 2: small moments', /Friendships are made of small moments\./.test(i2) && /A quick call\. A coffee\. Stopping by to say hi\. Limen helps you make more of them\./.test(i2));
  check('intro 2: the three ways Limen helps', /Keep up with the friends you have\./.test(i2) && /Reconnect with someone you've lost touch with\./.test(i2) && /Meet someone new, one person at a time, in person\./.test(i2));
  check('intro 2: start here, Join and Sign in', /Wherever your friendships are right now, you can start here\./.test(i2) && /Join Limen/.test(i2) && /Already a member\? Sign in/.test(i2));
  check('liking-gap line is no longer in the intro', !/underestimate how much/.test(i2));
  await tap('Back', true, 600);
  check('intro 2 Back returns to intro 1', /They drift/.test(await t()));
  await tap('Next', true, 800);
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
  // What's hardest (private), right after Basics
  check("Basics goes to What's hardest", /What's hardest about friendship for you right now\?/.test(await t()), (await t()).slice(0, 300));
  check("What's hardest: all ten choices, private", /Meeting new people/.test(await t()) && /Friends don't really know what's going on with me/.test(await t()) && /Something else/.test(await t()) && /So Limen knows where to help first\. Only you see this\./.test(await t()));
  check("What's hardest has Back and margins", (await page.getByText('Back', { exact: true }).filter({ visible: true }).count()) > 0 && (await margin("What's hardest about friendship for you right now?")) >= 16);
  await tap('Meeting new people', true, 500);
  await tap('Keeping in touch with friends I have', true, 500);
  await tap('Something else', true, 500);
  await page.getByLabel('Something else, in your own words').fill('My weekends are all work');
  await page.getByLabel('Something else, in your own words').blur();
  await page.waitForTimeout(800);
  const hardRow = (await q("select j.hardest, j.hardest_other from joining_answers j join auth.users a on a.id = j.user_id where a.phone = $1", ['+1' + PHONE]))[0];
  check("hardest answers save as you go (with Something else)", hardRow && hardRow.hardest.includes('meeting_new') && hardRow.hardest.includes('keeping_in_touch') && /weekends are all work/.test(hardRow.hardest_other || ''), JSON.stringify(hardRow));
  await tap('Continue', true, 2500);
  // Think about your friends
  const fr = await t();
  check('then: think about your friends', /Think about your friends right now\./.test(fr) && /Not counting family or a partner: who would you call with good news\? Who could you ask for a hand\?/.test(fr));
  check('friends: the one-to-four line and the lost-touch prompt', /Most adults name one to four close friends\. None is more common than people think\./.test(fr) && /Anyone you've lost touch with but would like to hear from\?/.test(fr));
  check('friends: can skip', /Skip for now/.test(fr));
  const addName = async (box, name) => {
    await page.getByLabel(box, { exact: true }).fill(name);
    await page.getByRole('button', { name: `Add, ${box}`, exact: true }).click(); await page.waitForTimeout(1500);
  };
  await addName('Someone you would call', 'Mia');
  await addName('Someone you would call', 'Jo');
  await addName("Someone you've lost touch with", 'Ben');
  // Change Jo's circle to Friends.
  await page.getByLabel('Circle for Jo: Close. Change').click(); await page.waitForTimeout(600);
  await page.getByText('Friends', { exact: true }).filter({ visible: true }).last().click(); await page.waitForTimeout(1500);
  const circleRows = await q("select f.name, f.circle, f.rhythm from outside_friends f join auth.users a on a.id = f.user_id where a.phone = $1 order by f.name", ['+1' + PHONE]);
  const byName = Object.fromEntries(circleRows.map((r) => [r.name, r]));
  check('names land in Your circle right away', circleRows.length === 3, JSON.stringify(circleRows));
  check('Close gets every week', byName.Mia?.circle === 'close' && byName.Mia?.rhythm === 'week');
  check('Friends gets every month', byName.Jo?.circle === 'friends' && byName.Jo?.rhythm === 'month');
  check('Want to reconnect gets a few times a year', byName.Ben?.circle === 'reconnect' && byName.Ben?.rhythm === 'few_times_year');
  await tap('Continue', true, 2500);
  // Here's where Limen can help, filled in from What's hardest
  check("then: here's where Limen can help", /Here's where Limen can help\./.test(await t()) && /Change anything you like\./.test(await t()));
  const checked = async (label) => (await page.getByRole('checkbox', { name: label, exact: true }).getAttribute('aria-checked')) === 'true';
  check('filled in from the hardest answers', (await checked('Meet someone new')) && (await checked('Keep in touch with the people I have')) && !(await checked('Reconnect with someone')) && !(await checked('Notice my own patterns')));
  await tap('Reconnect with someone', true, 800);
  check('changeable, and saved as you go', (await q("select goals from joining_answers j join auth.users a on a.id = j.user_id where a.phone = $1", ['+1' + PHONE]))[0]?.goals?.includes('reconnect'));
  await tap('Back', true, 2000);
  check('Back goes to the friends step, names still there', /Think about your friends right now/.test(await t()) && /Mia/.test(await t()) && /Ben/.test(await t()));
  await tap('Continue', true, 2500);
  check('the change stays', await checked('Reconnect with someone'));
  await tap('Continue', true, 3000);
  // Start with you (Meet someone new)
  check('Meet someone new: the liking-gap line moved to the profile', /most people underestimate how much the other person\s+liked them/.test(await t()));
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
  await tap('Back', true, 2000);
  check("Start with you's Back goes to Here's where Limen can help", /Here's where Limen can help/.test(await t()));
  await tap('Continue', true, 3000);
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
  check('No care question (removed 2026-10-24)', !/How I like care|show they care/.test(more));
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
  check('Before you start: ending or pausing never counts, no extra button', /Nobody is told\. Ending a chat or pausing never counts\./.test(await t()) && !/More about quiet chats|Show less/.test(await t()));
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
  check('lands in Your circle', page.url().endsWith('/circle'), page.url());
  check('Your circle tip shows', /Tip · Your circle/i.test(await t()));
  const home1 = await t();
  check('Your circle holds the names from joining, with their rhythm', /Mia/.test(home1) && /Ben/.test(home1) && /Every week/.test(home1) && /A few times a year/.test(home1), home1.slice(0, 800));
  check('no profile offer card (already chose Meet someone new)', !/Meet someone new, too\?/.test(home1));
  check('empty circles show only the heading', !/Nobody here yet/.test(home1));
  const me = (await q('select id from auth.users where phone = $1', ['+1' + PHONE]))[0].id;

  // Tips: a card in the page, and it never covers a button.
  await page.goto('http://localhost:8099/home'); await page.waitForTimeout(3500);
  check('Discover tip is a card with a heading', /Tip · One new person a day/i.test(await t()));
  // Someone on Discover today, then Save.
  await q("delete from match_suggestions where user_id = $1", [me]);
  await q("insert into match_suggestions (user_id,candidate_id,reasoning,suggested_date) values ($1,'10000000-0000-0000-0000-000000000003','You might enjoy getting to know each other.', current_date) on conflict do nothing", [me]);
  await page.reload(); await page.waitForTimeout(3500);
  check('Discover card shows their own words, no app-written lines', !/You might enjoy getting to know each other|You'll likely connect/.test(await t()));
  await tap('Save', true, 2500);
  check('Save says saved', /Saved\. Aisha is below, under Saved/.test(await t()));
  await page.reload(); await page.waitForTimeout(3000);
  check('Saved lists the person, inside Discover', /Aisha/.test(await t()) && /SAVED · 1 OF 5/i.test(await t()));
  await tap('Aisha', false, 3000);
  check('profile page tip shows', /Tip · Notice something\?/i.test(await t()));
  await tap('Interested', true, 3000);
  check('Interested: kept in Your circle', /in Your circle, under Getting to know/.test(await t()));
  await page.goto('http://localhost:8099/circle'); await page.waitForTimeout(3500);
  check('Your circle: Aisha, waiting to connect', /Aisha/.test(await t()) && /Waiting to connect/.test(await t()), (await t()).slice(0, 600));
  await page.goto('http://localhost:8099/inbox'); await page.waitForTimeout(3500);
  check('Chats tip explains Chats', /Tip · Chats/i.test(await t()) && /under Past/.test(await t()));
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
  check('chat header stays calm (shared answers are on her profile)', !/approaches new friendships/.test(await t()));
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

  // You tab: with its tip showing, the Settings switch still works.
  await page.goto('http://localhost:8099/profile'); await page.waitForTimeout(3000);
  check('Profile tip shows', /Tip · Your profile/i.test(await t()));
  check('own profile lists How you connect answers (no summary)', /You as a friend/.test(await t()) && /They're probably just busy/.test(await t()) && !/connection summary/i.test(await t()));
  await page.getByText('Settings', { exact: true }).filter({ visible: true }).first().click(); await page.waitForTimeout(2500);
  check('Settings opens while the Profile tip is showing', page.url().includes('view=settings'), page.url());
  check('Settings tip shows', /Tip · Settings/i.test(await t()));
  check('no Guide anywhere', !/\bGuide\b/.test(await t()));
  await tap('Got it', true, 1500);
  await page.reload(); await page.waitForTimeout(3000);
  check('a closed tip stays closed', !/Tip · Settings/i.test(await t()));
  check('no "AI" and no em dash anywhere in tips', !/\bAI\b|—/.test(await t()));

  // ---- Second branch: joining without Meet someone new ---------------------
  const p2 = (await L.as(null, { viewport: { width: 390, height: 844 } })).page;
  const t2 = () => text(p2);
  const tap2 = async (label, exact = true, wait = 1200) => {
    const loc = p2.getByText(label, { exact }).filter({ visible: true });
    const n = await loc.count(); if (!n) throw new Error(`No visible "${label}"`);
    await loc.nth(n - 1).click(); await p2.waitForTimeout(wait);
  };
  const checked2 = async (label) => (await p2.getByRole('checkbox', { name: label, exact: true }).getAttribute('aria-checked')) === 'true';
  await p2.goto('http://localhost:8099/'); await p2.waitForTimeout(3000);
  await tap2('Next', true, 800); await tap2('Join Limen', true, 2000);
  await p2.getByPlaceholder('Phone number').fill(PHONE2);
  await tap2('Send code', true, 2000);
  await p2.locator('input').filter({ visible: true }).last().fill('123456');
  await tap2('Verify', true, 3500);
  for (const [ph, v] of [['First name', 'Raj'], ['Last name', 'Patel'], ['MM', '09'], ['DD', '03'], ['YYYY', '1968']]) await p2.getByPlaceholder(ph).filter({ visible: true }).last().fill(v);
  await p2.getByText('I agree to the', { exact: false }).filter({ visible: true }).last().click({ position: { x: 4, y: 6 } });
  await p2.waitForTimeout(400);
  await tap2('Continue', true, 3500);
  await tap2("Reconnecting with people I've lost touch with", true, 500);
  await tap2("I'm usually the one who reaches out", true, 800);
  await tap2('Continue', true, 2500);
  check('no names: only "Skip for now"', /Skip for now/.test(await t2()) && (await p2.getByText('Continue', { exact: true }).filter({ visible: true }).count()) === 0);
  await tap2('Skip for now', true, 2500);
  check('skipping the friends step is fine', /Here's where Limen can help/.test(await t2()));
  check('filled in: reconnect and patterns, not meet', (await checked2('Reconnect with someone')) && (await checked2('Notice my own patterns')) && !(await checked2('Meet someone new')));
  check('without Meet someone new, says it can be chosen later', /You can choose Meet someone new anytime later\./.test(await t2()));
  await tap2('Continue', true, 3000);
  check('no profile: straight to Keep your account safe', /Keep your account safe/.test(await t2()) && !/Start with you/.test(await t2()));
  await tap2('Back', true, 2000);
  check("Keep your account safe's Back goes to Here's where Limen can help", /Here's where Limen can help/.test(await t2()));
  await tap2('Continue', true, 3000);
  await tap2('Skip for now', true, 2500);
  const set2 = await t2();
  check('All set without the selfie offer', /You're all set/.test(set2) && !/selfie/i.test(set2) && /Go to Your circle/.test(set2));
  await tap2('Go to Your circle', true, 4000);
  check('lands in Your circle', p2.url().endsWith('/circle'), p2.url());
  const c2 = await t2();
  check('Your circle offers the profile in a card', /Meet someone new, too\?/.test(c2) && /Set up my profile/.test(c2));
  check('approved empty state wording', /Who would you like to stay close to\?/.test(c2) && /Add someone you'd like to see more of, or someone you've lost touch with\. A first name is enough, and only you see this list\./.test(c2) && /People you meet on Limen will show up here too\./.test(c2), c2.slice(0, 900));
  check('no "Nobody here yet" under empty circles', !/Nobody here yet/.test(c2));
  const me2 = (await q('select id from auth.users where phone = $1', ['+1' + PHONE2]))[0].id;
  const r2 = (await q('select readiness_status from users where id = $1', [me2]))[0];
  check('a member now (never sent through joining again)', r2?.readiness_status === 'ready');
  await p2.goto('http://localhost:8099/'); await p2.waitForTimeout(3500);
  check('opening the app again lands in Your circle', p2.url().endsWith('/circle'), p2.url());
  await p2.goto('http://localhost:8099/home'); await p2.waitForTimeout(3500);
  const d2 = await t2();
  check('Discover shows an invitation instead of people', /Meet someone new/.test(d2) && /Set up my profile/.test(d2) && !/People for you/.test(d2), d2.slice(0, 600));
  check('Discover invitation ends with the approved line', /Until then, you aren't shown to anyone, and nobody is shown to you\./.test(d2));
  check('Discover did not pick anyone for them', (await q('select count(*)::int n from match_suggestions where user_id = $1', [me2]))[0].n === 0);
  // Never suggested to anyone, even with a photo, until they choose it.
  await q("update profiles set photo_url = 'https://example.com/x.jpg', languages = '{English}', location_lat = null, location_lng = null where user_id = $1", [me2]);
  await q("update users set gender_identity = 'man', meet_genders = '{everyone}' where id = $1", [me2]);
  const seen = async () => (await q("select count(*)::int n from compatible_candidates_for('10000000-0000-0000-0000-000000000001') where user_id = $1", [me2]))[0].n;
  check('never suggested to others without Meet someone new', (await seen()) === 0);
  await q("update joining_answers set goals = goals || '{meet_new}' where user_id = $1", [me2]);
  check('(control) suggested once they choose it', (await seen()) === 1);
  await q("update joining_answers set goals = array_remove(goals, 'meet_new') where user_id = $1", [me2]);
  await p2.goto('http://localhost:8099/circle'); await p2.waitForTimeout(3500);
  await tap2('Set up my profile', true, 3000);
  check('the card opens the profile (Start with you, with the liking-gap line)', /Start with you/.test(await t2()) && /underestimate how much/.test(await t2()));
  await tap2('Back', true, 3000);
  check('Back returns to Your circle', p2.url().endsWith('/circle'), p2.url());
  await tap2('Not now', true, 1500);
  check('Not now puts the card away', !/Meet someone new, too\?/.test(await t2()));
  await p2.reload(); await p2.waitForTimeout(3500);
  check('and it stays away for now', !/Meet someone new, too\?/.test(await t2()));
  // Not now brings it back about 30 days later; the third Not now ends it (founder, 2026-10-27).
  const offer = async () => (await q('select meet_offer_not_now_count n, meet_offer_back_at back, meet_offer_hidden_at hidden from joining_answers where user_id = $1', [me2]))[0];
  let o = await offer();
  const days = (d) => Math.round((new Date(d) - Date.now()) / 86400000);
  check('first Not now: back in about 30 days', o.n === 1 && days(o.back) === 30 && !o.hidden, JSON.stringify(o));
  const monthLater = async () => { await q("update joining_answers set meet_offer_back_at = now() - interval '1 minute' where user_id = $1", [me2]); await p2.reload(); await p2.waitForTimeout(3500); };
  await monthLater();
  check('30 days later the card comes back', /Meet someone new, too\?/.test(await t2()));
  await tap2('Not now', true, 1500);
  o = await offer();
  check('second Not now: back again in about 30 days', o.n === 2 && days(o.back) === 30 && !o.hidden, JSON.stringify(o));
  await monthLater();
  check('...and comes back once more', /Meet someone new, too\?/.test(await t2()));
  // Setting up a profile ends it (here: choosing Meet someone new).
  await q("update joining_answers set goals = goals || '{meet_new}' where user_id = $1", [me2]);
  await p2.reload(); await p2.waitForTimeout(3500);
  check('setting up a profile ends the card', !/Meet someone new, too\?/.test(await t2()));
  await q("update joining_answers set goals = array_remove(goals, 'meet_new') where user_id = $1", [me2]);
  await p2.reload(); await p2.waitForTimeout(3500);
  await tap2('Not now', true, 1500);
  o = await offer();
  check('third Not now: never again', o.n === 3 && !!o.hidden && !o.back, JSON.stringify(o));
  await q("update joining_answers set meet_offer_back_at = now() - interval '400 days' where user_id = $1", [me2]);
  await p2.reload(); await p2.waitForTimeout(3500);
  check('after the third Not now it never comes back, even much later', !/Meet someone new, too\?/.test(await t2()));
  check('Discover still offers the profile', (await (async () => { await p2.goto('http://localhost:8099/home'); await p2.waitForTimeout(3500); return /Set up my profile/.test(await t2()); })()));
  // Private: another person can never read the hardest answers.
  const other = await (await fetch('http://localhost:54321/__test/session?user=10000000-0000-0000-0000-000000000001')).json();
  const peek = await (await fetch(`http://localhost:54321/rest/v1/joining_answers?select=*&user_id=eq.${me2}`, { headers: { apikey: 'x', Authorization: `Bearer ${other.access_token}` } })).json();
  check('another member cannot read the hardest answers', Array.isArray(peek) && peek.length === 0, JSON.stringify(peek).slice(0, 200));
  const anon = await (await fetch(`http://localhost:54321/rest/v1/joining_answers?select=*`, { headers: { apikey: 'x' } })).json();
  check('signed out cannot read them either', !Array.isArray(anon) || anon.length === 0, JSON.stringify(anon).slice(0, 200));
  await L.finish();
})().catch(async (e) => { console.log('FAIL  crashed:', e.message.split('\n')[0]); await L.finish(); });
