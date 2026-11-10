// Guards, the castellan and townsfolk: patrols, detection, combat AI and crowd behaviour.
import * as THREE from 'three';
import { createGuard, createCivilian } from './cast.js';

const V = () => new THREE.Vector3();
const _a = V(), _b = V(), _c = V(), _d = V();
const DOWN = new THREE.Vector3(0, -1, 0);
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rand = (a, b) => a + Math.random() * (b - a);

const VIEW_DIST = 24, VIEW_HALF_ANGLE = 1.02;

export class Npc {
  constructor(mgr, kind, opts = {}) {
    this.mgr = mgr; this.game = mgr.game; this.kind = kind; // 'guard' | 'captain' | 'civilian'
    this.char = kind === 'civilian' ? createCivilian(opts.variant || 0) : createGuard(opts.variant || 0, kind === 'captain');
    this.root = this.char.root;
    this.pos = V(); this.vel = V(); this.yaw = opts.yaw || 0;
    this.hostileKind = kind !== 'civilian';
    this.maxHealth = this.health = kind === 'captain' ? 230 : 100;
    this.blockChance = kind === 'captain' ? 0.5 : 0.3;
    this.state = 'idle'; this.stateTime = 0;
    this.dead = false; this.victim = false;
    this.awareness = 0; this.sees = false; this.losTimer = Math.random() * 0.2; this.lastSeen = V(); this.lostTime = 0;
    this.route = opts.route || null; this.routeIndex = 0; this.wait = rand(0, 2); this.post = opts.post || null;
    this.path = null; this.pathIndex = 0; this.repath = 0;
    this.attackCd = rand(0.6, 1.6); this.attack = null; this.stun = 0;
    this.speed = 0; this.walkSpeed = opts.walkSpeed || (kind === 'civilian' ? rand(1.15, 1.6) : 1.45);
    this.name = opts.name || kind;
    this.isTarget = !!opts.isTarget;
    this.home = opts.home ? opts.home.clone() : null;
    this.fixedY = opts.fixedY ?? null; // patrols on walls / platforms keep their height
    this.idleAnim = opts.idleAnim || (kind === 'civilian' ? 'Idle_Loop' : 'Idle_Loop');
    this.restricted = !!opts.restricted;
    this.navNode = opts.navNode ?? null; this.navPrev = null;
    this.fleeTime = 0; this.bodyNoted = new Set();
    this.lod = 0; this.animAcc = Math.random() * 0.1;
    this.marker = null;
    this.char.play(this.idleAnim, { fade: 0 });
    this.char.mixer.update(Math.random() * 2);
  }

  place(x, y, z, yaw = this.yaw) { this.pos.set(x, y, z); this.yaw = yaw; this.root.position.copy(this.pos); this.root.rotation.y = yaw; }
  setState(s) { this.state = s; this.stateTime = 0; }
  get forward() { return _d.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }
  get hostile() { return this.hostileKind && !this.dead && (this.state === 'combat' || this.state === 'search' || this.state === 'stunned'); }
  get alerted() { return this.state === 'combat' || this.state === 'search' || this.state === 'stunned' || this.state === 'investigate'; }

  // ------------------------------------------------------------------------------------------ senses
  canSee(target, dt) {
    const p = this.game.player;
    this.losTimer -= dt;
    if (this.losTimer > 0) return this.sees;
    this.losTimer = 0.14 + Math.random() * 0.06;
    const dx = target.x - this.pos.x, dy = target.y - this.pos.y, dz = target.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let range = VIEW_DIST * (p.crouching ? 0.6 : 1) * (this.state === 'combat' ? 1.5 : 1);
    if (dist > range || Math.abs(dy) > 16) return (this.sees = false);
    if (dist > 1.6) {
      const ang = Math.abs(angDiff(this.yaw, Math.atan2(dx, dz)));
      const half = this.state === 'combat' || this.state === 'search' ? 2.2 : VIEW_HALF_ANGLE;
      if (ang > half) return (this.sees = false);
      // guards rarely look straight up
      if (dy > 3 && Math.atan2(dy, dist) > 0.85 && this.state !== 'combat') return (this.sees = false);
    }
    _a.set(this.pos.x, this.pos.y + 1.62, this.pos.z); _b.set(target.x, target.y + (p.crouching ? 0.8 : 1.4), target.z);
    return (this.sees = this.game.physics.lineOfSight(_a, _b));
  }

