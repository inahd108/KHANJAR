// Scripted gameplay test (dev): node tools/play.cjs "<js run after begin>" [out.jpg] [--page]
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('console', (m) => { const t = m.text(); if (!/vite|GPU stall|GL Driver|world built/.test(t)) console.log('[' + m.type() + ']', t.slice(0, 1500)); });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message, (e.stack || '').split('\n').slice(0, 6).join(' | ')));
  await page.goto('http://127.0.0.1:5173/index.html?headless&q=' + (process.env.Q || 'low'));
  await page.waitForFunction('window.__ready === true || !!window.__error', null, { timeout: 300000 });
  if (await page.evaluate('!!window.__error')) { await browser.close(); process.exit(3); }
  await page.evaluate(`window.T = {
    key: (c, on = true) => { on ? (game.input.keys.add(c), game.input.pressed.add(c)) : game.input.keys.delete(c); },
    tap: (c) => { game.input.pressed.add(c); },
    click: (b = 'left') => { game.input.mouse[b + 'Pressed'] = true; },
    sim: (sec, dt = 1 / 30) => { const n = Math.round(sec / dt); for (let i = 0; i < n; i++) game.update(dt); },
    st: () => { const p = game.player; return { state: p.state, pos: p.pos.toArray().map((v) => +v.toFixed(2)), hp: Math.round(p.health), anim: p.char.currentName, alert: game.alertState, phase: game.phase, gs: game.state }; },
    tp: (x, y, z, yaw = 0) => { game.player.place(x, y, z, yaw); game.player.setState('ground'); game.player.body.onGround = true; game.cam.snap(game.player); },
    look: (yaw, pitch = 0.2) => { game.cam.yaw = yaw; game.cam.pitch = pitch; },
  }; game.begin(); undefined`);
  const res = await page.evaluate(process.argv[2]);
  console.log(typeof res === 'string' ? res : JSON.stringify(res));
  if (process.argv[3] && !process.argv[3].startsWith('--')) {
    await page.evaluate('window.__step(2, 0.001)');
    if (process.argv.includes('--page')) await page.screenshot({ path: process.argv[3], timeout: 180000 });
    else { const data = await page.evaluate(() => document.querySelector('canvas').toDataURL('image/jpeg', 0.92)); fs.writeFileSync(process.argv[3], Buffer.from(data.split(',')[1], 'base64')); }
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
