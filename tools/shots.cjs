// Multi-camera screenshot helper (dev): node tools/shots.cjs <url-path> <out-prefix> "name:px,py,pz,tx,ty,tz[,fov];..." [--w 1280] [--h 720]
const { chromium } = require('playwright');
const fs = require('fs');
const args = process.argv.slice(2);
const get = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: +get('w', 1280), height: +get('h', 720) }, deviceScaleFactor: 1 });
  page.on('console', (m) => { const t = m.text(); if (!/vite|GPU stall|GL Driver/.test(t)) console.log('[' + m.type() + ']', t.slice(0, 1500)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 5).join(' | ')));
  await page.goto('http://127.0.0.1:5173/' + args[0]);
  await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: 300000 });
  if (await page.evaluate('!!window.__error')) { await browser.close(); process.exit(3); }
  const pre = get('eval', null); if (pre) await page.evaluate(pre);
  for (const spec of args[2].split(';')) {
    const [name, rest] = spec.split(':'); const v = rest.split(',').map(Number);
    await page.evaluate(([v]) => { window.__cam(v[0], v[1], v[2], v[3], v[4], v[5], v[6] || 58); window.__settle(2); }, [v]);
    const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/jpeg', 0.92));
    fs.writeFileSync(`${args[1]}_${name}.jpg`, Buffer.from(data.split(',')[1], 'base64'));
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