  // ------------------------------------------------------------------------------------------ update
  update(dt) {
    this.stateTime += dt;
    if (this.dead) { this.updateDead(dt); return; }
    if (this.victim) { this.vel.set(0, 0, 0); this.animate(dt); return; }
    if (this.kind === 'civilian') this.updateCivilian(dt); else this.updateGuard(dt);
    // integrate + keep on the ground
    this.pos.x += this.vel.x * dt; this.pos.z += this.vel.z * dt;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    if (this.lod < 2) this.collide(dt);
    this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
    this.animate(dt);
  }

  collide(dt) {
    const g = this.game;
    if (this.fixedY !== null && !this.alerted) { this.pos.y = this.fixedY; return; }
    if (this.alerted || this.fleeTime > 0) {
      // full capsule collision while fighting / fleeing
      g.physics.resolveCapsule(this.pos, 0.3, 1.75, _c);
    }
    const hit = g.physics.raycast(_a.set(this.pos.x, this.pos.y + 0.9, this.pos.z), DOWN, 3.5);
    if (hit) { const ty = hit.point.y; this.pos.y = ty < this.pos.y ? Math.max(ty, this.pos.y - 14 * dt) : damp(this.pos.y, ty, 20, dt); }
    // separation from other characters
    for (const o of this.mgr.active) {
      if (o === this || o.dead) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z; const d2 = dx * dx + dz * dz;
      if (d2 < 0.49 && d2 > 1e-4 && Math.abs(this.pos.y - o.pos.y) < 1.5) { const d = Math.sqrt(d2); const push = (0.7 - d) * 0.5; this.pos.x += dx / d * push; this.pos.z += dz / d * push; }
    }
    const p = g.player;
    if (!p.busy) { const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z; const d2 = dx * dx + dz * dz; if (d2 < 0.42 && d2 > 1e-4 && Math.abs(this.pos.y - p.pos.y) < 1.5) { const d = Math.sqrt(d2); this.pos.x += dx / d * (0.65 - d); this.pos.z += dz / d * (0.65 - d); } }
  }

  animate(dt) {
    // far characters animate at a reduced rate
    if (this.lod === 0) { this.char.update(dt); return; }
    this.animAcc += dt;
    const step = this.lod === 1 ? 0.05 : 0.2;
    if (this.animAcc >= step) { this.char.update(this.animAcc); this.animAcc = 0; }
  }

  moveTowards(x, z, speed, dt, turn = 7) {
    const dx = x - this.pos.x, dz = z - this.pos.z; const d = Math.hypot(dx, dz);
    if (d < 0.05) { this.vel.x = damp(this.vel.x, 0, 10, dt); this.vel.z = damp(this.vel.z, 0, 10, dt); return d; }
    this.yaw += angDiff(this.yaw, Math.atan2(dx, dz)) * (1 - Math.exp(-turn * dt));
    this.vel.x = damp(this.vel.x, dx / d * speed, 8, dt); this.vel.z = damp(this.vel.z, dz / d * speed, 8, dt);
    return d;
  }
  stop(dt) { this.vel.x = damp(this.vel.x, 0, 10, dt); this.vel.z = damp(this.vel.z, 0, 10, dt); }
  face(x, z, dt, k = 6) { this.yaw += angDiff(this.yaw, Math.atan2(x - this.pos.x, z - this.pos.z)) * (1 - Math.exp(-k * dt)); }

  locomotion(armed = false) {
    const sp = this.speed, c = this.char;
    if (sp < 0.2) c.play(armed ? 'Sword_Idle' : this.idleAnim, { fade: 0.25 });
    else if (sp < 2.4) c.play(this.kind === 'civilian' && this.carry ? 'Walk_Carry_Loop' : (this.kind === 'civilian' ? 'Walk_Loop' : 'Walk_Formal_Loop'), { fade: 0.25, speed: clamp(sp / 1.4, 0.6, 1.5) });
    else if (sp < 5.6) c.play('Jog_Fwd_Loop', { fade: 0.2, speed: clamp(sp / 4.0, 0.7, 1.3) });
    else c.play('Sprint_Loop', { fade: 0.2, speed: clamp(sp / 6.6, 0.8, 1.2) });
  }

