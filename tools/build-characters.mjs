// Converts the CC0 Quaternius source packs into compact runtime assets.
// Usage: node tools/build-characters.mjs <dir-with-extracted-packs>
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { prune, resample, dedup } from '@gltf-transform/functions';

const SRC = process.argv[2];
const OUT = path.resolve('public/assets/chars');
fs.mkdirSync(OUT, { recursive: true });

const OUTFITS = path.join(SRC, 'Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)/Outfits');
const BASE = path.join(SRC, 'Universal Base Characters[Standard]/Base Characters/Godot - UE');
const HAIR = path.join(SRC, 'Universal Base Characters[Standard]/Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)');
const OUTFIT_TEX = path.join(SRC, 'Modular Character Outfits - Fantasy[Standard]/Textures');

const texCache = new Map();
async function convertTexture(srcFile, size) {
  const base = path.basename(srcFile).replace(/_png\.png$/, '.png').replace(/\.png$/i, '');
  const outName = base + '.webp';
  if (texCache.has(outName)) return outName;
  texCache.set(outName, true);
  const isNormal = /normal/i.test(base);
  const img = sharp(srcFile);
  const meta = await img.metadata();
  const target = Math.min(size, meta.width);
  await img.resize(target, target, { kernel: 'lanczos3' })
    .webp({ quality: isNormal ? 92 : 86, alphaQuality: 90, effort: 5 })
    .toFile(path.join(OUT, outName));
  console.log('  tex', outName, meta.width, '->', target, meta.hasAlpha ? 'alpha' : '');
  return outName;
}

const MATERIALS = {};
async function convertGltf(dir, name, texSize = 2048) {
  const j = JSON.parse(fs.readFileSync(path.join(dir, name + '.gltf'), 'utf8'));
  // Textures are stripped from the glTF and loaded once at runtime (see materials.json) so that
  // outfits sharing an atlas also share GPU memory.
  const uriOf = async (texIndex) => {
    if (texIndex === undefined) return undefined;
    const img = j.images[j.textures[texIndex.index].source];
    let src = path.join(dir, decodeURIComponent(img.uri));
    if (!fs.existsSync(src)) src = src.replace(/_png\.png$/, '.png');
    const small = /Eye|Hair|Regular|Superhero/.test(img.uri) ? 1024 : texSize;
    return convertTexture(src, small);
  };
  for (const m of j.materials) {
    const pbr = m.pbrMetallicRoughness || {};
    MATERIALS[m.name] = {
      map: await uriOf(pbr.baseColorTexture), orm: await uriOf(pbr.metallicRoughnessTexture), normal: await uriOf(m.normalTexture),
      metalness: pbr.metallicFactor ?? 1, roughness: pbr.roughnessFactor ?? 1,
    };
    delete pbr.baseColorTexture; delete pbr.metallicRoughnessTexture; delete m.normalTexture; delete m.occlusionTexture; delete m.emissiveTexture;
  }
  delete j.images; delete j.textures; delete j.samplers;
  for (const b of j.buffers) {
    if (b.uri && !b.uri.startsWith('data:')) {
      fs.copyFileSync(path.join(dir, decodeURIComponent(b.uri)), path.join(OUT, name + '.bin'));
      b.uri = name + '.bin';
    }
  }
  fs.writeFileSync(path.join(OUT, name + '.gltf'), JSON.stringify(j));
  console.log('gltf', name);
}

