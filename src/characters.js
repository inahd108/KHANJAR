// Character library: assembles CC0 modular outfits + heads + hair onto a single shared skeleton,
// and provides a small animation controller with cross-fading.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = './assets/chars/';
const OUTFITS = ['Male_Ranger', 'Female_Ranger', 'Male_Peasant', 'Female_Peasant'];
const HEADS = { male: 'Superhero_Male_FullBody', female: 'Superhero_Female_FullBody' };
const HAIRS = ['Hair_Beard', 'Hair_Buzzed', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Buns'];

const KEEP_ATTRS = ['position', 'normal', 'uv', 'skinIndex', 'skinWeight'];

export const lib = {
  outfits: {}, heads: {}, hairs: {}, clips: {}, textures: {}, templates: new Map(), ready: false,
};

function cleanGeometry(geo) {
  const g = geo.clone();
  for (const name of Object.keys(g.attributes)) if (!KEEP_ATTRS.includes(name)) g.deleteAttribute(name);
  g.morphAttributes = {};
  return g;
}

// Collect skinned meshes of a glTF scene and merge those sharing a material.
function extractSkinned(scene) {
  const meshes = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  const byMat = new Map();
  for (const m of meshes) {
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const key = mats[0].name || mats[0].uuid;
    if (!byMat.has(key)) byMat.set(key, { material: mats[0], geos: [], skeleton: m.skeleton, names: [] });
    byMat.get(key).geos.push(cleanGeometry(m.geometry));
    byMat.get(key).names.push(m.name);
  }
  const parts = [];
  for (const [key, e] of byMat) {
    const geometry = e.geos.length > 1 ? mergeGeometries(e.geos, false) : e.geos[0];
    parts.push({ key, geometry, material: e.material, skeleton: e.skeleton });
  }
  let rootBone = null;
  scene.traverse((o) => { if (o.isBone && o.name === 'root') rootBone = o; });
  return { parts, rootBone, armature: rootBone ? rootBone.parent : null };
}

// Keep only triangles of a body mesh that belong to the head/neck.
function headOnlyGeometry(geo, skeleton, minY) {
  const g = cleanGeometry(geo);
  const names = skeleton.bones.map((b) => b.name);
  const keepBones = new Set(['Head', 'neck_01']);
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
  const dominant = (v) => {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(v, k); if (w > bw) { bw = w; best = si.getComponent(v, k); } }
    return names[best];
  };
  const idx = g.index.array; const out = [];
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i], b = idx[i + 1], c = idx[i + 2];
    const ok = [a, b, c].every((v) => keepBones.has(dominant(v)) || pos.getY(v) > minY + 0.06) && [a, b, c].every((v) => pos.getY(v) > minY);
    if (ok) out.push(a, b, c);
  }
  g.setIndex(out);
  return g;
}

function fixTexture(t, srgb) {
  if (!t) return;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
}

const texCache = new Map();
function loadTex(file, srgb) {
  if (!file) return null;
  if (texCache.has(file)) return texCache.get(file);
  const t = new THREE.TextureLoader().load(BASE + file);
  t.flipY = false;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  texCache.set(file, t);
  return t;
}
export function characterTexture(file, srgb = true) { return loadTex(file, srgb); }

function applyMaterialDefs(scene, defs) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material; const d = defs[m.name];
    if (!d) return;
    m.map = loadTex(d.map, true);
    m.normalMap = loadTex(d.normal, false);
    if (d.orm) { m.roughnessMap = m.metalnessMap = loadTex(d.orm, false); }
    m.metalness = d.metalness; m.roughness = d.roughness;
    m.vertexColors = false;
    m.needsUpdate = true;
  });
}

export async function loadCharacterLibrary(onProgress = () => {}) {
  const loader = new GLTFLoader();
  const total = OUTFITS.length + 2 + HAIRS.length + 2 + 1;
  let done = 0;
  const tick = () => onProgress(++done / total);
  const load = (name) => loader.loadAsync(BASE + name).then((g) => { tick(); return g; });

  const [outfits, heads, hairs, anims, defs] = await Promise.all([
    Promise.all(OUTFITS.map((n) => load(n + '.gltf'))),
    Promise.all(Object.values(HEADS).map((n) => load(n + '.gltf'))),
    Promise.all(HAIRS.map((n) => load(n + '.gltf'))),
    Promise.all(['anims1.glb', 'anims2.glb'].map((n) => load(n))),
    fetch(BASE + 'materials.json').then((r) => r.json()).then((j) => { tick(); return j; }),
  ]);
  for (const g of [...outfits, ...heads, ...hairs]) applyMaterialDefs(g.scene, defs);
  lib.materialDefs = defs;

  OUTFITS.forEach((n, i) => { lib.outfits[n] = extractSkinned(outfits[i].scene); });
  Object.keys(HEADS).forEach((k, i) => {
    const ex = extractSkinned(heads[i].scene);
    // the base body: keep only head + neck (the outfit provides the rest)
    for (const p of ex.parts) if (/Superhero/.test(p.key)) p.geometry = headOnlyGeometry(p.geometry, p.skeleton, 1.47);
    lib.heads[k] = ex;
  });
  HAIRS.forEach((n, i) => { lib.hairs[n] = extractSkinned(hairs[i].scene); });

  // animation clips: drop translation/scale tracks except the pelvis so every body keeps its own proportions
  for (const g of anims) {
    for (const clip of g.animations) {
      clip.tracks = clip.tracks.filter((t) => {
        if (t.name.endsWith('.scale')) return false;
        if (t.name.endsWith('.position')) return t.name.startsWith('pelvis.');
        return true;
      });
      lib.clips[clip.name] = clip;
    }
  }
  buildDerivedClips();
  lib.ready = true;
  return lib;
}

