// Procedural palms, cypresses and olive trees (instanced).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from './geo.js';

function frondTexture() {
  const W = 256, H = 1024; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.clearRect(0, 0, W, H);
  const rng = mulberry32(7);
  // leaflets
  for (let i = 0; i < 150; i++) {
    const t = i / 150; const y = H - 20 - t * (H - 40);
    const len = (0.25 + 0.75 * Math.sin(Math.min(1, t * 1.15 + 0.12) * Math.PI) ** 0.6) * W * 0.5;
    for (const s of [-1, 1]) {
      const ang = (0.55 + 0.25 * t) + rng.range(-0.08, 0.08);
      const x1 = W / 2 + s * Math.sin(ang) * len, y1 = y - Math.cos(ang) * len * 0.9;
      const shade = 70 + rng() * 60;
      g.strokeStyle = `rgb(${shade * 0.78 | 0},${shade + 22 | 0},${shade * 0.42 | 0})`;
      g.lineWidth = 3.4 + rng() * 1.6; g.lineCap = 'round';
      g.beginPath(); g.moveTo(W / 2, y); g.quadraticCurveTo(W / 2 + s * len * 0.45, y - len * 0.12, x1, y1); g.stroke();
    }
  }
  g.strokeStyle = '#7d8a3c'; g.lineWidth = 7; g.beginPath(); g.moveTo(W / 2, H); g.lineTo(W / 2, 14); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.generateMipmaps = true;
  return t;
}

function foliageTexture(r, g, b) {
  const S = 256; const c = document.createElement('canvas'); c.width = c.height = S; const x = c.getContext('2d');
  const rng = mulberry32(11);
  x.fillStyle = `rgb(${r * 0.72 | 0},${g * 0.72 | 0},${b * 0.72 | 0})`; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 5200; i++) {
    const k = 0.5 + rng() * 0.9;
    x.fillStyle = `rgba(${r * k | 0},${g * k | 0},${b * k | 0},0.85)`;
    const px = rng() * S, py = rng() * S, s = 1.5 + rng() * 4;
    x.beginPath(); x.ellipse(px, py, s, s * 0.45, rng() * 3.14, 0, 6.3); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3); t.anisotropy = 4;
  return t;
}

function frondGeometry(L, W, droop) {
  const segs = 9; const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs; const z = Math.sin(t * 1.25) / Math.sin(1.25) * L * (1 - droop * 0.15);
    const y = -droop * L * t * t * 0.9 + 0.35 * L * t * (1 - t);
    const w = W * 0.5; const fold = 0.16 * W;
    pos.push(-w, y - fold, z, 0, y, z, w, y - fold, z);
    uv.push(0, t, 0.5, t, 1, t);
  }
  for (let i = 0; i < segs; i++) { const a = i * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function palmGeometry(seed) {
  const rng = mulberry32(seed);
  const H = rng.range(7.5, 10.5); const lean = rng.range(0.02, 0.1); const leanDir = rng() * 6.28;
  const trunk = new THREE.CylinderGeometry(0.17, 0.3, H, 9, 14, true); trunk.translate(0, H / 2, 0);
  const p = trunk.attributes.position; const uvA = trunk.attributes.uv;
  const bend = (y) => { const t = y / H; return lean * H * t * t; };
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); const b = bend(y); const ring = 1 + 0.06 * Math.sin(y * 9.0);
    p.setXYZ(i, p.getX(i) * ring + Math.cos(leanDir) * b, y, p.getZ(i) * ring + Math.sin(leanDir) * b);
    uvA.setXY(i, uvA.getX(i) * 2, uvA.getY(i) * H / 1.2);
  }
  trunk.computeVertexNormals();
  const top = new THREE.Vector3(Math.cos(leanDir) * bend(H), H, Math.sin(leanDir) * bend(H));
  const fronds = [];
  const n = 38;
  for (let i = 0; i < n; i++) {
    const tier = i / n; const az = i * 2.399 + rng() * 0.4;
    const elev = THREE.MathUtils.lerp(1.25, -0.5, Math.pow(tier, 0.85)) + rng.range(-0.1, 0.1);
    const L = rng.range(3.4, 4.6) * (0.78 + 0.3 * Math.sin(tier * Math.PI));
    const g = frondGeometry(L, 0.95, 0.5 + tier * 0.75);
    g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-elev, az, rng.range(-0.25, 0.25), 'YXZ')));
    g.translate(top.x, top.y - 0.1, top.z);
    fronds.push(g);
  }
  // crown bulb
  const bulb = new THREE.SphereGeometry(0.42, 8, 6); bulb.scale(1, 1.3, 1); bulb.translate(top.x, top.y - 0.35, top.z);
  for (const a of ['uv']) { /* keep */ }
  return { trunk: mergeGeometries([trunk, bulb]), fronds: mergeGeometries(fronds) };
}

