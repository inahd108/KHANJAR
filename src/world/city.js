// Procedural old-city district: street grid, building lots, facades, rooftops, market and plaza.
import * as THREE from 'three';
import { G, M } from './geo.js';
import { createContext, C, CLOTH_COLORS, CREAM } from './kit.js';
import { buildLandmarks, ZONES } from './landmarks.js';

// street centre lines (metres). The outermost lines are the ring street inside the city wall.
export const XS = [-150, -120, -88, -56, -24, 8, 40, 72, 104, 128, 150];
export const ZS = [-150, -122, -90, -58, -26, 6, 36, 66, 96, 126, 150];
export const MARKET_Z = 6;

const WALL_MATS = ['stoneA', 'stoneB', 'stoneB', 'stoneC', 'stoneC', 'stoneD', 'stoneD', 'stoneE', 'stoneE', 'stoneF', 'stoneF', 'plasterA', 'plasterB', 'plasterB', 'plasterD'];
const STONE_TINTS = [C(1.0, 0.97, 0.90), C(0.98, 0.93, 0.84), C(1.03, 1.0, 0.95), C(0.94, 0.90, 0.83), C(1.0, 0.95, 0.86), C(0.92, 0.89, 0.85)];

const inRect = (x, z, r, pad = 0) => x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
const overlaps = (a, b, pad = 0) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.z0 < b.z1 + pad && a.z1 > b.z0 - pad;

export function buildCity(materials, seed = 1187) {
  const ctx = createContext(materials, seed);
  const { rng, kit } = ctx;
  const reserved = Object.values(ZONES);

  // ---------------------------------------------------------------- streets
  const halfX = XS.map((x, i) => (i === 0 || i === XS.length - 1 ? 3.0 : rng.range(2.0, 3.1)));
  const halfZ = ZS.map((z, i) => (i === 0 || i === ZS.length - 1 ? 3.0 : (z === MARKET_Z ? 4.6 : rng.range(2.0, 3.1))));
  ctx.streets = { XS, ZS, halfX, halfZ };

  // navigation graph on street intersections
  const nodes = []; const nodeAt = new Map();
  const blocked = (x, z) => reserved.some((r) => r.solid && inRect(x, z, r, 0.5));
  for (let i = 0; i < XS.length; i++) for (let j = 0; j < ZS.length; j++) {
    if (blocked(XS[i], ZS[j])) continue;
    const n = { id: nodes.length, x: XS[i], z: ZS[j], links: [], i, j };
    nodes.push(n); nodeAt.set(i + ',' + j, n);
  }
  for (const n of nodes) {
    for (const [di, dj] of [[1, 0], [0, 1]]) {
      const o = nodeAt.get((n.i + di) + ',' + (n.j + dj));
      if (!o) continue;
      if (blocked((n.x + o.x) / 2, (n.z + o.z) / 2)) continue;
      n.links.push(o.id); o.links.push(n.id);
    }
  }
  ctx.nav = { nodes };

  // ---------------------------------------------------------------- ground
  ctx.put('cobble', G.planeUp(), M(0, 0, 0, 330, 1, 330), { color: C(1.08, 0.98, 0.84) });
  ctx.cbox(-400, -2, -400, 400, 0, 400);

  // ---------------------------------------------------------------- blocks -> lots -> buildings
  const lots = [];
  for (let i = 0; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
    const block = { x0: XS[i] + halfX[i], x1: XS[i + 1] - halfX[i + 1], z0: ZS[j] + halfZ[j], z1: ZS[j + 1] - halfZ[j + 1] };
    if (reserved.some((r) => overlaps(block, r, -0.5) && r.clearBlocks)) {
      // keep whatever part of the block lies outside the zone, if it is big enough
      const parts = subtractZones(block, reserved.filter((r) => r.clearBlocks));
      for (const p of parts) if (p.x1 - p.x0 > 6.5 && p.z1 - p.z0 > 6.5) splitBlock(p, lots, rng, p);
      continue;
    }
    splitBlock(block, lots, rng, block);
  }

  ctx.lots = lots;
  for (const L of lots) {
    const cx = (L.x0 + L.x1) / 2, cz = (L.z0 + L.z1) / 2;
    const w = L.x1 - L.x0, d = L.z1 - L.z0;
    // courtyards: leave some lots open
    L.courtyard = !L.special && rng.chance(0.075) && w > 7 && d > 7;
    const nearMarket = Math.abs(cz - MARKET_Z) < 22;
    const r = rng();
    let storeys = r < 0.22 ? 1 : r < 0.68 ? 2 : r < 0.95 ? 3 : 4;
    if (nearMarket && storeys === 1) storeys = 2;
    L.storeys = storeys;
    L.h = storeys * 3.15 + rng.range(0.4, 1.3);
    L.mat = rng.pick(WALL_MATS);
    L.tint = rng.pick(STONE_TINTS).clone().multiplyScalar(rng.range(0.93, 1.05));
    L.base = 0;
    L.cx = cx; L.cz = cz; L.w = w; L.d = d;
  }
  applySpecialLots(ctx, lots);
  for (const L of lots) {
    if (L.skip) continue;
    if (L.courtyard) courtyard(ctx, L); else building(ctx, L);
  }

  streetDressing(ctx);
  market(ctx);
  plaza(ctx);
  buildLandmarks(ctx);

  // ---------------------------------------------------------------- output meshes
  const group = new THREE.Group();
  group.name = 'city';
  for (const [name, batch] of Object.entries(ctx.batches)) {
    if (!batch.count) continue;
    const mesh = new THREE.Mesh(batch.build(), materials[name]);
    mesh.name = 'city:' + name;
    mesh.castShadow = name !== 'dark' && name !== 'water';
    mesh.receiveShadow = true;
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
  }
  if (ctx.terrainGeometry) {
    const tg = ctx.terrainGeometry; tg.setAttribute('color', tg.attributes.mixcol); tg.deleteAttribute('mixcol');
    const p = tg.attributes.position; const uv = tg.attributes.uv; const s = materials.terrain.userData.uvScale;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / s, p.getZ(i) / s);
    tg.setAttribute('aBase', new THREE.BufferAttribute(new Float32Array(p.count).fill(-500), 1));
    const terrain = new THREE.Mesh(tg, materials.terrain); terrain.name = 'terrain'; terrain.receiveShadow = true; terrain.matrixAutoUpdate = false;
    group.add(terrain);
  }
  return {
    group, colliderGeometry: ctx.collider.build(), nav: ctx.nav, props: ctx.props, trees: ctx.trees, lots, roofs: ctx.roofs,
    perches: ctx.perches, zones: ZONES, banners: ctx.banners, spawn: ctx.spawn, points: ctx.points || {},
  };
}

