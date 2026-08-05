const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  page.on('request', (req) => {
    if (req.url().includes('coach_marks_seen')) {
      console.log('REQUEST:', req.method(), req.url());
      console.log('  body:', req.postData());
    }
  });
  page.on('response', async (res) => {
    if (res.url().includes('coach_marks_seen')) {
      console.log('RESPONSE:', res.status(), res.url());
      try {
        console.log('  body:', await res.text());
      } catch {}
    }
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));

  await page.goto('http://localhost:8081/dev', { waitUntil: 'load', timeout: 60000 });
  await page.getByText('Sign in as a seed test account', { exact: false }).waitFor({ timeout: 30000 });
  await page.getByText('Aisha Bello', { exact: true }).click();
  await page.waitForTimeout(6000);

  await page.goto('http://localhost:8081/home', { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(5000);

  const tooltip = page.getByText('Discover shows AI-suggested matches picked for you.', { exact: false }).last();
  console.log('tooltip visible before dismiss:', await tooltip.isVisible().catch(() => false));

  const gotIt = page.getByText('Got it', { exact: true }).last();
  console.log('Got it count:', await page.getByText('Got it', { exact: true }).count());
  console.log('clicking Got it...');
  await gotIt.click();
  await page.waitForTimeout(4000);
  console.log('tooltip visible after dismiss:', await tooltip.isVisible().catch(() => false));

  await browser.close();
})().catch((e) => console.error('SCRIPT ERROR', e));
