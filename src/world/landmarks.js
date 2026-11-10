// Hand-authored landmarks: sanctuary platform + great dome, garrison citadel, church, city wall, hills.
import * as THREE from 'three';
import { G, M, fbm2 } from './geo.js';
import { C, CLOTH_COLORS, CREAM } from './kit.js';

export const ZONES = {
  citadel: { x0: -147, x1: -91, z0: -119, z1: -61, solid: true, clearBlocks: true },
  temple: { x0: 43, x1: 157, z0: -157, z1: -61, solid: true, clearBlocks: true },
  plaza: { x0: -21.5, x1: 5.5, z0: -23.5, z1: 1.2, solid: false, clearBlocks: true },
  church: { x0: 74.5, x1: 101.5, z0: 38.5, z1: 63.5, solid: false, clearBlocks: true },
};
export const PLATFORM_H = 4.6;
export const SHRINE = { x: 102, z: -111 };
export const WALL_R = 156;

export function buildLandmarks(ctx) {
  ctx.points = ctx.points || {};
  sanctuary(ctx);
  citadel(ctx);
  church(ctx);
  cityWall(ctx);
  hills(ctx);
}

// ------------------------------------------------------------------------------------------------
function stairs(ctx, x, z, width, rise, run, dir, mat = 'stoneA', tint = C(1, 0.97, 0.9)) {
  // dir: unit vector (dx,dz) pointing *down* the stairs. (x,z) is the top-centre edge.
  const n = Math.round(rise / 0.2); const stepH = rise / n, stepD = run / n;
  const alongX = Math.abs(dir[0]) > 0.5;
  for (let i = 0; i < n; i++) {
    const h = rise - (i + 1) * stepH + stepH; // tread height of step i (i=0 is the top one)
    const c = (i + 0.5) * stepD;
    const cx = x + dir[0] * c, cz = z + dir[1] * c;
    ctx.put(mat, G.boxUp(), M(cx, 0, cz, alongX ? stepD : width, h - stepH * 0.0, alongX ? width : stepD), { color: tint.clone().multiplyScalar(i % 2 ? 1.0 : 0.96), base: 0 });
  }
  // smooth ramp for the physics
  const ry = Math.atan2(-dir[0], -dir[1]);
  ctx.cgeo(G.wedge(), M(x + dir[0] * run, 0, z + dir[1] * run, width, rise, run, ry));
  // cheek walls
  for (const s of [-1, 1]) {
    const ox = alongX ? 0 : s * (width / 2 + 0.3), oz = alongX ? s * (width / 2 + 0.3) : 0;
    ctx.put(mat, G.wedge(), M(x + dir[0] * run + ox, 0, z + dir[1] * run + oz, 0.6, rise + 0.7, run, ry), { color: tint, base: 0 });
    ctx.put(mat, G.boxUp(), M(x + dir[0] * (run + 0.4) + ox, 0, z + dir[1] * (run + 0.4) + oz, alongX ? 0.8 : 0.6, 0.9, alongX ? 0.6 : 0.8), { color: tint, base: 0 });
    ctx.cgeo(G.wedge(), M(x + dir[0] * run + ox, 0, z + dir[1] * run + oz, 0.6, rise + 0.7, run, ry));
  }
}

function arcade(ctx, x, y, z, bays, alongX, tint) {
  // free-standing row of pointed arches (the "scales" at the top of the sanctuary stairs)
  const bayW = 4.4, H = 7.0, d = 1.1;
  const total = bays * bayW;
  for (let i = 0; i < bays; i++) {
    const o = -total / 2 + bayW * (i + 0.5);
    const px = alongX ? x + o : x, pz = alongX ? z : z + o;
    ctx.put('stoneC', G.archWall(bayW, H, 3.3, 5.4, d, 0.65), M(px, y, pz, 1, 1, 1, alongX ? 0 : Math.PI / 2), { color: tint, base: y });
  }
  for (let i = 0; i <= bays; i++) {
    const o = -total / 2 + bayW * i;
    const px = alongX ? x + o : x, pz = alongX ? z : z + o;
    // marble column faces + capitals
    ctx.put('marble', G.cyl(10), M(px, y, pz, 0.36, 3.2, 0.36), { color: C(0.95, 0.93, 0.9) });
    ctx.put('stoneC', G.boxUp(), M(px, y + 3.2, pz, 1.25, 0.3, 1.25), { color: tint });
    ctx.put('stoneC', G.boxUp(), M(px, y, pz, 1.25, 0.35, 1.25), { color: tint });
    ctx.cbox(px - 0.6, y, pz - 0.6, px + 0.6, y + H, pz + 0.6);
  }
  ctx.put('stoneC', G.boxUp(), M(x, y + H, z, alongX ? total + 0.5 : d + 0.4, 0.3, alongX ? d + 0.4 : total + 0.5), { color: tint.clone().multiplyScalar(1.05) });
  ctx.cbox(x - (alongX ? total / 2 : d / 2), y + 5.6, z - (alongX ? d / 2 : total / 2), x + (alongX ? total / 2 : d / 2), y + H + 0.3, z + (alongX ? d / 2 : total / 2));
}

