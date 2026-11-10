// Geometry batching helpers for the procedural city.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + (hi - lo) * f();
  f.int = (lo, hi) => Math.floor(f.range(lo, hi + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length)];
  f.chance = (p) => f() < p;
  return f;
}

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
const WHITE = new THREE.Color(1, 1, 1);

/** Accumulates transformed geometry into one big buffer with world-scale UVs and vertex tints. */
export class Batch {
  constructor(name) {
    this.name = name;
    this.pos = []; this.nor = []; this.uv = []; this.col = []; this.base = []; this.idx = [];
    this.count = 0;
  }

  /**
   * opts: color (THREE.Color), uvScale (metres per texture repeat; 0 = keep geometry UVs),
   *       uvOffset [u,v], base (ground height for grime), flip (invert winding)
   */
  add(geometry, matrix, opts = {}) {
    const { color = WHITE, color2 = null, uvScale = 0, uvOffset = null, base = 0, uvRot = false, uvMul = null } = opts;
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    const mixf = color2 ? geometry.attributes.mixf : null;
    const start = this.count;
    _nm.getNormalMatrix(matrix);
    const ou = uvOffset ? uvOffset[0] : 0, ov = uvOffset ? uvOffset[1] : 0;
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(matrix);
      _n.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z);
      this.nor.push(_n.x, _n.y, _n.z);
      if (uvScale > 0) {
        const ax = Math.abs(_n.x), ay = Math.abs(_n.y), az = Math.abs(_n.z);
        let u, v;
        if (ay > 0.72 || (ay > ax && ay > az)) { u = _v.x; v = _v.z; } else if (ax > az) { u = _v.z; v = _v.y; } else { u = _v.x; v = _v.y; }
        if (uvRot) { const t = u; u = v; v = t; }
        this.uv.push(u / uvScale + ou, v / uvScale + ov);
      } else if (uv) this.uv.push(uv.getX(i) * (uvMul ? uvMul[0] : 1) + ou, uv.getY(i) * (uvMul ? uvMul[1] : 1) + ov); else this.uv.push(0, 0);
      if (mixf) {
        const k = mixf.getX(i);
        this.col.push(color.r + (color2.r - color.r) * k, color.g + (color2.g - color.g) * k, color.b + (color2.b - color.b) * k);
      } else this.col.push(color.r, color.g, color.b);
      this.base.push(base);
    }
    const index = geometry.index;
    if (index) { for (let i = 0; i < index.count; i++) this.idx.push(start + index.getX(i)); } else { for (let i = 0; i < p.count; i++) this.idx.push(start + i); }
    this.count += p.count;
    return this;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aBase', new THREE.Float32BufferAttribute(this.base, 1));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    this.pos = this.nor = this.uv = this.col = this.base = this.idx = null;
    return g;
  }
}

/** Position-only batch used to build the physics collider. */
export class ColliderBatch {
  constructor() { this.pos = []; this.idx = []; this.count = 0; }
  add(geometry, matrix) {
    const p = geometry.attributes.position; const start = this.count;
    for (let i = 0; i < p.count; i++) { _v.fromBufferAttribute(p, i).applyMatrix4(matrix); this.pos.push(_v.x, _v.y, _v.z); }
    const index = geometry.index;
    if (index) { for (let i = 0; i < index.count; i++) this.idx.push(start + index.getX(i)); } else { for (let i = 0; i < p.count; i++) this.idx.push(start + i); }
    this.count += p.count;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(this.idx, 1));
    return g;
  }
}

// ------------------------------------------------------------------------------------------------
// cached primitives
const cache = new Map();
const memo = (key, make) => { if (!cache.has(key)) cache.set(key, make()); return cache.get(key); };

