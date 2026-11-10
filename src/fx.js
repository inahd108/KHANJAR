// Visual effects: pooled particles (dust, sparks, blood), the sabre trail, attack glints, birds, floating motes.
import * as THREE from 'three';

const _v = new THREE.Vector3();

class ParticlePool {
  constructor(scene, max, { additive = false, size = 0.2, texture }) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.sizes = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.maxLife = new Float32Array(max).fill(1);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.grow = new Float32Array(max); this.base = new Float32Array(max * 4);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4));
    g.setAttribute('psize', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture }, scale: { value: innerHeight * 0.9 } },
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false,
      vertexShader: /* glsl */`
        attribute vec4 pcolor; attribute float psize; varying vec4 vColor; uniform float scale;
        void main() { vColor = pcolor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = psize * scale / max(0.1, -mv.z); }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec4 vColor;
        void main() { vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vColor.rgb, vColor.a * t.a); if (gl_FragColor.a < 0.004) discard; }`,
    });
    this.points = new THREE.Points(g, mat); this.points.frustumCulled = false; this.points.renderOrder = 10;
    scene.add(this.points);
  }
  spawn(p, v, color, alpha, size, life, grav = 0, drag = 0, grow = 0) {
    const i = this.i; this.i = (this.i + 1) % this.max;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this.base[i * 4] = color.r; this.base[i * 4 + 1] = color.g; this.base[i * 4 + 2] = color.b; this.base[i * 4 + 3] = alpha;
    this.sizes[i] = size; this.life[i] = life; this.maxLife[i] = life; this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d; this.vel[i * 3 + 2] *= d; this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt; this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt; this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.sizes[i] += this.grow[i] * dt;
      this.col[i * 4] = this.base[i * 4]; this.col[i * 4 + 1] = this.base[i * 4 + 1]; this.col[i * 4 + 2] = this.base[i * 4 + 2];
      this.col[i * 4 + 3] = this.base[i * 4 + 3] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 8 + 0.2);
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.pcolor.needsUpdate = true; this.geo.attributes.psize.needsUpdate = true;
  }
}

function softDot() {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Ribbon that follows the sabre during swings. */
class BladeTrail {
  constructor(scene, len = 14) {
    this.len = len; this.count = 0;
    this.pts = []; for (let i = 0; i < len; i++) this.pts.push({ a: new THREE.Vector3(), b: new THREE.Vector3(), age: 1 });
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(len * 2 * 3); this.alpha = new Float32Array(len * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1));
    const idx = []; for (let i = 0; i < len - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(vec3(1.0, 0.93, 0.8) * 1.6, vA * 0.5); }',
    });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; this.mesh.renderOrder = 11; this.mesh.visible = false;
    scene.add(this.mesh);
  }
  push(a, b) {
    for (const p of this.pts) p.age += 0.085;
    const p = this.pts.pop(); p.a.copy(a); p.b.copy(b); p.age = 0; this.pts.unshift(p);
    this.count = Math.min(this.len, this.count + 1);
    this.write();
  }
  fade(dt) { if (!this.mesh.visible) return; let any = false; for (const p of this.pts) { p.age += dt * 5; if (p.age < 1) any = true; } if (!any) { this.mesh.visible = false; this.count = 0; } else this.write(); }
  write() {
    for (let i = 0; i < this.len; i++) {
      const p = this.pts[Math.min(i, Math.max(0, this.count - 1))];
      this.pos.set([p.a.x, p.a.y, p.a.z, p.b.x, p.b.y, p.b.z], i * 6);
      const a = Math.max(0, 1 - p.age) * (i < this.count ? 1 : 0);
      this.alpha[i * 2] = a * 0.15; this.alpha[i * 2 + 1] = a;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.alpha.needsUpdate = true; this.mesh.visible = this.count > 1;
  }
}

