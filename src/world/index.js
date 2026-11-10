// Assembles the whole level: city meshes, props, vegetation and the physics collider.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { createMaterials } from './materials.js';
import { buildCity } from './city.js';
import { buildVegetation } from './vegetation.js';
import { loadProps, buildProps } from './props.js';
import { G, M } from './geo.js';

export async function buildWorld(gfx, onProgress = () => {}) {
  const materials = createMaterials();
  const t0 = performance.now();
  const city = buildCity(materials, 1187);
  onProgress(0.3, 'Raising the city');
  const names = [...new Set(city.props.map((p) => p.model))];
  await Promise.all([loadProps(names, (f) => onProgress(0.3 + f * 0.4, 'Stocking the market')), materials.ready()]);
  const props = buildProps(city.props);
  const veg = buildVegetation(city.trees, gfx);
  onProgress(0.8, 'Planting palms');

  const group = new THREE.Group(); group.name = 'world';
  group.add(city.group, props.group, veg.group);

  // physics collider = city collider + prop boxes + tree trunks
  const extra = [];
  const boxG = G.box(), cylG = G.cyl(6);
  const col = city.colliderGeometry;
  const pos = Array.from(col.attributes.position.array); const idx = Array.from(col.index.array);
  const v = new THREE.Vector3();
  const addGeo = (geo, m) => {
    const start = pos.length / 3; const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); pos.push(v.x, v.y, v.z); }
    const ind = geo.index.array; for (let i = 0; i < ind.length; i++) idx.push(start + ind[i]);
  };
  for (const b of props.boxes) addGeo(boxG, M(b.x, b.y, b.z, b.sx, b.sy, b.sz, b.ry));
  for (const t of veg.colliders) addGeo(cylG, M(t.x, t.y, t.z, t.r, t.h, t.r));
  const cg = new THREE.BufferGeometry();
  cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); cg.setIndex(idx);
  cg.boundsTree = new MeshBVH(cg, { targetLeafSize: 8 });
  const colliderMesh = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ wireframe: true, color: 0x00ff88 }));
  colliderMesh.visible = false; colliderMesh.name = 'collider';
  group.add(colliderMesh);
  gfx.prepare(group);
  onProgress(1, 'Ready');
  console.log(`world built in ${(performance.now() - t0).toFixed(0)}ms, ${city.lots.length} lots, ${city.props.length} props, ${city.trees.length} trees, collider tris ${idx.length / 3}`);
  return { ...city, group, materials, collider: colliderMesh, bvh: cg.boundsTree, update: (cam) => props.update(cam) };
}
