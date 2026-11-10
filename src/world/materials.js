// PBR material library for the city (CC0 Poly Haven texture sets + procedural detail).
import * as THREE from 'three';
import { extendMaterial } from '../gfx.js';

const TEX = './assets/tex/';
const loader = new THREE.TextureLoader();
const pending = [];

function tex(name, srgb) {
  const t = loader.load(TEX + name + '.webp', undefined, undefined, () => console.warn('missing texture', name));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  pending.push(new Promise((res) => { const iv = setInterval(() => { if (t.image) { clearInterval(iv); res(); } }, 50); setTimeout(() => { clearInterval(iv); res(); }, 20000); }));
  return t;
}

const NOISE_GLSL = /* glsl */`
  float wHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float wNoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wHash(i), wHash(i + vec3(1,0,0)), f.x), mix(wHash(i + vec3(0,1,0)), wHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(wHash(i + vec3(0,0,1)), wHash(i + vec3(1,0,1)), f.x), mix(wHash(i + vec3(0,1,1)), wHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
`;

/**
 * Adds large-scale colour variation, dusty grime near the ground and sun-bleached tops so that the
 * tiling textures never read as repeats.
 */
function weather(mat, { grime = 1, macro = 1, dust = [0.50, 0.42, 0.31] } = {}) {
  return extendMaterial(mat, `weather${grime}_${macro}`, (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aBase;\nvarying vec3 vWPos;\nvarying float vBase;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        #ifdef USE_INSTANCING
          vWPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif
        vBase = aBase;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying float vBase;\n${NOISE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float m1 = wNoise(vWPos * vec3(0.11, 0.16, 0.11));
          float m2 = wNoise(vWPos * vec3(0.57, 0.9, 0.57) + 17.0);
          float m3 = wNoise(vWPos * vec3(2.3, 3.1, 2.3) + 5.0);
          float macro = (m1 * 0.62 + m2 * 0.33 + m3 * 0.05);
          diffuseColor.rgb *= mix(1.0, mix(0.86, 1.09, macro), ${macro.toFixed(2)});
          // warm / cool drift
          diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(1.05, 0.99, 0.92), vec3(0.95, 1.0, 1.05), m2), ${(macro * 0.6).toFixed(2)});
          float hAbove = vWPos.y - vBase;
          float g = smoothstep(2.6, 0.0, hAbove + (m2 - 0.5) * 1.6) * ${grime.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(${dust.map((v) => v.toFixed(3)).join(',')}) * 1.35, g * 0.55);
        }`);
  });
}

export function createMaterials() {
  const set = (name, opts = {}) => {
    const m = new THREE.MeshStandardMaterial({
      map: tex(name + '_diff', true), normalMap: tex(name + '_nor'), roughnessMap: tex(name + '_arm'), aoMap: opts.noAO ? null : null,
      metalness: 0, roughness: 1, vertexColors: true, ...(opts.params || {}),
    });
    m.name = name;
    if (opts.normalScale) m.normalScale.setScalar(opts.normalScale);
    return m;
  };

  const M = {};
  // --- walls: uvScale = metres per texture repeat
  const wall = (key, file, uvScale, opts) => { M[key] = weather(set(file, opts)); M[key].userData.uvScale = uvScale; };
  wall('stoneA', 'large_sandstone_blocks_01', 2.7, { normalScale: 1.2 }); // big weathered blocks: walls, towers, platform
  wall('stoneB', 'sandstone_blocks_08', 2.0, { normalScale: 1.1 }); // clean ashlar
  wall('stoneC', 'white_sandstone_bricks_03', 2.0, { normalScale: 1.1 }); // cream bricks
  wall('stoneD', 'yellow_stone_wall', 2.3, { normalScale: 1.1 }); // golden rubble courses
  wall('stoneE', 'white_sandstone_blocks_02', 2.3, { normalScale: 1.1 }); // rough white blocks
  wall('stoneF', 'seaworn_sandstone_brick', 2.3, { normalScale: 1.0 });
  wall('stoneG', 'medieval_blocks_03', 2.6, { normalScale: 1.2 }); // grey fortress ashlar
  wall('plasterA', 'yellow_plaster', 2.8);
  wall('plasterB', 'plaster_stone_wall_01', 2.8);
  wall('plasterC', 'painted_plaster_wall', 2.6); // clean lime plaster: domes and roofs
  wall('plasterD', 'white_rough_plaster', 2.8);
  // --- ground
  M.cobble = weather(set('cobblestone_floor_08', { normalScale: 1.3 }), { grime: 0, macro: 0.9 }); M.cobble.userData.uvScale = 2.6;
  M.gravel = weather(set('sandy_gravel'), { grime: 0, macro: 0.8 }); M.gravel.userData.uvScale = 4.0;
  M.tiles = weather(set('stone_tiles_02', { normalScale: 1.0 }), { grime: 0, macro: 0.8 }); M.tiles.userData.uvScale = 3.0;
  M.terrain = weather(set('sandy_gravel'), { grime: 0, macro: 1.0 }); M.terrain.userData.uvScale = 7.0; M.terrain.name = 'terrain';
  // --- wood, cloth, misc
  M.wood = set('weathered_planks'); M.wood.userData.uvScale = 1.6;
  M.woodDark = set('medieval_wood'); M.woodDark.userData.uvScale = 1.6;
  M.blueTile = new THREE.MeshStandardMaterial({ map: makeTileTexture(), roughness: 0.32, metalness: 0.0, vertexColors: true, envMapIntensity: 1.2 }); M.blueTile.userData.uvScale = 1.7; M.blueTile.name = 'blueTile';
  M.mosaic = new THREE.MeshStandardMaterial({ map: makeBandTexture(), roughness: 0.35, metalness: 0.0, vertexColors: true }); M.mosaic.userData.uvScale = 1.3; M.mosaic.name = 'mosaic';
  M.marble = set('marble_01', { params: { roughness: 0.6 } }); M.marble.userData.uvScale = 3.0;
  M.roofTile = weather(set('clay_roof_tiles_02'), { grime: 0, macro: 0.5 }); M.roofTile.userData.uvScale = 2.2;
  M.bark = set('palm_tree_bark'); M.bark.userData.uvScale = 1.0;

  // fabric: colour comes from the vertex tint, weave from the normal map; lit from both sides
  M.fabric = new THREE.MeshStandardMaterial({ normalMap: tex('fabric_pattern_07_nor'), roughness: 0.92, metalness: 0, vertexColors: true, side: THREE.DoubleSide });
  M.fabric.normalScale.setScalar(0.6); M.fabric.userData.uvScale = 0.7; M.fabric.name = 'fabric';
  // makes thin cloth glow slightly when the sun is behind it
  extendMaterial(M.fabric, 'cloth', (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * 0.16;`);
  });

  M.gold = new THREE.MeshStandardMaterial({ color: new THREE.Color(1.0, 0.72, 0.28), metalness: 1.0, roughness: 0.24, vertexColors: true, envMapIntensity: 1.6 });
  M.gold.normalMap = makePlateNormal(); M.gold.normalScale.setScalar(0.35); M.gold.name = 'gold';
  M.lead = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.45, 0.48), metalness: 0.85, roughness: 0.5, vertexColors: true });
  M.lead.normalMap = M.gold.normalMap; M.lead.normalScale.setScalar(0.5); M.lead.name = 'lead';
  M.iron = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.16, 0.15, 0.15), metalness: 0.9, roughness: 0.55, vertexColors: true }); M.iron.name = 'iron';
  M.brass = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.85, 0.62, 0.25), metalness: 1.0, roughness: 0.32, vertexColors: true }); M.brass.name = 'brass';
  // window / doorway interiors: almost black, barely lit
  M.dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.012, 0.010, 0.009), roughness: 1, metalness: 0, vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }); M.dark.name = 'dark';
  M.lattice = new THREE.MeshStandardMaterial({ map: makeLatticeTexture(), alphaTest: 0.5, roughness: 0.8, metalness: 0, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 });
  M.lattice.name = 'lattice';
  M.water = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.05, 0.16, 0.17), roughness: 0.06, metalness: 0.0, vertexColors: true, envMapIntensity: 1.4 }); M.water.name = 'water';

  for (const m of Object.values(M)) if (m.map) m.map.anisotropy = 16;
  M.ready = () => Promise.all(pending);
  return M;
}