function sanctuary(ctx) {
  const { rng, kit } = ctx;
  const PH = PLATFORM_H;
  const P = { x0: 49, x1: 157, z0: -157, z1: -67 };
  const tint = C(1.0, 0.97, 0.9);
  // retaining walls + paving
  ctx.put('stoneA', G.boxSides(), M((P.x0 + P.x1) / 2, 0, (P.z0 + P.z1) / 2, P.x1 - P.x0, PH, P.z1 - P.z0), { color: tint, uvScale: 5.6, base: 0 });
  ctx.put('tiles', G.planeUp(), M((P.x0 + P.x1) / 2, PH, (P.z0 + P.z1) / 2, P.x1 - P.x0, 1, P.z1 - P.z0), { color: C(1.0, 0.97, 0.9), uvScale: 3.4, base: -50 });
  ctx.cbox(P.x0, -1, P.z0, P.x1, PH, P.z1);
  // forecourt paving at street level
  ctx.box('tiles', 43, 0, -157, 49, 0.05, -61, { color: C(0.95, 0.92, 0.85) });
  ctx.box('tiles', 49, 0, -67, 157, 0.05, -61, { color: C(0.95, 0.92, 0.85) });
  // buttresses and coping along the exposed sides
  for (let x = P.x0 + 5; x < P.x1 - 4; x += 9.5) {
    if (Math.abs(x - 98) < 9) continue;
    ctx.solid('stoneA', x - 0.9, 0, P.z1, x + 0.9, PH - 0.5, P.z1 + 0.7, { color: tint, base: 0 });
    ctx.put('stoneA', G.wedge(), M(x, PH - 0.5, P.z1 + 0.7, 1.8, 0.5, 0.7, Math.PI), { color: tint });
  }
  for (let z = P.z0 + 5; z < P.z1 - 4; z += 9.5) {
    if (Math.abs(z + 104) < 8) continue;
    ctx.solid('stoneA', P.x0 - 0.7, 0, z - 0.9, P.x0, PH - 0.5, z + 0.9, { color: tint, base: 0 });
    ctx.put('stoneA', G.wedge(), M(P.x0 - 0.7, PH - 0.5, z, 1.8, 0.5, 0.7, Math.PI / 2), { color: tint });
  }
  // low parapet with gaps at the stairs
  const par = (x0, z0, x1, z1) => ctx.solid('stoneC', x0, PH, z0, x1, PH + 0.85, z1, { color: tint, base: PH });
  par(P.x0, P.z1 - 0.45, 98 - 7.6, P.z1); par(98 + 7.6, P.z1 - 0.45, P.x1, P.z1);
  par(P.x0, P.z0, P.x0 + 0.45, -104 - 6.6); par(P.x0, -104 + 6.6, P.x0 + 0.45, P.z1 - 0.45);

  // stairs: south (towards the city) and west
  stairs(ctx, 98, P.z1, 14, PH, 5.8, [0, 1]);
  stairs(ctx, P.x0, -104, 12, PH, 5.6, [-1, 0]);
  arcade(ctx, 98, PH, P.z1 - 2.2, 3, true, tint);
  arcade(ctx, P.x0 + 2.2, PH, -104, 3, false, tint);
  ctx.points.sanctuaryStairs = [{ x: 98, z: -60 }, { x: 98, z: -72, y: PH }, { x: 42, z: -104 }, { x: 54, z: -104, y: PH }];

  // ---------------- the great dome
  const { x: cx, z: cz } = SHRINE;
  const R = 15.5, rot = Math.PI / 8; const ap = R * Math.cos(Math.PI / 8); const side = 2 * R * Math.sin(Math.PI / 8);
  const per = side * 8;
  // marble dado, tiled upper walls, inscription band
  ctx.put('marble', G.cyl(8, true), M(cx, PH, cz, R, 4.4, R, rot), { uvScale: 0, uvMul: [per / 3.2, 4.4 / 3.2], color: C(0.96, 0.94, 0.9) });
  ctx.put('blueTile', G.cyl(8, true), M(cx, PH + 4.4, cz, R, 5.0, R, rot), { uvScale: 0, uvMul: [per / 1.7, 5.0 / 1.7], color: C(0.92, 1.0, 1.08) });
  ctx.put('mosaic', G.cyl(8, true), M(cx, PH + 9.4, cz, R + 0.05, 1.3, R + 0.05, rot), { uvScale: 0, uvMul: [per / 1.3, 1], color: C(0.75, 0.9, 1.15) });
  ctx.put('gold', G.cyl(8, true), M(cx, PH + 4.25, cz, R + 0.07, 0.22, R + 0.07, rot), { color: C(1, 1, 1) });
  ctx.put('marble', G.cyl(8, true), M(cx, PH + 10.7, cz, R + 0.14, 0.3, R + 0.14, rot), { uvScale: 0, uvMul: [per / 3, 0.1], color: C(0.98, 0.96, 0.92) });
  ctx.put('marble', G.cyl(8), M(cx, PH, cz, R + 0.3, 0.3, R + 0.3, rot), { uvScale: 3, color: C(0.9, 0.88, 0.84) });
  ctx.cgeo(G.cyl(8), M(cx, PH, cz, R, 11, R, rot));
  for (let f = 0; f < 8; f++) {
    const a = f * Math.PI / 4; // face normal direction
    const fm = M(cx + Math.sin(a) * ap, PH, cz + Math.cos(a) * ap, 1, 1, 1, a);
    const cardinal = f % 2 === 0;
    // corner pilasters
    for (const s of [-1, 1]) ctx.put('marble', G.boxUp(), ctx.sub(fm, s * (side / 2 - 0.3), 0, 0.02, 0.55, 10.7, 0.22), { uvScale: 3, color: C(0.98, 0.96, 0.92) });
    // upper windows with gilded frames and lattice
    const nwin = 5;
    for (let i = 0; i < nwin; i++) {
      const u = -side / 2 + (i + 0.5) * (side / nwin);
      if (cardinal && i === 2) continue;
      const wm = ctx.sub(fm, u, 5.0, 0);
      ctx.put('marble', G.archFrame(1.0, 3.0, 0.2, 0.12, 0.55), wm, { uvScale: 2, color: C(1, 0.98, 0.94) });
      ctx.put('dark', G.archPanel(1.0, 3.0, 0.55), ctx.sub(wm, 0, 0, 0.03));
      ctx.put('lattice', G.archPanel(1.0, 3.0, 0.55), ctx.sub(wm, 0, 0, 0.06), { uvMul: [2, 5], color: C(1.5, 1.25, 0.8) });
    }
    // blind marble panels on the dado
    for (let i = 0; i < nwin; i++) {
      const u = -side / 2 + (i + 0.5) * (side / nwin);
      if (cardinal && i === 2) continue;
      ctx.put('marble', G.archFrame(1.2, 3.2, 0.14, 0.07, 0.3), ctx.sub(fm, u, 0.5, 0), { uvScale: 2, color: C(0.86, 0.84, 0.82) });
    }
    if (cardinal) {
      // entrance porch
      const pw = 6.4, ph = 6.2, pd = 2.6;
      ctx.put('marble', G.archWall(pw, ph, 3.0, 4.6, 0.7, 0.5), ctx.sub(fm, 0, 0, pd - 0.35), { uvScale: 3, color: C(0.98, 0.96, 0.92) });
      for (const s of [-1, 1]) {
        ctx.put('marble', G.boxUp(), ctx.sub(fm, s * (pw / 2 - 0.35), 0, pd / 2, 0.7, ph, pd), { uvScale: 3, color: C(0.98, 0.96, 0.92) });
        ctx.cgeo(G.boxUp(), ctx.sub(fm, s * (pw / 2 - 0.35), 0, pd / 2, 0.7, ph, pd));
        ctx.put('marble', G.cyl(10), ctx.sub(fm, s * 1.9, 0, pd + 0.25, 0.22, 3.2, 0.22), { uvScale: 2, color: C(0.75, 0.82, 0.78) });
      }
      ctx.put('blueTile', G.boxUp(), ctx.sub(fm, 0, ph, pd / 2, pw + 0.3, 0.5, pd + 0.3), { uvScale: 1.7 });
      ctx.put('gold', G.boxUp(), ctx.sub(fm, 0, ph + 0.5, pd / 2, pw + 0.45, 0.12, pd + 0.45));
      ctx.cgeo(G.boxUp(), ctx.sub(fm, 0, ph - 1.4, pd / 2, pw, 2.0, pd));
      ctx.put('woodDark', G.archPanel(3.0, 4.6, 0.5), ctx.sub(fm, 0, 0, 0.06), { uvScale: 1.4, color: C(0.5, 0.75, 0.7) });
      ctx.put('gold', G.archFrame(3.0, 4.6, 0.18, 0.1, 0.5), ctx.sub(fm, 0, 0, 0.04));
    }
  }
  // roof skirt, drum, dome
  const drumR = 9.0; const skirtY = PH + 11.0; const drumY = skirtY + 1.6; const drumH = 6.4;
  const skirt = new THREE.CylinderGeometry(drumR + 0.2, R - 0.3, 1.6, 8, 1, true); skirt.translate(0, 0.8, 0);
  ctx.put('lead', skirt, M(cx, skirtY, cz, 1, 1, 1, rot), { uvScale: 0, uvMul: [22, 2] });
  const dper = Math.PI * 2 * drumR;
  ctx.put('blueTile', G.cyl(32, true), M(cx, drumY, cz, drumR, drumH, drumR), { uvScale: 0, uvMul: [dper / 1.7, drumH / 1.7], color: C(0.95, 1.0, 1.05) });
  ctx.put('mosaic', G.cyl(32, true), M(cx, drumY + drumH - 1.1, cz, drumR + 0.04, 1.1, drumR + 0.04), { uvScale: 0, uvMul: [dper / 1.3, 1], color: C(1.1, 0.95, 0.6) });
  ctx.put('gold', G.cyl(32, true), M(cx, drumY + drumH, cz, drumR + 0.2, 0.35, drumR + 0.2));
  ctx.put('gold', G.cyl(32, true), M(cx, drumY - 0.05, cz, drumR + 0.12, 0.25, drumR + 0.12));
  for (let i = 0; i < 16; i++) {
    const a = (i + 0.5) * Math.PI / 8;
    const wm = M(cx + Math.sin(a) * drumR, drumY + 1.1, cz + Math.cos(a) * drumR, 1, 1, 1, a);
    ctx.put('gold', G.archFrame(0.95, 2.9, 0.16, 0.12, 0.5), wm);
    ctx.put('dark', G.archPanel(0.95, 2.9, 0.5), ctx.sub(wm, 0, 0, 0.035));
    ctx.put('lattice', G.archPanel(0.95, 2.9, 0.5), ctx.sub(wm, 0, 0, 0.07), { uvMul: [2, 5], color: C(1.5, 1.25, 0.8) });
  }
  const domeR = 9.25; const domeY = drumY + drumH + 0.3;
  ctx.put('gold', G.dome(56, 0.2, 0.16, 20), M(cx, domeY, cz, domeR, domeR, domeR), { uvScale: 0, uvMul: [30, 9] });
  ctx.cgeo(G.cyl(12), M(cx, skirtY, cz, drumR + 0.2, drumH + 2, drumR + 0.2));
  ctx.cgeo(G.dome(14, 0.2, 0.16, 7), M(cx, domeY, cz, domeR, domeR, domeR));
  const apex = domeY + domeR * 1.2;
  ctx.put('gold', G.cyl(8), M(cx, apex - 0.3, cz, 0.16, 2.6, 0.16));
  for (const [dy, r] of [[0.5, 0.5], [1.25, 0.36], [1.85, 0.25]]) ctx.put('gold', G.sphere(12, 8), M(cx, apex + dy, cz, r, r, r));
  const cres = new THREE.TorusGeometry(0.46, 0.07, 6, 16, Math.PI * 1.5); cres.rotateZ(Math.PI * 0.75);
  ctx.put('gold', cres, M(cx, apex + 2.75, cz, 1, 1, 1, 0.6));
  ctx.points.shrine = { x: cx, z: cz, y: PH, apex };

  // ---------------- small open kiosk east of the dome
  const kx = cx + 25, kz = cz + 2;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    ctx.put('marble', G.cyl(8), M(kx + Math.sin(a) * 3.2, PH, kz + Math.cos(a) * 3.2, 0.2, 3.1, 0.2), { uvScale: 2, color: C(0.92, 0.9, 0.88) });
    ctx.cgeo(G.cyl(6), M(kx + Math.sin(a) * 3.2, PH, kz + Math.cos(a) * 3.2, 0.25, 3.1, 0.25));
  }
  ctx.put('stoneC', G.cyl(8, true), M(kx, PH + 3.1, kz, 3.6, 0.9, 3.6, rot), { color: tint });
  ctx.put('stoneC', G.cyl(8), M(kx, PH + 3.95, kz, 3.7, 0.12, 3.7, rot), { color: tint });
  kit.dome(kx, PH + 4.0, kz, 2.5, { mat: 'lead', drumMat: 'blueTile', tint: C(1, 1, 1), drumH: 1.0, point: 0.25, windows: 0, finialMat: 'gold' });
  ctx.put('tiles', G.cyl(8), M(kx, PH, kz, 4.2, 0.18, 4.2, rot), { color: C(0.9, 0.88, 0.84) });

  // ablution fountain south of the dome
  const fx = cx, fz = cz + 26;
  ctx.put('marble', G.cyl(12, true), M(fx, PH, fz, 2.4, 0.7, 2.4), { uvScale: 2, color: C(0.96, 0.94, 0.9) });
  ctx.put('water', G.cyl(12), M(fx, PH, fz, 2.25, 0.55, 2.25));
  ctx.cgeo(G.cyl(10), M(fx, PH, fz, 2.4, 0.7, 2.4));

  // cypress rows, a few palms and olive trees
  for (let x = P.x0 + 8; x < P.x1 - 8; x += 11) {
    if (Math.abs(x - 98) < 12) continue;
    ctx.tree('cypress', x, PH, P.z1 - 6, rng.range(1.05, 1.4));
  }
  for (let z = P.z0 + 12; z < P.z1 - 10; z += 12) {
    if (Math.abs(z + 104) < 10) continue;
    ctx.tree('cypress', P.x0 + 6, PH, z, rng.range(1.05, 1.4));
  }
  for (const [dx, dz] of [[-30, 20], [-32, -22], [32, -24], [34, 22], [-24, -34], [26, -36], [-36, 0], [38, -6]]) ctx.tree(rng.chance(0.55) ? 'cypress' : 'olive', cx + dx, PH, cz + dz, rng.range(1.0, 1.4));
  for (const [dx, dz] of [[-18, 30], [18, 30]]) ctx.tree('palm', cx + dx, PH, cz + dz, 1.25);
}

