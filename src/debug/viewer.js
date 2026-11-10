// Development-only contact sheet: ?outfit=Male_Ranger&head=male&hair=Hair_Beard&anim=Sword_Regular_A&n=6&cam=front
import * as THREE from 'three';
import { loadCharacterLibrary, Character, lib } from '../characters.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { loadCastAssets, createHero, createGuard, createCivilian } from '../cast.js';
import { loadProps } from '../world/props.js';

const q = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8a8f99);
const camera = new THREE.PerspectiveCamera(+(q.get('fov') || 30), innerWidth / innerHeight, 0.1, 100);
const sun = new THREE.DirectionalLight(0xfff0dd, 3); sun.position.set(3, 6, 4); sun.castShadow = true;
sun.shadow.camera.left = -8; sun.shadow.camera.right = 8; sun.shadow.camera.top = 6; sun.shadow.camera.bottom = -6; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0005;
scene.add(sun, new THREE.HemisphereLight(0xbcd0ff, 0x6b5a48, 1.2));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x9a948a, roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
scene.add(new THREE.GridHelper(40, 40, 0x444444, 0x777777));

(async () => {
  await loadCharacterLibrary();
  const env = await new HDRLoader().loadAsync('./assets/sky.hdr'); env.mapping = THREE.EquirectangularReflectionMapping; scene.environment = env; scene.environmentIntensity = 0.6;
  const n = +(q.get('n') || 6);
  const anim = q.get('anim') || 'Idle_Loop';
  const clip = lib.clips[anim];
  const outfits = (q.get('outfit') || 'Male_Ranger').split(',');
  const t0 = +(q.get('t0') || 0), t1 = q.get('t1') ? +q.get('t1') : clip.duration;
  const spacing = +(q.get('sp') || 1.3);
  const chars = [];
  const cast = q.get('cast');
  if (cast) { await loadCastAssets(); await loadProps(['wooden_handle_saber', 'ornate_medieval_dagger', 'antique_estoc', 'kite_shield']); }
  const off = +(q.get('off') || 0);
  for (let i = 0; i < n; i++) {
    const outfit = outfits[i % outfits.length];
    const head = q.get('head') === 'none' ? null : (/Female/.test(outfit) ? 'female' : 'male');
    const hair = q.get('hair') ? q.get('hair').split(',') : [];
    let c;
    if (cast === 'main') { c = i === 0 ? createHero() : i === 1 ? createHero() : i === n - 1 ? createGuard(0, true) : createGuard(i); if (i === 1) c.setWeapon('sword'); }
    else if (cast === 'civ') c = createCivilian(i + off);
    else if (cast === 'hero') { c = createHero(); c.setWeapon(q.get('weapon') || 'sword'); }
    else if (cast === 'guard') c = createGuard(i);
    else c = new Character({ outfit, head, hair });
    c.root.position.x = (i - (n - 1) / 2) * spacing;
    scene.add(c.root);
    c.play(anim, { fade: 0 });
    const t = n > 1 ? t0 + (t1 - t0) * (i / (n - 1)) : t0;
    c.mixer.setTime(Math.min(t, clip.duration - 0.001));
    if (q.get('axes')) for (const b of q.get('axes').split(',')) c.bones[b].add(new THREE.AxesHelper(0.25));
    chars.push(c);
  }
  window.chars = chars; window.lib = lib; window.THREE = THREE; window.scene = scene;
  const cam = q.get('cam') || 'front';
  const dist = +(q.get('dist') || (n * spacing * 1.05 + 2.6));
  const h = +(q.get('h') || 1.0);
  const dirs = { front: [0, 0, 1], back: [0, 0, -1], side: [1, 0, 0.0001], left: [-1, 0, 0.0001], q: [0.6, 0.25, 0.75], top: [0.001, 1, 0.3] };
  const d = new THREE.Vector3(...dirs[cam]).normalize().multiplyScalar(dist);
  camera.position.set(d.x, h + d.y, d.z); camera.lookAt(0, h, 0);
  console.log('duration', clip.duration.toFixed(2), 'clips', Object.keys(lib.clips).length);
  renderer.render(scene, camera);
  renderer.setAnimationLoop(() => renderer.render(scene, camera));
  window.__ready = true;
})();