function blobTree(seed, kind) {
  const rng = mulberry32(seed); const blobs = [];
  if (kind === 'cypress') {
    // a narrow flame of small overlapping tufts spiralling up the trunk
    const H = 11.5; const n = 84;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1); const y = 0.7 + t * (H - 0.7);
      const env = Math.pow(Math.sin(Math.min(1, t * 0.9 + 0.1) * Math.PI), 0.6) * (1 - t * 0.3) + 0.08;
      const rad = 0.62 * env + 0.1;
      const a = i * 2.39996 + rng() * 0.5; const off = env * rng.range(0.32, 0.62);
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const j = 1 + (rng() - 0.5) * 0.5; p.setXYZ(k, p.getX(k) * j, p.getY(k) * j, p.getZ(k) * j); }
      g.scale(rad * rng.range(0.75, 1.0), rad * rng.range(1.5, 2.3) + 0.2, rad * rng.range(0.75, 1.0));
      g.rotateZ(rng.range(-0.25, 0.25)); g.rotateX(rng.range(-0.25, 0.25));
      g.translate(Math.cos(a) * off, y, Math.sin(a) * off);
      blobs.push(g);
    }
  } else if (kind === 'olive') {
    // broad, slightly flattened silver-green canopy made of many jittered tufts
    const n = 22;
    for (let i = 0; i < n; i++) {
      const g = new THREE.IcosahedronGeometry(1, 1);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) { const j = 1 + (rng() - 0.5) * 0.55; p.setXYZ(k, p.getX(k) * j, p.getY(k) * j, p.getZ(k) * j); }
      const r = rng.range(0.7, 1.25);
      g.scale(r * rng.range(0.9, 1.3), r * rng.range(0.55, 0.8), r * rng.range(0.9, 1.3));
      const a = rng() * 6.283, d = Math.sqrt(rng()) * 2.1;
      g.translate(Math.cos(a) * d, rng.range(2.7, 3.9) - d * 0.25, Math.sin(a) * d);
      blobs.push(g);
    }
  } else { // far, very cheap
    for (let i = 0; i < 3; i++) { const g = new THREE.IcosahedronGeometry(1, 0); const r = rng.range(1.3, 2.0); g.scale(r, r * 0.85, r); g.translate(rng.range(-1, 1), rng.range(2.4, 3.6), rng.range(-1, 1)); blobs.push(g); }
  }
  for (const b of blobs) b.computeVertexNormals();
  const g = mergeGeometries(blobs);
  // soften the normals so blobs read as one mass: blend with direction from the tree axis
  const p = g.attributes.position, nrm = g.attributes.normal; const v = new THREE.Vector3(), n2 = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); n2.fromBufferAttribute(nrm, i);
    const radial = new THREE.Vector3(v.x, kind === 'cypress' ? 0.25 : (v.y - 3) * 0.6, v.z).normalize();
    n2.lerp(radial, kind === 'cypress' ? 0.42 : 0.55).normalize(); nrm.setXYZ(i, n2.x, n2.y, n2.z);
  }
  return g;
}

export function buildVegetation(trees, gfx) {
  const group = new THREE.Group(); group.name = 'vegetation';
  const barkTex = new THREE.TextureLoader().load('./assets/tex/palm_tree_bark_diff.webp'); barkTex.wrapS = barkTex.wrapT = THREE.RepeatWrapping; barkTex.colorSpace = THREE.SRGBColorSpace;
  const barkNor = new THREE.TextureLoader().load('./assets/tex/palm_tree_bark_nor.webp'); barkNor.wrapS = barkNor.wrapT = THREE.RepeatWrapping;
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex, normalMap: barkNor, roughness: 0.95, color: 0xb9a68c });
  const frondMat = new THREE.MeshStandardMaterial({ map: frondTexture(), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.7, color: 0x8c9468 });
  frondMat.onBeforeCompile = (s) => { // thin leaves: let a little light through
    s.fragmentShader = s.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * 0.12;');
  };
  frondMat.userData.shaderKey = 'frond'; frondMat.customProgramCacheKey = () => 'frond';
  const cypressMat = new THREE.MeshStandardMaterial({ map: foliageTexture(44, 68, 34), roughness: 1, color: 0xffffff });
  const oliveMat = new THREE.MeshStandardMaterial({ map: foliageTexture(96, 108, 78), roughness: 1, color: 0xffffff });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b4a3a, roughness: 1 });
  const dummy = new THREE.Object3D();
  const inst = (geo, mat, list, shadow = true, yOff = 0, sxz = 1) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((t, i) => { dummy.position.set(t.x, t.y + yOff, t.z); dummy.rotation.set(0, t.ry, 0); dummy.scale.set(t.s * sxz, t.s, t.s * sxz); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
    m.castShadow = shadow; m.receiveShadow = true; m.frustumCulled = false;
    group.add(m); return m;
  };
  const palms = trees.filter((t) => t.type === 'palm');
  const VAR = 3;
  for (let v = 0; v < VAR; v++) {
    const list = palms.filter((_, i) => i % VAR === v);
    const g = palmGeometry(100 + v);
    inst(g.trunk, barkMat, list); inst(g.fronds, frondMat, list);
  }
  const near = trees.filter((t) => !t.far);
  inst(blobTree(1, 'cypress'), cypressMat, near.filter((t) => t.type === 'cypress'));
  const trunkGeo = new THREE.CylinderGeometry(0.14, 0.2, 1.4, 6); trunkGeo.translate(0, 0.7, 0);
  inst(trunkGeo, trunkMat, near.filter((t) => t.type === 'cypress'));
  inst(blobTree(2, 'olive'), oliveMat, near.filter((t) => t.type === 'olive'));
  const oTrunk = new THREE.CylinderGeometry(0.2, 0.34, 3.0, 6); oTrunk.translate(0, 1.5, 0);
  inst(oTrunk, trunkMat, near.filter((t) => t.type === 'olive'));
  const far = trees.filter((t) => t.far);
  inst(blobTree(3, 'far'), oliveMat, far.filter((t) => t.type === 'olive'), false);
  inst(blobTree(1, 'cypress'), cypressMat, far.filter((t) => t.type === 'cypress'), false);
  // collision: trunks
  const colliders = near.map((t) => ({ x: t.x, y: t.y, z: t.z, r: t.type === 'palm' ? 0.3 : t.type === 'olive' ? 0.35 : 0.6, h: t.type === 'cypress' ? 6 : 5 }));
  return { group, colliders };
}
