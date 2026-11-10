// Rendering core: renderer, sky, sun + cascaded shadows, atmospheric height fog, post-processing.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import {
  EffectComposer, RenderPass, EffectPass, BloomEffect, SMAAEffect, SMAAPreset, ToneMappingEffect, ToneMappingMode,
  VignetteEffect, HueSaturationEffect, BrightnessContrastEffect, GodRaysEffect, KernelSize, BlendFunction, Effect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';

export const QUALITY = {
  low: { shadowSize: 1024, cascades: 3, ao: false, aoSamples: 8, smaa: SMAAPreset.LOW, godrays: false, pixelRatio: 1, maxFar: 260 },
  medium: { shadowSize: 2048, cascades: 3, ao: true, aoSamples: 8, smaa: SMAAPreset.MEDIUM, godrays: true, pixelRatio: 1, maxFar: 320 },
  high: { shadowSize: 2048, cascades: 4, ao: true, aoSamples: 12, smaa: SMAAPreset.HIGH, godrays: true, pixelRatio: Math.min(devicePixelRatio, 1.5), maxFar: 420 },
  ultra: { shadowSize: 4096, cascades: 4, ao: true, aoSamples: 16, smaa: SMAAPreset.ULTRA, godrays: true, pixelRatio: Math.min(devicePixelRatio, 2), maxFar: 480 },
};

// Direction *towards* the sun: a low morning sun in the east-south-east, so the main vista
// (looking north-east from the start tower) is side-lit with long shadows raking across the roofs.
export const SUN_DIR = new THREE.Vector3(0.80, 0.50, 0.33).normalize();
const SUN_COLOR = new THREE.Color(1.0, 0.80, 0.56);
const FOG = {
  color: new THREE.Color(0.56, 0.66, 0.78).multiplyScalar(0.56), // cool airy haze away from the sun
  sunColor: new THREE.Color(1.0, 0.82, 0.60).multiplyScalar(0.6), // warm in-scatter towards the sun
  density: 0.0021, falloff: 0.016, baseHeight: 0.0, sunPower: 6.0,
};

const glv3 = (c) => `vec3(${(c.r ?? c.x).toFixed(5)}, ${(c.g ?? c.y).toFixed(5)}, ${(c.b ?? c.z).toFixed(5)})`;

const FOG_FUNC = /* glsl */`
  vec3 atmosFogColor(vec3 dir) {
    float sunAmt = pow(max(dot(dir, ${glv3(SUN_DIR)}), 0.0), ${FOG.sunPower.toFixed(2)});
    float sunWide = pow(max(dot(dir, ${glv3(SUN_DIR)}), 0.0), 2.0);
    return mix(fogColor, ${glv3(FOG.sunColor)}, clamp(sunAmt * 0.8 + sunWide * 0.22, 0.0, 1.0));
  }
  float atmosFogFactor(vec3 camPos, vec3 dir, float dist, float density) {
    float b = ${FOG.falloff.toFixed(5)};
    float ro = max(camPos.y - ${FOG.baseHeight.toFixed(3)}, -30.0);
    float t = dir.y * b;
    float integ = abs(t) > 1e-5 ? (1.0 - exp(-dist * t)) / t : dist;
    return 1.0 - exp(-max(density * exp(-ro * b) * integ, 0.0));
  }
`;

function installFogChunks() {
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */`
    #ifdef USE_FOG
      varying vec3 vFogWorld;
    #endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */`
    #ifdef USE_FOG
      vFogWorld = cameraPosition + transpose(mat3(viewMatrix)) * mvPosition.xyz;
    #endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */`
    #ifdef USE_FOG
      uniform vec3 fogColor;
      varying vec3 vFogWorld;
      #ifdef FOG_EXP2
        uniform float fogDensity;
      #else
        uniform float fogNear;
        uniform float fogFar;
      #endif
      ${FOG_FUNC}
    #endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */`
    #ifdef USE_FOG
      vec3 fogVec = vFogWorld - cameraPosition;
      float fogDist = length(fogVec);
      vec3 fogDir = fogVec / max(fogDist, 1e-4);
      #ifdef FOG_EXP2
        float fogAmt = atmosFogFactor(cameraPosition, fogDir, fogDist, fogDensity);
      #else
        float fogAmt = smoothstep(fogNear, fogFar, fogDist);
      #endif
      gl_FragColor.rgb = mix(gl_FragColor.rgb, atmosFogColor(fogDir), fogAmt);
    #endif`;
}

