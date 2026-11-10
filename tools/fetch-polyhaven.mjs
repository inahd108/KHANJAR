// Downloads CC0 textures / models / sky from Poly Haven and converts them to compact runtime assets.
// Usage: node tools/fetch-polyhaven.mjs <cache-dir>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup, weld, simplify, textureCompress, join, flatten } from '@gltf-transform/functions';

const CACHE = path.resolve(process.argv[2] || '.ph-cache');
const OUT_TEX = path.resolve('public/assets/tex');
const OUT_MODELS = path.resolve('public/assets/models');
for (const d of [CACHE, OUT_TEX, OUT_MODELS]) fs.mkdirSync(d, { recursive: true });

function dl(url, dest) {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return dest;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  for (let i = 0; i < 4; i++) {
    try { execFileSync('curl', ['-sS', '-L', '--fail', '-m', '300', '-o', dest, url]); return dest; }
    catch (e) { console.log('retry', url); }
  }
  throw new Error('download failed ' + url);
}
const api = (p) => JSON.parse(execFileSync('curl', ['-sS', '-L', '--fail', '-m', '60', 'https://api.polyhaven.com' + p], { maxBuffer: 1 << 26 }).toString());

const TEXTURES = {
  large_sandstone_blocks_01: 2048, sandstone_blocks_08: 1024, white_sandstone_bricks_03: 1024, yellow_stone_wall: 1024,
  white_sandstone_blocks_02: 1024, seaworn_sandstone_brick: 1024, medieval_blocks_03: 1024,
  yellow_plaster: 1024, plaster_stone_wall_01: 1024, painted_plaster_wall: 1024, white_rough_plaster: 1024,
  cobblestone_floor_08: 2048, sandy_gravel: 1024, stone_tiles_02: 1024, weathered_planks: 1024, medieval_wood: 1024,
  fabric_pattern_07: 1024, clay_roof_tiles_02: 1024, palm_tree_bark: 1024, marble_01: 1024,
};
// `tris` = triangle budget after simplification (scatter props are drawn hundreds of times)
const MODELS = {
  kite_shield: { tex: 1024, tris: 3500 }, wooden_handle_saber: { tex: 1024, tris: 4000 }, ornate_medieval_dagger: { tex: 1024, tris: 4000 }, antique_estoc: { tex: 1024, tris: 4000 },
  wooden_crate_01: { tex: 512, tris: 500 }, wooden_crate_02: { tex: 512, tris: 500 }, wine_barrel_01: { tex: 512, tris: 700 }, ceramic_vase_01: { tex: 512, tris: 500 },
  ceramic_vase_03: { tex: 512, tris: 500 }, antique_ceramic_vase_01: { tex: 512, tris: 600 }, wicker_basket_01: { tex: 512, tris: 700 },
  brass_pot_01: { tex: 512, tris: 500 }, planter_pot_clay: { tex: 512, tris: 400 }, wooden_bucket_01: { tex: 512, tris: 500 }, wooden_ladder: { tex: 1024, tris: 1500 },
  wooden_table_02: { tex: 1024 }, wooden_stool_01: { tex: 512, tris: 600 }, wooden_lantern_01: { tex: 512, tris: 600 },
  brass_diya_lantern: { tex: 512, tris: 600 }, food_pomegranate_01: { tex: 256, tris: 160 }, carved_wooden_plate: { tex: 256, tris: 220 },
  large_castle_door: { tex: 1024, tris: 4000 },
};
const HDRI = process.env.HDRI || 'qwantani_late_afternoon_puresky';

// ---------- textures
for (const [name, size] of Object.entries(TEXTURES)) {
  const files = api('/files/' + name);
  const res = size > 1024 ? '2k' : '1k';
  const maps = { diff: files.Diffuse, nor: files.nor_gl, arm: files.arm };
  for (const [k, m] of Object.entries(maps)) {
    const out = path.join(OUT_TEX, `${name}_${k}.webp`);
    if (fs.existsSync(out)) continue;
    if (!m) { console.log('  missing', name, k); continue; }
    const src = dl(m[res].jpg.url, path.join(CACHE, 'tex', `${name}_${k}_${res}.jpg`));
    await sharp(src).resize(size, size).webp({ quality: k === 'nor' ? 90 : 84, effort: 5 }).toFile(out);
  }
  console.log('tex', name);
}

// ---------- sky
{
  const files = api('/files/' + HDRI);
  const hdr = dl(files.hdri['2k'].hdr.url, path.join(CACHE, 'hdri', HDRI + '_2k.hdr'));
  fs.copyFileSync(hdr, path.resolve('public/assets/sky.hdr'));
  console.log('sky', HDRI, (fs.statSync(hdr).size / 1e6).toFixed(1) + 'MB');
}

// ---------- models
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let MeshoptSimplifier = null;
try { ({ MeshoptSimplifier } = await import('meshoptimizer')); await MeshoptSimplifier.ready; } catch { console.log('meshoptimizer unavailable; no simplification'); }
for (const [name, opt] of Object.entries(MODELS)) {
  const out = path.join(OUT_MODELS, name + '.glb');
  if (fs.existsSync(out)) continue;
  const files = api('/files/' + name);
  const g = files.gltf['1k'].gltf;
  const dir = path.join(CACHE, 'models', name);
  const gltfPath = dl(g.url, path.join(dir, name + '.gltf'));
  for (const [rel, inc] of Object.entries(g.include)) dl(inc.url, path.join(dir, rel));
  const doc = await io.read(gltfPath);
  const tf = [dedup(), weld()];
  let tris = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) tris += (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  if (opt.tris && MeshoptSimplifier && tris > opt.tris * 1.15) tf.push(simplify({ simplifier: MeshoptSimplifier, ratio: opt.tris / tris, error: 0.03, lockBorder: false }));
  tf.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [opt.tex, opt.tex], quality: 84 }), prune());
  await doc.transform(...tf);
  await io.write(out, doc);
  let after = 0;
  for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) after += (prim.getIndices() ? prim.getIndices().getCount() : prim.getAttribute('POSITION').getCount()) / 3;
  console.log('model', name, tris, '->', after, 'tris', (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
}
