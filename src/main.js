import * as THREE from 'three';
import { Gfx } from './gfx.js';
import { buildWorld } from './world/index.js';
import { loadCharacterLibrary } from './characters.js';
import { loadCastAssets } from './cast.js';
import { loadProps } from './world/props.js';
import { Game } from './game.js';

const q = new URLSearchParams(location.search);
window.__headless = q.has('headless');

async function boot() {
  const ui = document.getElementById('ui');
  ui.innerHTML = '<div class="screen loading"><div class="title-block"><div class="kicker">Jerusalem &middot; 1187</div><h1>KHANJAR</h1><div class="bar"><div class="fill"></div></div><div class="load-text">Preparing</div></div></div>';
  const fill = ui.querySelector('.fill'), text = ui.querySelector('.load-text');
  const progress = (f, t) => { fill.style.width = Math.round(f * 100) + '%'; if (t) text.textContent = t; };
  const quality = q.get('q') || localStorage.getItem('khanjar.quality') || 'high';
  const gfx = new Gfx(document.getElementById('game'), quality);
  progress(0.05, 'Lighting the sky');
  await gfx.loadSky('./assets/sky.hdr');
  progress(0.12, 'Gathering the cast');
  await Promise.all([
    loadCharacterLibrary((f) => progress(0.12 + f * 0.28, 'Gathering the cast')),
    loadCastAssets(),
    loadProps(['wooden_handle_saber', 'ornate_medieval_dagger', 'antique_estoc', 'kite_shield']),
  ]);
  const world = await buildWorld(gfx, (f, t) => progress(0.4 + f * 0.5, t));
  gfx.scene.add(world.group);
  progress(0.94, 'Posting the guard');
  await new Promise((r) => setTimeout(r, 30));
  const game = new Game(gfx, world, ui);
  window.game = game; window.gfx = gfx; window.world = world; window.THREE = THREE;

  // ---- development hooks (used by the headless screenshot tools)
  let frozenCam = null;
  window.__cam = (px, py, pz, tx, ty, tz, fov) => { frozenCam = { p: [px, py, pz], t: [tx, ty, tz], fov: fov || 58 }; };
  window.__freeCam = () => { frozenCam = null; };
  const frame = (dt) => {
    game.update(dt);
    if (frozenCam) { gfx.camera.position.set(...frozenCam.p); gfx.camera.lookAt(...frozenCam.t); gfx.camera.fov = frozenCam.fov; gfx.camera.updateProjectionMatrix(); }
    gfx.render(dt);
  };
  window.__step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt); };
  window.__settle = (n = 2) => { const t = performance.now(); window.__step(n, 0.001); const i = gfx.renderer.info; console.log('frame ms', ((performance.now() - t) / n).toFixed(0), 'calls', i.render.calls, 'tris', i.render.triangles); };
  window.__sim = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) game.update(dt); }; // logic only, no rendering

  let last = performance.now();
  const loop = () => {
    const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now;
    frame(dt);
    requestAnimationFrame(loop);
  };
  if (window.__headless) window.__step(1, 0.016); else requestAnimationFrame(loop);
  window.__ready = true;
}
boot().catch((e) => { console.error('BOOT FAILED: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 8).join('\n')); window.__error = e; });
