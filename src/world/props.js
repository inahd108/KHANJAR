// Instanced CC0 props (Poly Haven) placed by the city generator.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const BASE = './assets/models/';
export const propModels = {};

export async function loadProps(names, onProgress = () => {}) {
  const loader = new GLTFLoader();
  let done = 0;
  await Promise.all(names.map(async (n) => {
    if (propModels[n]) return;
    const g = await loader.loadAsync(BASE + n + '.glb');
    g.scene.updateMatrixWorld(true);
    const parts = [];
    const box = new THREE.Box3();
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      const geo = o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
      geo.computeBoundingBox(); box.union(geo.boundingBox);
      if (o.material.map) o.material.map.anisotropy = 4;
      parts.push({ geometry: geo, material: o.material });
    });
    propModels[n] = { parts, box, scene: g.scene };
    onProgress(++done / names.length);
  }));
  return propModels;
}

const CELL = 72;
/**
 * Build instanced meshes for a prop list, chunked on a grid so they can be frustum / distance culled.
 * Returns { group, boxes, update(cameraPosition) } where boxes are collision AABBs.
 */
export function buildProps(list) {
  const group = new THREE.Group(); group.name = 'props';
  const chunks = new Map();
  for (const p of list) {
    if (!propModels[p.model]) continue;
    const key = p.model + '|' + Math.floor(p.x / CELL) + '|' + Math.floor(p.z / CELL);
    if (!chunks.has(key)) chunks.set(key, { model: p.model, items: [] });
    chunks.get(key).items.push(p);
  }
  const dummy = new THREE.Object3D(); const boxes = []; const meshes = [];
  for (const { model: name, items } of chunks.values()) {
    const model = propModels[name];
    const centre = new THREE.Vector3(); for (const p of items) centre.add(new THREE.Vector3(p.x, p.y, p.z)); centre.multiplyScalar(1 / items.length);
    let radius = 0; for (const p of items) radius = Math.max(radius, Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) + 1.5);
    for (const part of model.parts) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
      items.forEach((p, i) => { dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(0, p.ry, 0); dummy.scale.setScalar(p.s); dummy.updateMatrix(); mesh.setMatrixAt(i, dummy.matrix); });
      mesh.boundingSphere = new THREE.Sphere(centre.clone(), radius);
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true;
      mesh.name = 'prop:' + name;
      mesh.userData.centre = centre;
      group.add(mesh); meshes.push(mesh);
    }
    for (const p of items) {
      if (!p.collide) continue;
      const b = model.box; const sx = (b.max.x - b.min.x) * p.s, sy = (b.max.y - b.min.y) * p.s, sz = (b.max.z - b.min.z) * p.s;
      boxes.push({ x: p.x, y: p.y + sy / 2, z: p.z, sx, sy, sz, ry: p.ry });
    }
  }
  const update = (cam) => {
    for (const m of meshes) {
      const d = m.userData.centre.distanceTo(cam);
      m.visible = d < 210;
      m.castShadow = d < 80;
    }
  };
  return { group, boxes, update };
}
