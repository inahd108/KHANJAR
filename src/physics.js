// Kinematic capsule collision + raycasts against the level BVH.
import * as THREE from 'three';

const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _triPoint = new THREE.Vector3();
const _capPoint = new THREE.Vector3();
const _ray = new THREE.Ray();
const _delta = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Physics {
  constructor(bvh) {
    this.bvh = bvh;
    this.gravity = 24;
  }

  /**
   * Resolve a capsule (feet at `pos`, given radius/height) against the world. Mutates pos.
   * Returns the total push-out vector length and writes the push direction into `out`.
   */
  resolveCapsule(pos, radius, height, out = _delta) {
    _seg.start.set(pos.x, pos.y + radius, pos.z);
    _seg.end.set(pos.x, pos.y + height - radius, pos.z);
    _box.makeEmpty();
    _box.expandByPoint(_seg.start); _box.expandByPoint(_seg.end);
    _box.min.addScalar(-radius); _box.max.addScalar(radius);
    const sx = _seg.start.x, sy = _seg.start.y, sz = _seg.start.z;
    this.bvh.shapecast({
      intersectsBounds: (box) => box.intersectsBox(_box),
      intersectsTriangle: (tri) => {
        const dist = tri.closestPointToSegment(_seg, _triPoint, _capPoint);
        if (dist < radius) {
          const depth = radius - dist;
          _n.copy(_capPoint).sub(_triPoint);
          if (_n.lengthSq() < 1e-10) tri.getNormal(_n); else _n.normalize();
          _seg.start.addScaledVector(_n, depth); _seg.end.addScaledVector(_n, depth);
        }
      },
    });
    out.set(_seg.start.x - sx, _seg.start.y - sy, _seg.start.z - sz);
    pos.add(out);
    return out;
  }

  /**
   * Move a character: integrates velocity, resolves collisions in sub-steps.
   * body: { pos, vel, radius, height, onGround, groundNormal }
   */
  move(body, dt, { gravity = true, steps = 4, snap = true } = {}) {
    const wasGrounded = body.onGround;
    if (gravity) body.vel.y -= this.gravity * dt;
    body.onGround = false;
    const sub = dt / steps;
    let hitWall = false;
    for (let i = 0; i < steps; i++) {
      body.pos.addScaledVector(body.vel, sub);
      const push = this.resolveCapsule(body.pos, body.radius, body.height, _delta);
      const len = push.length();
      if (len > 1e-6) {
        const ny = push.y / len;
        if (ny > 0.55) { // walkable ground
          body.onGround = true;
          if (body.vel.y < 0) body.vel.y = 0;
        } else if (ny < -0.5) { if (body.vel.y > 0) body.vel.y = 0; } else {
          hitWall = true;
          // remove the velocity component going into the wall
          _n.copy(push).multiplyScalar(1 / len);
          const vn = body.vel.dot(_n);
          if (vn < 0) body.vel.addScaledVector(_n, -vn);
        }
      }
    }
    // keep contact with the ground when walking down steps and ramps
    if (snap && !body.onGround && wasGrounded && body.vel.y <= 0.01) {
      const hit = this.raycast(_capPoint.set(body.pos.x, body.pos.y + 0.4, body.pos.z), DOWN, 0.4 + 0.45);
      if (hit && hit.normal.y > 0.55) { body.pos.y = hit.point.y; body.onGround = true; body.vel.y = 0; }
    }
    body.hitWall = hitWall;
    return body;
  }

  /** First hit along a ray, or null. Returns { point, normal, distance } (fresh vectors). */
  raycast(origin, dir, maxDist = 100) {
    _ray.origin.copy(origin); _ray.direction.copy(dir);
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, maxDist);
    if (!hit) return null;
    const normal = hit.face.normal.clone();
    if (normal.dot(dir) > 0) normal.negate();
    return { point: hit.point.clone(), normal, distance: hit.distance };
  }

  /** true when nothing blocks the segment a->b */
  lineOfSight(a, b) {
    _n.copy(b).sub(a); const d = _n.length();
    if (d < 1e-4) return true;
    _n.multiplyScalar(1 / d);
    _ray.origin.copy(a); _ray.direction.copy(_n);
    const hit = this.bvh.raycastFirst(_ray, THREE.DoubleSide, 0, d);
    return !hit;
  }

  groundHeight(x, z, fromY = 200) {
    const hit = this.raycast(_capPoint.set(x, fromY, z), DOWN, fromY + 50);
    return hit ? hit.point.y : 0;
  }
}

export const DOWN = new THREE.Vector3(0, -1, 0);
export const UP = new THREE.Vector3(0, 1, 0);