// Sub-clips and tweaked variants derived from the source library.
function buildDerivedClips() {
  const sub = (src, name, t0, t1) => {
    const c = THREE.AnimationUtils.subclip(lib.clips[src], name, Math.round(t0 * 30), Math.round(t1 * 30), 30);
    lib.clips[name] = c;
  };
  if (lib.clips.Death01) sub('Death01', 'Dead_Pose', 2.3, 2.4);
  if (lib.clips.ClimbUp_1m) sub('ClimbUp_1m', 'Climb_Pose', 0.0, 0.05);
  if (lib.clips.Hit_Knockback) sub('Hit_Knockback', 'Down_Pose', 0.78, 0.83);
}

function bindPart(part, bonesByName, sharedSkeletons) {
  // Re-target a part onto the destination bones but keep its own inverse bind matrices.
  let skel = sharedSkeletons.get(part.skeleton);
  if (!skel) {
    const bones = part.skeleton.bones.map((b) => bonesByName.get(b.name));
    skel = new THREE.Skeleton(bones, part.skeleton.boneInverses.map((m) => m.clone()));
    sharedSkeletons.set(part.skeleton, skel);
  }
  return skel;
}

/**
 * Build (and cache) a template for a given look, then clone it.
 * spec: { outfit, head:'male'|'female', hair:[names], materials: { [partKey]: (mat)=>void } , id }
 */
function getTemplate(spec) {
  const key = spec.id || JSON.stringify([spec.outfit, spec.head, spec.hair]);
  if (lib.templates.has(key)) return lib.templates.get(key);
  const outfit = lib.outfits[spec.outfit];
  const group = new THREE.Group();
  const armature = SkeletonUtils.clone(outfit.armature);
  const stray = []; armature.traverse((o) => { if (o.isMesh) stray.push(o); }); stray.forEach((o) => o.removeFromParent());
  group.add(armature);
  const bonesByName = new Map();
  armature.traverse((o) => { if (o.isBone) bonesByName.set(o.name, o); });
  const shared = new Map();
  const addPart = (part, tag) => {
    const skel = bindPart(part, bonesByName, shared);
    const mat = part.material.clone();
    mat.name = part.material.name;
    const mesh = new THREE.SkinnedMesh(part.geometry, mat);
    mesh.name = tag + ':' + part.key;
    mesh.bind(skel, new THREE.Matrix4());
    mesh.frustumCulled = false;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const p of outfit.parts) {
    if (spec.hideParts && spec.hideParts.some((r) => r.test(p.key))) continue;
    addPart(p, 'outfit');
  }
  if (spec.head) for (const p of lib.heads[spec.head].parts) addPart(p, 'head');
  for (const h of spec.hair || []) for (const p of lib.hairs[h].parts) addPart(p, 'hair');
  group.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    m.side = /hair|MI_Hair/i.test(o.name) ? THREE.DoubleSide : THREE.FrontSide;
    if (/MI_Hair/.test(m.name)) { m.alphaTest = 0.4; m.transparent = false; m.roughness = 0.75; }
    if (/MI_Eyes/.test(m.name)) { m.roughness = 0.25; }
    m.envMapIntensity = 1.0;
  });
  if (spec.setup) spec.setup(group);
  lib.templates.set(key, group);
  return group;
}

export class Character {
  constructor(spec) {
    const template = getTemplate(spec);
    this.root = SkeletonUtils.clone(template);
    // share one Skeleton instance between meshes that shared one in the template
    const map = new Map();
    const tMeshes = []; template.traverse((o) => { if (o.isSkinnedMesh) tMeshes.push(o); });
    const cMeshes = []; this.root.traverse((o) => { if (o.isSkinnedMesh) cMeshes.push(o); });
    cMeshes.forEach((m, i) => {
      const src = tMeshes[i].skeleton;
      if (map.has(src)) { m.skeleton = map.get(src); } else map.set(src, m.skeleton);
      m.frustumCulled = false;
    });
    this.meshes = cMeshes;
    this.bones = {};
    this.root.traverse((o) => { if (o.isBone) this.bones[o.name] = o; });
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = {};
    this.current = null;
    this.currentName = '';
    this.upper = null;
  }

