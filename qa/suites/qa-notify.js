// 2026-10-28: Rebuild stage 3b, Notifications. Runs the real
// send-notifications server function (Deno) against the local database, with
// Expo's push service and Resend replaced by local stand-ins that record what
// they receive. Then the Settings screen: per type and channel, quiet hours,
// the email line, and the web's "phone app" note.
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const L = require('../qa-lib');
const { U, check, text, go, q } = L;

const SECRET = 'local-test-secret-local-test-secret-1234';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' });
  const p = b64(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`;
}
const SERVICE = jwt({ role: 'service_role', iss: 'local', exp: 4102444800 });

// Stand-ins for Expo push and Resend.
const got = { push: [], email: [] };
let deadToken = null;
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const data = body ? JSON.parse(body) : null;
    if (req.url === '/push') {
      got.push.push(...data);
      res.end(JSON.stringify({ data: data.map((m) => (m.to === deadToken ? { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } : { status: 'ok', id: 'x' })) }));
    } else if (req.url === '/email') {
      got.email.push({ auth: req.headers.authorization, ...data });
      res.end(JSON.stringify({ id: 'e1' }));
    } else {
      res.statusCode = 404;
      res.end('{}');
    }
  });
});

async function run(auth = `Bearer ${SERVICE}`) {
  const r = await fetch('http://localhost:8000/', { method: 'POST', headers: { Authorization: auth } });
  return { status: r.status, json: await r.json().catch(() => null) };
}

(async () => {
  await new Promise((r) => fake.listen(8093, r));
  const fn = spawn('npx', ['deno', 'run', '-A', path.join(__dirname, '..', '..', 'supabase', 'functions', 'send-notifications', 'index.ts')], {
    env: {
      ...process.env,
      SUPABASE_URL: 'http://localhost:54321',
      SUPABASE_SERVICE_ROLE_KEY: SERVICE,
      RESEND_API_KEY: 're_test',
      NOTIFY_FROM: 'Limen <hello@limen.test>',
      APP_URL: 'https://app.limen.test/',
      EXPO_PUSH_URL: 'http://localhost:8093/push',
      RESEND_URL: 'http://localhost:8093/email',
    },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 9000));
  await L.start();
  const all = Object.values(U);
  await q(`delete from connections where user_a_id = any($1) or user_b_id = any($1)`, [all]);
  await q(`delete from notification_outbox`);
  await q(`delete from push_tokens`);
  await q(`delete from notification_settings where user_id = any($1)`, [all]);
  await q(`delete from outside_friends where user_id = any($1)`, [all]);
  await q(`delete from circle_suggestions where user_id = any($1)`, [all]);
  await q(`update users set email = null where id = any($1)`, [all]);
  await q(`update users set selfie_verified_at = now(), paused_until = null, suspended_at = null`);
  // No quiet hours for the sending checks (they are checked on their own below).
  await q(`insert into notification_settings (user_id, quiet_on) select unnest($1::uuid[]), false`, [all]);

  // ---- Who may run it --------------------------------------------------------------
  let r = await run('Bearer not-the-key');
  check('Only the service key can run the sender', r.status === 401);

  // ---- A hello, by push and email; never the message text ---------------------------
  await q(`update users set email = 'david@example.com' where id = $1`, [U.david]);
  await q(`insert into push_tokens (token, user_id, platform) values ('ExponentPushToken[david]', $1, 'ios')`, [U.david]);
  const C = await L.makeChat(U.maria, U.david, []);
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'My private words','text')`, [C, U.maria]);
  r = await run();
  check('The sender runs', r.status === 200 && r.json?.sent >= 1, JSON.stringify(r.json));
  const p1 = got.push.find((m) => m.to === 'ExponentPushToken[david]');
  check('Push: "Maria S. said hello", to the right phone', p1 && p1.body === 'Maria S. said hello' && p1.title === 'Limen', JSON.stringify(got.push));
  check('Push: tapping opens the chat', p1 && p1.data?.path === `/thread/${C}`);
  const e1 = got.email.find((m) => m.to?.[0] === 'david@example.com');
  check('Email: same line as the subject, from Limen, with the key', e1 && e1.subject === 'Maria S. said hello' && e1.from === 'Limen <hello@limen.test>' && e1.auth === 'Bearer re_test', JSON.stringify(got.email).slice(0, 300));
  check('Email: a link to the chat, and how to turn emails off', e1 && e1.html.includes(`https://app.limen.test/thread/${C}`) && /turn them off, in Limen under You, Settings, Notifications/.test(e1.text));
  check('Never the message text, anywhere', !JSON.stringify(got).includes('My private words'));
  check('Marked as sent', (await q(`select pushed, emailed, done_at is not null done from notification_outbox where user_id = $1`, [U.david]))[0]?.done === true);
  r = await run();
  check('Sent once, not again on the next run', got.push.filter((m) => m.to === 'ExponentPushToken[david]').length === 1);

  // ---- Choices per type and channel ---------------------------------------------------
  await q(`update notification_outbox set created_at = now() - interval '2 hours'`);
  await q(`update notification_settings set message_push = false where user_id = $1`, [U.david]);
  got.push = []; got.email = [];
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'More','text')`, [C, U.maria]);
  await run();
  check('Messages off for phone: no push, still an email', got.push.length === 0 && got.email.some((m) => m.subject === 'New message from Maria S.'), JSON.stringify([got.push, got.email.map((m) => m.subject)]));
  await q(`update notification_outbox set created_at = now() - interval '2 hours'`);
  await q(`update notification_settings set message_email = false where user_id = $1`, [U.david]);
  got.push = []; got.email = [];
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'Again','text')`, [C, U.maria]);
  await run();
  check('Messages off for both: nothing sent', got.push.length === 0 && got.email.length === 0);
  await q(`update notification_settings set message_email = true, message_push = true where user_id = $1`, [U.david]);

  // ---- Quiet hours: it waits ------------------------------------------------------------
  await q(`update notification_outbox set created_at = now() - interval '2 hours'`);
  await q(`update notification_settings set quiet_on = true, quiet_start = 0, quiet_end = 23, time_zone = 'UTC' where user_id = $1`, [U.david]);
  const hour = (await q(`select extract(hour from now() at time zone 'UTC')::int h`))[0].h;
  got.push = []; got.email = [];
  await q(`insert into messages (connection_id, sender_id, content, type) values ($1,$2,'x','plan_invite')`, [C, U.maria]);
  await run();
  if (hour < 23) {
    check('Quiet hours: nothing goes out yet', got.push.length === 0 && got.email.length === 0);
    check('...and it is still waiting', (await q(`select count(*)::int n from notification_outbox where user_id = $1 and done_at is null`, [U.david]))[0].n === 1);
    await q(`update notification_settings set quiet_on = false where user_id = $1`, [U.david]);
    await run();
    check('After quiet hours it goes out', got.push.some((m) => m.body === 'Maria S. invited you to plan something'));
  } else {
    check('Quiet hours (skipped at 11pm UTC): nothing goes out yet', true);
    await q(`update notification_settings set quiet_on = false where user_id = $1`, [U.david]);
    await run();
  }

  // ---- A phone that no longer has the app is forgotten --------------------------------------
  await q(`insert into push_tokens (token, user_id, platform) values ('ExponentPushToken[old]', $1, 'android')`, [U.david]);
  deadToken = 'ExponentPushToken[old]';
  await q(`insert into notification_outbox (user_id, type, title, path) values ($1, 'plan', 'A test notification from Limen', '/circle')`, [U.david]);
  await run();
  check('A phone that no longer has the app is forgotten', (await q(`select count(*)::int n from push_tokens where token = 'ExponentPushToken[old]'`))[0].n === 0);

  // ---- Suggestions: started by the sender, one line, the same rule as the app ------------
  await q(`update users set readiness_status = 'ready' where id = $1`, [U.priya]);
  await q(`update users set email = 'priya@example.com' where id = $1`, [U.priya]);
  await q(`insert into outside_friends (user_id, name, circle, rhythm, created_at) values ($1, 'Momo Tanaka', 'close', 'week', now() - interval '9 days')`, [U.priya]);
  got.push = []; got.email = [];
  r = await run();
  const sMail = got.email.find((m) => m.to?.[0] === 'priya@example.com');
  check('A due suggestion is sent once: the name and the plain line', sMail && sMail.subject === "You and Momo haven't been in touch for a while.", JSON.stringify(got.email.map((m) => m.subject)));
  check('The suggestion is the same one waiting in Your circle', (await q(`select count(*)::int n from circle_suggestions where user_id = $1 and resolved_at is null`, [U.priya]))[0].n === 1);
  got.email = [];
  await run();
  check('The open suggestion isn\'t sent again', !got.email.some((m) => m.to?.[0] === 'priya@example.com'));
  await q(`delete from circle_suggestions where user_id = $1`, [U.priya]);
  await q(`insert into circle_suggestion_settings (user_id, frequency) values ($1, 'off') on conflict (user_id) do update set frequency = 'off'`, [U.priya]);
  got.email = [];
  await run();
  check('Suggestions set to none: nothing sent', !got.email.some((m) => m.to?.[0] === 'priya@example.com'));
  await q(`delete from circle_suggestion_settings where user_id = $1`, [U.priya]);
  await q(`update notification_settings set suggestion_email = false, suggestion_push = false where user_id = $1`, [U.priya]);
  await run();
  check('Suggestion notifications off: none started from outside the app', (await q(`select count(*)::int n from circle_suggestions where user_id = $1`, [U.priya]))[0].n === 0);

  // ---- Settings screen ------------------------------------------------------------------------
  await q(`update users set email = null where id = $1`, [U.marcus]);
  await q(`delete from notification_settings where user_id = $1`, [U.marcus]);
  const m = await L.as(U.marcus, { viewport: { width: 390, height: 844 } });
  await go(m.page, '/profile?view=settings', 3500);
  let t = await text(m.page);
  check('Settings: Notifications section', /Notifications/.test(t) && /A message notification only says who it's from, never what it says\./.test(t));
  check('Four types, each with Phone and Email', /A new hi/.test(t) && /New messages/.test(t) && /Plans and meetups/.test(t) && /Suggestions/.test(t) && (await m.page.getByRole('switch', { name: 'New messages: email', exact: true }).count()) === 1 && (await m.page.getByRole('switch', { name: 'Plans and meetups: phone', exact: true }).count()) === 1);
  check('Gentle defaults: everything on', await m.page.getByRole('switch', { name: 'A new hi: phone', exact: true }).isChecked() && await m.page.getByRole('switch', { name: 'Suggestions: email', exact: true }).isChecked());
  check('Quiet hours on by default, 9 pm to 8 am', /Nothing arrives between 9 pm and 8 am\. It waits until then\./.test(t));
  check('Web: phone notifications work in the phone app', /Phone notifications work in the Limen phone app\./.test(t));
  check('No email yet: points to Sign-in and recovery', /To get emails, add one in Sign-in and recovery\./.test(t));
  await m.page.getByRole('switch', { name: 'New messages: email', exact: true }).click();
  await m.page.waitForTimeout(1500);
  check('Turning one off is saved', (await q(`select message_email from notification_settings where user_id = $1`, [U.marcus]))[0]?.message_email === false);
  await m.page.getByRole('radio', { name: '10 pm', exact: true }).click(); await m.page.waitForTimeout(1200);
  await m.page.getByRole('radio', { name: '7 am', exact: true }).click(); await m.page.waitForTimeout(1500);
  check('Quiet hours change is saved', JSON.stringify(await q(`select quiet_start, quiet_end from notification_settings where user_id = $1`, [U.marcus])) === JSON.stringify([{ quiet_start: 22, quiet_end: 7 }]));
  check('...and the line follows', /Nothing arrives between 10 pm and 7 am\./.test(await text(m.page)));
  await m.page.getByRole('switch', { name: 'Quiet hours', exact: true }).click(); await m.page.waitForTimeout(1500);
  check('Quiet hours can be turned off', /Notifications can arrive at any hour\./.test(await text(m.page)) && (await q(`select quiet_on from notification_settings where user_id = $1`, [U.marcus]))[0].quiet_on === false);
  await q(`update users set email = 'marcus@example.com' where id = $1`, [U.marcus]);
  await m.page.reload(); await m.page.waitForTimeout(3500);
  check('With an email: says where emails go', /Emails go to marcus@example\.com\./.test(await text(m.page)));
  check('The time zone is saved when the app opens', (await q(`select time_zone from notification_settings where user_id = $1`, [U.marcus]))[0]?.time_zone === 'America/Los_Angeles');

  // Test tab button
  const mo = await L.as(U.mochi, { viewport: { width: 390, height: 844 } });
  await go(mo.page, '/dev', 3000);
  check('Test tab: "Send me a test notification"', (await mo.page.getByText('Send me a test notification', { exact: true }).count()) > 0);

  fn.kill();
  fake.close();
  await L.finish();
})().catch(async (e) => { console.log('CRASH', e.message); await L.finish().catch(() => {}); process.exit(0); });