function subtractZones(block, zones) {
  let parts = [block];
  for (const z of zones) {
    const next = [];
    for (const p of parts) {
      if (!overlaps(p, z)) { next.push(p); continue; }
      if (p.x0 < z.x0) next.push({ x0: p.x0, x1: z.x0 - 0.01, z0: p.z0, z1: p.z1 });
      if (p.x1 > z.x1) next.push({ x0: z.x1 + 0.01, x1: p.x1, z0: p.z0, z1: p.z1 });
      const mx0 = Math.max(p.x0, z.x0), mx1 = Math.min(p.x1, z.x1);
      if (p.z0 < z.z0) next.push({ x0: mx0, x1: mx1, z0: p.z0, z1: z.z0 - 0.01 });
      if (p.z1 > z.z1) next.push({ x0: mx0, x1: mx1, z0: z.z1 + 0.01, z1: p.z1 });
    }
    parts = next;
  }
  return parts;
}

// recursive split of a block into building lots; `outer` is the block rect (to know which walls face a street)
function splitBlock(r, lots, rng, outer, depth = 0) {
  const w = r.x1 - r.x0, d = r.z1 - r.z0;
  const big = Math.max(w, d);
  const stop = big < 9.5 || (big < 15 && rng.chance(0.45)) || depth > 5;
  if (stop) {
    const eps = 0.05;
    lots.push({
      ...r,
      street: { w: Math.abs(r.x0 - outer.x0) < eps, e: Math.abs(r.x1 - outer.x1) < eps, n: Math.abs(r.z0 - outer.z0) < eps, s: Math.abs(r.z1 - outer.z1) < eps },
    });
    return;
  }
  const f = rng.range(0.38, 0.62);
  if (w >= d) {
    const m = r.x0 + w * f;
    splitBlock({ ...r, x1: m }, lots, rng, outer, depth + 1); splitBlock({ ...r, x0: m }, lots, rng, outer, depth + 1);
  } else {
    const m = r.z0 + d * f;
    splitBlock({ ...r, z1: m }, lots, rng, outer, depth + 1); splitBlock({ ...r, z0: m }, lots, rng, outer, depth + 1);
  }
}

// hand placed features: the starting watch-tower and a few minarets
function applySpecialLots(ctx, lots) {
  const find = (x, z) => lots.find((L) => x > L.x0 && x < L.x1 && z > L.z0 && z < L.z1);
  // start tower: the tallest house south of the plaza
  const s = find(-8, 46);
  if (s) { s.special = 'startTower'; s.courtyard = false; s.h = 19.5; s.storeys = 6; s.mat = 'stoneA'; s.tint = C(1.0, 0.96, 0.88); s.dome = false; }
  for (const [x, z, h] of [[-70, -40, 27], [60, 22, 25], [-100, 80, 24], [24, 112, 26], [-40, -104, 25]]) {
    const L = find(x, z);
    if (L && !L.special) { L.special = 'minaret'; L.minaretH = h; L.courtyard = false; }
  }
}