// Final colour grade: gentle filmic S-curve, warm highlights / cool shadows split-tone.
class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', /* glsl */`
      uniform float uDesat;
      uniform float uPulse;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        // split toning
        vec3 shadowTint = vec3(0.94, 0.99, 1.07);
        vec3 highTint = vec3(1.08, 1.02, 0.91);
        c *= mix(shadowTint, highTint, smoothstep(0.05, 0.75, l));
        // contrast around mid grey
        c = mix(vec3(0.5), c, 1.1);
        // saturation
        l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, 1.18 * (1.0 - uDesat));
        // damage / focus pulse towards the screen edge
        float edge = smoothstep(0.35, 0.95, length(uv - 0.5) * 1.35);
        c = mix(c, c * vec3(1.0, 0.25, 0.2), edge * uPulse);
        outputColor = vec4(clamp(c, 0.0, 1.0), inputColor.a);
      }`, { uniforms: new Map([['uDesat', new THREE.Uniform(0)], ['uPulse', new THREE.Uniform(0)]]) });
  }
}

export class Gfx {
  constructor(canvas, qualityName = 'high') {
    this.q = QUALITY[qualityName] || QUALITY.high;
    this.qualityName = qualityName;
    installFogChunks();
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: false, preserveDrawingBuffer: !!window.__headless });
    renderer.setPixelRatio(this.q.pixelRatio);
    renderer.setSize(innerWidth, innerHeight);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(FOG.color, FOG.density);
    this.camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.25, 2600);
    this.camera.position.set(0, 30, 60);
    this.sunDir = SUN_DIR.clone();

    // --- cascaded shadow maps
    this.csm = new CSM({
      maxFar: this.q.maxFar, cascades: this.q.cascades, mode: 'practical', parent: this.scene,
      shadowMapSize: this.q.shadowSize, lightDirection: SUN_DIR.clone().negate(), camera: this.camera,
      lightIntensity: 4.1, lightNear: 1, lightFar: 900, lightMargin: 120, shadowBias: -0.00012,
    });
    this.csm.fade = true;
    for (const l of this.csm.lights) { l.color.copy(SUN_COLOR); l.shadow.normalBias = 0.06; }

    // soft fill from the sky hemisphere (image based light is added once the HDRI is loaded)
    this.hemi = new THREE.HemisphereLight(0xc9d6ec, 0xc09a68, 1.05);
    this.scene.add(this.hemi);

    this._prepared = new WeakSet();
    this._buildSky();
    this._buildPost();
    addEventListener('resize', () => this.resize());
  }

  async loadSky(url) {
    const hdr = await new HDRLoader().loadAsync(url);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    hdr.minFilter = THREE.LinearFilter; hdr.magFilter = THREE.LinearFilter; hdr.generateMipmaps = false;
    // locate the sun in the panorama so we can rotate it onto our sun direction
    const { data, width, height } = hdr.image;
    let best = -1, bx = 0, by = 0;
    const isHalf = data instanceof Uint16Array;
    for (let y = 0; y < height / 2; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const i = (y * width + x) * 4;
        const r = isHalf ? THREE.DataUtils.fromHalfFloat(data[i]) : data[i];
        const g = isHalf ? THREE.DataUtils.fromHalfFloat(data[i + 1]) : data[i + 1];
        const lum = r + g;
        if (lum > best) { best = lum; bx = x; by = y; }
      }
    }
    // The panorama's own sun would act as a second, unshadowed sun through image-based lighting and
    // wash out every upward-facing surface, so clamp it: the directional light supplies the real sun.
    if (isHalf) {
      const limit = THREE.DataUtils.toHalfFloat(3.2);
      for (let i = 0; i < data.length; i++) { const v = data[i]; if (v > limit && v < 0x7c00) data[i] = limit; }
    } else for (let i = 0; i < data.length; i++) if (data[i] > 3.2) data[i] = 3.2;
    hdr.needsUpdate = true;
    // equirect: u = atan2(z, x) / 2pi + 0.5 (three.js convention), v = asin(y)/pi + 0.5 (flipped rows)
    const u = (bx + 0.5) / width, v = 1 - (by + 0.5) / height;
    const flip = hdr.flipY ? 1 - v : v;
    const elev = (Math.max(v, flip) - 0.5) * Math.PI; // sun is in the upper hemisphere
    const phiTex = (u - 0.5) * Math.PI * 2; // direction in panorama: (cos(phi), y, sin(phi))
    const phiWant = Math.atan2(this.sunDir.z, this.sunDir.x);
    this.skyRotation = phiWant - phiTex;
    this.skyElevation = elev;
    this.skyUniforms.map.value = hdr;
    this.skyUniforms.rot.value = this.skyRotation;
    this.scene.environment = hdr;
    // environmentRotation rotates lookups; the sign matches the manual rotation in the dome shader
    this.scene.environmentRotation.set(0, -this.skyRotation, 0);
    this.scene.environmentIntensity = 0.95;
    this.hdr = hdr;
    return { u, v, elev, rot: this.skyRotation };
  }

  _buildSky() {
    this.skyUniforms = {
      map: { value: null }, rot: { value: 0 }, intensity: { value: 0.58 },
      fogColor: { value: FOG.color }, fogDensity: { value: FOG.density },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, depthTest: true, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
          gl_Position = p.xyww; // at the far plane
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform float rot; uniform float intensity; uniform vec3 fogColor; uniform float fogDensity;
        varying vec3 vDir;
        ${FOG_FUNC}
        float skyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float skyNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(skyHash(i), skyHash(i + vec2(1, 0)), f.x), mix(skyHash(i + vec2(0, 1)), skyHash(i + vec2(1, 1)), f.x), f.y); }
        float skyFbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * skyNoise(p); p = p * 2.03 + 11.3; a *= 0.5; } return s; }
        void main() {
          vec3 d = normalize(vDir);
          float c = cos(-rot), s = sin(-rot);
          vec3 r = vec3(c * d.x - s * d.z, d.y, s * d.x + c * d.z);
          vec2 uv = vec2(atan(r.z, r.x) * 0.15915494 + 0.5, asin(clamp(r.y, -1.0, 1.0)) * 0.31830989 + 0.5);
          vec3 sky = texture2D(map, vec2(uv.x, max(uv.y, 0.502))).rgb * intensity;
          sky = min(sky, vec3(60.0));
          // slightly richer blue overhead
          float up = clamp(d.y, 0.0, 1.0);
          sky *= mix(vec3(1.0), vec3(0.80, 0.93, 1.16), smoothstep(0.08, 0.9, up));
          // high wispy cirrus, brushed along the wind and warmed towards the sun
          if (d.y > 0.0) {
            vec2 cp = d.xz / (d.y + 0.12) * 1.6;
            float n = skyFbm(cp * vec2(0.55, 1.7) + vec2(3.7, 1.3));
            float n2 = skyFbm(cp * vec2(1.3, 3.9) + vec2(-2.1, 7.7));
            float cl = smoothstep(0.52, 0.86, n * 0.72 + n2 * 0.34) * smoothstep(0.02, 0.22, d.y);
            float sunA = max(dot(d, ${glv3(SUN_DIR)}), 0.0);
            vec3 cc = mix(vec3(0.95, 0.97, 1.02), vec3(1.5, 1.22, 0.9), pow(sunA, 3.0)) * 0.72;
            sky = mix(sky, cc, cl * 0.62);
          }
          vec3 fdir = normalize(vec3(d.x, max(d.y, 0.0006), d.z));
          float f = atmosFogFactor(cameraPosition, fdir, 6000.0, fogDensity * 0.5);
          f = mix(f, 1.0, smoothstep(0.0, -0.02, d.y));
          gl_FragColor = vec4(mix(sky, atmosFogColor(d), f), 1.0);
        }`,
    });
    const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
    sky.frustumCulled = false; sky.renderOrder = -1000; sky.matrixAutoUpdate = false;
    this.scene.add(sky);
    // bright sun disc used as the god-ray source (drawn into the scene so buildings occlude it)
    const sunMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.86, 0.62).multiplyScalar(7), fog: false, depthWrite: false });
    this.sunMesh = new THREE.Mesh(new THREE.SphereGeometry(42, 20, 12), sunMat);
    this.sunMesh.frustumCulled = false;
    this.scene.add(this.sunMesh);
  }

  _buildPost() {
    const { renderer, scene, camera, q } = this;
    const composer = this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    composer.addPass(new RenderPass(scene, camera));
    if (q.ao) {
      const ao = this.ao = new N8AOPostPass(scene, camera, innerWidth, innerHeight);
      ao.configuration.aoRadius = 1.6;
      ao.configuration.distanceFalloff = 1.0;
      ao.configuration.intensity = 2.0;
      ao.configuration.aoSamples = q.aoSamples;
      ao.configuration.denoiseSamples = 6;
      ao.configuration.denoiseRadius = 10;
      // note: N8AO's half-res path is incompatible with three r187 render targets, so AO runs at full res
      ao.configuration.halfRes = false;
      ao.configuration.gammaCorrection = false;
      ao.configuration.color = new THREE.Color(0.10, 0.08, 0.09);
      composer.addPass(ao);
    }
    const effects = [];
    if (q.godrays) {
      this.godrays = new GodRaysEffect(camera, this.sunMesh, {
        resolutionScale: 0.5, density: 0.92, decay: 0.94, weight: 0.32, exposure: 0.32, samples: 48, clampMax: 0.9, blur: true,
      });
      effects.push(this.godrays);
    }
    this.bloom = new BloomEffect({ intensity: 0.55, luminanceThreshold: 1.0, luminanceSmoothing: 0.35, mipmapBlur: true, radius: 0.72 });
    effects.push(this.bloom);
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    effects.push(this.tone);
    composer.addPass(new EffectPass(camera, ...effects));
    this.grade = new GradeEffect();
    this.vignette = new VignetteEffect({ darkness: 0.42, offset: 0.32 });
    this.smaa = new SMAAEffect({ preset: q.smaa });
    composer.addPass(new EffectPass(camera, this.smaa, this.grade, this.vignette));
    this.exposure = 1.0;
    renderer.toneMappingExposure = 1.0;
  }

  /** Make every material under `root` shadow-cascade aware (must run for anything that is lit). */
  prepare(root) {
    root.traverse((o) => {
      if (!o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) this.prepareMaterial(m);
    });
  }

  prepareMaterial(m) {
    if (this._prepared.has(m)) return;
    this._prepared.add(m);
    if (!(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial)) return;
    const prev = m.onBeforeCompile;
    this.csm.setupMaterial(m);
    const csmHook = m.onBeforeCompile;
    m.onBeforeCompile = function (shader, renderer) { prev.call(m, shader, renderer); csmHook.call(m, shader, renderer); };
    const key = (m.userData.shaderKey || '') + '|csm';
    m.customProgramCacheKey = () => key;
    m.needsUpdate = true;
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.csm.updateFrustums();
  }

  render(dt) {
    const cam = this.camera;
    this.sky.matrix.makeScale(2000, 2000, 2000).setPosition(cam.position);
    this.sky.matrixWorld.copy(this.sky.matrix);
    this.sunMesh.position.copy(cam.position).addScaledVector(this.sunDir, 1500);
    this.csm.update();
    this.renderer.info.reset();
    this.composer.render(dt);
  }
}

/** Compose an extra onBeforeCompile step onto a material while keeping program caching correct. */
export function extendMaterial(mat, key, fn) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = function (shader, renderer) { prev.call(mat, shader, renderer); fn(shader); };
  mat.userData.shaderKey = (mat.userData.shaderKey || '') + '|' + key;
  const k = mat.userData.shaderKey;
  mat.customProgramCacheKey = () => k;
  return mat;
}
