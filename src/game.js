// Game orchestration: world, actors, mission flow, alert state, time control.
import * as THREE from 'three';
import { Physics } from './physics.js';
import { Input } from './input.js';
import { Player } from './player.js';
import { CameraRig } from './camera.js';
import { NpcManager, Nav } from './npc.js';
import { Fx } from './fx.js';
import { Hud } from './hud.js';
import { AudioSystem } from './audio.js';
import { XS, ZS } from './world/city.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const rand = (a, b) => a + Math.random() * (b - a);

export class Game {
  constructor(gfx, world, uiRoot) {
    this.gfx = gfx; this.world = world;
    this.qualityName = gfx.qualityName;
    this.physics = new Physics(world.bvh);
    this.input = new Input(gfx.renderer.domElement);
    this.audio = new AudioSystem();
    this.fx = new Fx(gfx);
    this.cam = new CameraRig(gfx.camera, this.physics);
    this.time = 0; this.timeScale = 1; this.hitStopT = 0; this.slowT = 0; this.slowScale = 1;
    this.state = 'menu'; this.phase = 'find';
    this.softZones = [];
    this.buildNav();
    this.npcs = new NpcManager(this);
    gfx.scene.add(this.npcs.group);
    this.player = new Player(this);
    gfx.scene.add(this.player.root); gfx.prepare(this.player.root);
    this.hud = new Hud(uiRoot, this);
    this.combat = { playerStrike: (p, o) => this.playerStrike(p, o) };
    this.combatTimer = 0; this.huntedTimer = 0; this.detectedOnce = false; this.missionTime = 0;
    this.hintsShown = new Set();
    this.timers = [];
    this.placeStart();
    this.spawnActors();
    this.input.onLockChange = (locked) => { if (!locked && this.state === 'play') this.pauseGame(); };
    addEventListener('keydown', (e) => { if (e.code === 'Escape' && this.state === 'paused') this.resume(); });
    this.enterMenu();
  }

  // ------------------------------------------------------------------------------------------ setup
  buildNav() {
    const nodes = this.world.nav.nodes.map((n) => ({ ...n, links: [...n.links] }));
    const add = (x, z, restricted) => { const n = { id: nodes.length, x, z, links: [], restricted }; nodes.push(n); return n; };
    const link = (a, b) => { a.links.push(b.id); b.links.push(a.id); };
    const near = (x, z) => nodes.reduce((b, n) => ((n.x - x) ** 2 + (n.z - z) ** 2 < (b.x - x) ** 2 + (b.z - z) ** 2 ? n : b), nodes[0]);
    // citadel gate + yard
    const c = this.world.points.citadel;
    const street = near(c.gate.x, c.gate.z);
    const g1 = add(c.gate.x - 4.5, c.gate.z, true), g2 = add(c.yard.x + 8, c.yard.z, true), g3 = add(c.yard.x - 6, c.yard.z, true);
    link(street, g1); link(g1, g2); link(g2, g3);
    this.nav = new Nav(nodes);
    const Z = this.world.zones.citadel;
    this.restricted = { x0: Z.x0 - 1, x1: Z.x1 + 1, z0: Z.z0 - 1, z1: Z.z1 + 1 };
  }

  inRestricted(p) { const r = this.restricted; return p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1 && p.y < 16; }

