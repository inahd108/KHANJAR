// The cast: looks (recoloured outfits, headgear, capes) and weapons for the hero, guards and townsfolk.
import * as THREE from 'three';
import { Character, lib, characterTexture } from './characters.js';
import { propModels } from './world/props.js';

const texLoader = new THREE.TextureLoader();
const recolorCache = new Map();
const baseImages = {};

export async function loadCastAssets() {
  const files = ['T_Ranger_BaseColor', 'T_Peasant_BaseColor', 'T_Peasant_2_BaseColor', 'T_Ranger_3_BaseColor'];
  await Promise.all(files.map(async (f) => { const t = await texLoader.loadAsync('./assets/chars/' + f + '.webp'); baseImages[f] = t.image; }));
}

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d > 1e-5) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx === 0 ? 0 : d / mx, mx];
}
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c; let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0]; else if (h < 120) [r, g, b] = [x, c, 0]; else if (h < 180) [r, g, b] = [0, c, x]; else if (h < 240) [r, g, b] = [0, x, c]; else if (h < 300) [r, g, b] = [x, 0, c]; else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

/**
 * Re-dye an outfit atlas. rules: [{ hue:[lo,hi], sat:[lo,hi], val:[lo,hi], to:{h,s,v} | mul:[r,g,b] }]
 * `to.s` / `to.v` are multipliers on the original saturation / value so shading detail is preserved.
 */
function recolor(file, key, rules, size = 1024) {
  const id = file + '|' + key;
  if (recolorCache.has(id)) return recolorCache.get(id);
  const img = baseImages[file];
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, size, size);
  const data = g.getImageData(0, 0, size, size); const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const [h, s, v] = rgb2hsv(r, gg, b);
    for (const rule of rules) {
      if (rule.hue && (h < rule.hue[0] || h > rule.hue[1])) continue;
      if (rule.sat && (s < rule.sat[0] || s > rule.sat[1])) continue;
      if (rule.val && (v < rule.val[0] || v > rule.val[1])) continue;
      let o;
      if (rule.to) o = hsv2rgb(rule.to.h, Math.min(1, s * (rule.to.s ?? 1) + (rule.to.sAdd ?? 0)), Math.min(1, v * (rule.to.v ?? 1)));
      else o = [Math.min(1, r * rule.mul[0]), Math.min(1, gg * rule.mul[1]), Math.min(1, b * rule.mul[2])];
      d[i] = o[0] * 255; d[i + 1] = o[1] * 255; d[i + 2] = o[2] * 255;
      break;
    }
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c); t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  recolorCache.set(id, t);
  return t;
}

const GREEN = { hue: [62, 175], sat: [0.18, 1] };
const LINEN = { sat: [0, 0.3], val: [0.42, 1] };

// ------------------------------------------------------------------------------------------------
// accessory geometry (built in character space at bind pose, then attached to a bone)
const clothMat = (color, rough = 0.9) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0 });
const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.38, metalness: 1.0 });
const darkSteel = new THREE.MeshStandardMaterial({ color: 0x4a4d52, roughness: 0.55, metalness: 0.9 });
const gilt = new THREE.MeshStandardMaterial({ color: 0xd9a441, roughness: 0.3, metalness: 1.0 });
const HEAD_Y = 1.725; // head centre in bind pose

function shadow(m) { m.castShadow = true; m.receiveShadow = true; return m; }

function turban(color, size = 1) {
  const g = new THREE.Group();
  const mat = clothMat(color);
  const wrap = new THREE.TorusGeometry(0.094 * size, 0.043 * size, 8, 18);
  for (let i = 0; i < 3; i++) {
    const m = shadow(new THREE.Mesh(wrap, mat));
    m.rotation.set(Math.PI / 2 + (i - 1) * 0.2, 0, (i - 1) * 0.22);
    m.position.set(0, HEAD_Y + 0.045 + i * 0.02, -0.012);
    m.scale.set(1.05, 1.14, 1.0 - i * 0.05);
    g.add(m);
  }
  const cap = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.1 * size, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat));
  cap.position.set(0, HEAD_Y + 0.06, -0.012); cap.scale.set(1, 0.7, 1.08); g.add(cap);
  // tail of cloth down the back of the neck
  const tail = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.24, 0.02), mat));
  tail.position.set(0.02, HEAD_Y - 0.1, -0.112); tail.rotation.x = 0.16; g.add(tail);
  return g;
}