function courtyard(ctx, L) {
  const { rng } = ctx;
  ctx.box('gravel', L.x0, 0, L.z0, L.x1, 0.05, L.z1);
  // low wall where the courtyard meets a street
  for (const side of ['n', 's', 'e', 'w']) {
    if (!L.street[side]) continue;
    const t = 0.35, h = 2.2;
    const gate = rng.range(0.3, 0.7);
    const seg = (a0, a1) => {
      if (a1 - a0 < 0.3) return;
      if (side === 'n') ctx.solid('stoneB', L.x0 + a0, 0, L.z0, L.x0 + a1, h, L.z0 + t, { color: L.tint });
      if (side === 's') ctx.solid('stoneB', L.x0 + a0, 0, L.z1 - t, L.x0 + a1, h, L.z1, { color: L.tint });
      if (side === 'w') ctx.solid('stoneB', L.x0, 0, L.z0 + a0, L.x0 + t, h, L.z0 + a1, { color: L.tint });
      if (side === 'e') ctx.solid('stoneB', L.x1 - t, 0, L.z0 + a0, L.x1, h, L.z0 + a1, { color: L.tint });
    };
    const len = (side === 'n' || side === 's') ? L.w : L.d;
    seg(0, len * gate - 0.9); seg(len * gate + 0.9, len);
  }
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) ctx.tree(rng.chance(0.7) ? 'palm' : 'cypress', rng.range(L.x0 + 2, L.x1 - 2), 0, rng.range(L.z0 + 2, L.z1 - 2), rng.range(0.85, 1.25));
  ctx.prop('wooden_bucket_01', L.cx + 1, 0.05, L.cz, rng() * 6);
  if (rng.chance(0.6)) { // a well
    ctx.put('stoneB', G.cyl(12, true), M(L.cx, 0, L.cz - 0.6, 0.9, 0.8, 0.9));
    ctx.put('stoneB', G.cyl(12), M(L.cx, 0, L.cz - 0.6, 0.72, 0.5, 0.72), { color: C(0.2, 0.2, 0.2) });
    ctx.cgeo(G.cyl(8), M(L.cx, 0, L.cz - 0.6, 0.9, 0.8, 0.9));
  }
  for (let i = 0; i < 3; i++) ctx.prop(rng.pick(['ceramic_vase_01', 'planter_pot_clay', 'wooden_crate_01', 'wicker_basket_01']), rng.range(L.x0 + 1, L.x1 - 1), 0.05, rng.range(L.z0 + 1, L.z1 - 1), rng() * 6);
}

function building(ctx, L) {
  const { rng, kit } = ctx;
  const { x0, x1, z0, z1 } = L; const base = L.base; const top = base + L.h;
  const w = x1 - x0, d = z1 - z0;
  const o = { color: L.tint, base };
  if (L.special === 'minaret') return minaret(ctx, L);

  // walls + roof
  ctx.put(L.mat, G.boxSides(), M(L.cx, base, L.cz, w, L.h, d), o);
  ctx.cbox(x0, base - 1, z0, x1, top, z1);
  const roofTint = L.tint.clone().multiply(C(0.98, 0.9, 0.78));
  ctx.put(rng.chance(0.6) ? 'plasterC' : 'plasterB', G.planeUp(), M(L.cx, top, L.cz, w, 1, d), { color: roofTint, base: top - 50 });
  ctx.roofs.push({ x0, x1, z0, z1, y: top, lot: L });
  // plinth
  ctx.put('stoneA', G.boxSides(), M(L.cx, base, L.cz, w + 0.16, 0.55, d + 0.16), { color: L.tint.clone().multiplyScalar(0.95), base });
  ctx.put('stoneA', G.planeUp(), M(L.cx, base + 0.55, L.cz, w + 0.16, 1, d + 0.16), { color: L.tint.clone().multiplyScalar(0.95), base });

  // parapet
  const ptype = L.special ? 'cren' : rng.pick(['plain', 'plain', 'plain', 'cren', 'low']);
  const ph = ptype === 'low' ? 0.35 : rng.range(0.6, 0.95);
  kit.parapet(L, top, { h: ph, mat: L.mat, tint: L.tint, style: ptype === 'cren' ? 'cren' : 'plain', base });
  // cornice line under the parapet
  ctx.put(L.mat, G.boxSides(), M(L.cx, top - 0.18, L.cz, w + 0.14, 0.18, d + 0.14), { color: L.tint.clone().multiplyScalar(1.06), base });

  // facades
  for (const side of ['n', 's', 'e', 'w']) facade(ctx, L, side, L.street[side]);

  if (L.special === 'startTower') return startTower(ctx, L);
  roofDressing(ctx, L, ph);
}