// ------------------------------------------------------------------------------------------------
function tower(ctx, x0, z0, x1, z1, h, o = {}) {
  const { kit } = ctx;
  const { mat = 'stoneA', tint = C(0.95, 0.9, 0.82), slits = true, floor = 'tiles', uvScale } = o;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  ctx.put(mat, G.boxSides(), M(cx, 0, cz, x1 - x0, h, z1 - z0), { color: tint, base: 0, uvScale });
  ctx.put(floor, G.planeUp(), M(cx, h, cz, x1 - x0, 1, z1 - z0), { color: C(0.8, 0.77, 0.72), base: -50 });
  ctx.cbox(x0, -1, z0, x1, h, z1);
  // corbelled crown
  ctx.put(mat, G.boxSides(), M(cx, h - 0.6, cz, x1 - x0 + 0.5, 0.6, z1 - z0 + 0.5), { color: tint.clone().multiplyScalar(1.05), base: 0, uvScale });
  kit.parapet({ x0: x0 - 0.25, x1: x1 + 0.25, z0: z0 - 0.25, z1: z1 + 0.25 }, h, { h: 0.9, t: 0.45, mat, tint, style: 'cren', base: 0 });
  if (slits) {
    const R = { x0, x1, z0, z1 };
    for (const side of ['n', 's', 'e', 'w']) {
      const F = ctx.wallFrame(R, side);
      for (let y = 4; y < h - 2.5; y += 4.2) kit.slit(F.at(F.len / 2, y, 0), { h: 1.5, w: 0.3 });
    }
  }
  ctx.roofs.push({ x0, x1, z0, z1, y: h, tower: true });
}