function headscarf(color) {
  // SphereGeometry: phi = PI/2 faces +Z (the face); leave that quarter open
  const g = new THREE.Group(); const mat = clothMat(color); mat.side = THREE.DoubleSide;
  const shell = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.118, 18, 12, Math.PI * 0.78, Math.PI * 1.44, 0, Math.PI * 0.8), mat));
  shell.position.set(0, HEAD_Y + 0.015, -0.006); shell.scale.set(1, 1.12, 1.1); g.add(shell);
  // CylinderGeometry: theta = 0 faces +Z
  const drape = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.19, 0.32, 16, 1, true, Math.PI * 0.24, Math.PI * 1.52), mat));
  drape.position.set(0, HEAD_Y - 0.21, -0.02); g.add(drape);
  return g;
}

function helmet(kind = 'nasal') {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector2(0.116 * Math.cos(t * Math.PI / 2) ** 0.8 + 0.001, 0.165 * Math.sin(t * Math.PI / 2))); }
  const dome = shadow(new THREE.Mesh(new THREE.LatheGeometry(pts, 18), steel));
  dome.position.set(0, HEAD_Y + 0.062, -0.008); dome.scale.set(1, 1, 1.1); g.add(dome);
  const brim = shadow(new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.012, 6, 20), kind === 'captain' ? gilt : darkSteel));
  brim.rotation.x = Math.PI / 2; brim.position.set(0, HEAD_Y + 0.066, -0.008); brim.scale.set(1, 1.1, 1); g.add(brim);
  const nasal = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.085, 0.01), kind === 'captain' ? gilt : darkSteel));
  nasal.position.set(0, HEAD_Y + 0.022, 0.123); g.add(nasal);
  // mail aventail: back and sides of the neck only (open at the face)
  const mailMat = darkSteel.clone(); mailMat.side = THREE.DoubleSide;
  const mail = shadow(new THREE.Mesh(new THREE.CylinderGeometry(0.116, 0.165, 0.2, 16, 1, true, Math.PI * 0.33, Math.PI * 1.34), mailMat));
  mail.position.set(0, HEAD_Y - 0.04, -0.012); g.add(mail);
  if (kind === 'captain') {
    const crest = shadow(new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.09, 8), gilt)); crest.position.set(0, HEAD_Y + 0.265, -0.008); g.add(crest);
    const plume = shadow(new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), clothMat(0x6b0f12))); plume.scale.set(0.6, 1.4, 1.5); plume.position.set(0, HEAD_Y + 0.32, -0.045); g.add(plume);
  }
  return g;
}

function cape(color, trim, len = 1.05) {
  const g = new THREE.Group();
  const geo = new THREE.PlaneGeometry(0.5, len, 10, 10);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i); const t = 0.5 - y / len; // 0 at the shoulders, 1 at the hem
    const wrap = x * x * 1.3; // curl around the shoulders
    p.setXYZ(i, x * (1 + t * 0.45), y, -t * 0.16 + wrap * (1 - t * 0.6) - Math.cos(x * 18) * 0.018 * (0.2 + t));
  }
  geo.computeVertexNormals();
  const mat = clothMat(color); mat.side = THREE.DoubleSide;
  const m = shadow(new THREE.Mesh(geo, mat)); m.position.set(0, 1.5 - len / 2, -0.13); m.rotation.y = Math.PI; g.add(m);
  const clasp = shadow(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.035, 0.03), new THREE.MeshStandardMaterial({ color: trim, roughness: 0.35, metalness: 0.9 })));
  clasp.position.set(0, 1.49, -0.115); g.add(clasp);
  return g;
}

