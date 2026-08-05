const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const context = await browser.newContext({ viewport: null, storageState: undefined });
  const page = await context.newPage();
  await page.goto('http://localhost:8081/', { waitUntil: 'networkidle' });
  console.log('Landed on:', page.url());
  // Keep the process alive so the window stays open for the user.
  await new Promise(() => {});
})();