function banner(ctx, m, w = 1.3, h = 3.6, color = C(0.45, 0.06, 0.07), color2 = C(0.85, 0.66, 0.2)) {
  ctx.put('fabric', G.cloth(3, 0.02, 0), ctx.sub(m, 0, 0, 0.08, w, 1, h, 0, Math.PI / 2), { color, color2, uvScale: 0.6 });
  ctx.put('woodDark', G.box(), ctx.sub(m, 0, 0.04, 0.1, w + 0.3, 0.07, 0.07));
}

function citadel(ctx) {
  const { rng, kit } = ctx;
  const Z = ZONES.citadel; const T = 2.6, WH = 9.0;
  const tint = C(0.93, 0.88, 0.80);
  const { x0, x1, z0, z1 } = Z; const gz = -90, gw = 4.6;
  ctx.box('gravel', x0, 0, z0, x1, 0.05, z1, { color: C(0.95, 0.9, 0.82) });
  // curtain walls (walkable tops)
  const wall = (ax, az, bx, bz) => {
    ctx.put('stoneA', G.boxSides(), M((ax + bx) / 2, 0, (az + bz) / 2, bx - ax, WH, bz - az), { color: tint, base: 0, uvScale: 4.6 });
    ctx.put('tiles', G.planeUp(), M((ax + bx) / 2, WH, (az + bz) / 2, bx - ax, 1, bz - az), { color: C(0.78, 0.74, 0.68), base: -50 });
    ctx.cbox(ax, -1, az, bx, WH, bz);
  };
  wall(x0, z0, x1, z0 + T); wall(x0, z1 - T, x1, z1); wall(x0, z0 + T, x0 + T, z1 - T);
  wall(x1 - T, z0 + T, x1, gz - gw / 2); wall(x1 - T, gz + gw / 2, x1, z1 - T);
  // gate: pointed arch filling the gap, portcullis raised
  ctx.put('stoneA', G.archWall(gw + 0.02, WH, 3.7, 5.2, T, 0.6), M(x1 - T / 2, 0, gz, 1, 1, 1, Math.PI / 2), { color: tint.clone().multiplyScalar(1.04), base: 0, uvScale: 4.6 });
  ctx.cbox(x1 - T, 5.0, gz - gw / 2, x1, WH, gz + gw / 2);
  ctx.cbox(x1 - T, 0, gz - gw / 2, x1, 5, gz - 1.85); ctx.cbox(x1 - T, 0, gz + 1.85, x1, 5, gz + gw / 2);
  for (let i = -3; i <= 3; i++) ctx.put('iron', G.box(), M(x1 - T / 2, 5.2, gz + i * 0.5, 0.08, 1.6, 0.08));
  for (const y of [4.6, 5.3]) ctx.put('iron', G.box(), M(x1 - T / 2, y, gz, 0.08, 0.08, 3.6));
  ctx.put('tiles', G.planeUp(), M(x1 - T / 2, WH, gz, T, 1, gw), { color: C(0.78, 0.74, 0.68) });
  // battlements: merlons on the outer edge, low kerb inside
  const mer = (ax, az, bx, bz) => {
    const alongX = Math.abs(bx - ax) > Math.abs(bz - az); const len = alongX ? bx - ax : bz - az;
    ctx.solid('stoneA', alongX ? ax : ax - 0.25, WH, alongX ? az - 0.25 : az, alongX ? bx : ax + 0.25, WH + 0.75, alongX ? az + 0.25 : bz, { color: tint, base: 0 });
    const n = Math.floor(len / 1.7);
    for (let i = 0; i < n; i++) {
      const c = (i + 0.5) * (len / n);
      ctx.put('stoneA', G.boxUp(), M(alongX ? ax + c : ax, WH + 0.75, alongX ? az : az + c, alongX ? 0.9 : 0.5, 0.75, alongX ? 0.5 : 0.9), { color: tint, base: 0 });
    }
  };
  mer(x0, z0 + 0.25, x1, z0 + 0.25); mer(x0, z1 - 0.25, x1, z1 - 0.25); mer(x0 + 0.25, z0, x0 + 0.25, z1); mer(x1 - 0.25, z0, x1 - 0.25, z1);
  // corner towers and gate towers
  const tw = 8.6, th = 14.5;
  tower(ctx, x0 - 1.5, z0 - 1.5, x0 - 1.5 + tw, z0 - 1.5 + tw, th, { tint, uvScale: 4.6 });
  tower(ctx, x1 + 1.5 - tw, z0 - 1.5, x1 + 1.5, z0 - 1.5 + tw, th, { tint, uvScale: 4.6 });
  tower(ctx, x0 - 1.5, z1 + 1.5 - tw, x0 - 1.5 + tw, z1 + 1.5, th, { tint, uvScale: 4.6 });
  tower(ctx, x1 + 1.5 - tw, z1 + 1.5 - tw, x1 + 1.5, z1 + 1.5, th, { tint, uvScale: 4.6 });
  tower(ctx, x1 - T - 0.6, gz - gw / 2 - 5.6, x1 + 1.4, gz - gw / 2 - 0.0, 12.5, { tint, uvScale: 4.6 });
  tower(ctx, x1 - T - 0.6, gz + gw / 2 + 0.0, x1 + 1.4, gz + gw / 2 + 5.6, 12.5, { tint, uvScale: 4.6 });
  // banners either side of the gate (outside) and on the keep
  banner(ctx, M(x1 + 1.45, 10.5, gz - gw / 2 - 2.8, 1, 1, 1, Math.PI / 2));
  banner(ctx, M(x1 + 1.45, 10.5, gz + gw / 2 + 2.8, 1, 1, 1, Math.PI / 2));

  // keep
  const kx0 = x0 + T + 2, kx1 = kx0 + 13, kz0 = gz - 7, kz1 = gz + 7; const kh = 20;
  tower(ctx, kx0, kz0, kx1, kz1, kh, { tint: C(0.96, 0.91, 0.83), uvScale: 4.6 });
  const KR = { x0: kx0, x1: kx1, z0: kz0, z1: kz1 };
  const KF = ctx.wallFrame(KR, 'e');
  kit.door(KF.at(7, 0.5, 0), { w: 1.9, h: 3.2, pointed: 0.6, tint: C(1, 0.96, 0.9), baseY: 0 });
  for (const u of [2.3, 11.7]) banner(ctx, KF.at(u, 12, 0), 1.5, 5.5);
  for (const y of [7, 12.5]) for (const u of [3.5, 7, 10.5]) kit.window(KF.at(u, y, 0), { w: 0.8, h: 1.8, pointed: 0.6, tint: C(1, 0.96, 0.9), lattice: false, baseY: 0 });
  // dais and steps in front of the keep
  ctx.solid('stoneB', kx1, 0, gz - 4.5, kx1 + 6, 0.5, gz + 4.5, { color: tint });
  ctx.solid('stoneB', kx1 + 6, 0, gz - 3.5, kx1 + 6.5, 0.25, gz + 3.5, { color: tint });
  ctx.points.castellan = { x: kx1 + 3.2, y: 0.5, z: gz, ry: Math.PI / 2 };
  for (const s of [-1, 1]) { // braziers
    const bx = kx1 + 5.2, bz = gz + s * 3.8;
    ctx.put('iron', G.cyl(6), M(bx, 0.5, bz, 0.07, 0.9, 0.07)); ctx.put('iron', G.cone(10, 1.6), M(bx, 1.4, bz, 0.26, 0.3, 0.26));
    ctx.lights.push({ x: bx, y: 1.85, z: bz, fire: true });
  }

  // barracks along the north wall, stores along the south
  const hall = (hx0, hz0, hx1, hz1, h, doorSide) => {
    const R = { x0: hx0, x1: hx1, z0: hz0, z1: hz1 };
    ctx.put('stoneB', G.boxSides(), M((hx0 + hx1) / 2, 0, (hz0 + hz1) / 2, hx1 - hx0, h, hz1 - hz0), { color: tint, base: 0 });
    ctx.put('plasterD', G.planeUp(), M((hx0 + hx1) / 2, h, (hz0 + hz1) / 2, hx1 - hx0, 1, hz1 - hz0), { color: C(0.8, 0.76, 0.7) });
    ctx.cbox(hx0, 0, hz0, hx1, h, hz1);
    kit.parapet(R, h, { h: 0.5, mat: 'stoneB', tint, base: 0 });
    const F = ctx.wallFrame(R, doorSide); const n = Math.floor(F.len / 3.4);
    for (let i = 0; i < n; i++) {
      const u = (i + 0.5) * (F.len / n);
      if (i % 3 === 1) kit.door(F.at(u, 0, 0), { tint, baseY: 0, open: i === 1 }); else kit.squareWindow(F.at(u, 1.6, 0), { tint, shutters: false });
    }
    ctx.roofs.push({ x0: hx0, x1: hx1, z0: hz0, z1: hz1, y: h });
  };
  hall(x0 + 22, z0 + T, x1 - 12, z0 + T + 7.5, 4.6, 's');
  hall(x0 + 26, z1 - T - 6.5, x1 - 20, z1 - T, 4.2, 'n');
  // stair ramp up to the wall walk (inside the east wall, south of the gate)
  const sx = x1 - T - 0.9;
  ctx.put('stoneB', G.wedge(), M(sx, 0, gz + gw / 2 + 6.5, 1.8, WH, 13, Math.PI), { color: tint, base: 0 });
  ctx.cgeo(G.wedge(), M(sx, 0, gz + gw / 2 + 6.5, 1.8, WH, 13, Math.PI));
  ctx.points.wallStairs = { x: sx, z: gz + gw / 2 + 20 };

  // yard dressing: training dummies, weapon racks, tents, crates
  const yard = [];
  for (const [dx, dz] of [[-12, 12], [-9, 14.5], [-15, 14.5]]) {
    const px = x1 - 14 + dx, pz = gz + dz;
    ctx.put('woodDark', G.cyl(6), M(px, 0, pz, 0.07, 1.7, 0.07)); ctx.put('woodDark', G.box(), M(px, 1.35, pz, 1.1, 0.07, 0.07));
    ctx.put('fabric', G.cyl(8), M(px, 0.75, pz, 0.24, 0.75, 0.2), { color: C(0.62, 0.54, 0.38) });
    ctx.put('fabric', G.sphere(8, 6), M(px, 1.68, pz, 0.17, 0.2, 0.17), { color: C(0.62, 0.54, 0.38) });
    ctx.cgeo(G.cyl(6), M(px, 0, pz, 0.25, 1.7, 0.25));
  }
  for (const [px, pz] of [[x1 - 9, gz - 12], [x1 - 9, gz + 26], [x0 + 20, gz + 12]]) { // weapon racks
    ctx.box('woodDark', px - 1.1, 0, pz - 0.05, px - 1.0, 1.5, pz + 0.05); ctx.box('woodDark', px + 1.0, 0, pz - 0.05, px + 1.1, 1.5, pz + 0.05);
    ctx.box('woodDark', px - 1.1, 1.3, pz - 0.05, px + 1.1, 1.4, pz + 0.05); ctx.box('woodDark', px - 1.1, 0.5, pz - 0.05, px + 1.1, 0.6, pz + 0.05);
    for (let i = -2; i <= 2; i++) ctx.put('iron', G.box(), M(px + i * 0.4, 1.0, pz + 0.08, 0.04, 2.1, 0.03, 0, -0.1), { color: C(2.2, 2.2, 2.3) });
    ctx.cbox(px - 1.1, 0, pz - 0.15, px + 1.1, 1.4, pz + 0.15);
  }
  for (let i = 0; i < 16; i++) {
    const px = rng.range(x0 + 20, x1 - 6), pz = rng.range(z0 + 13, z1 - 11);
    if (Math.abs(pz - gz) < 7 && px > x0 + 14) continue;
    ctx.prop(rng.pick(['wooden_crate_01', 'wooden_crate_02', 'wine_barrel_01', 'wine_barrel_01', 'wooden_bucket_01']), px, 0.05, pz, rng() * 6, rng.range(0.95, 1.2), true);
    yard.push({ x: px, z: pz });
  }
  // a couple of field tents
  for (const [tx, tz, c] of [[x0 + 24, gz + 18, 0], [x0 + 31, gz + 19, 1]]) {
    ctx.put('fabric', G.gable(), M(tx, 0.05, tz, 3.4, 2.3, 4.2, 0.2 * c), { color: c ? C(0.75, 0.68, 0.55) : C(0.5, 0.12, 0.1), uvScale: 0.7 });
    ctx.cgeo(G.gable(), M(tx, 0.05, tz, 3.4, 2.3, 4.2, 0.2 * c));
  }
  ctx.tree('palm', x0 + 16, 0.05, z1 - 9, 1.2);
  ctx.tree('palm', x1 - 14, 0.05, z0 + 14, 1.1);
  ctx.points.citadel = {
    gate: { x: x1 + 3, z: gz }, yard: { x: (x0 + x1) / 2 + 6, z: gz },
    patrol: [
      [{ x: x1 - 8, z: gz - 14 }, { x: x1 - 8, z: gz + 14 }, { x: x0 + 34, z: gz + 14 }, { x: x0 + 34, z: gz - 14 }],
      [{ x: x0 + 26, z: gz + 9 }, { x: x1 - 12, z: gz + 9 }, { x: x1 - 12, z: gz - 9 }, { x: x0 + 26, z: gz - 9 }],
    ],
    wallWalk: [
      [{ x: x0 + 12, z: z0 + 1.3, y: WH }, { x: x1 - 12, z: z0 + 1.3, y: WH }],
      [{ x: x0 + 12, z: z1 - 1.3, y: WH }, { x: x1 - 12, z: z1 - 1.3, y: WH }],
      [{ x: x1 - 1.3, z: gz + 8, y: WH }, { x: x1 - 1.3, z: z1 - 10, y: WH }],
    ],
    posts: [{ x: x1 + 2.6, z: gz - 3.2, ry: Math.PI / 2 }, { x: x1 + 2.6, z: gz + 3.2, ry: Math.PI / 2 }, { x: kx1 + 5.4, z: gz - 2.6, ry: Math.PI / 2 }, { x: kx1 + 5.4, z: gz + 2.6, ry: Math.PI / 2 }],
    wallH: WH,
  };
}

