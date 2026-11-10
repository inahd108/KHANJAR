// The player character: locomotion, free-climbing, sword combat and takedowns.
import * as THREE from 'three';
import { createHero } from './cast.js';
import { solveTwoBoneIK } from './characters.js';

const V = () => new THREE.Vector3();
const _fwd = V(), _right = V(), _dir = V(), _tmp = V(), _tmp2 = V(), _origin = V(), _n = V();
const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export const SPEED = { walk: 1.7, jog: 4.3, sprint: 7.4, crouch: 1.9, climb: 2.3, block: 1.5 };

// the three-hit combo is one continuous authored clip, split into segments
const COMBO = [
  { start: 0.0, hit: 0.25, end: 0.5, damage: 34, lunge: 2.6, sfx: 'swing' },
  { start: 0.5, hit: 0.73, end: 1.18, damage: 34, lunge: 2.2, sfx: 'swing' },
  { start: 1.18, hit: 1.55, end: 2.35, damage: 60, lunge: 3.4, sfx: 'swingHeavy' },
];

export class Player {
  constructor(game) {
    this.game = game;
    this.char = createHero();
    this.root = this.char.root;
    this.body = { pos: V(), vel: V(), radius: 0.32, height: 1.78, onGround: true, hitWall: false };
    this.pos = this.body.pos; this.vel = this.body.vel;
    this.yaw = 0;
    this.state = 'ground'; this.stateTime = 0;
    this.health = 100; this.maxHealth = 100; this.dead = false;
    this.armed = false; this.crouching = false;
    this.airTime = 0; this.fallStart = 0; this.stepAcc = 0;
    this.combo = { index: 0, queued: false, hitDone: false };
    this.blockTime = 0; this.invuln = 0; this.regenDelay = 0;
    this.climb = { normal: V(), phase: 0, holds: null, mantleFrom: V(), mantleTo: V(), mantleT: 0 };
    this.takedown = null;
    this.speed = 0; // horizontal speed, for audio / AI
    this.profile = 0; // 0 calm, 1 conspicuous, 2 unlawful (set every frame)
    this.lastKillTime = -99;
    this.stats = { stealthKills: 0, airKills: 0, combatKills: 0, hitsTaken: 0 };
    this.prompt = null;
    this.targetYaw = 0;
    this.char.play('Idle_Loop', { fade: 0 });
  }

  place(x, y, z, yaw = 0) { this.pos.set(x, y, z); this.vel.set(0, 0, 0); this.yaw = yaw; this.root.position.copy(this.pos); this.root.rotation.y = yaw; }