function facade(ctx, L, side, facesStreet) {
  const { rng, kit } = ctx;
  const F = ctx.wallFrame(L, side);
  const base = L.base; const len = F.len;
  if (len < 3) return;
  const storeyH = 3.15;
  const winStyle = L.winStyle || (L.winStyle = rng.pick(['arch', 'arch', 'arch', 'square', 'mix']));
  const pointed = L.pointed ?? (L.pointed = rng.pick([0.0, 0.45, 0.7]));
  // string courses
  if (L.storeys > 1 && facesStreet && rng.chance(0.6)) {
    for (let s = 1; s < L.storeys; s++) ctx.put(L.mat, G.box(), F.at(len / 2, base + s * storeyH, 0.04).multiply(M(0, 0, 0, len + 0.1, 0.14, 0.1)), { color: L.tint.clone().multiplyScalar(1.07), base });
  }
  const margin = 1.2;
  const n = Math.max(1, Math.floor((len - margin * 2) / rng.range(2.5, 3.6)) + 1);
  const span = len - margin * 2;
  const doorSlot = facesStreet && rng.chance(0.8) ? rng.int(0, n - 1) : -1;
  for (let s = 0; s < L.storeys; s++) {
    const y = base + s * storeyH + (s === 0 ? 1.5 : 1.15);
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? len / 2 : margin + (span * i) / (n - 1);
      if (s === 0) {
        if (i === doorSlot) { kit.door(F.at(u, base, 0), { tint: L.tint, pointed: Math.max(pointed, 0.3), baseY: base, open: rng.chance(0.12) }); if (rng.chance(0.35)) kit.lantern(F.at(u + 1.1, base + 2.7, 0)); continue; }
        if (!facesStreet) continue;
        if (rng.chance(0.45)) kit.squareWindow(F.at(u, y + 0.2, 0), { w: 0.6, h: 0.75, tint: L.tint, shutters: rng.chance(0.4) });
        continue;
      }
      if (!facesStreet && rng.chance(0.65)) continue;
      const r = rng();
      if (facesStreet && r < 0.09 && s >= 1) kit.mashrabiya(F.at(u, y - 0.1, 0), {});
      else if (r < 0.2) continue;
      else if (winStyle === 'square' || (winStyle === 'mix' && rng.chance(0.5))) kit.squareWindow(F.at(u, y, 0), { tint: L.tint, shutters: rng.chance(0.75) });
      else kit.window(F.at(u, y, 0), { w: rng.pick([0.75, 0.9, 0.9]), h: 1.55, pointed, tint: L.tint.clone().multiplyScalar(1.08), lattice: rng.chance(0.4), baseY: base });
    }
  }
  if (!facesStreet) return;
  // rows of beam ends under the roofline, sometimes a long perch beam
  if (rng.chance(0.4)) {
    const by = base + L.h - rng.range(0.55, 0.9);
    const nb = Math.floor(len / 1.25);
    for (let i = 0; i < nb; i++) kit.beam(F.at(0.7 + i * ((len - 1.4) / Math.max(1, nb - 1)), by, 0), 0.38, 0.13);
  }
  if (rng.chance(0.14) && L.h > 6) {
    const u = rng.range(1.5, len - 1.5); const by = base + L.h - 0.45;
    kit.beam(F.at(u, by, 0), 2.6, 0.2);
    const m = F.at(u, by, 1.3);
    ctx.cgeo(G.box(), m.clone().multiply(M(0, 0, 0, 0.2, 0.2, 2.6)));
    const p = new THREE.Vector3(0, 0.1, 1.15).applyMatrix4(F.at(u, by, 1.3));
    ctx.perches.push({ x: p.x, y: p.y, z: p.z, ry: F.S.ry });
  }
  // cloth hung from the parapet
  if (rng.chance(0.22)) kit.hangingCloth(F.at(rng.range(1.2, len - 1.2), base + L.h + 0.3, 0.02), { w: rng.range(0.9, 1.6), h: rng.range(1.4, 2.6) });
  // small awning over a window or door
  if (rng.chance(0.25) && len > 5) kit.awning(F.at(rng.range(2, len - 2), base + 2.75, 0), { w: rng.range(1.8, 3.0), d: rng.range(1.0, 1.5), drop: 0.55, groundY: base, y: base + 2.75, poles: false });
  // buttress on tall plain walls
  if (L.h > 9 && rng.chance(0.4)) {
    for (const u of [0.5, len - 0.5]) {
      ctx.put(L.mat, G.box(), F.at(u, base + L.h * 0.33, 0.3).multiply(M(0, 0, 0, 0.9, L.h * 0.66, 0.6)), { color: L.tint, base });
      ctx.put(L.mat, G.box(), F.at(u, base + L.h * 0.66 + 0.25, 0.22).multiply(M(0, 0, 0, 0.9, 0.7, 0.62, 0, -0.75)), { color: L.tint, base });
    }
  }
}

