// Shared builder context + the architectural "kit" (windows, doors, awnings, domes, parapets ...).
import * as THREE from 'three';
import { Batch, ColliderBatch, G, M, mulberry32 } from './geo.js';

export const C = (r, g, b) => new THREE.Color(r, g, b);
export const CLOTH_COLORS = [C(0.62, 0.12, 0.10), C(0.10, 0.25, 0.48), C(0.80, 0.55, 0.14), C(0.20, 0.42, 0.30), C(0.50, 0.20, 0.42), C(0.82, 0.74, 0.58), C(0.72, 0.30, 0.12), C(0.14, 0.40, 0.46)];
export const CREAM = C(0.88, 0.80, 0.64);

const SIDE = {
  // normal, rotation so local +Z faces outward, and how the along-wall coordinate u maps to world
  s: { ry: 0, nx: 0, nz: 1 },
  n: { ry: Math.PI, nx: 0, nz: -1 },
  e: { ry: Math.PI / 2, nx: 1, nz: 0 },
  w: { ry: -Math.PI / 2, nx: -1, nz: 0 },
};

export function createContext(materials, seed) {
  const rng = mulberry32(seed);
  const batches = {};
  const collider = new ColliderBatch();
  const ctx = {
    rng, materials, batches, collider,
    props: [], // { model, x, y, z, ry, s }
    trees: [], // { type, x, y, z, s, ry }
    lights: [],
    perches: [], // interesting high points
    roofs: [], // { x0,x1,z0,z1,y }
    banners: [],
    put(mat, geo, m, o) {
      const b = batches[mat] || (batches[mat] = new Batch(mat));
      const uvScale = o && o.uvScale !== undefined ? o.uvScale : (materials[mat].userData.uvScale || 0);
      b.add(geo, m, { ...o, uvScale });
    },
    /** axis aligned box from min/max corners */
    box(mat, x0, y0, z0, x1, y1, z1, o) {
      ctx.put(mat, G.box(), M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0), o);
    },
    cbox(x0, y0, z0, x1, y1, z1) {
      collider.add(G.box(), M((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0));
    },
    /** visual + collision box */
    solid(mat, x0, y0, z0, x1, y1, z1, o) { ctx.box(mat, x0, y0, z0, x1, y1, z1, o); ctx.cbox(x0, y0, z0, x1, y1, z1); },
    cgeo(geo, m) { collider.add(geo, m); },
    prop(model, x, y, z, ry = 0, s = 1, collide = false) { ctx.props.push({ model, x, y, z, ry, s, collide }); },
    tree(type, x, y, z, s = 1) { ctx.trees.push({ type, x, y, z, s, ry: rng() * 6.283 }); },
  };

  // ------------------------------------------------------------------ wall-relative placement
  /** matrix for a point on a wall of rect R: u metres along the wall, y up, `out` metres off the surface */
  ctx.wallFrame = (R, side) => {
    const S = SIDE[side];
    const len = (side === 'n' || side === 's') ? R.x1 - R.x0 : R.z1 - R.z0;
    const at = (u, y, out = 0) => {
      let x, z;
      if (side === 's') { x = R.x0 + u; z = R.z1 + out; } else if (side === 'n') { x = R.x1 - u; z = R.z0 - out; } else if (side === 'e') { x = R.x1 + out; z = R.z1 - u; } else { x = R.x0 - out; z = R.z0 + u; }
      return M(x, y, z, 1, 1, 1, S.ry);
    };
    return { len, at, S, side };
  };
  const sub = (base, x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) => base.clone().multiply(M(x, y, z, sx, sy, sz, ry, rx, rz));
  ctx.sub = sub;

  // ------------------------------------------------------------------ kit pieces (local: x along wall, y up, z outward)
  const kit = ctx.kit = {};

  kit.window = (base, o = {}) => {
    const { w = 0.9, h = 1.6, pointed = 0.5, frameMat = 'stoneC', tint, lattice = false, sill = true, baseY = 0 } = o;
    const fr = G.archFrame(w, h, 0.16, 0.13, pointed);
    ctx.put(frameMat, fr, sub(base, 0, 0, 0.0), { color: tint, base: baseY });
    ctx.put('dark', G.archPanel(w, h, pointed), sub(base, 0, 0, 0.035));
    if (lattice) ctx.put('lattice', G.archPanel(w, h, pointed), sub(base, 0, 0, 0.07), { uvScale: 0, color: C(1, 1, 1) });
    if (sill) ctx.put(frameMat, G.box(), sub(base, 0, -0.07, 0.1, w + 0.5, 0.12, 0.26), { color: tint, base: baseY });
  };

  kit.slit = (base, o = {}) => {
    const { w = 0.28, h = 1.3 } = o;
    ctx.put('dark', G.plane(), sub(base, 0, h / 2, 0.03, w, h, 1));
  };

  kit.squareWindow = (base, o = {}) => {
    const { w = 0.8, h = 1.0, tint, shutters = true } = o;
    ctx.put('dark', G.plane(), sub(base, 0, h / 2, 0.035, w, h, 1));
    ctx.put('woodDark', G.box(), sub(base, 0, h + 0.08, 0.07, w + 0.4, 0.16, 0.16));
    ctx.put('stoneC', G.box(), sub(base, 0, -0.06, 0.09, w + 0.3, 0.1, 0.22), { color: tint });
    if (shutters) {
      const col = rng.pick([C(0.28, 0.42, 0.40), C(0.42, 0.30, 0.20), C(0.25, 0.33, 0.48), C(0.5, 0.36, 0.22)]);
      const open = rng.range(0.2, 1.2);
      ctx.put('wood', G.box(), sub(base, -w / 2, h / 2, 0.05, w / 2, h, 0.04, -open).multiply(M(-0.5, 0, 0)), { color: col });
      ctx.put('wood', G.box(), sub(base, w / 2, h / 2, 0.05, w / 2, h, 0.04, open).multiply(M(0.5, 0, 0)), { color: col });
    }
  };

  /** projecting wooden bay window */
  kit.mashrabiya = (base, o = {}) => {
    const { w = 1.5, h = 1.7, d = 0.62 } = o;
    const wood = C(0.72, 0.55, 0.38);
    ctx.put('woodDark', G.box(), sub(base, 0, -0.06, d / 2, w + 0.1, 0.12, d + 0.06), { color: wood });
    ctx.put('woodDark', G.box(), sub(base, 0, h + 0.05, d / 2, w + 0.16, 0.1, d + 0.12), { color: wood });
    // sloped little roof
    ctx.put('woodDark', G.box(), sub(base, 0, h + 0.22, d / 2 - 0.04, w + 0.24, 0.06, d + 0.3, 0, 0.38), { color: C(0.5, 0.36, 0.25) });
    for (const sx of [-1, 1]) {
      ctx.put('woodDark', G.box(), sub(base, sx * w / 2, h / 2, d, 0.09, h, 0.09), { color: wood });
      ctx.put('woodDark', G.box(), sub(base, sx * (w / 2 - 0.1), -0.3, d * 0.42, 0.1, 0.1, d * 1.05, 0, -0.6), { color: wood });
      ctx.put('lattice', G.plane(), sub(base, sx * w / 2, h / 2, d / 2, d, h, 1, sx * Math.PI / 2), { uvScale: 0.55 });
    }
    ctx.put('lattice', G.plane(), sub(base, 0, h / 2, d, w, h, 1), { uvScale: 0.55 });
    ctx.put('dark', G.plane(), sub(base, 0, h / 2, 0.03, w, h, 1));
    ctx.put('woodDark', G.box(), sub(base, 0, h * 0.5, d + 0.01, w, 0.07, 0.05), { color: wood });
  };

  kit.door = (base, o = {}) => {
    const { w = 1.25, h = 2.35, pointed = 0.45, tint, open = false, baseY = 0 } = o;
    ctx.put('stoneC', G.archFrame(w, h, 0.22, 0.16, pointed), sub(base, 0, 0, 0), { color: tint, base: baseY });
    if (open) ctx.put('dark', G.archPanel(w, h, pointed), sub(base, 0, 0, 0.035));
    else {
      const col = rng.pick([C(0.55, 0.42, 0.3), C(0.36, 0.5, 0.48), C(0.45, 0.3, 0.2), C(0.3, 0.38, 0.52), C(0.6, 0.5, 0.36)]);
      ctx.put('woodDark', G.archPanel(w, h, pointed), sub(base, 0, 0, 0.05), { uvScale: 1.1, color: col });
      ctx.put('iron', G.box(), sub(base, w * 0.28, h * 0.45, 0.07, 0.07, 0.07, 0.05));
      for (const yy of [0.5, 1.5]) ctx.put('iron', G.box(), sub(base, 0, yy, 0.06, w * 0.96, 0.07, 0.02));
    }
    ctx.put('stoneB', G.box(), sub(base, 0, 0.07, 0.3, w + 0.7, 0.14, 0.6), { color: tint, base: baseY });
  };

  /** cloth awning sloping away from the wall, on two poles */
  kit.awning = (base, o = {}) => {
    const { w = 3, d = 2.2, drop = 0.7, color = rng.pick(CLOTH_COLORS), color2 = CREAM, poles = true, groundY = 0, y = 2.7 } = o;
    ctx.put('fabric', G.cloth(Math.max(2, Math.round(w / 0.45)), 0.1, 1), sub(base, 0, 0, 0.02, w, drop, d), { color, color2, uvScale: 0.6 });
    // valance
    ctx.put('fabric', G.plane(), sub(base, 0, -drop - 0.13, d + 0.02, w, 0.26, 1), { color: color2, uvScale: 0.6 });
    ctx.put('woodDark', G.box(), sub(base, 0, 0.0, 0.05, w + 0.1, 0.07, 0.07));
    ctx.put('woodDark', G.box(), sub(base, 0, -drop, d, w + 0.1, 0.06, 0.06));
    if (poles) for (const sx of [-1, 1]) ctx.put('woodDark', G.cyl(6), sub(base, sx * (w / 2 - 0.05), -(y - groundY), d - 0.02, 0.045, y - groundY - drop, 0.045));
  };

  kit.beam = (base, len = 0.5, thick = 0.14, o = {}) => {
    ctx.put('woodDark', G.box(), sub(base, 0, 0, len / 2 - 0.05, thick, thick, len + 0.1), { color: o.color });
  };

  kit.lantern = (base) => {
    ctx.put('iron', G.box(), sub(base, 0, 0, 0.25, 0.04, 0.04, 0.5));
    ctx.put('iron', G.box(), sub(base, 0, -0.18, 0.46, 0.02, 0.36, 0.02));
    ctx.put('brass', G.cyl(6), sub(base, 0, -0.62, 0.46, 0.1, 0.26, 0.1));
    ctx.put('brass', G.cone(6), sub(base, 0, -0.36, 0.46, 0.13, 0.1, 0.13));
  };

  /** hanging cloth banner / rug over a parapet */
  kit.hangingCloth = (base, o = {}) => {
    const { w = 1.3, h = 2.0, color = rng.pick(CLOTH_COLORS), color2 = rng.pick(CLOTH_COLORS) } = o;
    ctx.put('fabric', G.cloth(5, 0.03, 0), sub(base, 0, 0, 0.06, w, 1, h, 0, Math.PI / 2), { color, color2, uvScale: 0.5 });
  };

  /** a dome on a drum. Returns the apex height. */
  kit.dome = (x, y, z, r, o = {}) => {
    const { mat = 'plasterC', drumMat = mat, drumH = r * 0.45, point = 0.25, bulge = 0, tint, finial = true, sides = 28, drumSides = 16, collide = true, windows = 0, finialMat = 'brass' } = o;
    const dr = r * 1.04;
    ctx.put(drumMat, G.cyl(drumSides), M(x, y, z, dr, drumH, dr), { color: tint, base: y });
    ctx.put(drumMat, G.cyl(drumSides), M(x, y + drumH - 0.12, z, dr + 0.1, 0.16, dr + 0.1), { color: tint, base: y });
    const dg = G.dome(sides, point, bulge);
    ctx.put(mat, dg, M(x, y + drumH, z, r, r, r), { color: tint, base: y - 50 });
    if (windows) for (let i = 0; i < windows; i++) {
      const a = (i / windows) * Math.PI * 2 + 0.2;
      const bm = M(x + Math.sin(a) * dr, y + drumH * 0.2, z + Math.cos(a) * dr, 1, 1, 1, a);
      ctx.put('dark', G.archPanel(0.45, drumH * 0.6, 0.6), sub(bm, 0, 0, 0.03));
    }
    const apex = y + drumH + r * (1 + point);
    if (finial) {
      ctx.put(finialMat, G.cyl(6), M(x, apex - 0.1, z, 0.045 * Math.max(1, r / 3), 0.9 * Math.max(1, r / 4), 0.045 * Math.max(1, r / 3)));
      ctx.put(finialMat, G.sphere(8, 6), M(x, apex + 0.25 * Math.max(1, r / 4), z, 0.16 * Math.max(1, r / 4), 0.16 * Math.max(1, r / 4), 0.16 * Math.max(1, r / 4)));
    }
    if (collide) {
      ctx.cgeo(G.cyl(10), M(x, y, z, dr, drumH, dr));
      ctx.cgeo(G.dome(10, point, bulge, 5), M(x, y + drumH, z, r, r, r));
    }
    return apex;
  };

  /** parapet around a roof rectangle; style: 'plain' | 'cren' | 'none' */
  kit.parapet = (R, y, o = {}) => {
    const { h = 0.7, t = 0.32, mat = 'stoneB', tint, style = 'plain', base = 0, gaps = null } = o;
    const { x0, x1, z0, z1 } = R;
    const segs = [
      [x0, z0, x1, z0 + t], [x0, z1 - t, x1, z1], [x0, z0 + t, x0 + t, z1 - t], [x1 - t, z0 + t, x1, z1 - t],
    ];
    for (const [a, b, c, d] of segs) { ctx.box(mat, a, y, b, c, y + h, d, { color: tint, base }); ctx.cbox(a, y - 0.2, b, c, y + h, d); }
    if (style === 'cren') {
      const mw = 0.62, gap = 0.62, mh = 0.5;
      const run = (ax, az, bx, bz) => {
        const len = Math.hypot(bx - ax, bz - az); const n = Math.max(2, Math.floor((len + gap) / (mw + gap)));
        const step = (len - mw) / (n - 1);
        for (let i = 0; i < n; i++) {
          const f = (mw / 2 + i * step) / len; const cx = ax + (bx - ax) * f, cz = az + (bz - az) * f;
          const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
          ctx.put(mat, G.box(), M(cx, y + h + mh / 2, cz, alongX ? mw : t, mh, alongX ? t : mw), { color: tint, base });
        }
      };
      run(x0, z0 + t / 2, x1, z0 + t / 2); run(x0, z1 - t / 2, x1, z1 - t / 2);
      run(x0 + t / 2, z0, x0 + t / 2, z1); run(x1 - t / 2, z0, x1 - t / 2, z1);
    }
  };

  /** wooden pergola with a cloth roof */
  kit.pergola = (x0, z0, x1, z1, y, o = {}) => {
    const { h = 2.3, color = rng.pick(CLOTH_COLORS), color2 = CREAM } = o;
    for (const [px, pz] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) ctx.put('woodDark', G.cyl(6), M(px, y, pz, 0.06, h, 0.06));
    ctx.box('woodDark', x0 - 0.15, y + h, z0 - 0.05, x1 + 0.15, y + h + 0.08, z0 + 0.05);
    ctx.box('woodDark', x0 - 0.15, y + h, z1 - 0.05, x1 + 0.15, y + h + 0.08, z1 + 0.05);
    ctx.put('fabric', G.cloth(Math.max(3, Math.round((x1 - x0) / 0.5)), 0.07, 0), M((x0 + x1) / 2, y + h + 0.1, z0, x1 - x0, 1.6, z1 - z0), { color, color2, uvScale: 0.6 });
  };

  /** an arch spanning a street between two buildings */
  kit.streetArch = (x, y, z, span, alongX, o = {}) => {
    const { mat = 'stoneB', tint, thick = 0.9, rise = 2.3 } = o;
    const W = Math.round(span * 2) / 2 + 0.4;
    const geo = G.archWall(W, rise + 0.7, W - 0.3, rise, thick, 0.35);
    const m = M(x, y, z, 1, 1, 1, alongX ? 0 : Math.PI / 2);
    ctx.put(mat, geo, m, { color: tint, base: 0 });
    ctx.cgeo(G.box(), M(x, y + rise + 0.35, z, alongX ? W : thick, 0.7, alongX ? thick : W));
  };

  return ctx;
}