  placeStart() {
    const s = this.world.spawn;
    this.spawnPoint = { x: s.x, y: s.y, z: s.z, yaw: s.ry };
    this.player.place(s.x, s.y, s.z, s.ry);
    this.player.setState('perch');
    // a broad canopy stretched below the lookout beam breaks the fall: the safe way down
    const L0 = 2.4, L1 = 12.5, HW = 3.2;
    let top = 0; const groundAt = (t, side) => { const h = this.physics.raycast(_v.set(s.tipX + s.dx * t - s.dz * side, s.y - 1, s.tipZ + s.dz * t + s.dx * side), DOWN, 60); return h ? h.point.y : 0; };
    for (const t of [L0 + 1, (L0 + L1) / 2, L1 - 1]) for (const side of [-HW * 0.6, 0, HW * 0.6]) top = Math.max(top, groundAt(t, side));
    top = Math.min(top, s.y - 7);
    const cy = top + 2.5; const mid = (L0 + L1) / 2;
    const cxm = s.tipX + s.dx * mid, czm = s.tipZ + s.dz * mid;
    const g = new THREE.Group();
    const geo = new THREE.PlaneGeometry(HW * 2, L1 - L0, 10, 14); geo.rotateX(-Math.PI / 2);
    const pa = geo.attributes.position; const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i) / HW, z = pa.getZ(i) / ((L1 - L0) / 2);
      pa.setY(i, -0.55 * (1 - x * x) * (1 - z * z));
      const stripe = Math.floor((pa.getX(i) + HW) / 0.8) % 2; const c = stripe ? [0.50, 0.11, 0.10] : [0.86, 0.78, 0.62];
      col.set(c, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.computeVertexNormals();
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }));
    g.add(cloth);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5f4630, roughness: 0.9 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const lx = sx * HW, lz = sz * (L1 - L0) / 2;
      const wx = cxm - s.dz * lx + s.dx * lz, wz = czm + s.dx * lx + s.dz * lz;
      const hit = this.physics.raycast(_v.set(wx, cy + 0.5, wz), DOWN, 60); const gy = hit ? hit.point.y : 0;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, cy - gy + 0.25, 8), wood);
      pole.position.set(lx, -(cy - gy) / 2 + 0.12, lz); g.add(pole);
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    g.position.set(cxm, cy, czm); g.rotation.y = Math.atan2(s.dx, s.dz);
    this.gfx.scene.add(g); this.gfx.prepare(g);
    this.softZones.push({ x: cxm, z: czm, dx: s.dx, dz: s.dz, halfLen: (L1 - L0) / 2 + 0.6, halfWid: HW + 0.5, y: cy - 0.3 });
    this.safehouse = this.world.points.safehouse;
  }

  spawnActors() {
    const w = this.world, pts = w.points, npcs = this.npcs, c = pts.citadel;
    let v = 0;
    // --- the castellan on his dais
    const cp = pts.castellan;
    this.target = npcs.add('captain', cp.x, cp.y, cp.z, { yaw: cp.ry, post: { x: cp.x, z: cp.z, ry: cp.ry, sweep: 0.7 }, isTarget: true, name: 'Castellan Reynaud', restricted: true, idleAnim: 'Idle_FoldArms_Loop' });
    // --- citadel garrison
    for (const p of c.posts) npcs.add('guard', p.x, 0, p.z, { variant: v++, yaw: p.ry, post: { x: p.x, z: p.z, ry: p.ry, sweep: 0.45 }, restricted: true });
    c.patrol.forEach((route, i) => { for (let k = 0; k < 2; k++) { const s = route[(k * 2) % route.length]; const g = npcs.add('guard', s.x + k, 0, s.z, { variant: v++, route, restricted: true }); g.routeIndex = (k * 2 + 1) % route.length; } });
    for (const route of c.wallWalk) { const s = route[0]; npcs.add('guard', s.x, s.y, s.z, { variant: v++, route, fixedY: s.y, restricted: true, walkSpeed: 1.2 }); }
    // --- street patrols: pairs walking loops around city blocks
    const node = (i, j) => w.nav.nodes.find((n) => n.i === i && n.j === j);
    const loops = [[3, 4], [5, 6], [2, 6], [6, 3], [4, 7], [1, 4], [7, 6]];
    for (const [i, j] of loops) {
      const quad = [node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)];
      if (quad.some((n) => !n)) continue;
      const route = quad.map((n) => ({ x: n.x, z: n.z }));
      for (let k = 0; k < 2; k++) { const g = npcs.add('guard', route[0].x + k * 1.1, 0, route[0].z + k * 0.6, { variant: v++, route: route.map((p) => ({ x: p.x + k * 1.0, z: p.z + k * 0.7 })), walkSpeed: 1.4 }); g.routeIndex = 1; }
    }
    // --- rooftop sentries on flat roofs near the citadel and the market
    const roofs = w.roofs.filter((r) => r.lot && !r.lot.special && r.y > 5.5 && r.y < 11 && (r.x1 - r.x0) > 8 && (r.z1 - r.z0) > 8);
    const wanted = [[-70, -70], [-60, -20], [-30, -40], [20, -10], [-70, 20], [30, 40]];
    for (const [x, z] of wanted) {
      const r = roofs.reduce((b, q) => { const d = Math.hypot((q.x0 + q.x1) / 2 - x, (q.z0 + q.z1) / 2 - z); return !b || d < b.d ? { q, d } : b; }, null);
      if (!r || r.d > 40 || r.q.used) continue; r.q.used = true;
      const q = r.q; const px = q.x0 + 1.4, pz = q.z0 + 1.4;
      npcs.add('guard', px, q.y, pz, { variant: v++, yaw: rand(0, 6), post: { x: px, z: pz, ry: rand(0, 6), sweep: 1.3 }, fixedY: q.y, idleAnim: 'Idle_FoldArms_Loop' });
    }
    // --- townsfolk
    const civNodes = this.nav.nodes.filter((n) => !n.restricted && Math.abs(n.x) < 140 && Math.abs(n.z) < 140);
    let cv = 0;
    // the souk and the plaza draw the biggest crowds
    const busy = civNodes.filter((n) => Math.abs(n.z - 6) < 2 && n.x > -90 && n.x < 75);
    for (let i = 0; i < 46; i++) {
      const pool = i < 20 && busy.length ? busy : civNodes;
      const n = pool[Math.floor(Math.random() * pool.length)];
      const civ = npcs.add('civilian', n.x + rand(-1.5, 1.5), 0, n.z + rand(-1.5, 1.5), { variant: cv++, navNode: n.id, yaw: rand(0, 6) });
      civ.carry = Math.random() < 0.15;
    }
    // stall keepers
    for (const s of (pts.stalls || []).filter((_, i) => i % 2 === 0).slice(0, 12)) {
      const civ = npcs.add('civilian', s.x, 0, s.z + s.side * 0.95, { variant: cv++, yaw: s.side === 1 ? Math.PI : 0 });
      civ.activity = { anim: Math.random() < 0.5 ? 'Idle_Talking_Loop' : 'Idle_Loop', t: 1, forever: true, face: { x: s.x, z: s.z - s.side * 3 } };
    }
    // people talking in the plaza and on the sanctuary platform
    const groups = [[pts.fountain.x + 5.5, 0.06, pts.fountain.z + 4], [pts.fountain.x - 6, 0.06, pts.fountain.z - 3], [pts.shrine.x - 4, pts.shrine.y, pts.shrine.z + 22], [pts.shrine.x + 16, pts.shrine.y, pts.shrine.z + 18], [pts.shrine.x - 22, pts.shrine.y, pts.shrine.z + 6]];
    for (const [x, y, z] of groups) {
      const a = rand(0, 6);
      for (let k = 0; k < 2; k++) {
        const px = x + Math.cos(a + k * Math.PI) * 0.6, pz = z + Math.sin(a + k * Math.PI) * 0.6;
        const civ = npcs.add('civilian', px, y, pz, { variant: cv++, fixedY: y });
        civ.activity = { anim: k ? 'Idle_Talking_Loop' : 'Idle_Loop', t: 1, forever: true, face: { x, z } };
      }
    }
  }

  // ------------------------------------------------------------------------------------------ flow
  enterMenu() {
    this.state = 'menu';
    const p = this.player.pos;
    this.cam.mode = 'orbit';
    const s = this.world.spawn; const back = Math.atan2(-s.dx, -s.dz);
    // sit behind and to the left of the hero, looking past him at the great dome
    Object.assign(this.cam.orbit, { centre: new THREE.Vector3(p.x, p.y + 1.0, p.z), radius: 5.2, height: 1.5, speed: 0, base: back - 0.3, swing: 0.12, angle: back - 0.3, fov: 44, look: new THREE.Vector3(p.x + s.dx * 9 + s.dz * 4.6, p.y + 0.7, p.z + s.dz * 9 - s.dx * 4.6) });
    this.hud.show('menu');
    this.input.enabled = false;
  }

  onMenu(act) {
    if (act === 'start') this.begin();
    else if (act === 'resume') this.resume();
    else if (act === 'retry') this.retry();
    else if (act === 'restart' || act === 'again') location.reload();
    else if (act === 'mute') { this.muted = !this.muted; this.audio.setMuted(this.muted); this.hud.setMuted(this.muted); }
  }

  begin() {
    this.audio.unlock();
    this.state = 'play'; this.input.enabled = true; this.input.lock();
    const sp = this.world.spawn; this.cam.mode = 'follow'; this.cam.yaw = Math.atan2(-sp.dx, -sp.dz); this.cam.pitch = 0.2; this.cam.snap(this.player);
    this.hud.show(null);
    this.setPhase('find');
    this.hud.banner('Jerusalem · 1187', 'The Castellan\'s Due');
    this.audio.play('objective');
    this.after(5.2, () => { if (this.player.state === 'perch') this.hud.hint('Move to leave your perch — leap onto the <b>canopy</b> below, or climb down the tower', 9); });
  }

  setPhase(phase) {
    this.phase = phase;
    if (phase === 'find') { this.hud.setObjective('Reach the citadel and end <b>Castellan Reynaud</b>'); }
    if (phase === 'escape') { this.hud.setObjective('Vanish. Return to the <b>watch-tower roof</b>'); this.hud.banner('It is done', 'Now disappear'); this.audio.play('objective'); }
  }

  get objectivePos() {
    if (this.phase === 'find' && this.target && !this.target.dead) return { x: this.target.pos.x, y: this.target.pos.y, z: this.target.pos.z };
    if (this.phase === 'escape') return { x: this.safehouse.x, y: this.safehouse.y, z: this.safehouse.z, beacon: true };
    return null;
  }

  pauseGame() { if (this.state !== 'play') return; this.state = 'paused'; this.hud.show('pause'); this.audio.setState({ paused: true }); }
  resume() { if (this.state !== 'paused') return; this.state = 'play'; this.hud.show(null); this.input.lock(); this.audio.setState({ paused: false }); }
  setQuality(q) { if (q === this.qualityName) return; localStorage.setItem('khanjar.quality', q); location.reload(); }

  onLeavePerch() { this.hint('climb', 'Sprint (<b>Shift</b>) into any wall to climb it — <b>C</b> lets go, <b>Space</b> leaps off', 8); }
  hint(id, text, time) { if (this.hintsShown.has(id)) return; this.hintsShown.add(id); this.hud.hint(text, time); }

  onPlayerHurt(a) { this.hud.hurtFlash(Math.min(0.8, a / 40)); this.gfx.grade.uniforms.get('uPulse').value = Math.min(1, a / 30); }
  onPlayerDeath() { this.state = 'dying'; this.after(2.3, () => { this.state = 'dead'; this.hud.show('death'); this.input.unlock(); this.audio.play('fail'); }); }
  retry() {
    // back to the perch; the garrison calms down, the dead stay dead
    const s = this.spawnPoint;
    for (const n of this.npcs.npcs) if (!n.dead && n.hostileKind) { n.awareness = 0; n.attack = null; n.setState('patrol'); n.goHome(); }
    this.npcs.tokens.clear();
    this.player.revive(s.x, s.y, s.z, s.yaw); this.player.setState('perch');
    this.state = 'play'; this.hud.show(null); this.input.lock(); this.cam.snap(this.player);
  }

  onGuardAlerted(n) { this.detectedOnce = true; this.hint('fight', '<b>Left mouse</b> to strike &middot; hold <b>Right mouse</b> to block — block just before a blow to parry, then <b>F</b>', 8); }
  onBodyFound() { this.hud.hint('A body has been found', 3); }
  onKill(npc, type) {
    if (npc.isTarget && this.phase === 'find') this.after(1.4, () => this.setPhase('escape'));
  }

  combatNearby() { return this.combatTimer > 0; }
  get hunted() { return this.huntedTimer > 0; }
  get alertState() { return this.npcs.anyCombat ? 'hunted' : (this.npcs.anySearch ? 'search' : 'calm'); }

  /** run fn after `sec` seconds of game time (so it pauses and slows with the game) */
  after(sec, fn) { this.timers.push({ t: sec, fn }); }
  hitStop(sec) { this.hitStopT = Math.max(this.hitStopT, sec); }
  slowMo(scale, sec) { this.slowScale = scale; this.slowT = sec; }

  playerStrike(player, { range, arc, damage, heavy }) {
    const f = player.forward; let any = false;
    for (const n of this.npcs.npcs) {
      if (n.dead || n.victim) continue;
      const dx = n.pos.x - player.pos.x, dz = n.pos.z - player.pos.z, d = Math.hypot(dx, dz);
      if (d > range || Math.abs(n.pos.y - player.pos.y) > 1.6) continue;
      if (d > 0.6 && Math.acos(Math.max(-1, Math.min(1, (dx * f.x + dz * f.z) / d))) > arc) continue;
      if (!n.hostileKind) { n.panic(player.pos); continue; }
      const res = n.receiveStrike(player, damage, heavy);
      _v.set(n.pos.x - dx / Math.max(d, 0.01) * 0.35, n.pos.y + 1.25, n.pos.z - dz / Math.max(d, 0.01) * 0.35);
      if (res === 'blocked') { this.audio.play('clang', { pos: n.pos }); this.fx.sparks(_v, 12); this.cam.shake(0.22); this.hitStop(0.05); }
      else if (res === 'hit' || res === 'killed') {
        this.audio.play('hitFlesh', { pos: n.pos }); this.fx.blood(_v, res === 'killed' ? 12 : 6); this.cam.shake(heavy ? 0.5 : 0.3); this.hitStop(heavy ? 0.1 : 0.065);
        if (res === 'killed') { player.stats.combatKills++; player.lastKillTime = this.time; this.onKill(n, 'combat'); this.slowMo(0.35, 0.3); }
      }
      any = true;
    }
    return any;
  }

  // ------------------------------------------------------------------------------------------ frame
  update(realDt) {
    let dt = realDt;
    if (this.hitStopT > 0) { this.hitStopT -= realDt; dt = realDt * 0.04; }
    else if (this.slowT > 0) { this.slowT -= realDt; dt = realDt * this.slowScale; }
    const p = this.player;
    if (this.state === 'menu') {
      this.time += dt;
      p.update(dt); this.npcs.update(dt); this.fx.update(dt, this.time, p.pos);
      this.cam.update(dt, p, null);
    } else if (this.state === 'play' || this.state === 'dying') {
      this.time += dt; this.missionTime += dt;
      for (let i = this.timers.length - 1; i >= 0; i--) { const tm = this.timers[i]; tm.t -= dt; if (tm.t <= 0) { this.timers.splice(i, 1); tm.fn(); } }
      p.update(dt);
      this.npcs.update(dt);
      const combat = this.npcs.anyCombat;
      this.combatTimer = combat ? 2.5 : Math.max(0, this.combatTimer - dt);
      this.huntedTimer = combat ? 9 : Math.max(0, this.huntedTimer - dt);
      p.prompt = this.state === 'play' ? p.findTakedown() : null;
      if (p.prompt) this.hint('takedown', p.prompt.type === 'air' ? 'Press <b>F</b> to leap onto the guard below' : 'Press <b>F</b> for a silent strike', 5);
      // the canopy catches a falling body and lets it down gently
      if (p.state === 'air' && p.vel.y < -5) for (const z of this.softZones) {
        const rx = p.pos.x - z.x, rz = p.pos.z - z.z; const along = rx * z.dx + rz * z.dz, across = -rx * z.dz + rz * z.dx;
        if (Math.abs(along) < z.halfLen && Math.abs(across) < z.halfWid && p.pos.y < z.y + 0.5 && p.pos.y > z.y - 1.4) {
          p.vel.set(p.vel.x * 0.25, -1.2, p.vel.z * 0.25); p.fallStart = p.pos.y;
          this.fx.dust(_v.set(p.pos.x, z.y, p.pos.z), 14); this.audio.play('cloth', { pos: p.pos }); this.audio.play('land', { pos: p.pos, volume: 0.6 }); this.cam.shake(0.3);
          this.hint('city', 'Guards ignore a calm walker — running, climbing and bare steel draw their eyes', 8);
        }
      }
      this.fx.update(dt, this.time, p.pos);
      this.cam.update(realDt, p, this.input, { combat: combat && p.state !== 'takedown' });
      this.updateMission(dt);
      this.hud.update(realDt);
      const crowd = Math.max(0, 1 - Math.hypot(p.pos.x + 8, p.pos.z - 4) / 70);
      this.audio.setState({ combat, tension: Math.max(this.npcs.maxAwareness * 0.7, this.npcs.anySearch ? 0.6 : 0), height: Math.max(0, p.pos.y), speed: p.speed, crowd });
    } else if (this.state === 'paused' || this.state === 'dead' || this.state === 'complete') {
      this.cam.update(0, p, null);
    }
    _v.set(-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw));
    this.audio.setListener(this.gfx.camera.position, _v);
    this.audio.update(realDt);
    const pulse = this.gfx.grade.uniforms.get('uPulse'); pulse.value = Math.max(0, pulse.value - realDt * 1.6);
    const desat = this.gfx.grade.uniforms.get('uDesat'); desat.value += ((p.dead ? 0.8 : 0) - desat.value) * Math.min(1, realDt * 2);
    this.world.update(this.gfx.camera.position);
    this.input.endFrame();
  }

  updateMission(dt) {
    const p = this.player;
    if (this.phase === 'escape' && this.state === 'play') {
      const s = this.safehouse;
      if (Math.hypot(p.pos.x - s.x, p.pos.z - s.z) < 4.5 && Math.abs(p.pos.y - s.y) < 2 && !this.npcs.anyCombat) this.completeMission();
    }
    if (this.phase === 'find' && this.inRestricted(p.pos)) this.hint('restricted', 'The citadel is forbidden ground — stay out of sight, or strike from above', 7);
  }

  completeMission() {
    this.state = 'complete'; this.phase = 'done';
    const p = this.player, st = p.stats;
    const m = Math.floor(this.missionTime / 60), s = Math.floor(this.missionTime % 60);
    const rank = !this.detectedOnce ? 'A whisper on the wind — never seen' : st.hitsTaken === 0 ? 'Untouched' : 'Blood and dust';
    this.hud.showStats(`<span>Time</span><span>${m}:${String(s).padStart(2, '0')}</span><span>Silent strikes</span><span>${st.stealthKills}</span><span>Leap strikes</span><span>${st.airKills}</span><span>Duels won</span><span>${st.combatKills}</span><span class="rank">${rank}</span>`);
    this.hud.show('complete'); this.input.unlock(); this.audio.play('missionComplete');
  }
}