  setState(s) { this.state = s; this.stateTime = 0; }
  get forward() { return _tmp2.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get chest() { return V().set(this.pos.x, this.pos.y + (this.crouching ? 0.9 : 1.3), this.pos.z); }
  get busy() { return this.state === 'takedown' || this.state === 'dead' || this.state === 'mantle' || this.state === 'perch'; }
  get inCombatStance() { return this.armed; }

  setArmed(on, silent = false) {
    if (this.armed === on) return;
    this.armed = on;
    this.char.setWeapon(on ? 'sword' : 'none');
    if (!silent) this.game.audio.play(on ? 'drawSword' : 'sheathe', { pos: this.pos });
  }

  // ------------------------------------------------------------------------------------------ update
  update(dt) {
    const g = this.game, input = g.input;
    this.stateTime += dt;
    this.invuln = Math.max(0, this.invuln - dt);
    // camera-relative movement basis
    const ax = input.axes();
    _fwd.set(-Math.sin(g.cam.yaw), 0, -Math.cos(g.cam.yaw));
    _right.set(-_fwd.z, 0, _fwd.x);
    _dir.set(0, 0, 0).addScaledVector(_fwd, ax.y).addScaledVector(_right, ax.x);
    const moving = _dir.lengthSq() > 0.01;
    if (moving) _dir.normalize();

    switch (this.state) {
      case 'perch': this.updatePerch(dt, moving); break;
      case 'ground': this.updateGround(dt, moving, ax); break;
      case 'air': this.updateAir(dt, moving); break;
      case 'climb': this.updateClimb(dt, ax); break;
      case 'mantle': this.updateMantle(dt); break;
      case 'roll': this.updateRoll(dt); break;
      case 'attack': this.updateAttack(dt, moving); break;
      case 'block': this.updateBlock(dt, moving); break;
      case 'hit': this.updateHit(dt); break;
      case 'takedown': this.updateTakedown(dt); break;
      case 'dead': this.vel.x = damp(this.vel.x, 0, 8, dt); this.vel.z = damp(this.vel.z, 0, 8, dt); g.physics.move(this.body, dt); break;
    }

    // health regeneration out of combat
    this.regenDelay -= dt;
    if (!this.dead && this.regenDelay <= 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + dt * 6);
    // fell out of the world safeguard
    if (this.pos.y < -30) this.place(g.world.spawn.x, g.world.spawn.y + 1, g.world.spawn.z);

    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.updateProfile();
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this.char.update(dt);
    if (this.state === 'climb') this.applyClimbIK(dt);
    this.updateTrail(dt);
  }

  updateProfile() {
    const g = this.game;
    let p = 0;
    const roof = this.pos.y > 2.6 && this.state !== 'air';
    if (this.speed > 5.5 || roof || this.armed || this.crouching) p = 1;
    if (this.state === 'climb' || this.state === 'mantle' || this.state === 'attack' || this.state === 'takedown' || g.inRestricted(this.pos) || g.time - this.lastKillTime < 4) p = 2;
    this.profile = p;
  }

  // ------------------------------------------------------------------------------------------ ground
  updatePerch(dt, moving) {
    this.char.play('Crouch_Idle_Loop', { fade: 0.3 });
    this.vel.set(0, 0, 0);
    if (moving || this.game.input.hit('Space')) { this.setState('ground'); this.game.onLeavePerch(); }
  }

  updateGround(dt, moving, ax) {
    const g = this.game, input = g.input;
    if (input.hit('KeyC')) {
      if (g.combatNearby() && moving) { this.startRoll(); return; }
      this.crouching = !this.crouching;
    }
    if (input.hit('KeyQ')) this.setArmed(!this.armed);
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    if (sprint && moving) this.crouching = false;
    let target = 0;
    if (moving) target = this.crouching ? SPEED.crouch : input.down('AltLeft') ? SPEED.walk : sprint ? SPEED.sprint : SPEED.jog;
    const accel = moving ? 11 : 14;
    this.vel.x = damp(this.vel.x, _dir.x * target, accel, dt);
    this.vel.z = damp(this.vel.z, _dir.z * target, accel, dt);
    if (moving) this.yaw += angDiff(this.yaw, Math.atan2(_dir.x, _dir.z)) * (1 - Math.exp(-13 * dt));

    // actions
    if (input.hit('KeyF') && this.tryTakedown()) return;
    if (input.mouse.leftPressed) { if (this.prompt && this.prompt.type !== 'air' && !this.armed && this.tryTakedown()) return; this.startAttack(); return; }
    if (input.mouse.right && this.armed) { this.setState('block'); this.blockTime = 0; this.char.play('Sword_Block', { fade: 0.08, loop: false, force: true }); return; }
    if (input.hit('Space')) {
      if (moving && this.tryGrabWall(true)) return;
      this.vel.y = sprint ? 7.9 : 7.3;
      this.body.onGround = false;
      this.setState('air'); this.airTime = 0; this.fallStart = this.pos.y;
      this.char.play('Jump_Start', { fade: 0.08, loop: false, speed: 1.5, startAt: 0.25, force: true });
      g.audio.play('jump', { pos: this.pos });
      return;
    }

    g.physics.move(this.body, dt);
    if (!this.body.onGround) {
      this.airTime += dt;
      if (this.airTime > 0.12) { this.setState('air'); this.fallStart = this.pos.y; this.char.play('Jump_Loop', { fade: 0.2 }); return; }
    } else this.airTime = 0;

    // run up walls: sprinting straight into a wall starts a climb
    if (moving && sprint && this.body.hitWall && this.tryGrabWall(false)) return;

    // locomotion animation
    const sp = Math.hypot(this.vel.x, this.vel.z);
    const c = this.char;
    if (this.crouching) { if (sp < 0.25) c.play('Crouch_Idle_Loop', { fade: 0.2 }); else c.play('Crouch_Fwd_Loop', { fade: 0.2, speed: clamp(sp / 1.35, 0.6, 1.8) }); }
    else if (sp < 0.25) c.play(this.armed ? 'Sword_Idle' : 'Idle_Loop', { fade: 0.22 });
    else if (sp < 2.7) c.play('Walk_Loop', { fade: 0.2, speed: clamp(sp / 1.45, 0.6, 1.7) });
    else if (sp < 5.8) c.play('Jog_Fwd_Loop', { fade: 0.2, speed: clamp(sp / 4.0, 0.7, 1.3) });
    else c.play('Sprint_Loop', { fade: 0.18, speed: clamp(sp / 6.6, 0.8, 1.25) });

    // footsteps
    this.stepAcc += sp * dt;
    const stride = sp > 5.8 ? 2.1 : sp > 2.7 ? 1.5 : 0.85;
    if (this.stepAcc > stride) { this.stepAcc = 0; g.audio.play(this.crouching ? 'stepSoft' : 'step', { pos: this.pos, volume: sp > 5.8 ? 1 : 0.7 }); if (sp > 5.8) g.fx.dust(this.pos, 2); }
  }

  // ------------------------------------------------------------------------------------------ air
  updateAir(dt, moving) {
    const g = this.game, input = g.input;
    this.airTime += dt;
    if (moving) {
      this.vel.x = damp(this.vel.x, _dir.x * Math.max(3.5, Math.hypot(this.vel.x, this.vel.z)), 2.2, dt);
      this.vel.z = damp(this.vel.z, _dir.z * Math.max(3.5, Math.hypot(this.vel.x, this.vel.z)), 2.2, dt);
      this.yaw += angDiff(this.yaw, Math.atan2(_dir.x, _dir.z)) * (1 - Math.exp(-6 * dt));
    }
    const vy = this.vel.y;
    if (this.stateTime > 0.25 || vy < 0) this.char.play('Jump_Loop', { fade: 0.25 });
    if (input.hit('KeyF') && this.tryTakedown()) return;
    g.physics.move(this.body, dt, { snap: false });
    // catch walls / ledges while airborne
    if ((moving || input.down('Space')) && this.vel.y < 4.5 && this.airTime > 0.12 && this.tryGrabWall(false)) return;
    if (this.body.onGround) {
      const fall = this.fallStart - this.pos.y; const impact = -vy;
      this.setState('ground'); this.airTime = 0;
      if (impact > 19) { this.damage(impact > 25 ? 200 : (impact - 16) * 9, null, true); g.audio.play('landHeavy', { pos: this.pos }); g.fx.dust(this.pos, 10); g.cam.shake(0.5); if (!this.dead) this.startRoll(true); }
      else if (impact > 11.5 && Math.hypot(this.vel.x, this.vel.z) > 2) { g.audio.play('land', { pos: this.pos }); g.fx.dust(this.pos, 6); this.startRoll(true); }
      else { g.audio.play('land', { pos: this.pos, volume: clamp(impact / 12, 0.3, 1) }); if (impact > 6) g.fx.dust(this.pos, 4); this.char.play('Jump_Land', { fade: 0.08, loop: false, startAt: 0.12, speed: 1.6, force: true }); this.landLock = 0.16; }
    }
  }

  startRoll(fromLanding = false) {
    const g = this.game;
    this.setState('roll'); this.crouching = false;
    let dir = this.forward.clone();
    if (!fromLanding && _dir.lengthSq() > 0.01) { dir.copy(_dir); this.yaw = Math.atan2(dir.x, dir.z); }
    this.rollDir = dir;
    this.invuln = 0.45;
    this.char.play('Roll', { fade: 0.08, loop: false, speed: 1.75, startAt: 0.1, force: true });
    g.audio.play('roll', { pos: this.pos });
  }

  updateRoll(dt) {
    const t = this.stateTime; const sp = 7.2 * Math.max(0.25, 1 - t / 0.75);
    this.vel.x = this.rollDir.x * sp; this.vel.z = this.rollDir.z * sp;
    this.game.physics.move(this.body, dt);
    if (t > 0.7) this.setState(this.body.onGround ? 'ground' : 'air');
  }

  // ------------------------------------------------------------------------------------------ climbing
  /** look for a climbable wall in front of the chest; begin climbing if found */
  tryGrabWall(fromGround) {
    const g = this.game;
    const dir = _tmp.copy(_dir.lengthSq() > 0.01 ? _dir : this.forward);
    for (const h of [1.25, 0.6, 1.75]) {
      _origin.set(this.pos.x, this.pos.y + h, this.pos.z);
      const hit = g.physics.raycast(_origin, dir, 0.75);
      if (!hit || Math.abs(hit.normal.y) > 0.35) continue;
      // needs to be a real wall: something to hold above knee height
      _n.set(hit.normal.x, 0, hit.normal.z).normalize();
      if (_n.dot(dir) > -0.45) continue;
      // don't "climb" a wall whose top is reachable by a plain step
      const top = this.findLedge(_n, 0.0);
      if (fromGround && top !== null && top - this.pos.y < 0.55) continue;
      this.climb.normal.copy(_n);
      this.pos.x = hit.point.x + _n.x * 0.36; this.pos.z = hit.point.z + _n.z * 0.36;
      this.vel.set(0, 0, 0);
      this.setState('climb'); this.crouching = false; this.climb.phase = 0; this.climb.holds = null;
      if (this.armed) this.setArmed(false, true);
      this.yaw = Math.atan2(-_n.x, -_n.z);
      this.char.play('Idle_Loop', { fade: 0.15 });
      g.audio.play('climbGrab', { pos: this.pos });
      if (top !== null && top - this.pos.y < 1.15) this.startMantle(top);
      return true;
    }
    return false;
  }

  /** height of the top of the wall we are on (within reach), or null */
  findLedge(n, extraUp = 0) {
    const g = this.game;
    // walk a probe up the wall until the forward ray stops hitting, then drop down onto the ledge
    for (let h = 0.4; h <= 2.5 + extraUp; h += 0.3) {
      _origin.set(this.pos.x + n.x * 0.2, this.pos.y + h, this.pos.z + n.z * 0.2);
      const hit = g.physics.raycast(_origin, _tmp2.copy(n).negate(), 1.1);
      if (!hit) {
        _origin.set(this.pos.x - n.x * 0.55, this.pos.y + h + 0.05, this.pos.z - n.z * 0.55);
        const down = g.physics.raycast(_origin, DOWN, 1.2);
        if (down && down.normal.y > 0.6) {
          // head room on top?
          const up = g.physics.raycast(_origin.set(down.point.x, down.point.y + 0.1, down.point.z), UP, 1.6);
          if (!up) return down.point.y;
        }
        return null;
      }
    }
    return null;
  }

  updateClimb(dt, ax) {
    const g = this.game, input = g.input, c = this.climb, n = c.normal;
    this.vel.set(0, 0, 0);
    // let go / leap off
    if (input.hit('KeyC')) { this.setState('air'); this.fallStart = this.pos.y; this.airTime = 0.2; this.pos.addScaledVector(n, 0.15); this.char.play('Jump_Loop', { fade: 0.2 }); return; }
    if (input.hit('Space') && ax.y <= 0) {
      this.vel.set(n.x * 4.6, 5.2, n.z * 4.6); this.yaw = Math.atan2(n.x, n.z);
      this.setState('air'); this.airTime = 0; this.fallStart = this.pos.y; this.pos.addScaledVector(n, 0.2);
      this.char.play('Jump_Start', { fade: 0.08, loop: false, speed: 1.5, startAt: 0.25, force: true }); g.audio.play('jump', { pos: this.pos });
      return;
    }
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const vUp = ax.y * (ax.y > 0 ? SPEED.climb * (sprint ? 1.45 : 1) : 2.9);
    const vSide = ax.x * 1.7;
    // tangent along the wall (to the player's right when facing the wall)
    _tmp.set(n.z, 0, -n.x);
    const px = this.pos.x, py = this.pos.y, pz = this.pos.z;
    this.pos.y += vUp * dt; this.pos.x += _tmp.x * -vSide * dt; this.pos.z += _tmp.z * -vSide * dt;
    // stay glued to the surface
    _origin.set(this.pos.x + n.x * 0.5, this.pos.y + 1.15, this.pos.z + n.z * 0.5);
    let hit = g.physics.raycast(_origin, _tmp2.copy(n).negate(), 1.3);
    if (!hit) { // maybe only the lower body still has wall
      _origin.y = this.pos.y + 0.45;
      hit = g.physics.raycast(_origin, _tmp2.copy(n).negate(), 1.3);
    }
    if (!hit || Math.abs(hit.normal.y) > 0.5) {
      // ran out of wall sideways: undo the lateral part
      this.pos.x = px; this.pos.z = pz;
    } else {
      _n.set(hit.normal.x, 0, hit.normal.z).normalize();
      if (_n.dot(n) > 0.5) { n.lerp(_n, 0.35).normalize(); }
      this.pos.x = hit.point.x + n.x * 0.36; this.pos.z = hit.point.z + n.z * 0.36;
      this.yaw += angDiff(this.yaw, Math.atan2(-n.x, -n.z)) * (1 - Math.exp(-10 * dt));
    }
    // something overhead?
    if (vUp > 0) {
      const up = g.physics.raycast(_origin.set(this.pos.x, py + 1.6, this.pos.z), UP, 0.45);
      if (up) this.pos.y = py;
    }
    // reached the top?
    if (ax.y > 0) {
      const top = this.findLedge(n, 0);
      if (top !== null && top - this.pos.y < 1.75) { this.startMantle(top); return; }
    }
    // reached the ground?
    if (ax.y < 0) {
      const ground = g.physics.raycast(_origin.set(this.pos.x, this.pos.y + 0.3, this.pos.z), DOWN, 0.42);
      if (ground && ground.normal.y > 0.6) { this.pos.y = ground.point.y; this.setState('ground'); this.body.onGround = true; return; }
    }
    const moved = Math.hypot(this.pos.y - py, this.pos.x - px, this.pos.z - pz);
    c.phase += moved * 1.5;
    c.moveY = this.pos.y - py; c.moveSide = -vSide * dt;
    this.stepAcc += moved;
    if (this.stepAcc > 0.72) { this.stepAcc = 0; g.audio.play('climbGrab', { pos: this.pos, volume: 0.6 }); }
  }

  /** procedural hand / foot placement on the wall */
  applyClimbIK(dt) {
    const c = this.climb, n = c.normal, b = this.char.bones;
    const right = _tmp.set(n.z, 0, -n.x).clone(); // character's right when facing the wall (forward = -n)
    const wall = (side, up, out = 0.08) => V().set(
      this.pos.x - n.x * (0.36 - out) + right.x * side, this.pos.y + up, this.pos.z - n.z * (0.36 - out) + right.z * side);
    const ph = c.phase * Math.PI * 2;
    const s = Math.sin(ph), s2 = Math.sin(ph + Math.PI);
    const reach = (v) => 0.5 + 0.5 * v;
    // hips sway with each reach; chest stays close to the stone, head looks up the wall
    b.pelvis.position.y += Math.sin(ph * 2) * 0.015 - 0.06;
    b.pelvis.rotateY(s * 0.12); b.pelvis.rotateZ(s * 0.05);
    b.spine_02.rotateX(0.1); b.spine_03.rotateX(0.08); b.neck_01.rotateX(-0.3); b.Head.rotateX(-0.25);
    this.root.updateMatrixWorld(true);
    const hands = [
      { u: b.upperarm_r, l: b.lowerarm_r, e: b.hand_r, t: wall(0.27, 1.6 + reach(s) * 0.44, 0.07), pole: wall(0.85, 1.0, 0.3) },
      { u: b.upperarm_l, l: b.lowerarm_l, e: b.hand_l, t: wall(-0.27, 1.6 + reach(s2) * 0.44, 0.07), pole: wall(-0.85, 1.0, 0.3) },
    ];
    const feet = [
      { u: b.thigh_r, l: b.calf_r, e: b.foot_r, t: wall(0.2, 0.14 + reach(s2) * 0.4, 0.2), pole: wall(0.8, 0.75, 0.12) },
      { u: b.thigh_l, l: b.calf_l, e: b.foot_l, t: wall(-0.2, 0.14 + reach(s) * 0.4, 0.2), pole: wall(-0.8, 0.75, 0.12) },
    ];
    for (const h of [...hands, ...feet]) solveTwoBoneIK(h.u, h.l, h.e, h.t, h.pole);
  }

  startMantle(topY) {
    const c = this.climb, n = c.normal;
    this.setState('mantle');
    c.mantleFrom.copy(this.pos);
    c.mantleTo.set(this.pos.x - n.x * 0.62, topY, this.pos.z - n.z * 0.62);
    c.mantleDur = clamp(0.3 + (topY - this.pos.y) * 0.22, 0.34, 0.72);
    this.vel.set(0, 0, 0);
    this.char.play('ClimbUp_1m', { fade: 0.12, loop: false, speed: 0.67 / c.mantleDur * 0.95, force: true });
    this.game.audio.play('cloth', { pos: this.pos });
  }

  updateMantle(dt) {
    const c = this.climb; const t = clamp(this.stateTime / c.mantleDur, 0, 1);
    // rise first, then move in over the ledge
    const ty = 1 - Math.pow(1 - Math.min(1, t / 0.7), 2);
    const tx = t < 0.35 ? 0 : Math.pow((t - 0.35) / 0.65, 1.3);
    this.pos.set(c.mantleFrom.x + (c.mantleTo.x - c.mantleFrom.x) * tx, c.mantleFrom.y + (c.mantleTo.y - c.mantleFrom.y) * ty, c.mantleFrom.z + (c.mantleTo.z - c.mantleFrom.z) * tx);
    if (t >= 1) { this.setState('ground'); this.body.onGround = true; this.vel.set(-c.normal.x * 1.5, 0, -c.normal.z * 1.5); }
  }

  // ------------------------------------------------------------------------------------------ combat
  startAttack() {
    const g = this.game;
    if (!this.armed) this.setArmed(true);
    this.crouching = false;
    this.setState('attack');
    this.combo.index = 0; this.combo.queued = false; this.combo.hitDone = false;
    this.attackAction = this.char.play('Sword_Regular_Combo', { fade: 0.07, loop: false, speed: 1.12, force: true });
    this.beginSegment();
  }

  beginSegment() {
    const g = this.game; const seg = COMBO[this.combo.index];
    this.combo.hitDone = false; this.combo.queued = false;
    // face the best target in front
    const t = g.npcs.nearestHostile(this.pos, 3.6, this.forward, _dir.lengthSq() > 0.01 ? _dir : null);
    this.attackTarget = t;
    if (t) this.targetYaw = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    else if (_dir.lengthSq() > 0.01) this.targetYaw = Math.atan2(_dir.x, _dir.z); else this.targetYaw = this.yaw;
    g.audio.play(seg.sfx, { pos: this.pos });
  }

  updateAttack(dt, moving) {
    const g = this.game, input = g.input; const seg = COMBO[this.combo.index];
    const t = this.attackAction.time;
    if (input.mouse.leftPressed) this.combo.queued = true;
    this.yaw += angDiff(this.yaw, this.targetYaw) * (1 - Math.exp(-16 * dt));
    // lunge towards the target during the wind-up, stop at striking distance
    const k = clamp((t - seg.start) / (seg.hit - seg.start + 0.05), 0, 1);
    let sp = k < 1 ? seg.lunge * (1 - k * 0.6) : 0;
    if (this.attackTarget) { const d = Math.hypot(this.attackTarget.pos.x - this.pos.x, this.attackTarget.pos.z - this.pos.z); if (d < 1.25) sp = 0; else sp = Math.min(sp * 1.6, (d - 1.2) / Math.max(dt, 0.016)); }
    const f = this.forward;
    this.vel.x = f.x * sp; this.vel.z = f.z * sp;
    g.physics.move(this.body, dt);
    if (!this.combo.hitDone && t >= seg.hit) {
      this.combo.hitDone = true;
      g.combat.playerStrike(this, { range: 2.35, arc: 1.25, damage: seg.damage, heavy: this.combo.index === 2 });
    }
    if (t >= seg.end - 0.02 || this.char.finished()) {
      if (this.combo.queued && this.combo.index < COMBO.length - 1) { this.combo.index++; this.beginSegment(); }
      else { this.setState('ground'); this.char.play('Sword_Idle', { fade: 0.28 }); }
      return;
    }
    // cancel the recovery into a block or roll
    if (this.combo.hitDone && t > seg.hit + 0.12) {
      if (input.mouse.right) { this.setState('block'); this.blockTime = 0; this.char.play('Sword_Block', { fade: 0.1, loop: false, force: true }); return; }
      if (input.hit('KeyC') && moving) { this.startRoll(); return; }
    }
  }

  updateBlock(dt, moving) {
    const g = this.game, input = g.input;
    this.blockTime += dt;
    const a = this.char.current;
    if (a && a.time > 0.42 && input.mouse.right) a.timeScale = 0; // hold the guard
    const t = g.npcs.nearestHostile(this.pos, 6, this.forward, null);
    if (t) this.yaw += angDiff(this.yaw, Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z)) * (1 - Math.exp(-10 * dt));
    this.vel.x = damp(this.vel.x, moving ? _dir.x * SPEED.block : 0, 10, dt);
    this.vel.z = damp(this.vel.z, moving ? _dir.z * SPEED.block : 0, 10, dt);
    g.physics.move(this.body, dt);
    if (input.hit('KeyC') && moving) { this.startRoll(); return; }
    if (input.mouse.leftPressed) { this.startAttack(); return; }
    if (!input.mouse.right && this.blockTime > 0.18) { this.setState('ground'); this.char.play('Sword_Idle', { fade: 0.25 }); }
  }

