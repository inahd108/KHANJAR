// Third-person orbit camera with collision, sprint FOV, shake and short cinematic framing for takedowns.
import * as THREE from 'three';

const _pivot = new THREE.Vector3(), _off = new THREE.Vector3(), _want = new THREE.Vector3(), _dir = new THREE.Vector3(), _look = new THREE.Vector3();
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

export class CameraRig {
  constructor(camera, physics) {
    this.camera = camera; this.physics = physics;
    this.yaw = 0; this.pitch = 0.18; this.dist = 4.3; this.curDist = 4.3;
    this.pivot = new THREE.Vector3(); this.pivotY = 0;
    this.fov = 58; this.shakeAmt = 0; this.time = 0;
    this.cine = null; this.cineBlend = 0;
    this.mode = 'follow'; // 'follow' | 'orbit' (menu / intro)
    this.orbit = { centre: new THREE.Vector3(), radius: 9, height: 3, speed: 0.05, angle: 0 };
    this.sens = 0.0023;
  }

  snap(player) {
    this.pivot.set(player.pos.x, player.pos.y + 1.55, player.pos.z); this.pivotY = this.pivot.y; this.curDist = this.dist;
  }

  shake(a) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  beginCinematic(player, npc, type) {
    // frame attacker and victim from the side, a little low
    const dx = npc.pos.x - player.pos.x, dz = npc.pos.z - player.pos.z;
    const base = Math.atan2(dx, dz);
    // choose the side closer to the current camera yaw to avoid a big swing
    const a1 = base + Math.PI / 2 + Math.PI, a2 = base - Math.PI / 2 + Math.PI;
    const yaw = Math.abs(angDiff(this.yaw, a1)) < Math.abs(angDiff(this.yaw, a2)) ? a1 : a2;
    this.cine = { yaw, pitch: type === 'air' ? 0.32 : 0.1, dist: type === 'air' ? 5.2 : 3.1, npc, type };
  }
  endCinematic() { if (this.cine) { this.yaw = this.yaw + angDiff(this.yaw, this.cine.yaw) * this.cineBlend; this.pitch = damp(this.pitch, 0.2, 1, 1); } this.cine = null; }

  update(dt, player, input, opts = {}) {
    this.time += dt;
    const cam = this.camera;
    if (this.mode === 'orbit') {
      const o = this.orbit; o.angle += o.speed * dt; if (o.swing) o.angle = o.base + Math.sin(this.time * 0.11) * o.swing;
      cam.position.set(o.centre.x + Math.sin(o.angle) * o.radius, o.centre.y + o.height, o.centre.z + Math.cos(o.angle) * o.radius);
      _look.copy(o.centre); if (o.look) _look.copy(o.look);
      cam.lookAt(_look);
      this.fov = damp(this.fov, o.fov || 50, 3, dt); cam.fov = this.fov; cam.updateProjectionMatrix();
      return;
    }
    if (input && input.locked) {
      this.yaw -= input.mouse.dx * this.sens;
      this.pitch = Math.min(1.25, Math.max(-1.05, this.pitch + input.mouse.dy * this.sens));
    }
    this.cineBlend = damp(this.cineBlend, this.cine ? 1 : 0, this.cine ? 7 : 4, dt);
    let yaw = this.yaw, pitch = this.pitch, dist = this.dist;
    const climbing = player.state === 'climb' || player.state === 'mantle';
    if (climbing) dist = 5.0;
    if (opts.combat) dist = 4.9;
    if (this.cine) { yaw = this.yaw + angDiff(this.yaw, this.cine.yaw) * this.cineBlend; pitch = damp(this.pitch, this.cine.pitch, 1, this.cineBlend * 4); dist = this.dist + (this.cine.dist - this.dist) * this.cineBlend; }
    else if (this.cineBlend > 0.01) { /* easing back handled by cineBlend on distance */ }

    // pivot follows the player; vertical motion is smoothed more to hide foot bobbing
    const headY = player.pos.y + (player.crouching ? 1.15 : 1.55);
    this.pivot.x = damp(this.pivot.x, player.pos.x, 18, dt);
    this.pivot.z = damp(this.pivot.z, player.pos.z, 18, dt);
    this.pivotY = damp(this.pivotY, headY, player.state === 'air' || climbing || player.state === 'takedown' ? 14 : 8, dt);
    _pivot.set(this.pivot.x, this.pivotY, this.pivot.z);
    if (this.cine) { // look between the two fighters
      _pivot.x += (this.cine.npc.pos.x - player.pos.x) * 0.5 * this.cineBlend; _pivot.z += (this.cine.npc.pos.z - player.pos.z) * 0.5 * this.cineBlend;
      _pivot.y -= 0.2 * this.cineBlend;
    }
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    _off.set(Math.sin(yaw) * cp, sp, Math.cos(yaw) * cp);
    // shoulder offset
    const shoulder = 0.42 * (1 - this.cineBlend);
    _pivot.x += Math.cos(yaw) * shoulder; _pivot.z += -Math.sin(yaw) * shoulder;
    // collision: pull the camera in if something is between it and the pivot
    let d = dist;
    const hit = this.physics.raycast(_pivot, _off, dist + 0.35);
    if (hit) d = Math.max(0.55, hit.distance - 0.3);
    this.curDist = d < this.curDist ? d : damp(this.curDist, d, 5, dt);
    _want.copy(_pivot).addScaledVector(_off, this.curDist);
    // keep above the floor
    cam.position.copy(_want);
    // shake
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.09, t = this.time * 43;
      cam.position.x += Math.sin(t * 1.3) * s; cam.position.y += Math.sin(t * 1.7 + 1.3) * s; cam.position.z += Math.sin(t * 2.1 + 4.1) * s;
      this.shakeAmt = damp(this.shakeAmt, 0, 7, dt);
    }
    _look.copy(_pivot); _look.y += 0.1;
    cam.lookAt(_look);
    const targetFov = 58 + Math.min(1, Math.max(0, (player.speed - 4.6) / 2.8)) * 8 - this.cineBlend * 10;
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(cam.fov - this.fov) > 0.02) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
