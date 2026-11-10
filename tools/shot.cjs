// Headless screenshot helper used during development.
// node tools/shot.cjs <url-path> <out.png> [--w 1600] [--h 900] [--wait ms] [--eval "js"] [--frames n]
const { chromium } = require('playwright');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
  const page = await browser.newPage({ viewport: { width: +get('w', 1600), height: +get('h', 900) }, deviceScaleFactor: 1 });
  page.on('console', (m) => { const t = m.text(); if (!/GPU stall|GL Driver Message/.test(t)) console.log('[' + m.type() + ']', t.slice(0, 1500)); });
  page.on('pageerror', (e) => { console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 5).join(' | ')); if (!args.includes('--keep')) { browser.close().then(() => process.exit(2)); } });
  await page.goto('http://127.0.0.1:5173/' + args[0], { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: +get('timeout', 240000) });
  if (await page.evaluate('!!window.__error')) { await browser.close(); process.exit(3); }
  const ev = get('eval', null);
  if (ev) { const r = await page.evaluate(ev); if (r !== undefined) console.log('eval ->', JSON.stringify(r)); }
  await page.waitForTimeout(+get('wait', 500));
  if (get('settle', null)) await page.evaluate('window.__settle && window.__settle(' + get('settle') + ')');
  if (args.includes('--page')) await page.screenshot({ path: args[1], timeout: 180000 });
  else {
    // read the WebGL canvas directly (fast, and independent of the compositor)
    const data = await page.evaluate(() => { const c = document.querySelector('canvas'); return c.toDataURL('image/png'); });
    require('fs').writeFileSync(args[1], Buffer.from(data.split(',')[1], 'base64'));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