function roofDressing(ctx, L, ph) {
  const { rng, kit } = ctx;
  const top = L.base + L.h; const w = L.w, d = L.d;
  const inner = { x0: L.x0 + 0.5, x1: L.x1 - 0.5, z0: L.z0 + 0.5, z1: L.z1 - 0.5 };
  const m = Math.min(w, d);
  const r = rng();
  let used = false;
  if (m > 7.5 && r < 0.3) {
    // a dome
    const rad = Math.min(m * 0.3, 3.4) * rng.range(0.85, 1.0);
    const point = rng.pick([0.0, 0.2, 0.35]);
    const whitish = rng.chance(0.65);
    kit.dome(L.cx, top, L.cz, rad, { mat: whitish ? 'plasterC' : L.mat, drumMat: L.mat, tint: whitish ? C(0.98, 0.96, 0.92) : L.tint, point, drumH: rad * rng.range(0.3, 0.55), windows: rng.chance(0.5) ? 6 : 0 });
    used = true;
  } else if (m > 6 && r < 0.5) {
    // stair house with a little door
    const sw = 2.6, sh = 2.3;
    const cx = rng.chance(0.5) ? inner.x0 + sw / 2 + 0.2 : inner.x1 - sw / 2 - 0.2;
    const cz = rng.chance(0.5) ? inner.z0 + sw / 2 + 0.2 : inner.z1 - sw / 2 - 0.2;
    ctx.put(L.mat, G.boxUp(), M(cx, top, cz, sw, sh, sw), { color: L.tint, base: top });
    ctx.cbox(cx - sw / 2, top, cz - sw / 2, cx + sw / 2, top + sh, cz + sw / 2);
    const R = { x0: cx - sw / 2, x1: cx + sw / 2, z0: cz - sw / 2, z1: cz + sw / 2 };
    const side = cx < L.cx ? 'e' : 'w';
    kit.door(ctx.wallFrame(R, side).at(sw / 2, top, 0), { w: 0.9, h: 1.85, tint: L.tint, baseY: top });
    if (rng.chance(0.5)) kit.dome(cx, top + sh, cz, sw * 0.42, { mat: 'plasterC', tint: C(0.97, 0.95, 0.9), drumH: 0.15, point: 0.1, finial: false, collide: true, sides: 16, drumSides: 12 });
  } else if (m > 6.5 && r < 0.68) {
    const px0 = rng.range(inner.x0 + 0.3, L.cx - 1.2), pz0 = rng.range(inner.z0 + 0.3, L.cz - 1.2);
    kit.pergola(px0, pz0, px0 + rng.range(2.4, Math.min(4.5, inner.x1 - px0 - 0.3)), pz0 + rng.range(2.2, Math.min(4.0, inner.z1 - pz0 - 0.3)), top);
    ctx.prop('wooden_stool_01', px0 + 1.0, top, pz0 + 1.1, rng() * 6);
    ctx.prop('ceramic_vase_03', px0 + 0.4, top, pz0 + 0.5, rng() * 6);
  }
  // loose clutter along the parapet
  const n = rng.int(0, 4);
  for (let i = 0; i < n; i++) {
    const model = rng.pick(['wooden_crate_01', 'wooden_crate_02', 'ceramic_vase_01', 'antique_ceramic_vase_01', 'wicker_basket_01', 'planter_pot_clay', 'wine_barrel_01', 'brass_pot_01', 'wooden_bucket_01']);
    const edge = rng.int(0, 3);
    let x = rng.range(inner.x0 + 0.5, inner.x1 - 0.5), z = rng.range(inner.z0 + 0.5, inner.z1 - 0.5);
    if (edge === 0) x = inner.x0 + 0.5; else if (edge === 1) x = inner.x1 - 0.5; else if (edge === 2) z = inner.z0 + 0.5; else z = inner.z1 - 0.5;
    if (used && Math.hypot(x - L.cx, z - L.cz) < m * 0.36) continue;
    ctx.prop(model, x, top, z, rng() * 6.28, rng.range(0.9, 1.15), /crate|barrel/.test(model));
  }
  // washing line
  if (!used && m > 6 && rng.chance(0.3)) {
    const z = rng.range(inner.z0 + 1, inner.z1 - 1); const xa = inner.x0 + 0.6, xb = inner.x1 - 0.6;
    for (const x of [xa, xb]) ctx.put('woodDark', G.cyl(6), M(x, top, z, 0.04, 1.9, 0.04));
    ctx.put('woodDark', G.box(), M((xa + xb) / 2, top + 1.85, z, xb - xa, 0.02, 0.02));
    const k = Math.floor((xb - xa) / 0.9);
    for (let i = 0; i < k; i++) if (rng.chance(0.75)) {
      const cw = rng.range(0.5, 0.8), ch = rng.range(0.6, 1.2);
      ctx.put('fabric', G.plane(), M(xa + 0.6 + i * 0.9, top + 1.85 - ch / 2, z, cw, ch, 1, 0, 0, rng.range(-0.05, 0.05)), { color: rng.pick([...CLOTH_COLORS, CREAM, CREAM, C(0.9, 0.88, 0.82)]) });
    }
  }
  // a rug laid out on the roof
  if (rng.chance(0.2)) ctx.put('fabric', G.planeUp(), M(rng.range(inner.x0 + 1.5, inner.x1 - 1.5), top + 0.03, rng.range(inner.z0 + 1.5, inner.z1 - 1.5), 1.4, 1, 2.2, rng() * 3), { color: rng.pick(CLOTH_COLORS).clone().multiplyScalar(0.8) });
}

function startTower(ctx, L) {
  const { kit } = ctx;
  const top = L.base + L.h;
  // a long lookout beam reaching out over the city towards the north-east
  const by = top - 0.3; const len = 4.2;
  ctx.box('woodDark', L.x1 - 0.6, by - 0.11, L.z0 + 1.2 - 0.14, L.x1 + len, by + 0.11, L.z0 + 1.2 + 0.14, { color: C(0.9, 0.8, 0.66) });
  ctx.cbox(L.x1 - 0.6, by - 0.11, L.z0 + 1.2 - 0.14, L.x1 + len, by + 0.11, L.z0 + 1.2 + 0.14);
  // rope lashings + hanging sack
  for (const dx of [0.6, 2.3, 3.9]) ctx.put('fabric', G.cyl(8), M(L.x1 + dx, by - 0.14, L.z0 + 1.2, 0.17, 0.28, 0.17), { color: C(0.45, 0.38, 0.27) });
  ctx.put('fabric', G.sphere(10, 8), M(L.x1 + 3.9, by - 0.75, L.z0 + 1.2, 0.26, 0.36, 0.26), { color: C(0.5, 0.42, 0.3) });
  ctx.put('woodDark', G.cyl(5), M(L.x1 + 3.9, by - 0.5, L.z0 + 1.2, 0.012, 0.45, 0.012));
  ctx.spawn = { x: L.x1 + len - 0.5, y: by + 0.11, z: L.z0 + 1.2, ry: Math.PI / 2 - 0.9 };
  ctx.perches.push({ x: L.x1 + len - 0.5, y: by + 0.11, z: L.z0 + 1.2, ry: Math.PI / 2, start: true });
  ctx.points = ctx.points || {};
  ctx.points.safehouse = { x: L.cx, y: top, z: L.cz };
  // small domed stair turret and a brazier on the roof
  kit.dome(L.cx - 0.6, top, L.cz + 0.8, 1.5, { mat: 'plasterC', tint: C(0.97, 0.95, 0.9), drumH: 1.2, point: 0.3, drumMat: 'stoneA' });
  ctx.prop('wooden_crate_01', L.x0 + 1.1, top, L.z0 + 1.2, 0.3, 1, true);
  ctx.prop('wicker_basket_01', L.x0 + 1.2, top, L.z1 - 1.3, 1.3);
  // ladders / handholds: banded stone courses make the tower read as climbable
  for (let y = 3.2; y < L.h - 1; y += 3.2) ctx.put(L.mat, G.boxSides(), M(L.cx, L.base + y, L.cz, L.w + 0.2, 0.2, L.d + 0.2), { color: L.tint.clone().multiplyScalar(1.08), base: L.base });
}