// ------------------------------------------------------------------------------------------------
// weapons: normalise a prop so the blade runs along +Z from the grip at the origin
const weaponCache = new Map();
export function makeWeapon(model, { length = 0.95, grip = 0.1, flip = false } = {}) {
  const key = model + length + grip + flip;
  if (!weaponCache.has(key)) {
    const src = propModels[model];
    const group = new THREE.Group();
    const box = src.box; const size = new THREE.Vector3(); box.getSize(size);
    const axes = ['x', 'y', 'z'].sort((a, b) => size[b] - size[a]); // longest first
    const main = axes[0], edge = axes[1], thin = axes[2];
    const s = length / size[main];
    // decide which end is the hilt: the end whose vertices spread wider across the blade
    let lo = 0, hi = 0;
    for (const part of src.parts) {
      const p = part.geometry.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const t = (p.getComponent(i, 'xyz'.indexOf(main)) - box.min[main]) / size[main];
        const w = Math.abs(p.getComponent(i, 'xyz'.indexOf(edge)) - (box.min[edge] + box.max[edge]) / 2);
        if (t < 0.3) lo = Math.max(lo, w); else if (t > 0.7) hi = Math.max(hi, w);
      }
    }
    let hiltAtMin = lo >= hi; if (flip) hiltAtMin = !hiltAtMin;
    // basis: main -> +Z (blade direction), edge -> Y, thin -> X
    const basis = new THREE.Matrix4();
    const e = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
    const zAxis = e[main].clone().multiplyScalar(hiltAtMin ? 1 : -1), yAxis = e[edge].clone();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    basis.makeBasis(xAxis, yAxis, zAxis).invert();
    const centre = new THREE.Vector3(); box.getCenter(centre);
    const origin = centre.clone(); origin[main] = hiltAtMin ? box.min[main] + size[main] * grip : box.max[main] - size[main] * grip;
    const m = new THREE.Matrix4().makeScale(s, s, s).multiply(basis).multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
    for (const part of src.parts) {
      const geo = part.geometry.clone(); geo.applyMatrix4(m);
      const mesh = new THREE.Mesh(geo, part.material); mesh.castShadow = true; group.add(mesh);
    }
    weaponCache.set(key, group);
  }
  return weaponCache.get(key).clone();
}

/** put a weapon in the right hand (hand bone: x = back of hand, y = towards fingers, z = thumb side) */
export function gripInHand(character, weapon, hand = 'hand_r') {
  weapon.position.set(-0.035, 0.085, 0.0);
  weapon.rotation.set(0, 0, 0);
  character.bones[hand].add(weapon);
}

// ------------------------------------------------------------------------------------------------
function applyOutfitTexture(group, matName, tex) {
  group.traverse((o) => { if (o.isMesh && o.material.name === matName) { o.material.map = tex; o.material.needsUpdate = true; } });
}
function tintSkin(group, color) {
  group.traverse((o) => { if (o.isMesh && /MI_(Regular|Superhero)/.test(o.material.name)) o.material.color.set(color); });
}
function attachAcc(group, obj, boneName) {
  let bone = null; group.traverse((o) => { if (o.isBone && o.name === boneName) bone = o; });
  group.add(obj); group.updateMatrixWorld(true); bone.attach(obj);
}

const SKIN = [0xffffff, 0xf2d9c4, 0xd9b08c, 0xc49a78, 0xb08462];
const TURBAN_COLORS = [0xe8e0cf, 0xd9cdb4, 0x8c2f24, 0x2f4a6b, 0xb8892f, 0x4f5b3a, 0xf1ece0, 0x5a3a52];

