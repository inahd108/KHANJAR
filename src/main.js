import * as THREE from 'three';
import { Gfx } from './gfx.js';
import { buildWorld } from './world/index.js';

const q = new URLSearchParams(location.search);
window.__headless = q.has('headless');

async function boot() {
  const gfx = new Gfx(document.getElementById('game'), q.get('q') || 'high');
  window.gfx = gfx; window.THREE = THREE;
  const sky = await gfx.loadSky('./assets/sky.hdr');
  console.log('sky', JSON.stringify(sky));
  const world = await buildWorld(gfx);
  window.world = world;
  gfx.scene.add(world.group);
  const s = world.spawn;
  gfx.camera.position.set(s.x - 3.5, s.y + 2.6, s.z + 5.5);
  gfx.camera.lookAt(102, 16, -111);
  window.__cam = (px, py, pz, tx, ty, tz, fov) => { gfx.camera.position.set(px, py, pz); gfx.camera.lookAt(tx, ty, tz); if (fov) { gfx.camera.fov = fov; gfx.camera.updateProjectionMatrix(); } };
  window.__settle = (n = 3) => { const t = performance.now(); for (let i = 0; i < n; i++) { world.update(gfx.camera.position); gfx.render(0.016); } const i = gfx.renderer.info; console.log('frame ms', ((performance.now() - t) / n).toFixed(0), 'calls', i.render.calls, 'tris', i.render.triangles); };
  let last = performance.now();
  const loop = () => { const now = performance.now(); const dt = Math.min(0.05, (now - last) / 1000); last = now; world.update(gfx.camera.position); gfx.render(dt); if (!window.__headless) requestAnimationFrame(loop); };
  loop();
  window.__settle(2);
  window.__ready = true;
}
boot().catch((e) => { console.error('BOOT FAILED: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 8).join('\n')); window.__error = e; });