// ------------------------------------------------------------------------------------------------
function church(ctx) {
  const { rng, kit } = ctx;
  const Z = ZONES.church; const tint = C(0.97, 0.93, 0.86);
  ctx.box('gravel', Z.x0, 0, Z.z0, Z.x1, 0.05, Z.z1, { color: C(0.95, 0.9, 0.8) });
  const nx0 = 79, nx1 = 91, nz0 = 41, nz1 = 61, nh = 9.6;
  const R = { x0: nx0, x1: nx1, z0: nz0, z1: nz1 };
  ctx.put('stoneE', G.boxSides(), M((nx0 + nx1) / 2, 0, (nz0 + nz1) / 2, nx1 - nx0, nh, nz1 - nz0), { color: tint, base: 0 });
  ctx.cbox(nx0, 0, nz0, nx1, nh, nz1);
  ctx.put('roofTile', G.gable(), M((nx0 + nx1) / 2, nh, (nz0 + nz1) / 2, nx1 - nx0 + 0.9, 4.4, nz1 - nz0 + 0.7), { color: C(0.92, 0.82, 0.74), base: -50 });
  ctx.cgeo(G.gable(), M((nx0 + nx1) / 2, nh, (nz0 + nz1) / 2, nx1 - nx0 + 0.9, 4.4, nz1 - nz0 + 0.7));
  // gable walls
  for (const zz of [nz0, nz1]) ctx.put('stoneE', G.gable(), M((nx0 + nx1) / 2, nh, zz, nx1 - nx0, 4.2, 0.02), { color: tint, base: 0 });
  // side buttresses + lancet windows
  for (const side of ['e', 'w']) {
    const F = ctx.wallFrame(R, side);
    for (let i = 0; i < 5; i++) {
      const u = 2 + i * 4;
      ctx.put('stoneE', G.boxUp(), F.at(u, 0, 0.35).multiply(M(0, 0, 0, 0.8, nh * 0.8, 0.7)), { color: tint, base: 0 });
      ctx.put('stoneE', G.wedge(), F.at(u, nh * 0.8, 0.7).multiply(M(0, 0, 0, 0.8, 1.0, 0.7, Math.PI)), { color: tint });
      if (i < 4) kit.window(F.at(u + 2, 3.2, 0), { w: 0.8, h: 3.4, pointed: 0.85, tint, lattice: false, baseY: 0 });
    }
  }
  const S = ctx.wallFrame(R, 's');
  kit.door(S.at(6, 0, 0), { w: 2.0, h: 3.4, pointed: 0.8, tint, baseY: 0 });
  // rose window
  const rose = new THREE.CircleGeometry(1.1, 20);
  ctx.put('dark', rose, S.at(6, 7.0, 0.035));
  const ringG = new THREE.TorusGeometry(1.2, 0.14, 6, 24);
  ctx.put('stoneC', ringG, S.at(6, 7.0, 0.06), { color: tint });
  for (let i = 0; i < 6; i++) ctx.put('stoneC', G.box(), S.at(6, 7.0, 0.06).multiply(M(0, 0, 0, 2.3, 0.08, 0.06, 0, 0, i * Math.PI / 6)), { color: tint });
  // apse
  ctx.put('stoneE', G.cyl(12), M((nx0 + nx1) / 2, 0, nz0, 4.2, 7.2, 4.2), { color: tint, base: 0 });
  ctx.cgeo(G.cyl(10), M((nx0 + nx1) / 2, 0, nz0, 4.2, 7.2, 4.2));
  ctx.put('roofTile', G.cone(12), M((nx0 + nx1) / 2, 7.2, nz0, 4.5, 2.4, 4.5), { color: C(0.92, 0.82, 0.74) });

  // bell tower
  const bx0 = 92.2, bx1 = 98.2, bz0 = 54.5, bz1 = 60.5, bh = 17.5;
  const bcx = (bx0 + bx1) / 2, bcz = (bz0 + bz1) / 2;
  ctx.put('stoneE', G.boxSides(), M(bcx, 0, bcz, 6, bh, 6), { color: tint, base: 0 });
  ctx.cbox(bx0, 0, bz0, bx1, bh, bz1);
  for (const y of [5.8, 11.6, bh - 0.2]) ctx.put('stoneE', G.boxSides(), M(bcx, y, bcz, 6.3, 0.3, 6.3), { color: tint.clone().multiplyScalar(1.06), base: 0 });
  ctx.put('tiles', G.planeUp(), M(bcx, bh, bcz, 6, 1, 6), { color: C(0.8, 0.76, 0.7) });
  // belfry: four arched openings
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    ctx.put('stoneE', G.archWall(6, 4.6, 2.4, 3.4, 0.7, 0.7), M(bcx + Math.sin(a) * 2.65, bh, bcz + Math.cos(a) * 2.65, 1, 1, 1, a), { color: tint, base: 0 });
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.cbox(bcx + sx * 3 - 0.9 * (sx > 0 ? 1 : 0) - (sx < 0 ? 0 : 0), bh, bcz + sz * 3 - (sz > 0 ? 0.9 : 0), bcx + sx * 3 + (sx < 0 ? 0.9 : 0), bh + 4.6, bcz + sz * 3 + (sz < 0 ? 0.9 : 0));
  ctx.put('brass', G.dome(12, 0.5, 0.2, 6), M(bcx, bh + 2.3, bcz, 0.75, 0.85, 0.75), { color: C(0.7, 0.6, 0.45) });
  ctx.put('woodDark', G.box(), M(bcx, bh + 3.3, bcz, 5, 0.2, 0.2));
  ctx.put('stoneE', G.boxUp(), M(bcx, bh + 4.6, bcz, 6.4, 0.35, 6.4), { color: tint });
  ctx.cbox(bx0, bh + 4.2, bz0, bx1, bh + 4.95, bz1);
  ctx.put('roofTile', G.cone(4), M(bcx, bh + 4.95, bcz, 4.7, 5.2, 4.7, Math.PI / 4), { color: C(0.9, 0.8, 0.72), uvScale: 1.8 });
  ctx.cgeo(G.cone(4), M(bcx, bh + 4.95, bcz, 4.7, 5.2, 4.7, Math.PI / 4));
  ctx.put('iron', G.box(), M(bcx, bh + 10.9, bcz, 0.1, 1.6, 0.1)); ctx.put('iron', G.box(), M(bcx, bh + 11.2, bcz, 0.8, 0.1, 0.1));
  const BR = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };
  for (const side of ['s', 'e']) { const F = ctx.wallFrame(BR, side); for (const y of [3.4, 8, 13]) kit.slit(F.at(3, y, 0), { h: 1.6, w: 0.3 }); }
  ctx.perches.push({ x: bcx, y: bh, z: bcz, ry: 0 });
  ctx.roofs.push({ x0: bx0, x1: bx1, z0: bz0, z1: bz1, y: bh, tower: true });
  // churchyard
  for (const [x, z] of [[77, 44], [77, 52], [77, 60], [94, 43], [99, 47]]) ctx.tree('cypress', x, 0.05, z, rng.range(1.0, 1.3));
  for (const side of [['s', Z.z1 - 0.4, Z.z1], ['n', Z.z0, Z.z0 + 0.4]]) {
    ctx.solid('stoneB', Z.x0, 0, side[1], side[0] === 's' ? 82 : Z.x1, 1.5, side[2], { color: tint });
    if (side[0] === 's') ctx.solid('stoneB', 88, 0, side[1], Z.x1, 1.5, side[2], { color: tint });
  }
}