for (const n of ['Male_Ranger', 'Female_Ranger', 'Male_Peasant', 'Female_Peasant']) await convertGltf(OUTFITS, n);
for (const n of ['Superhero_Male_FullBody', 'Superhero_Female_FullBody']) await convertGltf(BASE, n);
for (const n of ['Hair_Beard', 'Hair_Buzzed', 'Hair_Long', 'Hair_SimpleParted', 'Hair_Buns', 'Hair_BuzzedFemale', 'Eyebrows_Regular', 'Eyebrows_Female']) await convertGltf(HAIR, n);
// alternate colourways
await convertTexture(path.join(OUTFIT_TEX, 'Peasant/T_Peasant_2_BaseColor.png'), 2048);
await convertTexture(path.join(OUTFIT_TEX, 'Ranger/T_Ranger_3_BaseColor.png'), 2048);
await convertTexture(path.join(SRC, 'Universal Base Characters[Standard]/Base Characters/Textures/T_Superhero_Male_Ligh.png'), 1024);
await convertTexture(path.join(SRC, 'Universal Base Characters[Standard]/Base Characters/Textures/T_Superhero_Female_Light_BaseColor.png'), 1024);
fs.writeFileSync(path.join(OUT, 'materials.json'), JSON.stringify(MATERIALS, null, 1));
await convertTexture(path.join(BASE, 'T_Hair_2_BaseColor.png'), 1024);

// ---- animations: keep only the clips the game uses, strip the mannequin mesh
const KEEP = {
  'Universal Animation Library[Standard]/Unreal-Godot/UAL1_Standard.glb': [
    'Crouch_Fwd_Loop', 'Crouch_Idle_Loop', 'Death01', 'Hit_Chest', 'Hit_Head', 'Idle_Loop', 'Idle_Talking_Loop',
    'Interact', 'Jog_Fwd_Loop', 'Jump_Land', 'Jump_Loop', 'Jump_Start', 'Punch_Cross', 'Punch_Jab', 'Roll',
    'Sitting_Idle_Loop', 'Sitting_Talking_Loop', 'Sprint_Loop', 'Sword_Attack', 'Sword_Idle', 'Walk_Formal_Loop',
    'Walk_Loop', 'PickUp_Table', 'Push_Loop', 'Spell_Simple_Shoot', 'Dance_Loop', 'Fixing_Kneeling', 'A_TPose',
  ],
  'Universal Animation Library 2[Standard]/Unreal-Godot/UAL2_Standard.glb': [
    'ClimbUp_1m', 'Hit_Knockback', 'Idle_FoldArms_Loop', 'Idle_No_Loop', 'Idle_Rail_Loop', 'Idle_Rail_Call', 'Melee_Hook',
    'NinjaJump_Idle_Loop', 'NinjaJump_Land', 'NinjaJump_Start', 'OverhandThrow', 'Slide_Exit', 'Slide_Loop',
    'Slide_Start', 'Sword_Block', 'Sword_Dash', 'Sword_Heavy_Combo', 'Sword_Regular_A', 'Sword_Regular_A_Rec',
    'Sword_Regular_B', 'Sword_Regular_B_Rec', 'Sword_Regular_C', 'Sword_Regular_Combo', 'Walk_Carry_Loop', 'Yes',
    'LayToIdle', 'Idle_Shield_Loop', 'Zombie_Idle_Loop', 'Consume', 'Farm_Harvest', 'Idle_Lantern_Loop',
  ],
};
const io = new NodeIO();
let i = 0;
for (const [file, keep] of Object.entries(KEEP)) {
  const doc = await io.read(path.join(SRC, file));
  const root = doc.getRoot();
  for (const a of root.listAnimations()) if (!keep.includes(a.getName())) a.dispose();
  for (const n of root.listNodes()) { if (n.getMesh()) n.setMesh(null); n.setSkin(null); }
  for (const m of root.listMeshes()) m.dispose();
  for (const s of root.listSkins()) s.dispose();
  for (const m of root.listMaterials()) m.dispose();
  for (const t of root.listTextures()) t.dispose();
  await doc.transform(resample({ tolerance: 0.0005 }), prune({ keepLeaves: true }), dedup());
  const out = path.join(OUT, `anims${++i}.glb`);
  await io.write(out, doc);
  console.log('anims', out, root.listAnimations().map((a) => a.getName()).length, (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
}