export const LOOKS = {
  // The hero: an original design — midnight-indigo hooded leathers with a bone-white sash.
  hero: {
    id: 'hero', outfit: 'Male_Ranger', head: 'male', hair: ['Hair_Beard'],
    setup: (g) => {
      applyOutfitTexture(g, 'MI_Ranger', recolor('T_Ranger_BaseColor', 'hero', [
        { ...GREEN, to: { h: 226, s: 0.72, v: 0.5 } },
        { hue: [10, 45], sat: [0.25, 1], to: { h: 28, s: 0.7, v: 0.72 } },
      ], 2048));
      tintSkin(g, 0xd9b08c);
      g.traverse((o) => { if (o.isMesh && o.material.name === 'MI_Hair_1') o.material.color.set(0x2a2018); });
    },
  },
  guard: (v) => ({
    id: 'guard' + v, outfit: 'Male_Ranger', head: 'male', hair: v % 2 ? ['Hair_Beard'] : [], hideParts: [],
    setup: (g) => {
      const dyes = [{ h: 2, s: 1.05, v: 0.62 }, { h: 358, s: 0.95, v: 0.52 }, { h: 12, s: 0.9, v: 0.58 }];
      applyOutfitTexture(g, 'MI_Ranger', recolor('T_Ranger_BaseColor', 'guard' + (v % 3), [{ ...GREEN, to: dyes[v % 3] }, { hue: [10, 45], sat: [0.25, 1], to: { h: 24, s: 0.6, v: 0.55 } }]));
      tintSkin(g, SKIN[1 + (v % 3)]);
      // hide the hood: guards wear helmets
      const hood = []; g.traverse((o) => { if (o.isMesh && /outfit/.test(o.name)) hood.push(o); });
      attachAcc(g, helmet('nasal'), 'Head');
    },
  }),
  castellan: {
    id: 'castellan', outfit: 'Male_Ranger', head: 'male', hair: ['Hair_Beard'],
    setup: (g) => {
      applyOutfitTexture(g, 'MI_Ranger', recolor('T_Ranger_BaseColor', 'castellan', [{ ...GREEN, to: { h: 275, s: 0.55, v: 0.34 } }, { hue: [10, 45], sat: [0.25, 1], to: { h: 40, s: 0.85, v: 0.95 } }]));
      tintSkin(g, 0xf2d9c4);
      attachAcc(g, helmet('captain'), 'Head');
      attachAcc(g, cape(0x5a0d12, 0xd9a441, 1.15), 'spine_03');
    },
  },
  civilian: (v) => {
    const female = v % 3 === 2;
    const dyes = [[0.62, 0.72, 0.95], [0.95, 0.72, 0.42], [0.9, 0.52, 0.45], [0.66, 0.78, 0.55], [1, 0.96, 0.88], [0.72, 0.6, 0.86], [0.95, 0.86, 0.6], [0.55, 0.75, 0.78]];
    const dye = dyes[v % dyes.length];
    const base = v % 4 === 0 ? 'T_Peasant_BaseColor' : 'T_Peasant_2_BaseColor';
    const hairOpts = female ? [[], [], ['Hair_Long'], ['Hair_Buns']] : [['Hair_Beard'], ['Hair_Beard', 'Hair_Buzzed'], ['Hair_SimpleParted'], ['Hair_Beard']];
    const hair = hairOpts[Math.floor(v / 3) % 4];
    const headwear = female ? (hair.length ? 0 : 1) : (v % 4 === 3 ? 0 : 2); // 0 none, 1 scarf, 2 turban
    return {
      id: 'civ' + v, outfit: female ? 'Female_Peasant' : 'Male_Peasant', head: female ? 'female' : 'male', hair,
      setup: (g) => {
        applyOutfitTexture(g, 'MI_Peasant', recolor(base, 'civ' + (v % dyes.length), [{ ...LINEN, mul: dye }, { hue: [15, 60], sat: [0.25, 1], to: { h: 18 + (v * 37) % 30, s: 0.85, v: 1.0 + (v % 3) * 0.22 } }]));
        tintSkin(g, SKIN[v % SKIN.length]);
        g.traverse((o) => { if (o.isMesh && /MI_Hair/.test(o.material.name)) o.material.color.set([0x1f1811, 0x3a2a1c, 0x12100e, 0x6b6660][v % 4]); });
        if (headwear === 2) attachAcc(g, turban(TURBAN_COLORS[v % TURBAN_COLORS.length], 1 + (v % 3) * 0.06), 'Head');
        if (headwear === 1) attachAcc(g, headscarf(TURBAN_COLORS[(v * 3) % TURBAN_COLORS.length]), 'Head');
      },
    };
  },
};