/** A flock of pigeons wheeling over the roofs (instanced, flapping in the vertex shader). */
class Birds {
  constructor(scene, count = 70) {
    const tri = new THREE.BufferGeometry();
    // two wings + body
    tri.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.16, 0, 0, -0.14, -0.42, 0, -0.04, 0, 0, 0.16, 0.42, 0, -0.04, 0, 0, -0.14], 3));
    tri.setAttribute('wing', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 0], 1));
    this.count = count;
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: { value: 0 } }, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        attribute float wing; attribute vec4 seed; uniform float time; varying float vShade;
        void main() {
          vec3 p = position; float flap = sin(time * (9.0 + seed.w * 4.0) + seed.w * 40.0);
          p.y += wing * flap * 0.26; p.x *= 1.0 - wing * abs(flap) * 0.22;
          vec4 wp = instanceMatrix * vec4(p, 1.0);
          vShade = 0.55 + 0.45 * wing * (flap * 0.5 + 0.5);
          gl_Position = projectionMatrix * viewMatrix * modelMatrix * wp;
        }`,
      fragmentShader: 'varying float vShade; void main(){ gl_FragColor = vec4(vec3(0.34, 0.33, 0.36) * vShade * 2.2, 1.0); }',
    });
    this.mesh = new THREE.InstancedMesh(tri, mat, count); this.mesh.frustumCulled = false;
    const seeds = new Float32Array(count * 4);
    this.birds = [];
    for (let i = 0; i < count; i++) {
      const flock = i % 3;
      this.birds.push({ flock, phase: Math.random() * 6.28, r: 6 + Math.random() * 22, h: Math.random() * 7, speed: 0.22 + Math.random() * 0.12, wob: Math.random() * 6 });
      seeds.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
    }
    tri.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 4));
    this.flocks = [{ x: 20, z: -30, y: 26, rx: 70, rz: 50, s: 0.05 }, { x: 95, z: -105, y: 34, rx: 40, rz: 40, s: -0.07 }, { x: -70, z: 30, y: 24, rx: 55, rz: 60, s: 0.045 }];
    this.dummy = new THREE.Object3D();
    scene.add(this.mesh);
  }
  update(dt, time) {
    this.mesh.material.uniforms.time.value = time;
    const d = this.dummy;
    for (let i = 0; i < this.count; i++) {
      const b = this.birds[i], f = this.flocks[b.flock];
      const ca = time * f.s; const cx = f.x + Math.cos(ca) * f.rx, cz = f.z + Math.sin(ca * 1.3) * f.rz;
      const a = time * b.speed * (b.flock === 1 ? -1 : 1) + b.phase;
      const x = cx + Math.cos(a) * b.r, z = cz + Math.sin(a) * b.r * 0.8, y = f.y + b.h + Math.sin(time * 0.6 + b.wob) * 2;
      const a2 = a + 0.05 * Math.sign(b.speed * (b.flock === 1 ? -1 : 1));
      d.position.set(x, y, z);
      d.lookAt(cx + Math.cos(a2) * b.r, y + Math.cos(time * 0.6 + b.wob) * 0.1, cz + Math.sin(a2) * b.r * 0.8);
      d.updateMatrix(); this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Fx {
  constructor(gfx) {
    this.gfx = gfx; const scene = gfx.scene;
    const dot = softDot();
    this.soft = new ParticlePool(scene, 420, { texture: dot });
    this.glow = new ParticlePool(scene, 260, { texture: dot, additive: true });
    this.trail = new BladeTrail(scene);
    this.birds = new Birds(scene);
    this.time = 0;
    this.dustColor = new THREE.Color(0.78, 0.68, 0.52); this.bloodColor = new THREE.Color(0.32, 0.02, 0.02);
    this.sparkColor = new THREE.Color(1.0, 0.75, 0.35).multiplyScalar(3); this.moteColor = new THREE.Color(1.0, 0.92, 0.75).multiplyScalar(1.2);
    this.glints = [];
    this.moteTimer = 0;
  }
  dust(p, n = 6) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 1.6, Math.random() * 0.7 + 0.1, (Math.random() - 0.5) * 1.6);
      this.soft.spawn({ x: p.x + _v.x * 0.15, y: p.y + 0.08, z: p.z + _v.z * 0.15 }, _v, this.dustColor, 0.2 + Math.random() * 0.14, 0.35 + Math.random() * 0.3, 0.9 + Math.random() * 0.7, -0.15, 2.2, 0.9);
    }
  }
  sparks(p, n = 10) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 7, Math.random() * 4.5 + 0.5, (Math.random() - 0.5) * 7);
      this.glow.spawn(p, _v, this.sparkColor, 1, 0.045 + Math.random() * 0.05, 0.2 + Math.random() * 0.3, 14, 1.2, -0.05);
    }
    this.glow.spawn(p, _v.set(0, 0, 0), this.sparkColor, 0.8, 0.9, 0.09, 0, 0, -6);
  }
  blood(p, n = 8) {
    for (let i = 0; i < n; i++) {
      _v.set((Math.random() - 0.5) * 2.6, Math.random() * 2.2 + 0.3, (Math.random() - 0.5) * 2.6);
      this.soft.spawn(p, _v, this.bloodColor, 0.75, 0.06 + Math.random() * 0.07, 0.45 + Math.random() * 0.35, 11, 1.0, 0.05);
    }
  }
  /** brief flash on a guard's blade to telegraph an attack */
  glint(npc) { this.glints.push({ npc, t: 0 }); }

  update(dt, time, playerPos) {
    this.time = time;
    this.soft.update(dt); this.glow.update(dt);
    this.birds.update(dt, time);
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const gl = this.glints[i]; gl.t += dt;
      if (gl.t > 0.3 || gl.npc.dead) { this.glints.splice(i, 1); continue; }
      const s = gl.npc.char.sword; s.updateWorldMatrix(true, false);
      _v.set(0, 0, 0.75).applyMatrix4(s.matrixWorld);
      this.glow.spawn(_v, { x: 0, y: 0, z: 0 }, this.sparkColor, 0.55, 0.55 * (1 - gl.t / 0.3) + 0.1, 0.05, 0, 0, 0);
    }
    // sunlit dust motes drifting near the player
    this.moteTimer -= dt;
    if (this.moteTimer <= 0 && playerPos) {
      this.moteTimer = 0.07;
      const p = { x: playerPos.x + (Math.random() - 0.5) * 22, y: playerPos.y + Math.random() * 6, z: playerPos.z + (Math.random() - 0.5) * 22 };
      this.glow.spawn(p, _v.set((Math.random() - 0.5) * 0.25, 0.04 + Math.random() * 0.08, (Math.random() - 0.5) * 0.25), this.moteColor, 0.13, 0.035 + Math.random() * 0.03, 3.5 + Math.random() * 2, 0, 0, 0);
    }
  }
}