  // ------------------------------------------------------------------------------------------ guards
  updateGuard(dt) {
    const g = this.game, p = g.player;
    const sees = !p.dead && this.canSee(p.pos, dt);
    const dist = Math.hypot(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
    if (sees) { this.lastSeen.copy(p.pos); this.lostTime = 0; } else this.lostTime += dt;

    if (this.state !== 'combat' && this.state !== 'stunned') {
      // awareness builds while the player is seen doing something conspicuous
      let rate = 0;
      if (sees) {
        const prof = g.hunted ? 2 : p.profile;
        const near = clamp(1.6 - dist / VIEW_DIST * 1.4, 0.25, 1.6);
        if (prof === 2) rate = 0.95 * near; else if (prof === 1) rate = 0.3 * near; else if (dist < 1.3 && this.restricted) rate = 0.5;
        if (p.crouching) rate *= 0.55;
        if (g.hunted) rate = Math.max(rate, 3);
      }
      if (rate > 0) this.awareness = Math.min(1, this.awareness + rate * dt); else this.awareness = Math.max(0, this.awareness - 0.22 * dt);
      // notice bodies
      if (this.state !== 'search') for (const b of this.mgr.bodies) {
        if (this.bodyNoted.has(b)) continue;
        const bd = Math.hypot(b.pos.x - this.pos.x, b.pos.z - this.pos.z);
        if (bd < 13 && Math.abs(b.pos.y - this.pos.y) < 4 && Math.abs(angDiff(this.yaw, Math.atan2(b.pos.x - this.pos.x, b.pos.z - this.pos.z))) < 1.1) {
          _a.set(this.pos.x, this.pos.y + 1.6, this.pos.z); _b.set(b.pos.x, b.pos.y + 0.4, b.pos.z);
          if (g.physics.lineOfSight(_a, _b)) { this.bodyNoted.add(b); this.lastSeen.copy(b.pos); this.setState('search'); this.searchTime = 14; g.audio.play('suspicious', { pos: this.pos }); g.onBodyFound(this); }
        }
      }
      if (this.awareness >= 1) { this.enterCombat(true); }
      else if (this.awareness > 0.45 && this.state !== 'investigate' && this.state !== 'search') { this.setState('investigate'); g.audio.play('suspicious', { pos: this.pos }); }
    }

    switch (this.state) {
      case 'idle': case 'patrol': this.updatePatrol(dt); break;
      case 'investigate':
        this.face(this.lastSeen.x, this.lastSeen.z, dt, 5);
        if (this.stateTime > 1.2 && this.awareness > 0.6 && this.fixedY === null) this.moveTowards(this.lastSeen.x, this.lastSeen.z, 1.5, dt); else this.stop(dt);
        if (this.awareness < 0.25 && this.stateTime > 2.5) this.setState('patrol');
        this.locomotion(false);
        break;
      case 'combat': this.updateCombat(dt, sees, dist); break;
      case 'search': this.updateSearch(dt, sees); break;
      case 'stunned':
        this.stop(dt); this.stun -= dt;
        if (this.stun <= 0) { this.setState('combat'); this.char.play('Sword_Idle', { fade: 0.3 }); }
        break;
    }
  }

  updatePatrol(dt) {
    if (this.post) {
      // sentry: hold position, look around slowly
      const d = Math.hypot(this.post.x - this.pos.x, this.post.z - this.pos.z);
      if (d > 0.6) { this.moveTowards(this.post.x, this.post.z, this.walkSpeed, dt); this.locomotion(false); return; }
      this.stop(dt);
      const sweep = this.post.sweep ?? 0.5;
      this.yaw += angDiff(this.yaw, this.post.ry + Math.sin(this.game.time * 0.35 + this.post.x) * sweep) * (1 - Math.exp(-2 * dt));
      this.char.play(this.idleAnim, { fade: 0.4 });
      return;
    }
    if (!this.route) { this.stop(dt); this.char.play(this.idleAnim, { fade: 0.4 }); return; }
    if (this.wait > 0) { this.wait -= dt; this.stop(dt); this.locomotion(false); return; }
    const wp = this.route[this.routeIndex];
    const d = this.moveTowards(wp.x, wp.z, this.walkSpeed, dt, 4);
    if (d < 0.6) { this.routeIndex = (this.routeIndex + 1) % this.route.length; if (Math.random() < 0.35) this.wait = rand(1.5, 4); }
    this.locomotion(false);
  }

  enterCombat(shout) {
    const g = this.game;
    if (this.state === 'combat') return;
    const first = !g.hunted;
    this.setState('combat'); this.awareness = 1; this.lostTime = 0; this.fixedY = null;
    this.lastSeen.copy(g.player.pos);
    this.char.play('Sword_Idle', { fade: 0.2 });
    if (shout) { g.audio.play('guardShout', { pos: this.pos }); if (first) g.audio.play('alert', { pos: this.pos }); }
    g.onGuardAlerted(this);
    // raise the alarm for comrades in earshot
    if (shout) for (const o of this.mgr.npcs) {
      if (o === this || o.dead || !o.hostileKind || o.state === 'combat') continue;
      if (Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 17 && Math.abs(o.pos.y - this.pos.y) < 6) { o.awareness = Math.max(o.awareness, 0.8); o.lastSeen.copy(g.player.pos); if (o.state !== 'search') { o.setState('search'); o.searchTime = 10; } }
    }
    for (const o of this.mgr.npcs) if (o.kind === 'civilian' && !o.dead && Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 14) o.panic(this.pos);
  }

  updateCombat(dt, sees, dist) {
    const g = this.game, p = g.player, mgr = this.mgr;
    if (p.dead) { this.setState('patrol'); this.awareness = 0; return; }
    const dy = p.pos.y - this.pos.y;
    if (!sees && this.lostTime > 3.5) { this.setState('search'); this.searchTime = 13; mgr.releaseToken(this); return; }
    // an attack in progress runs to completion
    if (this.attack) { this.updateAttack(dt, dist); return; }
    this.attackCd -= dt;
    const reachable = Math.abs(dy) < 1.6;
    if (!reachable) {
      // the player is above / below: get as close as possible and shake a fist
      if (dist > 3 && this.followPath(p.pos, 5.4, dt)) this.locomotion(true);
      else { this.stop(dt); this.face(p.pos.x, p.pos.z, dt); this.speed = 0; this.char.play(this.stateTime % 6 < 2.5 ? 'Idle_Rail_Call' : 'Sword_Idle', { fade: 0.3 }); }
      return;
    }
    const hasToken = mgr.requestToken(this);
    const want = hasToken ? 1.75 : 3.6 + (this.slot || 0) * 0.5;
    if (dist > want + 0.4) {
      if (dist > 9 || !sees) this.followPath(p.pos, 5.6, dt); else this.moveTowards(p.pos.x, p.pos.z, dist > 5 ? 5.4 : 3.4, dt, 9);
      this.locomotion(true);
    } else if (dist < want - 0.5 && !hasToken) {
      // back off to the ring
      const dx = this.pos.x - p.pos.x, dz = this.pos.z - p.pos.z; const d = Math.max(0.01, Math.hypot(dx, dz));
      this.vel.x = damp(this.vel.x, dx / d * 1.6, 6, dt); this.vel.z = damp(this.vel.z, dz / d * 1.6, 6, dt);
      this.face(p.pos.x, p.pos.z, dt, 9); this.char.play('Sword_Idle', { fade: 0.2 });
    } else {
      // circle slowly while waiting for an opening
      this.face(p.pos.x, p.pos.z, dt, 9);
      const side = this.circleDir || (this.circleDir = Math.random() < 0.5 ? -1 : 1);
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z; const d = Math.max(0.01, dist);
      const sp = hasToken ? 0.5 : 1.0;
      this.vel.x = damp(this.vel.x, -dz / d * side * sp, 5, dt); this.vel.z = damp(this.vel.z, dx / d * side * sp, 5, dt);
      this.char.play('Sword_Idle', { fade: 0.2 });
      if (hasToken && this.attackCd <= 0 && dist < 2.4 && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) < 0.5) this.startAttack();
    }
  }