function minaret(ctx, L) {
  const { rng, kit } = ctx;
  // a small prayer hall with a slender tower on one corner
  const h = 5.2; const top = L.base + h;
  const tint = C(1.0, 0.97, 0.9);
  ctx.put('stoneC', G.boxSides(), M(L.cx, L.base, L.cz, L.w, h, L.d), { color: tint, base: L.base });
  ctx.cbox(L.x0, L.base - 1, L.z0, L.x1, top, L.z1);
  ctx.put('plasterC', G.planeUp(), M(L.cx, top, L.cz, L.w, 1, L.d), { color: C(0.86, 0.82, 0.76) });
  kit.parapet(L, top, { h: 0.6, mat: 'stoneC', tint, style: 'cren', base: L.base });
  L.h = h; L.storeys = 1; L.mat = 'stoneC'; L.tint = tint; L.pointed = 0.7; L.winStyle = 'arch';
  for (const side of ['n', 's', 'e', 'w']) {
    const F = ctx.wallFrame(L, side);
    const n = Math.max(1, Math.floor(F.len / 3));
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * (F.len / n);
      if (L.street[side] && i === Math.floor(n / 2)) kit.door(F.at(u, L.base, 0), { w: 1.5, h: 2.9, pointed: 0.7, tint, baseY: L.base, open: true });
      else kit.window(F.at(u, L.base + 1.7, 0), { w: 0.8, h: 2.2, pointed: 0.7, tint, lattice: true, baseY: L.base });
    }
  }
  const m = Math.min(L.w, L.d);
  if (m > 6) kit.dome(L.cx + 0.6, top, L.cz + 0.6, Math.min(3.2, m * 0.3), { mat: 'plasterC', tint: C(0.98, 0.97, 0.93), drumMat: 'stoneC', drumH: 1.0, point: 0.3, windows: 8 });
  // the tower
  const tw = 2.9; const tx = L.x0 + tw / 2 + 0.2, tz = L.z0 + tw / 2 + 0.2; const H = L.minaretH;
  ctx.put('stoneC', G.boxSides(), M(tx, L.base, tz, tw, H * 0.62, tw), { color: tint, base: L.base });
  ctx.cbox(tx - tw / 2, L.base, tz - tw / 2, tx + tw / 2, L.base + H * 0.62, tz + tw / 2);
  const by = L.base + H * 0.62;
  // balcony
  ctx.put('stoneC', G.cyl(8), M(tx, by - 0.5, tz, tw * 0.62, 0.5, tw * 0.62, Math.PI / 8), { color: tint.clone().multiplyScalar(0.92), base: L.base });
  ctx.put('stoneC', G.cyl(8), M(tx, by, tz, tw * 0.95, 0.25, tw * 0.95, Math.PI / 8), { color: tint, base: L.base });
  ctx.cgeo(G.cyl(8), M(tx, by, tz, tw * 0.95, 0.25, tw * 0.95, Math.PI / 8));
  ctx.put('woodDark', G.cyl(8, true), M(tx, by + 0.25, tz, tw * 0.9, 0.85, tw * 0.9, Math.PI / 8), { color: C(0.8, 0.66, 0.5) });
  ctx.cgeo(G.cyl(8, true), M(tx, by + 0.25, tz, tw * 0.9, 0.85, tw * 0.9, Math.PI / 8));
  // upper shaft
  const ur = tw * 0.36;
  ctx.put('stoneC', G.cyl(8), M(tx, by + 0.25, tz, ur, H * 0.26, ur, Math.PI / 8), { color: tint, base: L.base });
  ctx.cgeo(G.cyl(8), M(tx, by + 0.25, tz, ur, H * 0.26, ur));
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    const bm = M(tx + Math.sin(a) * ur * 0.93, by + 1.0, tz + Math.cos(a) * ur * 0.93, 1, 1, 1, a);
    ctx.put('dark', G.archPanel(0.5, 1.5, 0.7), ctx.sub(bm, 0, 0, 0.03));
  }
  const cy = by + 0.25 + H * 0.26;
  ctx.put('stoneC', G.cyl(8), M(tx, cy, tz, ur * 1.25, 0.22, ur * 1.25, Math.PI / 8), { color: tint });
  const apex = kit.dome(tx, cy + 0.22, tz, ur * 1.05, { mat: 'lead', drumMat: 'stoneC', tint: C(1, 1, 1), drumH: 0.5, point: 0.6, sides: 16, drumSides: 8, collide: true });
  ctx.perches.push({ x: tx, y: by + 0.25, z: tz + tw * 0.7, ry: 0 });
  for (let s = 0; s < 4; s++) {
    const y = L.base + 4 + s * (H * 0.62 - 6) / 3;
    for (const side of ['n', 's', 'e', 'w']) {
      const F = ctx.wallFrame({ x0: tx - tw / 2, x1: tx + tw / 2, z0: tz - tw / 2, z1: tz + tw / 2 }, side);
      if (s % 2 === (side === 'n' || side === 's' ? 0 : 1)) kit.slit(F.at(tw / 2, y, 0), { h: 1.2, w: 0.25 });
    }
  }
}