export const G = {
  box: () => memo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  /** box without its bottom face, origin at the bottom centre */
  boxUp: () => memo('boxUp', () => { const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0); return g; }),
  /** the four vertical sides of a unit box (no top / bottom), origin at the bottom centre */
  boxSides: () => memo('boxSides', () => {
    const g = new THREE.BoxGeometry(1, 1, 1); g.translate(0, 0.5, 0);
    const idx = []; const src = g.index.array;
    for (let f = 0; f < 6; f++) { if (f === 2 || f === 3) continue; for (let k = 0; k < 6; k++) idx.push(src[f * 6 + k]); }
    g.setIndex(idx);
    return g;
  }),
  plane: () => memo('plane', () => new THREE.PlaneGeometry(1, 1)),
  /** ramp: x -0.5..0.5, rises from y=0 at z=0 to y=1 at z=1 (closed prism) */
  wedge: () => memo('wedge', () => fromTris([
    // slope
    [-0.5, 0, 0], [0.5, 0, 0], [0.5, 1, 1], [-0.5, 0, 0], [0.5, 1, 1], [-0.5, 1, 1],
    // back
    [0.5, 0, 1], [-0.5, 0, 1], [-0.5, 1, 1], [0.5, 0, 1], [-0.5, 1, 1], [0.5, 1, 1],
    // sides
    [-0.5, 0, 0], [-0.5, 1, 1], [-0.5, 0, 1], [0.5, 0, 0], [0.5, 0, 1], [0.5, 1, 1],
    // bottom
    [-0.5, 0, 0], [-0.5, 0, 1], [0.5, 0, 1], [-0.5, 0, 0], [0.5, 0, 1], [0.5, 0, 0],
  ], true)),
  /** gable roof prism: footprint x,z in -0.5..0.5, ridge along z at y=1 */
  gable: () => memo('gable', () => fromTris([
    [-0.5, 0, 0.5], [0.5, 0, 0.5], [0, 1, 0.5], [0.5, 0, -0.5], [-0.5, 0, -0.5], [0, 1, -0.5],
    [-0.5, 0, -0.5], [-0.5, 0, 0.5], [0, 1, 0.5], [-0.5, 0, -0.5], [0, 1, 0.5], [0, 1, -0.5],
    [0.5, 0, 0.5], [0.5, 0, -0.5], [0, 1, -0.5], [0.5, 0, 0.5], [0, 1, -0.5], [0, 1, 0.5],
  ])),
  /**
   * Unit cloth sheet in the XZ plane (x: -0.5..0.5, z: 0..1) with sag and `stripes` colour bands.
   * `mixf` attribute alternates 0/1 per stripe so two colours can be blended in by the batch.
   */
  cloth: (stripes = 6, sag = 0.12, slope = 0.0) => memo(`cloth${stripes}_${sag}_${slope}`, () => {
    const pos = [], uv = [], mixf = [], idx = [];
    const rows = 6;
    for (let s = 0; s < stripes; s++) {
      for (let c = 0; c < 2; c++) {
        const x = (s + c) / stripes - 0.5;
        for (let r = 0; r <= rows; r++) {
          const z = r / rows;
          const y = -sag * 4 * z * (1 - z) * (1 - 0.5 * Math.abs(x) * 2) - sag * 0.6 * (1 - 4 * x * x) * z * 0 - slope * z;
          pos.push(x, y, z); uv.push(x + 0.5, z); mixf.push(s % 2);
        }
      }
      const b = s * 2 * (rows + 1);
      for (let r = 0; r < rows; r++) {
        const a0 = b + r, a1 = b + r + 1, b0 = b + rows + 1 + r, b1 = b0 + 1;
        idx.push(a0, a1, b0, a1, b1, b0);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('mixf', new THREE.Float32BufferAttribute(mixf, 1));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }),
  planeUp: () => memo('planeUp', () => { const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2); return g; }),
  cyl: (seg = 16, open = false) => memo(`cyl${seg}${open}`, () => { const g = new THREE.CylinderGeometry(1, 1, 1, seg, 1, open); g.translate(0, 0.5, 0); return g; }),
  cone: (seg = 16, rTop = 0) => memo(`cone${seg}_${rTop}`, () => { const g = new THREE.CylinderGeometry(rTop, 1, 1, seg, 1, false); g.translate(0, 0.5, 0); return g; }),
  sphere: (w = 16, h = 12) => memo(`sph${w}_${h}`, () => new THREE.SphereGeometry(1, w, h)),
  /** dome profile: `point` 0 = hemisphere, >0 = pointed (Islamic) dome; `bulge` widens it above the springing */
  dome: (seg = 28, point = 0.25, bulge = 0.0, rows = 14) => memo(`dome${seg}_${point}_${bulge}_${rows}`, () => {
    const pts = [];
    for (let i = 0; i <= rows; i++) {
      const t = i / rows; // 0 at the base, 1 at the apex
      const a = t * Math.PI / 2;
      let r = Math.cos(a), y = Math.sin(a);
      r = r * (1 + bulge * Math.sin(Math.min(1, t * 2.2) * Math.PI) * 0.5);
      y = y * (1 + point * t * t) ;
      r *= 1 - point * 0.35 * t * t * (1 - t) * 4 * 0.5;
      pts.push(new THREE.Vector2(Math.max(r, 0.0001), y));
    }
    return new THREE.LatheGeometry(pts, seg);
  }),
  /** arch outline as a THREE.Shape: width w, total height h, `pointed` 0..1 */
  archShape: (w, h, pointed = 0.5, segs = 10) => {
    const s = new THREE.Shape();
    const hw = w / 2; const rise = hw * (1 + pointed * 0.55); const spring = Math.max(h - rise, 0.05);
    s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw, spring);
    for (let i = 1; i <= segs; i++) { // right half up to the apex
      const t = i / segs; const a = t * Math.PI / 2;
      const x = hw * Math.cos(a) * (1 - pointed * 0.18 * Math.sin(a * 2));
      s.lineTo(x, spring + rise * Math.sin(a));
    }
    for (let i = segs - 1; i >= 0; i--) {
      const t = i / segs; const a = t * Math.PI / 2;
      const x = -hw * Math.cos(a) * (1 - pointed * 0.18 * Math.sin(a * 2));
      s.lineTo(x, spring + rise * Math.sin(a));
    }
    s.closePath();
    return s;
  },
  /** arch frame (ring) extruded by depth; inner opening w x h, frame thickness t */
  archFrame: (w, h, t, depth, pointed = 0.5) => memo(`af${w}_${h}_${t}_${depth}_${pointed}`, () => {
    const outer = G.archShape(w + 2 * t, h + t, pointed);
    const hole = new THREE.Path(G.archShape(w, h, pointed).getPoints());
    // cut the opening all the way to the bottom edge
    outer.holes.push(hole);
    const g = new THREE.ExtrudeGeometry(outer, { depth, bevelEnabled: false, curveSegments: 4 });
    return g;
  }),
  /** solid arch panel (a flat filled arch, facing +z) */
  archPanel: (w, h, pointed = 0.5) => memo(`ap${w}_${h}_${pointed}`, () => {
    const g = new THREE.ShapeGeometry(G.archShape(w, h, pointed));
    // normalised UVs across the opening
    const p = g.attributes.position; const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / w + 0.5, p.getY(i) / h);
    return g;
  }),
  /** wall slab with an arched opening cut through it: overall W x H, opening w x h, thickness d (centred on z) */
  archWall: (W, H, w, h, d, pointed = 0.5) => memo(`aw${W}_${H}_${w}_${h}_${d}_${pointed}`, () => {
    const s = new THREE.Shape();
    s.moveTo(-W / 2, 0); s.lineTo(W / 2, 0); s.lineTo(W / 2, H); s.lineTo(-W / 2, H); s.closePath();
    const pts = G.archShape(w, h, pointed).getPoints();
    // drop the opening slightly below the base so there is no sliver at the bottom
    for (const q of pts) if (q.y < 0.001) q.y = -0.001;
    s.holes.push(new THREE.Path(pts));
    const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -d / 2);
    return g;
  }),
};

function fromTris(tris, flip = false) {
  if (flip) { tris = tris.slice(); for (let i = 0; i < tris.length; i += 3) { const t = tris[i + 1]; tris[i + 1] = tris[i + 2]; tris[i + 2] = t; } }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(tris.length * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}

/** cheap deterministic value noise for terrain */
export function noise2(x, z) {
  const h = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
  const xi = Math.floor(x), zi = Math.floor(z); const xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return (h(xi, zi) * (1 - u) + h(xi + 1, zi) * u) * (1 - v) + (h(xi, zi + 1) * (1 - u) + h(xi + 1, zi + 1) * u) * v;
}
export function fbm2(x, z, oct = 4) { let a = 0.5, f = 1, s = 0; for (let i = 0; i < oct; i++) { s += a * noise2(x * f, z * f); f *= 2.03; a *= 0.5; } return s; }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
/** Compose a TRS matrix (rotation given as euler angles). Returns a fresh matrix. */
export function M(x, y, z, sx = 1, sy = 1, sz = 1, ry = 0, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
}