  startAttack() {
    const heavy = this.kind === 'captain' && Math.random() < 0.4;
    this.attack = { t: 0, hit: false, speed: heavy ? 0.72 : 0.85, damage: heavy ? 30 : (this.kind === 'captain' ? 22 : 16) };
    this.attack.action = this.char.play('Sword_Attack', { fade: 0.1, loop: false, speed: this.attack.speed, force: true });
    this.game.audio.play('grunt', { pos: this.pos, volume: 0.6 });
    this.game.fx.glint(this);
  }

  updateAttack(dt, dist) {
    const g = this.game, p = g.player, a = this.attack;
    a.t += dt;
    const time = a.action.time;
    if (time < 0.34) { this.face(p.pos.x, p.pos.z, dt, 6); if (dist > 1.5) this.moveTowards(p.pos.x, p.pos.z, 2.2, dt, 6); else this.stop(dt); } else this.stop(dt);
    if (!a.hit && time >= 0.4) {
      a.hit = true;
      g.audio.play('swing', { pos: this.pos });
      const dx = p.pos.x - this.pos.x, dz = p.pos.z - this.pos.z;
      if (Math.hypot(dx, dz) < 2.3 && Math.abs(p.pos.y - this.pos.y) < 1.4 && Math.abs(angDiff(this.yaw, Math.atan2(dx, dz))) < 0.95) {
        const res = p.receiveAttack(this, a.damage);
        if (res === 'parried') { this.stagger(1.9); return; }
      }
    }
    if (time >= 1.05 || this.char.finished()) { this.attack = null; this.attackCd = rand(1.3, 2.6) * (this.kind === 'captain' ? 0.7 : 1); this.mgr.releaseToken(this); this.char.play('Sword_Idle', { fade: 0.25 }); }
  }