export function createHero() {
  const c = new Character(LOOKS.hero);
  c.sword = makeWeapon('wooden_handle_saber', { length: 0.98, grip: 0.1 });
  c.dagger = makeWeapon('ornate_medieval_dagger', { length: 0.4, grip: 0.14 });
  // sheathed positions: sabre across the back, dagger at the belt
  c.sheath = new THREE.Group(); c.root.add(c.sheath); c.root.updateMatrixWorld(true);
  c.sheath.position.set(0.1, 1.42, -0.17); c.sheath.rotation.set(Math.PI * 0.5 + 0.9, 0.0, 0.6, 'ZYX');
  c.bones.spine_03.attach(c.sheath);
  c.daggerSheath = new THREE.Group(); c.root.add(c.daggerSheath);
  c.daggerSheath.position.set(-0.17, 1.02, -0.06); c.daggerSheath.rotation.set(Math.PI * 0.5 + 0.25, 0, -0.1);
  c.bones.pelvis.attach(c.daggerSheath);
  c.sheath.add(c.sword); c.daggerSheath.add(c.dagger);
  c.setWeapon = (which) => { // 'none' | 'sword' | 'dagger'
    if (c.weapon === which) return;
    c.weapon = which;
    c.sword.position.set(0, 0, 0); c.sword.rotation.set(0, 0, 0); c.dagger.position.set(0, 0, 0); c.dagger.rotation.set(0, 0, 0);
    c.sheath.add(c.sword); c.daggerSheath.add(c.dagger);
    if (which === 'sword') gripInHand(c, c.sword);
    if (which === 'dagger') gripInHand(c, c.dagger);
  };
  c.weapon = 'none';
  return c;
}

export function createGuard(variant = 0, captain = false) {
  const c = new Character(captain ? LOOKS.castellan : LOOKS.guard(variant));
  c.sword = makeWeapon('antique_estoc', { length: captain ? 1.08 : 1.0, grip: 0.11 });
  gripInHand(c, c.sword);
  if (!captain) {
    const shield = new THREE.Group();
    const src = propModels.kite_shield;
    const size = new THREE.Vector3(); src.box.getSize(size); const centre = new THREE.Vector3(); src.box.getCenter(centre);
    for (const part of src.parts) { const m = new THREE.Mesh(part.geometry, part.material); m.castShadow = true; shield.add(m); }
    const holder = new THREE.Group(); holder.add(shield);
    shield.position.copy(centre).negate();
    const s = 0.86 / Math.max(size.x, size.y, size.z);
    holder.scale.setScalar(s);
    c.root.add(holder); c.root.updateMatrixWorld(true);
    // slung on the back
    holder.position.set(0.02, 1.2, -0.2);
    const longest = size.y >= size.x && size.y >= size.z ? 'y' : size.z >= size.x ? 'z' : 'x';
    if (longest === 'z') holder.rotation.set(-Math.PI / 2, 0, 0); else if (longest === 'x') holder.rotation.set(0, 0, Math.PI / 2);
    holder.rotation.y += Math.PI;
    c.bones.spine_03.attach(holder);
    c.shield = holder;
  }
  return c;
}

export function createCivilian(variant = 0) {
  return new Character(LOOKS.civilian(variant));
}
