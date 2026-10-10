const { chromium } = require('playwright-core');
const { Pool } = require('pg');
const pool = new Pool({ host: 'localhost', port: 5433, user: 'postgres', database: 'limen' });
const U = {
  maria: '10000000-0000-0000-0000-000000000001', david: '10000000-0000-0000-0000-000000000002',
  aisha: '10000000-0000-0000-0000-000000000003', robert: '10000000-0000-0000-0000-000000000004',
  priya: '10000000-0000-0000-0000-000000000005', marcus: '10000000-0000-0000-0000-000000000006',
  jordan: '10000000-0000-0000-0000-000000000007', sam: '10000000-0000-0000-0000-000000000008',
  elena: '10000000-0000-0000-0000-000000000009',
  mochi: '10000000-0000-0000-0000-0000000000aa',
};
const BASE = 'http://localhost:8099';
let browser;
const results = [];
function check(label, cond, extra = '') {
  results.push({ label, ok: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  ' + String(extra).slice(0, 300) : ''}`);
}
async function start() {
  const fs = require('fs');
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const dir = fs.readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().pop();
  browser = await chromium.launch({ executablePath: `${base}/${dir}/chrome-linux/chrome` });
}
async function as(userId, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 430, height: 1100 }, colorScheme: 'dark', timezoneId: 'America/Los_Angeles', ...opts });
  if (userId) {
    const session = await (await fetch(`http://localhost:54321/__test/session?user=${userId}`)).json();
    await ctx.addInitScript((s) => {
      if (!window.sessionStorage.getItem('__seeded')) {
        window.localStorage.setItem('sb-localhost-auth-token', JSON.stringify(s));
        window.sessionStorage.setItem('__seeded', '1');
      }
    }, session);
  }
  const page = await ctx.newPage();
  page.on('pageerror', (e) => { if (!/Minified React error #418/.test(e.message)) console.log('   pageerror:', e.message.slice(0, 200)); });
  return { ctx, page };
}
async function text(page) { return (await page.innerText('body')).replace(/\s+/g, ' '); }
async function go(page, path, wait = 2500, opts = {}) {
  await page.goto(BASE + path);
  await page.waitForTimeout(wait);
  if ((opts.expand ?? true) && path.startsWith('/thread/')) await openPlan(page);
}
async function tap(page, label, opts = {}) {
  const loc = page.getByText(label, { exact: opts.exact ?? true });
  const n = await loc.count();
  if (n === 0) throw new Error(`No button "${label}"`);
  await loc.nth(opts.nth ?? (n - 1)).click();
  await page.waitForTimeout(opts.wait ?? 1200);
}
// 2026-10-10: the plan card is a slim bar until tapped.
async function openPlan(page) {
  const loc = page.getByRole('button', { name: /Show the plan/ });
  if (await loc.count()) {
    await loc.first().click();
    await page.waitForTimeout(800);
  }
}
async function q(sql, params = []) { return (await pool.query(sql, params)).rows; }
async function makeChat(a, b, messages = []) {
  const [c] = await q(`insert into connections (user_a_id, user_b_id, status) values ($1,$2,'active') returning id`, [a, b]);
  for (const [sender, content, hoursAgo] of messages) {
    await q(`insert into messages (connection_id, sender_id, content, type, created_at) values ($1,$2,$3,'text', now() - make_interval(hours => $4))`, [c.id, sender, content, hoursAgo]);
  }
  return c.id;
}
async function finish() {
  await browser.close();
  await pool.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) console.log('FAILED:', failed.map((f) => f.label).join(' | '));
}
module.exports = { start, as, text, go, tap, q, makeChat, check, finish, U, openPlan };