// ------------------------------------------------------------------------------------------------
function cityWall(ctx) {
  const { kit } = ctx;
  const R = WALL_R, T = 3.6, H = 11; const tint = C(0.93, 0.88, 0.79);
  const seg = (ax, az, bx, bz) => {
    ctx.put('stoneA', G.boxSides(), M((ax + bx) / 2, 0, (az + bz) / 2, bx - ax, H, bz - az), { color: tint, base: 0, uvScale: 5.2 });
    ctx.put('tiles', G.planeUp(), M((ax + bx) / 2, H, (az + bz) / 2, bx - ax, 1, bz - az), { color: C(0.76, 0.72, 0.66), base: -50 });
    ctx.cbox(ax, -1, az, bx, H, bz);
    kit.parapet({ x0: ax, x1: bx, z0: az, z1: bz }, H, { h: 0.8, t: 0.5, mat: 'stoneA', tint, style: 'cren', base: 0 });
  };
  seg(-R - T, -R - T, R + T, -R); seg(-R - T, R, R + T, R + T); seg(-R - T, -R, -R, R); seg(R, -R, R + T, R);
  for (let i = -3; i <= 3; i++) {
    const p = i * 52;
    for (const [x, z] of [[p, -R - T / 2], [p, R + T / 2], [-R - T / 2, p], [R + T / 2, p]]) {
      if (Math.abs(x) > R - 5 && Math.abs(z) > R - 5) continue;
      tower(ctx, x - 4.6, z - 4.6, x + 4.6, z + 4.6, 15.5, { tint, uvScale: 5.2 });
    }
  }
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) tower(ctx, sx * (R + T / 2) - 5.5, sz * (R + T / 2) - 5.5, sx * (R + T / 2) + 5.5, sz * (R + T / 2) + 5.5, 17, { tint, uvScale: 5.2 });
  // south gate (closed) at the end of the central avenue
  kit.door(M(8, 0, R - 0.02, 1, 1, 1, Math.PI), { w: 3.6, h: 5.4, pointed: 0.6, tint: C(1, 0.96, 0.9), baseY: 0 });
}