// arches across streets, lanterns, carts and clutter in the lanes
function streetDressing(ctx) {
  const { rng, kit } = ctx;
  const { XS, ZS, halfX, halfZ } = ctx.streets;
  const reserved = Object.values(ZONES);
  const free = (x, z) => !reserved.some((r) => inRect(x, z, r, 3));
  // N-S streets
  for (let i = 1; i < XS.length - 1; i++) for (let j = 0; j < ZS.length - 1; j++) {
    const x = XS[i]; const za = ZS[j] + halfZ[j] + 2, zb = ZS[j + 1] - halfZ[j + 1] - 2;
    if (rng.chance(0.5)) { const z = rng.range(za + 2, zb - 2); if (free(x, z)) kit.streetArch(x, rng.range(3.6, 5.2), z, halfX[i] * 2, true, { mat: rng.pick(['stoneA', 'stoneB']), tint: C(0.97, 0.93, 0.85) }); }
    for (let k = 0; k < 3; k++) {
      const z = rng.range(za, zb); const sx = rng.chance(0.5) ? -1 : 1;
      if (!free(x, z)) continue;
      ctx.prop(rng.pick(['wooden_crate_01', 'wooden_crate_02', 'wine_barrel_01', 'ceramic_vase_01', 'wicker_basket_01', 'wooden_bucket_01', 'planter_pot_clay']), x + sx * (halfX[i] - 0.6), 0, z, rng() * 6.28, rng.range(0.9, 1.2), true);
    }
  }
  // E-W streets
  for (let j = 1; j < ZS.length - 1; j++) for (let i = 0; i < XS.length - 1; i++) {
    const z = ZS[j]; const xa = XS[i] + halfX[i] + 2, xb = XS[i + 1] - halfX[i + 1] - 2;
    if (z === MARKET_Z) continue;
    if (rng.chance(0.5)) { const x = rng.range(xa + 2, xb - 2); if (free(x, z)) kit.streetArch(x, rng.range(3.6, 5.2), z, halfZ[j] * 2, false, { mat: rng.pick(['stoneA', 'stoneB']), tint: C(0.97, 0.93, 0.85) }); }
    for (let k = 0; k < 3; k++) {
      const x = rng.range(xa, xb); const sz = rng.chance(0.5) ? -1 : 1;
      if (!free(x, z)) continue;
      ctx.prop(rng.pick(['wooden_crate_01', 'wooden_crate_02', 'wine_barrel_01', 'ceramic_vase_01', 'wicker_basket_01', 'wooden_bucket_01', 'antique_ceramic_vase_01']), x, 0, z + sz * (halfZ[j] - 0.6), rng() * 6.28, rng.range(0.9, 1.2), true);
    }
    // a cloth canopy stretched across the lane now and then
    if (rng.chance(0.3)) {
      const x = rng.range(xa + 3, xb - 3);
      if (free(x, z)) ctx.put('fabric', G.cloth(6, 0.16, 0), M(x, rng.range(4.2, 5.4), z - halfZ[j], rng.range(3, 5), 2.2, halfZ[j] * 2), { color: rng.pick(CLOTH_COLORS), color2: CREAM, uvScale: 0.6 });
    }
  }
}

// the souk: stalls with awnings and goods along the wide east-west street
function market(ctx) {
  const { rng, kit } = ctx;
  const z = MARKET_Z; const half = 4.6;
  const stalls = [];
  for (let x = -84; x < 66; x += rng.range(5.2, 7.5)) {
    if (x > -26 && x < 10 && false) continue;
    for (const side of [-1, 1]) {
      if (rng.chance(0.2)) continue;
      // keep street intersections clear
      if (XS.some((sx) => Math.abs(sx - x) < 4.2)) continue;
      // the plaza opens on the north side
      if (side === -1 && x > -26 && x < 10) continue;
      const w = rng.range(2.6, 3.6); const zz = z + side * (half - 0.05);
      const frame = { at: (u, y, out) => M(x + u * (side === 1 ? -1 : 1), y, zz - side * out, 1, 1, 1, side === 1 ? Math.PI : 0) };
      // awning from the wall
      kit.awning(frame.at(0, 3.1, 0), { w: w + 0.6, d: 2.3, drop: 0.75, groundY: 0, y: 3.1 });
      // table with goods
      const tz = z + side * (half - 1.25);
      ctx.box('wood', x - w / 2, 0.78, tz - 0.5, x + w / 2, 0.86, tz + 0.5, { color: C(0.85, 0.72, 0.55) });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) ctx.put('woodDark', G.box(), M(x + sx * (w / 2 - 0.1), 0.39, tz + sz * 0.4, 0.08, 0.78, 0.08));
      ctx.cbox(x - w / 2, 0, tz - 0.5, x + w / 2, 0.86, tz + 0.5);
      ctx.put('fabric', G.cloth(4, 0.02, 0), M(x, 0.87, tz - 0.56, w + 0.1, 1, 1.12), { color: rng.pick(CLOTH_COLORS), color2: rng.pick(CLOTH_COLORS), uvScale: 0.5 });
      const goods = rng.pick([['ceramic_vase_01', 'ceramic_vase_03', 'antique_ceramic_vase_01', 'brass_pot_01'], ['wicker_basket_01', 'food_pomegranate_01', 'carved_wooden_plate'], ['brass_pot_01', 'brass_diya_lantern', 'wooden_lantern_01'], ['wicker_basket_01', 'wooden_bucket_01', 'carved_wooden_plate']]);
      const ng = rng.int(4, 7);
      for (let k = 0; k < ng; k++) {
        const model = rng.pick(goods);
        ctx.prop(model, x + rng.range(-w / 2 + 0.3, w / 2 - 0.3), 0.89, tz + rng.range(-0.3, 0.3), rng() * 6.28, model === 'food_pomegranate_01' ? 1.6 : rng.range(0.7, 0.95));
      }
      if (rng.chance(0.7)) ctx.prop(rng.pick(['wine_barrel_01', 'wooden_crate_01', 'wooden_crate_02']), x + (w / 2 + 0.6), 0, tz + rng.range(-0.3, 0.3), rng() * 6.28, 1, true);
      if (rng.chance(0.5)) ctx.put('fabric', G.cloth(5, 0.02, 0), M(x - w / 2 - 0.5, 2.4, z + side * (half - 0.08), 1.1, 1, 1.9, side === 1 ? Math.PI : 0, Math.PI / 2), { color: rng.pick(CLOTH_COLORS), color2: rng.pick(CLOTH_COLORS), uvScale: 0.5 });
      stalls.push({ x, z: tz, side });
    }
    // canopies overhead
    if (rng.chance(0.55) && !XS.some((sx) => Math.abs(sx - x) < 5)) {
      ctx.put('fabric', G.cloth(8, 0.2, 0), M(x + 2.5, rng.range(5.6, 6.6), z - half, rng.range(3.5, 5), 2.6, half * 2), { color: rng.pick(CLOTH_COLORS), color2: CREAM, uvScale: 0.6 });
    }
  }
  ctx.stalls = stalls;
  ctx.points = ctx.points || {}; ctx.points.stalls = stalls;
}