/** Glazed geometric tilework: eight-pointed stars and crosses in cobalt, turquoise and white. */
function makeTileTexture() {
  const S = 512, N = 4, cell = S / N; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.fillStyle = '#143f8f'; g.fillRect(0, 0, S, S);
  const star = (cx, cy, r, fill, stroke) => {
    g.beginPath();
    for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; const rr = i % 2 ? r * 0.765 : r; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath(); g.fillStyle = fill; g.fill(); g.lineWidth = 3; g.strokeStyle = stroke; g.stroke();
  };
  for (let y = 0; y <= N; y++) for (let x = 0; x <= N; x++) {
    const cx = x * cell, cy = y * cell;
    // cross-shaped tile between the stars
    g.fillStyle = '#0d2c6e'; g.beginPath();
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; g.lineTo(cx + cell / 2 + Math.cos(a) * cell * 0.36, cy + cell / 2 + Math.sin(a) * cell * 0.36); g.lineTo(cx + cell / 2 + Math.cos(a + Math.PI / 4) * cell * 0.2, cy + cell / 2 + Math.sin(a + Math.PI / 4) * cell * 0.2); }
    g.closePath(); g.fill(); g.strokeStyle = '#e9eef2'; g.lineWidth = 2.5; g.stroke();
    star(cx, cy, cell * 0.44, '#1f9c9a', '#eef2f4');
    star(cx, cy, cell * 0.2, '#f2f0e6', '#143f8f');
    g.fillStyle = '#d9a437'; g.beginPath(); g.arc(cx, cy, cell * 0.06, 0, 7); g.fill();
    g.fillStyle = '#48b9c4'; g.beginPath(); g.arc(cx + cell / 2, cy + cell / 2, cell * 0.07, 0, 7); g.fill();
  }
  // glaze variation
  const img = g.getImageData(0, 0, S, S); const d = img.data;
  for (let i = 0; i < d.length; i += 4) { const n = 0.9 + Math.random() * 0.14; d[i] *= n; d[i + 1] *= n; d[i + 2] *= n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

/** Ornamental frieze band: gilded interlace on deep blue. */
function makeBandTexture() {
  const W = 512, H = 256; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#0f2f6b'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d6a43a'; g.fillRect(0, 0, W, 22); g.fillRect(0, H - 22, W, 22);
  g.fillStyle = '#f0ead8'; g.fillRect(0, 22, W, 6); g.fillRect(0, H - 28, W, 6);
  g.strokeStyle = '#e2b54a'; g.lineWidth = 9; g.lineJoin = 'round';
  for (const ph of [0, Math.PI]) {
    g.beginPath();
    for (let x = 0; x <= W; x += 4) { const y = H / 2 + Math.sin((x / W) * Math.PI * 8 + ph) * 58; if (x === 0) g.moveTo(x, y); else g.lineTo(x, y); }
    g.stroke();
  }
  g.fillStyle = '#f0ead8';
  for (let i = 0; i < 8; i++) { const x = (i + 0.5) * (W / 8); g.save(); g.translate(x, H / 2); g.rotate(Math.PI / 4); g.fillRect(-13, -13, 26, 26); g.restore(); }
  g.fillStyle = '#1f9c9a';
  for (let i = 0; i < 8; i++) { const x = (i + 0.5) * (W / 8); g.beginPath(); g.arc(x, H / 2, 7, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 16;
  return t;
}

/** Normal map of riveted metal plates (for the great dome). */
function makePlateNormal() {
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const row = Math.floor(y / 64); const xo = (x + (row % 2) * 64) % 128; const yo = y % 64;
    const edge = Math.min(xo, 128 - xo, yo, 64 - yo);
    h[y * S + x] = Math.min(1, edge / 3.5) + 0.05 * Math.sin(x * 0.3) * Math.sin(y * 0.23);
  }
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x + S - 1) % S)];
    const hy = h[((y + 1) % S) * S + x] - h[((y + S - 1) % S) * S + x];
    const n = new THREE.Vector3(-hx * 2.0, -hy * 2.0, 1).normalize();
    const i = (y * S + x) * 4; img.data[i] = (n.x * 0.5 + 0.5) * 255; img.data[i + 1] = (n.y * 0.5 + 0.5) * 255; img.data[i + 2] = (n.z * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

/** Wooden mashrabiya lattice with alpha. */
function makeLatticeTexture() {
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
  g.clearRect(0, 0, S, S);
  g.strokeStyle = '#5a3d24'; g.lineWidth = 7; g.lineCap = 'square';
  const step = 32;
  for (let i = -S; i < S * 2; i += step) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
    g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
  }
  g.strokeStyle = '#6b4a2c'; g.lineWidth = 3;
  for (let i = -S; i < S * 2; i += step) { g.beginPath(); g.moveTo(i + 2, 0); g.lineTo(i + S + 2, S); g.stroke(); }
  g.fillStyle = '#4c331d';
  for (let y = 0; y <= S; y += step) for (let x = 0; x <= S; x += step) { g.beginPath(); g.arc(x + 16, y + 16, 5, 0, 7); g.fill(); }
  g.strokeStyle = '#4a321d'; g.lineWidth = 14; g.strokeRect(0, 0, S, S);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