  get blocking() { return this.state === 'block'; }
  get parrying() { return this.state === 'block' && this.blockTime < 0.3; }

  /** take a hit. Returns 'dodged' | 'parried' | 'blocked' | 'hit' */
  receiveAttack(attacker, amount) {
    const g = this.game;
    if (this.dead || this.invuln > 0 || this.state === 'takedown') return 'dodged';
    const toAtt = _tmp.set(attacker.pos.x - this.pos.x, 0, attacker.pos.z - this.pos.z).normalize();
    const facing = toAtt.dot(this.forward) > 0.2;
    if (this.blocking && facing) {
      const at = _origin.copy(this.pos).addScaledVector(toAtt, 0.65).setY(this.pos.y + 1.25); // where the blades meet
      if (this.parrying) { g.audio.play('parry', { pos: this.pos }); g.fx.sparks(at, 16); g.cam.shake(0.25); g.hitStop(0.09); return 'parried'; }
      g.audio.play('clang', { pos: this.pos }); g.fx.sparks(at, 8);
      this.vel.addScaledVector(toAtt, -3.2); this.damage(amount * 0.12, attacker, true);
      return 'blocked';
    }
    this.damage(amount, attacker);
    return 'hit';
  }

  damage(amount, from = null, quiet = false) {
    const g = this.game;
    if (this.dead) return;
    this.health -= amount; this.regenDelay = 6; this.stats.hitsTaken += quiet ? 0 : 1;
    g.onPlayerHurt(amount);
    if (this.health <= 0) { this.die(); return; }
    if (quiet) return;
    g.audio.play('hitFlesh', { pos: this.pos }); g.audio.play('grunt', { pos: this.pos }); g.cam.shake(0.45);
    if (from) { const d = _tmp.set(this.pos.x - from.pos.x, 0, this.pos.z - from.pos.z).normalize(); this.vel.x = d.x * 4; this.vel.z = d.z * 4; }
    if (this.state !== 'climb' && this.state !== 'air') { this.setState('hit'); this.char.play(Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head', { fade: 0.05, loop: false, force: true }); }
    else if (this.state === 'climb') { this.setState('air'); this.fallStart = this.pos.y; this.pos.addScaledVector(this.climb.normal, 0.2); }
  }

  updateHit(dt) {
    this.vel.x = damp(this.vel.x, 0, 7, dt); this.vel.z = damp(this.vel.z, 0, 7, dt);
    this.game.physics.move(this.body, dt);
    if (this.stateTime > 0.36) this.setState('ground');
  }

  die() {
    const g = this.game;
    this.dead = true; this.health = 0; this.setState('dead');
    this.char.play('Death01', { fade: 0.1, loop: false, force: true });
    g.audio.play('death', { pos: this.pos });
    g.onPlayerDeath();
  }

  revive(x, y, z, yaw) {
    this.dead = false; this.health = this.maxHealth; this.setArmed(false, true); this.crouching = false;
    this.place(x, y, z, yaw); this.setState('ground'); this.char.play('Idle_Loop', { fade: 0, force: true });
  }

  // ------------------------------------------------------------------------------------------ takedowns
  /** decide which takedown (if any) is available right now; also used for the on-screen prompt */
  findTakedown() {
    const g = this.game;
    if (this.busy || this.dead || this.state === 'roll' || this.state === 'hit') return null;
    // leap strike from above
    if (this.state !== 'climb') {
      const below = g.npcs.bestBelow(this.pos, this.forward);
      if (below) return { type: 'air', npc: below };
    }
    if (this.state === 'climb' || this.state === 'air') return null;
    const near = g.npcs.bestStealthTarget(this.pos, this.forward);
    if (near) return near; // { type: 'stealth' | 'finisher', npc }
    return null;
  }

  tryTakedown() {
    const td = this.prompt || this.findTakedown();
    if (!td) return false;
    this.beginTakedown(td.type, td.npc);
    return true;
  }

  beginTakedown(type, npc) {
    const g = this.game;
    this.takedown = { type, npc, t: 0, struck: false, from: this.pos.clone(), fromYaw: this.yaw, hadSword: this.armed };
    this.setState('takedown'); this.crouching = false; this.vel.set(0, 0, 0);
    const td = this.takedown;
    npc.beginVictim(this, type);
    if (type === 'air') {
      this.char.setWeapon('dagger'); this.armed = false;
      const d = Math.hypot(npc.pos.x - this.pos.x, npc.pos.z - this.pos.z), h = this.pos.y - npc.pos.y;
      td.dur = clamp(0.32 + d * 0.045 + Math.sqrt(Math.max(0, h)) * 0.11, 0.5, 1.15);
      td.arc = 1.1 + d * 0.08;
      this.yaw = Math.atan2(npc.pos.x - this.pos.x, npc.pos.z - this.pos.z);
      this.char.play('NinjaJump_Start', { fade: 0.08, loop: false, speed: 1.6, startAt: 0.3, force: true });
      g.audio.play('whoosh', { pos: this.pos }); g.audio.play('jump', { pos: this.pos });
    } else if (type === 'stealth') {
      this.char.setWeapon('dagger'); this.armed = false;
      // step in close: behind the victim if we came from behind, otherwise in front
      const nf = npc.forward; const rel = _tmp.set(this.pos.x - npc.pos.x, 0, this.pos.z - npc.pos.z).normalize();
      td.fromBehind = rel.dot(nf) < 0.1;
      td.to = V().copy(npc.pos).addScaledVector(rel, 0.78); td.to.y = this.pos.y;
      td.dur = 1.05; td.hitAt = 0.36;
      g.audio.play('cloth', { pos: this.pos });
    } else { // finisher on a staggered opponent with the sabre
      this.setArmed(true, true);
      const rel = _tmp.set(this.pos.x - npc.pos.x, 0, this.pos.z - npc.pos.z).normalize();
      td.to = V().copy(npc.pos).addScaledVector(rel, 1.35); td.to.y = this.pos.y;
      td.dur = 1.15; td.hitAt = 0.4;
      this.char.play('Sword_Dash', { fade: 0.08, loop: false, speed: 1.15, force: true });
      g.audio.play('swingHeavy', { pos: this.pos });
    }
    g.cam.beginCinematic(this, npc, type);
  }

  updateTakedown(dt) {
    const g = this.game, td = this.takedown, npc = td.npc;
    td.t += dt;
    if (td.type === 'air') {
      const k = clamp(td.t / td.dur, 0, 1);
      if (!td.struck) {
        // ballistic leap onto the target
        const tx = npc.pos.x - Math.sin(this.yaw) * 0.55, tz = npc.pos.z - Math.cos(this.yaw) * 0.55, ty = npc.pos.y;
        this.pos.x = td.from.x + (tx - td.from.x) * k; this.pos.z = td.from.z + (tz - td.from.z) * k;
        this.pos.y = td.from.y + (ty - td.from.y) * (k * k) + td.arc * 4 * k * (1 - k) * (1 - k * 0.5);
        if (td.t > 0.18) this.char.play('NinjaJump_Idle_Loop', { fade: 0.15 });
        if (k > 0.82 && !td.swing) { td.swing = true; this.char.play('Melee_Hook', { fade: 0.06, loop: false, speed: 1.1, force: true }); }
        if (k >= 1) {
          td.struck = true; td.t2 = 0;
          this.strikeVictim(td, 'knockdown'); this.stats.airKills++;
          g.audio.play('landHeavy', { pos: this.pos }); g.fx.dust(this.pos, 12); g.cam.shake(0.7); g.slowMo(0.25, 0.5);
          this.char.play('NinjaJump_Land', { fade: 0.1, loop: false, speed: 1.3, startAt: 0.15, force: true });
        }
      } else {
        td.t2 += dt;
        if (td.t2 > 0.7) this.endTakedown();
      }
      return;
    }
    // ground takedowns: slide into position, strike, recover
    const k = clamp(td.t / 0.2, 0, 1);
    this.pos.x = td.from.x + (td.to.x - td.from.x) * k; this.pos.z = td.from.z + (td.to.z - td.from.z) * k;
    this.yaw += angDiff(this.yaw, Math.atan2(npc.pos.x - this.pos.x, npc.pos.z - this.pos.z)) * (1 - Math.exp(-18 * dt));
    if (td.type === 'stealth' && !td.started && td.t > 0.1) { td.started = true; this.char.play('Melee_Hook', { fade: 0.08, loop: false, speed: 0.9, force: true }); }
    if (!td.struck && td.t >= td.hitAt) {
      td.struck = true;
      this.strikeVictim(td, td.type === 'stealth' ? (td.fromBehind ? 'back' : 'front') : 'slash');
      if (td.type === 'stealth') this.stats.stealthKills++; else this.stats.combatKills++;
      g.slowMo(0.3, 0.35); g.cam.shake(0.3);
    }
    if (td.t >= td.dur) this.endTakedown();
  }

  strikeVictim(td, style) {
    const g = this.game, npc = td.npc;
    g.audio.play('stab', { pos: npc.pos });
    g.fx.blood(_tmp.set(npc.pos.x, npc.pos.y + 1.2, npc.pos.z), 10);
    npc.die(style, this);
    this.lastKillTime = g.time;
    g.onKill(npc, td.type);
  }

  endTakedown() {
    const g = this.game, td = this.takedown;
    this.takedown = null;
    this.char.setWeapon('none'); this.armed = false;
    if (td.hadSword || g.combatNearby()) this.setArmed(true, true);
    this.body.onGround = true; this.vel.set(0, 0, 0);
    this.setState('ground');
    this.char.play(this.armed ? 'Sword_Idle' : 'Idle_Loop', { fade: 0.3 });
    g.cam.endCinematic();
  }

  // ------------------------------------------------------------------------------------------ blade trail
  updateTrail(dt) {
    const g = this.game;
    const active = this.state === 'attack' || (this.state === 'takedown' && this.takedown && this.takedown.type === 'finisher');
    if (!g.fx.trail) return;
    const sword = this.char.sword;
    if (active && this.char.weapon === 'sword') {
      sword.updateWorldMatrix(true, false);
      const base = _tmp.set(0, 0, 0.22).applyMatrix4(sword.matrixWorld);
      const tip = _tmp2.set(0, 0, 0.88).applyMatrix4(sword.matrixWorld);
      g.fx.trail.push(base, tip);
    } else g.fx.trail.fade(dt);
  }
}