  stagger(time) {
    this.attack = null; this.mgr.releaseToken(this);
    this.setState('stunned'); this.stun = time;
    this.char.play('Hit_Head', { fade: 0.05, loop: false, force: true });
    this.game.after(0.38, () => { if (!this.dead && this.state === 'stunned') this.char.play('Zombie_Idle_Loop', { fade: 0.25 }); });
  }

  updateSearch(dt, sees) {
    const g = this.game;
    this.searchTime -= dt;
    if (sees && (g.hunted || g.player.profile > 0)) { this.awareness = Math.min(1, this.awareness + dt * 2.5); if (this.awareness >= 1) { this.enterCombat(true); return; } }
    const d = Math.hypot(this.lastSeen.x - this.pos.x, this.lastSeen.z - this.pos.z);
    if (d > 1.6 && this.stateTime < 9) { this.followPath(this.lastSeen, 3.6, dt); this.locomotion(true); }
    else { this.stop(dt); this.yaw += Math.sin(g.time * 1.3 + this.pos.x) * 1.4 * dt; this.speed = 0; this.char.play('Sword_Idle', { fade: 0.3 }); }
    if (this.searchTime <= 0) { this.awareness = 0.2; this.setState('patrol'); this.goHome(); }
  }

  goHome() { if (this.home && !this.route && !this.post) this.post = { x: this.home.x, z: this.home.z, ry: this.yaw }; }

  /** steer to a far target using the street graph when there is no straight line */
  followPath(target, speed, dt) {
    const g = this.game;
    _a.set(this.pos.x, this.pos.y + 1.0, this.pos.z); _b.set(target.x, this.pos.y + 1.0, target.z);
    const direct = _a.distanceTo(_b) < 30 && g.physics.lineOfSight(_a, _b);
    if (direct) { this.path = null; this.moveTowards(target.x, target.z, speed, dt, 8); return true; }
    this.repath -= dt;
    if (!this.path || this.repath <= 0) { this.path = g.nav.findPath(this.pos, target); this.pathIndex = 0; this.repath = 1.5; }
    if (!this.path || !this.path.length) { this.stop(dt); return false; }
    const wp = this.path[Math.min(this.pathIndex, this.path.length - 1)];
    const d = this.moveTowards(wp.x, wp.z, speed, dt, 8);
    if (d < 1.2 && this.pathIndex < this.path.length - 1) this.pathIndex++;
    return true;
  }

