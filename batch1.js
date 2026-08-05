const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = path.join(__dirname, 'batch-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
function record(label, pass) {
  results.push({ label, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}: ${label}`);
}

async function waitVisible(locator, timeout = 30000) {
  try {
    await locator.waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });

  console.log('Warming up routes...');
  for (const route of ['/dev', '/home', '/browse', '/saved']) {
    await page.goto(`http://localhost:8081${route}`, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(800);
  }
  console.log('Warm-up done.\n');

  console.log('--- Signing in as Aisha Bello ---');
  await page.goto('http://localhost:8081/dev', { waitUntil: 'load', timeout: 60000 });
  await page.getByText('Sign in as a seed test account', { exact: false }).waitFor({ timeout: 30000 });
  await page.getByText('Aisha Bello', { exact: true }).click();
  // Not waitForURL: expo-router's router.replace('/home') is a client-side
  // SPA route change (history API), it never fires a browser 'load' event,
  // which is what waitForURL's default waitUntil semantics wait for, so it
  // reliably times out even after navigation has genuinely already
  // happened. A generous fixed wait, empirically proven reliable in this
  // project's own prior testing, is used for this one sign-in step only;
  // every actual assertion below still uses a real waitFor, not a sleep.
  await page.waitForTimeout(6000);
  console.log('URL after sign-in:', page.url());

  const tabs = [
    { path: '/home', name: 'tab_discover', text: 'Discover shows AI-suggested matches picked for you.' },
    { path: '/browse', name: 'tab_browse', text: 'Browse lets you search and filter for people yourself.' },
    { path: '/saved', name: 'tab_saved', text: "This is where the profiles you" },
  ];

  for (const tab of tabs) {
    await page.goto(`http://localhost:8081${tab.path}`, { waitUntil: 'load', timeout: 60000 });
    // .last(): SpotlightHost's Modal content portals to the end of
    // document.body, after CoachMark's own invisible self-measuring
    // placeholder (which renders the same text, at opacity:0, for accurate
    // sizing), so .last() reliably selects the real, visible one.
    const tooltip = page.getByText(tab.text, { exact: false }).last();
    const shown = await waitVisible(tooltip, 30000);
    record(`${tab.name}: spotlight tooltip text renders on first visit`, shown);
    await page.screenshot({ path: path.join(SHOT_DIR, `${tab.name}-01-spotlight.png`) });

    const gotIt = page.getByText('Got it', { exact: true }).last();
    if (await gotIt.isVisible().catch(() => false)) {
      await gotIt.click();
      // Generous wait, not a quick 1.2s: markCoachMarkSeen's own write is
      // fire-and-forget (an intentional optimistic-UI design from the
      // 2026-08-20 build), and navigating away too fast (a real browser
      // behavior, not a bug) aborts the in-flight request before it
      // reaches Supabase, a real risk this test hit once already.
      await page.waitForTimeout(3500);
    }
    await page.screenshot({ path: path.join(SHOT_DIR, `${tab.name}-02-after-dismiss.png`) });
    const goneAfterDismiss = !(await tooltip.isVisible().catch(() => false));
    record(`${tab.name}: dismiss hides it`, goneAfterDismiss);

    await page.goto(`http://localhost:8081${tab.path}`, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(3000);
    const reappeared = await tooltip.isVisible().catch(() => false);
    record(`${tab.name}: does not reappear after reload`, !reappeared);
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\nBatch 1: ${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SCRIPT ERROR:', e);
  process.exit(1);
});