  action(name) {
    let a = this.actions[name];
    if (!a) {
      const clip = lib.clips[name];
      if (!clip) throw new Error('missing clip ' + name);
      a = this.actions[name] = this.mixer.clipAction(clip);
    }
    return a;
  }

  /** Cross-fade to a clip. opts: { fade, loop, speed, clamp, startAt, force } */
  play(name, opts = {}) {
    const { fade = 0.18, loop = true, speed = 1, startAt = 0, force = false } = opts;
    if (this.currentName === name && !force) { this.current.timeScale = speed; return this.current; }
    const next = this.action(name);
    next.enabled = true;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.timeScale = speed;
    next.time = startAt;
    next.setEffectiveWeight(1);
    if (this.current && this.current !== next) { next.crossFadeFrom(this.current, fade, false); } else if (fade > 0 && !this.current) next.fadeIn(0);
    next.play();
    this.current = next;
    this.currentName = name;
    return next;
  }

  /** time position (0..1) of the current action */
  progress() {
    if (!this.current) return 0;
    return this.current.time / this.current.getClip().duration;
  }
  finished() {
    const a = this.current;
    return !a || (a.loop === THREE.LoopOnce && a.time >= a.getClip().duration - 1e-3);
  }

  update(dt) { this.mixer.update(dt); }

  attach(object, boneName) { this.bones[boneName].add(object); return object; }

  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); }
}

// ---------------------------------------------------------------------------------------------
// Two-bone IK (after Daniel Holden's "Simple Two Joint IK"). Works in world space on any rig.
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _at = new THREE.Vector3(), _bc = new THREE.Vector3(), _ba = new THREE.Vector3();
const _axis0 = new THREE.Vector3(), _axis1 = new THREE.Vector3(), _tmp = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _r = new THREE.Quaternion(), _r2 = new THREE.Quaternion();
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function solveTwoBoneIK(upper, lower, end, target, pole = null, weight = 1) {
  upper.updateWorldMatrix(true, false); lower.updateWorldMatrix(false, false); end.updateWorldMatrix(false, false);
  _a.setFromMatrixPosition(upper.matrixWorld); _b.setFromMatrixPosition(lower.matrixWorld); _c.setFromMatrixPosition(end.matrixWorld);
  const lab = _a.distanceTo(_b), lcb = _b.distanceTo(_c);
  _at.copy(target).sub(_a);
  const lat = clamp(_at.length(), 0.02, lab + lcb - 0.004);
  _ac.copy(_c).sub(_a).normalize(); _ab.copy(_b).sub(_a).normalize();
  _ba.copy(_a).sub(_b).normalize(); _bc.copy(_c).sub(_b).normalize(); _at.normalize();
  const ac_ab_0 = Math.acos(clamp(_ac.dot(_ab), -1, 1));
  const ba_bc_0 = Math.acos(clamp(_ba.dot(_bc), -1, 1));
  const ac_at_0 = Math.acos(clamp(_ac.dot(_at), -1, 1));
  const ac_ab_1 = Math.acos(clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
  const ba_bc_1 = Math.acos(clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
  if (pole) { _tmp.copy(pole).sub(_a); _axis0.crossVectors(_ac, _tmp).normalize(); } else _axis0.crossVectors(_ac, _ab).normalize();
  if (_axis0.lengthSq() < 0.5) _axis0.set(1, 0, 0);
  _axis1.crossVectors(_ac, _at).normalize();
  upper.getWorldQuaternion(_qa); lower.getWorldQuaternion(_qb);
  // rotations are applied in world space, then converted back to local
  const apply = (bone, worldQ, axis, angle) => {
    if (Math.abs(angle) < 1e-5 || axis.lengthSq() < 0.5) return;
    _r.setFromAxisAngle(axis, angle * weight);
    worldQ.premultiply(_r);
    bone.parent.getWorldQuaternion(_r2).invert();
    bone.quaternion.copy(_r2.multiply(worldQ));
    bone.updateWorldMatrix(false, true);
  };
  apply(upper, _qa, _axis0, ac_ab_1 - ac_ab_0);
  apply(upper, _qa, _axis1, ac_at_0);
  lower.getWorldQuaternion(_qb);
  apply(lower, _qb, _axis0.applyAxisAngle(_axis1, ac_at_0), ba_bc_1 - ba_bc_0);
}