function hills(ctx) {
  const { rng } = ctx;
  // rolling terrain outside the walls with a long ridge to the east
  const S = 3000, N = 150;
  const g = new THREE.PlaneGeometry(S, S, N, N); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  const height = (x, z) => {
    const r = Math.max(Math.abs(x), Math.abs(z));
    const out = THREE.MathUtils.smoothstep(r, 172, 480);
    let h = (fbm2(x * 0.0042 + 3.1, z * 0.0042 - 1.7, 5) - 0.42) * 150 * out;
    h += (fbm2(x * 0.021 + 1.3, z * 0.021 + 8.1, 3) - 0.5) * 14 * out; // smaller folds and terraces
    h += 62 * Math.exp(-(((x - 520) / 190) ** 2)) * THREE.MathUtils.smoothstep(r, 190, 420); // eastern ridge
    h += 46 * Math.exp(-(((z + 560) / 220) ** 2) - ((x + 150) / 520) ** 2) * out;
    h -= 9 * THREE.MathUtils.smoothstep(r, 160, 215) * (1 - THREE.MathUtils.smoothstep(r, 240, 330)); // valley below the walls
    return h - 0.35;
  };
  for (let i = 0; i < p.count; i++) p.setY(i, height(p.getX(i), p.getZ(i)));
  // exact height of the tessellated terrain (so trees and houses sit on the mesh, not the analytic surface)
  const cell = S / N, N1 = N + 1;
  const meshHeight = (x, z) => {
    const fx = THREE.MathUtils.clamp((x + S / 2) / cell, 0, N - 1e-4), fz = THREE.MathUtils.clamp((z + S / 2) / cell, 0, N - 1e-4);
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const a = p.getY(i + N1 * j), b = p.getY(i + N1 * (j + 1)), c = p.getY(i + 1 + N1 * (j + 1)), d = p.getY(i + 1 + N1 * j);
    return u + v <= 1 ? a + (d - a) * u + (b - a) * v : c + (b - c) * (1 - u) + (d - c) * (1 - v);
  };
  ctx.heightAt = meshHeight;
  g.computeVertexNormals();
  // ground cover: pale limestone, ochre earth and dry olive scrub blended by slope and noise
  const col = new Float32Array(p.count * 3); const nrm = g.attributes.normal;
  const rock = C(0.80, 0.74, 0.60), earth = C(0.58, 0.46, 0.30), scrub = C(0.30, 0.36, 0.19), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const n1 = fbm2(x * 0.012 + 40, z * 0.012 - 7, 4), n2 = fbm2(x * 0.045 - 3, z * 0.045 + 19, 3);
    const slope = 1 - nrm.getY(i);
    c.copy(earth).lerp(scrub, THREE.MathUtils.smoothstep(n1 * 0.7 + n2 * 0.3, 0.42, 0.62) * 0.85);
    c.lerp(rock, THREE.MathUtils.smoothstep(slope + n2 * 0.08, 0.2, 0.42) * 0.8);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  g.setAttribute('mixcol', new THREE.BufferAttribute(col, 3));
  ctx.terrainGeometry = g;
  // far settlements: compact hill villages (cheap flat-roofed boxes, a few domes and towers)
  const villages = [];
  for (let i = 0; i < 60 && villages.length < 17; i++) {
    const a = rng() * Math.PI * 2; const d = rng.range(250, 640);
    const x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d;
    if (Math.max(Math.abs(x), Math.abs(z)) < 225) continue;
    if (villages.some((v) => Math.hypot(v.x - x, v.z - z) < 120)) continue;
    villages.push({ x, z, r: rng.range(28, 58), rot: rng() * 1.5 });
  }
  villages.push({ x: 330, z: -40, r: 55, rot: 0.3 }, { x: 60, z: -330, r: 50, rot: 0.1 });
  for (const v of villages) {
    const count = Math.floor(v.r * rng.range(0.7, 1.1));
    for (let i = 0; i < count; i++) {
      const a = rng() * Math.PI * 2; const d = Math.sqrt(rng()) * v.r;
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      const y = meshHeight(x, z); const w = rng.range(5, 10), dd = rng.range(5, 10), h = rng.range(3.2, 7.5) * (1 - d / v.r * 0.3);
      const tint = C(0.98, 0.93, 0.84).multiplyScalar(rng.range(0.86, 1.05));
      const ry = v.rot + rng.pick([0, Math.PI / 2]) + rng.range(-0.08, 0.08);
      ctx.put(rng.pick(['stoneB', 'stoneE', 'stoneF']), G.boxSides(), M(x, y - 3, z, w, h + 3, dd, ry), { color: tint, base: y });
      ctx.put('plasterC', G.planeUp(), M(x, y + h, z, w, 1, dd, ry), { color: C(0.9, 0.82, 0.7) });
      if (rng.chance(0.16)) ctx.kit.dome(x, y + h, z, Math.min(w, dd) * 0.3, { mat: 'plasterC', tint: C(0.96, 0.94, 0.9), drumH: 0.6, collide: false, finial: false, sides: 12, drumSides: 8 });
    }
    // a tower and a ring of trees per village
    const ty = meshHeight(v.x, v.z);
    ctx.put('stoneB', G.boxSides(), M(v.x, ty - 2, v.z, 4.5, rng.range(14, 20), 4.5, v.rot), { color: C(0.95, 0.9, 0.8), base: ty });
    for (let i = 0; i < 26; i++) {
      const a = rng() * Math.PI * 2; const d = v.r * rng.range(0.4, 1.35);
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      ctx.trees.push({ type: rng.chance(0.5) ? 'cypress' : 'olive', x, y: meshHeight(x, z) - 0.2, z, s: rng.range(0.9, 1.5), ry: rng() * 6.28, far: true });
    }
  }
  // olive groves and cypresses on the hills
  for (let i = 0; i < 2600; i++) {
    const a = rng() * Math.PI * 2; const d = rng.range(185, 760);
    const x = Math.cos(a) * d * 1.12, z = Math.sin(a) * d;
    if (Math.max(Math.abs(x), Math.abs(z)) < 176) continue;
    if (fbm2(x * 0.008 - 2, z * 0.008 + 11, 3) < 0.4) continue;
    ctx.trees.push({ type: rng.chance(0.86) ? 'olive' : 'cypress', x, y: meshHeight(x, z) - 0.2, z, s: rng.range(0.8, 1.4), ry: rng() * 6.28, far: true });
  }
}
