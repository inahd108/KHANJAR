// node tools/eval.cjs <url-path> "<js expression evaluated after load>"   (dev helper)
const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => { const t = m.text(); if (!/vite|GPU stall|GL Driver/.test(t)) console.log('[' + m.type() + ']', t.slice(0, 3000)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto('http://127.0.0.1:5173/' + process.argv[2]);
  await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: 240000 });
  const r = await page.evaluate(process.argv[3]);
  console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
  await browser.close();
})();