function plaza(ctx) {
  const { rng } = ctx;
  const P = ZONES.plaza; const cx = (P.x0 + P.x1) / 2, cz = (P.z0 + P.z1) / 2;
  ctx.box('tiles', P.x0 - 2.5, 0, P.z0 - 2.5, P.x1 + 2.5, 0.06, P.z1 + 4.6, { color: C(1.0, 0.96, 0.88) });
  // octagonal fountain
  const tint = C(1.0, 0.98, 0.94);
  ctx.put('marble', G.cyl(8), M(cx, 0.06, cz, 3.6, 0.22, 3.6, Math.PI / 8), { color: tint });
  ctx.put('marble', G.cyl(8, true), M(cx, 0.28, cz, 3.1, 0.6, 3.1, Math.PI / 8), { color: tint });
  ctx.put('marble', G.cyl(8, true), M(cx, 0.28, cz, 2.75, 0.6, 2.75, Math.PI / 8), { color: tint.clone().multiplyScalar(0.8) });
  const ring = new THREE.RingGeometry(2.75, 3.1, 8, 1); ring.rotateX(-Math.PI / 2);
  ctx.put('marble', ring, M(cx, 0.88, cz, 1, 1, 1, Math.PI / 8 + Math.PI / 8), { color: tint });
  ctx.put('water', G.cyl(8), M(cx, 0.28, cz, 2.8, 0.42, 2.8, Math.PI / 8));
  ctx.put('marble', G.cyl(10), M(cx, 0.28, cz, 0.35, 1.5, 0.35), { color: tint });
  ctx.put('marble', G.cone(12, 1.3), M(cx, 1.78, cz, 0.9, 0.25, 0.9, 0, Math.PI), { color: tint });
  ctx.put('marble', G.cyl(12), M(cx, 1.72, cz, 1.15, 0.1, 1.15), { color: tint });
  ctx.put('water', G.cyl(12), M(cx, 1.78, cz, 1.05, 0.05, 1.05));
  ctx.cgeo(G.cyl(8), M(cx, 0, cz, 3.2, 0.9, 3.2, Math.PI / 8));
  ctx.cgeo(G.cyl(8), M(cx, 0, cz, 0.5, 1.9, 0.5));
  ctx.points = ctx.points || {}; ctx.points.fountain = { x: cx, z: cz };
  for (const [dx, dz] of [[-10, -9], [10, -9], [-10.5, 9], [10.5, 9], [0, -11.5]]) ctx.tree('palm', cx + dx, 0.06, cz + dz, rng.range(1.0, 1.35));
  // benches and a few traders' carpets
  for (const a of [0.4, 2.0, 3.6, 5.2]) {
    const bx = cx + Math.cos(a) * 6.2, bz = cz + Math.sin(a) * 6.2;
    ctx.put('marble', G.box(), M(bx, 0.3, bz, 2.2, 0.48, 0.6, -a + Math.PI / 2), { color: tint });
    ctx.cgeo(G.box(), M(bx, 0.3, bz, 2.2, 0.48, 0.6, -a + Math.PI / 2));
  }
  for (let i = 0; i < 4; i++) {
    const x = cx + rng.range(-11, 11), z = cz + rng.range(-11, 11);
    if (Math.hypot(x - cx, z - cz) < 5) continue;
    ctx.put('fabric', G.planeUp(), M(x, 0.09, z, 2.0, 1, 3.0, rng() * 3), { color: rng.pick(CLOTH_COLORS).clone().multiplyScalar(0.8) });
    for (let k = 0; k < 4; k++) ctx.prop(rng.pick(['ceramic_vase_01', 'brass_pot_01', 'wicker_basket_01', 'antique_ceramic_vase_01', 'ceramic_vase_03']), x + rng.range(-0.8, 0.8), 0.1, z + rng.range(-1, 1), rng() * 6);
  }
}