  // ------------------------------------------------------------------------------------------ taking damage
  /** the player's blade connects. Returns 'blocked' | 'hit' | 'killed' */
  receiveStrike(player, damage, heavy) {
    const g = this.game;
    if (this.dead) return 'none';
    const facing = Math.abs(angDiff(this.yaw, Math.atan2(player.pos.x - this.pos.x, player.pos.z - this.pos.z))) < 1.2;
    const unaware = this.state !== 'combat' && this.state !== 'stunned';
    if (unaware) damage *= 3; // caught off guard
    if (this.hostileKind && this.state === 'combat' && facing && !this.attack && !heavy && Math.random() < this.blockChance) {
      this.char.play('Sword_Block', { fade: 0.06, loop: false, speed: 1.5, force: true });
      this.game.after(0.52, () => { if (!this.dead && this.state === 'combat' && !this.attack) this.char.play('Sword_Idle', { fade: 0.25 }); });
      this.attackCd = Math.min(this.attackCd, 0.5);
      return 'blocked';
    }
    this.health -= damage;
    const dx = this.pos.x - player.pos.x, dz = this.pos.z - player.pos.z; const d = Math.max(0.01, Math.hypot(dx, dz));
    this.vel.x = dx / d * (heavy ? 5 : 3); this.vel.z = dz / d * (heavy ? 5 : 3);
    if (this.health <= 0) { this.die('slash', player); return 'killed'; }
    this.attack = null; this.mgr.releaseToken(this);
    if (this.hostileKind) { if (this.state !== 'combat') this.enterCombat(true); this.char.play(Math.random() < 0.5 ? 'Hit_Chest' : 'Hit_Head', { fade: 0.05, loop: false, force: true }); this.attackCd = Math.max(this.attackCd, 0.7); this.game.after(0.4, () => { if (!this.dead && this.state === 'combat' && !this.attack) this.char.play('Sword_Idle', { fade: 0.2 }); }); }
    else this.panic(player.pos);
    return 'hit';
  }

  beginVictim(player, type) {
    this.victim = true; this.attack = null; this.mgr.releaseToken(this); this.vel.set(0, 0, 0);
    if (type === 'stealth') this.char.play(this.idleAnim, { fade: 0.2 });
  }

  die(style, killer) {
    const g = this.game;
    if (this.dead) return;
    this.dead = true; this.victim = false; this.health = 0; this.attack = null; this.mgr.releaseToken(this);
    this.setState('dead'); this.awareness = 0;
    if (killer) {
      const away = Math.atan2(this.pos.x - killer.pos.x, this.pos.z - killer.pos.z);
      // Death01 falls backwards: face the killer unless struck from behind
      if (style === 'back') this.yaw = away + Math.PI; else if (style !== 'knockdown') this.yaw = away + Math.PI;
    }
    if (style === 'knockdown') { this.char.play('Hit_Knockback', { fade: 0.05, loop: false, force: true }); }
    else this.char.play('Death01', { fade: 0.08, loop: false, speed: 1.15, force: true });
    this.vel.set(0, 0, 0);
    g.audio.play('death', { pos: this.pos });
    this.mgr.bodies.push(this);
    if (this.marker) this.marker.visible = false;
    for (const o of this.mgr.npcs) if (o.kind === 'civilian' && !o.dead && Math.hypot(o.pos.x - this.pos.x, o.pos.z - this.pos.z) < 13) { _a.set(o.pos.x, o.pos.y + 1.5, o.pos.z); _b.set(this.pos.x, this.pos.y + 1, this.pos.z); if (g.physics.lineOfSight(_a, _b)) o.panic(this.pos); }
  }

  updateDead(dt) {
    // settle on the ground, keep the final pose
    if (this.stateTime < 3) {
      const hit = this.game.physics.raycast(_a.set(this.pos.x, this.pos.y + 0.9, this.pos.z), DOWN, 6);
      if (hit) this.pos.y = damp(this.pos.y, hit.point.y, 12, dt);
      this.root.position.copy(this.pos); this.root.rotation.y = this.yaw;
      this.char.update(dt);
    }
  }

  // ------------------------------------------------------------------------------------------ townsfolk
  panic(from) {
    if (this.kind !== 'civilian' || this.dead) return;
    if (this.fleeTime <= 0) this.game.audio.play('crowdGasp', { pos: this.pos, volume: 0.6 });
    this.fleeTime = rand(6, 10); this.fleeFrom = from.clone(); this.path = null;
  }

  updateCivilian(dt) {
    const g = this.game, nav = g.nav;
    if (this.fleeTime > 0) {
      this.fleeTime -= dt;
      // run to the neighbouring street node that leads away from the danger
      if (!this.fleeNode || Math.hypot(this.fleeNode.x - this.pos.x, this.fleeNode.z - this.pos.z) < 1.5) {
        const here = nav.nearest(this.pos); let best = here, bs = -1e9;
        for (const id of here.links) { const n = nav.nodes[id]; const s = Math.hypot(n.x - this.fleeFrom.x, n.z - this.fleeFrom.z) + Math.random() * 6; if (s > bs) { bs = s; best = n; } }
        this.fleeNode = best; this.navNode = best.id;
      }
      this.moveTowards(this.fleeNode.x + (this.lane || 0), this.fleeNode.z + (this.lane || 0), 5.2, dt, 8);
      this.speed = Math.hypot(this.vel.x, this.vel.z); this.locomotion(false);
      if (this.fleeTime <= 0) { this.fleeNode = null; this.target = null; }
      return;
    }
    if (this.activity) { // standing at a stall, chatting, etc.
      this.stop(dt); this.activity.t -= dt;
      if (this.activity.face) this.face(this.activity.face.x, this.activity.face.z, dt, 3);
      this.char.play(this.activity.anim, { fade: 0.4 });
      if (this.activity.t <= 0 && !this.activity.forever) this.activity = null;
      return;
    }
    // stroll the street graph
    if (!this.target) {
      const here = nav.nodes[this.navNode] || nav.nearest(this.pos);
      const options = here.links.filter((id) => id !== this.navPrev && !nav.nodes[id].restricted);
      const pick = options.length ? options[Math.floor(Math.random() * options.length)] : (here.links[0] ?? here.id);
      this.navPrev = here.id; this.navNode = pick;
      const n = nav.nodes[pick];
      this.lane = this.lane ?? rand(-1.3, 1.3);
      this.target = { x: n.x + this.lane, z: n.z + this.lane };
      if (Math.random() < 0.16) this.activity = { anim: Math.random() < 0.5 ? 'Idle_Loop' : 'Idle_Talking_Loop', t: rand(3, 8) };
    }
    const d = this.moveTowards(this.target.x, this.target.z, this.walkSpeed, dt, 4);
    if (d < 0.8) this.target = null;
    this.speed = Math.hypot(this.vel.x, this.vel.z);
    this.locomotion(false);
  }
}

// ------------------------------------------------------------------------------------------------
export class NpcManager {
  constructor(game) {
    this.game = game; this.npcs = []; this.active = []; this.bodies = [];
    this.tokens = new Set(); this.maxTokens = 2;
    this.group = new THREE.Group(); this.group.name = 'npcs';
  }

  add(kind, x, y, z, opts = {}) {
    const n = new Npc(this, kind, opts);
    n.place(x, y, z, opts.yaw || 0);
    if (!n.home) n.home = n.pos.clone();
    this.group.add(n.root); this.npcs.push(n);
    this.game.gfx.prepare(n.root);
    return n;
  }

  requestToken(n) {
    if (this.tokens.has(n)) return true;
    for (const t of this.tokens) if (t.dead || t.state !== 'combat') this.tokens.delete(t);
    if (this.tokens.size < this.maxTokens) { this.tokens.add(n); return true; }
    return false;
  }
  releaseToken(n) { this.tokens.delete(n); }

  update(dt) {
    const cam = this.game.gfx.camera.position, p = this.game.player.pos;
    this.active.length = 0;
    let slot = 0;
    for (const n of this.npcs) {
      const d = Math.hypot(n.pos.x - cam.x, n.pos.z - cam.z);
      const dp = Math.hypot(n.pos.x - p.x, n.pos.z - p.z);
      n.lod = d < 38 ? 0 : d < 85 ? 1 : 2;
      n.root.visible = d < 190;
      const shadow = d < 55;
      if (n._shadow !== shadow) { n._shadow = shadow; for (const m of n.char.meshes) m.castShadow = shadow; }
      if (n.dead && n.stateTime > 3) continue;
      // far idle characters tick slowly
      if (n.lod === 2 && !n.alerted) { n._acc = (n._acc || 0) + dt; if (n._acc < 0.25) continue; n.update(n._acc); n._acc = 0; }
      else { if (dp < 45) this.active.push(n); if (n.state === 'combat') n.slot = slot++; n.update(dt); }
    }
  }

  get anyCombat() { return this.npcs.some((n) => !n.dead && n.state === 'combat'); }
  get anySearch() { return this.npcs.some((n) => !n.dead && (n.state === 'search' || n.state === 'stunned')); }
  get maxAwareness() { let m = 0; for (const n of this.npcs) if (!n.dead && n.hostileKind) m = Math.max(m, n.awareness); return m; }

  /** closest living armed opponent near `pos`, preferring those in front (and in the input direction) */
  nearestHostile(pos, range, forward, inputDir) {
    let best = null, bs = 1e9;
    for (const n of this.npcs) {
      if (n.dead || !n.hostileKind) continue;
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z, dy = n.pos.y - pos.y; const d = Math.hypot(dx, dz);
      if (d > range || Math.abs(dy) > 1.8) continue;
      const dir = inputDir || forward; const dot = (dx * dir.x + dz * dir.z) / Math.max(d, 0.01);
      if (dot < -0.2 && d > 1.3) continue;
      const s = d - dot * 1.6 - (n.state === 'combat' ? 0.6 : 0);
      if (s < bs) { bs = s; best = n; }
    }
    return best;
  }

  /** a target that can be struck silently, or a staggered one to finish */
  bestStealthTarget(pos, forward) {
    let best = null, bs = 1e9;
    for (const n of this.npcs) {
      if (n.dead || !n.hostileKind || n.victim) continue;
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z, dy = n.pos.y - pos.y; const d = Math.hypot(dx, dz);
      if (d > 2.5 || Math.abs(dy) > 1.3) continue;
      if ((dx * forward.x + dz * forward.z) / Math.max(d, 0.01) < 0.25) continue;
      let type = null;
      if (n.state === 'stunned') type = 'finisher';
      else if (n.state !== 'combat') type = 'stealth';
      else { // in combat: only from behind
        const nf = n.forward; if ((-dx * nf.x - dz * nf.z) / Math.max(d, 0.01) < -0.45) type = 'stealth';
      }
      if (type && d < bs) { bs = d; best = { type, npc: n }; }
    }
    return best;
  }

  /** a guard below the player that a leap strike can reach */
  bestBelow(pos, forward) {
    let best = null, bs = 1e9;
    for (const n of this.npcs) {
      if (n.dead || !n.hostileKind || n.victim) continue;
      const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z; const d = Math.hypot(dx, dz); const drop = pos.y - n.pos.y;
      if (drop < 2.3 || drop > 15 || d > 3.2 + drop * 0.75 || d > 10) continue;
      if (d > 2 && (dx * forward.x + dz * forward.z) / d < 0.15) continue;
      // clear line down to the target
      _a.set(pos.x, pos.y + 1.3, pos.z); _b.set(n.pos.x, n.pos.y + 1.3, n.pos.z);
      if (!this.game.physics.lineOfSight(_a, _b)) continue;
      if (d < bs) { bs = d; best = n; }
    }
    return best;
  }
}

// ------------------------------------------------------------------------------------------------
/** A* over the street graph. */
export class Nav {
  constructor(nodes) { this.nodes = nodes; }
  nearest(p, filter = null) {
    let best = this.nodes[0], bd = 1e18;
    for (const n of this.nodes) { if (filter && !filter(n)) continue; const d = (n.x - p.x) ** 2 + (n.z - p.z) ** 2; if (d < bd) { bd = d; best = n; } }
    return best;
  }
  findPath(from, to) {
    const start = this.nearest(from), goal = this.nearest(to);
    if (start === goal) return [{ x: to.x, z: to.z }];
    const open = new Set([start.id]); const came = new Map(); const gScore = new Map([[start.id, 0]]);
    const h = (n) => Math.hypot(n.x - goal.x, n.z - goal.z);
    const fScore = new Map([[start.id, h(start)]]);
    let guard = 0;
    while (open.size && guard++ < 2000) {
      let cur = null, cf = 1e18;
      for (const id of open) { const f = fScore.get(id); if (f < cf) { cf = f; cur = id; } }
      if (cur === goal.id) {
        const path = [{ x: to.x, z: to.z }]; let c = cur;
        while (c !== undefined) { const n = this.nodes[c]; path.unshift({ x: n.x, z: n.z }); c = came.get(c); }
        // skip the first node if we are already past it
        if (path.length > 1) { const a = path[0], b = path[1]; if (Math.hypot(b.x - from.x, b.z - from.z) < Math.hypot(b.x - a.x, b.z - a.z)) path.shift(); }
        return path;
      }
      open.delete(cur);
      const n = this.nodes[cur];
      for (const id of n.links) {
        const m = this.nodes[id]; const t = gScore.get(cur) + Math.hypot(m.x - n.x, m.z - n.z);
        if (t < (gScore.get(id) ?? 1e18)) { came.set(id, cur); gScore.set(id, t); fScore.set(id, t + h(m)); open.add(id); }
      }
    }
    return [{ x: to.x, z: to.z }];
  }
}
