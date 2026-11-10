// audio.js — fully synthesized game audio (Web Audio API only: no files, no network).
//
// Signal flow:
//   one-shots ─► sfxBus ──┐
//   wind/murmur ► ambBus ─┼─► duck (pause) ─► master ─► compressor ─► destination
//   drone/plucks ► musicBus┘        ▲
//   (post-fader sends) ─► convolver reverb ─┘
//
// Nothing here touches `window` at import time; the AudioContext is created in unlock().

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

const MAX_VOICES = 24;     // simultaneous one-shots
const RATE_LIMIT = 0.02;   // s between identical one-shots
const MAX_DIST = 60;       // m, positional cut-off
const BPM = 104;
const STEP = 60 / BPM / 4; // 16th note
const LOOKAHEAD = 0.15;    // s scheduled ahead of the audio clock

// D Hijaz-type scale (D Eb F# G A Bb C) as semitones above the root.
const SCALE = [0, 1, 4, 5, 7, 8, 10];
const ROOT = 146.83; // D3
const degFreq = (i, root = ROOT) => {
  const oct = Math.floor(i / 7);
  return root * 2 ** ((SCALE[i - oct * 7] + 12 * oct) / 12);
};

// Combat patterns, 16 steps per bar. D = dum (bass), T = tek (rim), t = ghost tek.
const DRUMS = ['D..T..D.T.D.T.tt', 'D..T..D.t.DDT.t.', 'D..T..D.T.D.T.tt', 'D.tT.tD.TtD.TtTT'];
const _ = null;
const OSTINATI = [
  [0, _, 0, _, 1, _, 0, _, 4, _, 3, _, 1, _, 0, _],
  [0, _, 0, 7, _, 0, _, 4, 5, _, 4, _, 3, 1, 0, _],
  [0, _, 2, _, 3, _, 4, _, 5, _, 4, _, 3, _, 2, 1],
];

// Inharmonic partial sets: [frequency ratio, amplitude, decay scale].
const BELL = [[0.5, 0.45, 1], [1, 0.8, 0.8], [1.19, 0.5, 0.6], [1.5, 0.3, 0.45], [2, 0.6, 0.4],
  [2.51, 0.25, 0.28], [2.66, 0.2, 0.25], [3.01, 0.22, 0.2], [4.07, 0.14, 0.14], [5.33, 0.08, 0.1]];
const BLADE = [[1, 1, 1], [1.47, 0.7, 0.8], [2.09, 0.6, 0.7], [2.56, 0.5, 0.55], [3.39, 0.4, 0.45],
  [4.08, 0.3, 0.35], [5.33, 0.25, 0.3], [6.71, 0.2, 0.2]];
const ANVIL = [[1, 1, 1], [1.59, 0.6, 0.7], [2.37, 0.4, 0.5], [3.21, 0.3, 0.4]];

// ---------------------------------------------------------------- buffer generation

/** Seamlessly looping noise buffer: 'white' | 'pink' | 'brown', peak-normalised. */
function makeNoise(ctx, color, seconds = 4) {
  const sr = ctx.sampleRate, len = Math.floor(sr * seconds), fade = 2048;
  const raw = new Float32Array(len + fade);
  let b0 = 0, b1 = 0, b2 = 0, last = 0, peak = 1e-6;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    let v = w;
    if (color === 'pink') {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      v = b0 + b1 + b2 + w * 0.1848;
    } else if (color === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      v = last;
    }
    raw[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    // Cross-fade the head with the samples that follow the tail so the loop point is continuous.
    const k = i < fade ? i / fade : 1;
    out[i] = (k < 1 ? raw[i] * Math.sqrt(k) + raw[len + i] * Math.sqrt(1 - k) : raw[i]) / peak;
  }
  return buf;
}

/** Stereo decaying-noise impulse response for the convolution reverb. */
function makeImpulse(ctx, seconds = 2.6) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len, w = Math.random() * 2 - 1;
      lp += 0.3 * (w - lp); // the tail gets darker than the onset
      d[i] = (lp * 0.75 + w * 0.25 * (1 - t)) * (1 - t) ** 3.2;
    }
  }
  return buf;
}

/** Karplus-Strong plucked string rendered into a buffer. Returns { buf, freq: actual pitch }. */
function renderPluck(ctx, freq, t60 = 1.7, bright = 0.55) {
  const sr = ctx.sampleRate;
  const n = Math.max(2, Math.round(sr / freq - 0.5));
  const len = Math.floor(sr * Math.min(2.4, t60 * 1.15));
  const buf = ctx.createBuffer(1, len, sr), out = buf.getChannelData(0);
  const ring = new Float32Array(n);
  let lp = 0, mean = 0;
  for (let i = 0; i < n; i++) { // excitation: softened noise = finger/plectrum on gut
    lp += bright * (Math.random() * 2 - 1 - lp);
    ring[i] = lp;
    mean += lp / n;
  }
  for (let i = 0; i < n; i++) ring[i] -= mean;
  const damp = 10 ** (-3 / (freq * t60));
  let idx = 0, peak = 1e-6;
  for (let i = 0; i < len; i++) {
    const nxt = idx + 1 === n ? 0 : idx + 1, v = ring[idx];
    out[i] = v;
    peak = Math.max(peak, Math.abs(v));
    ring[idx] = damp * 0.5 * (v + ring[nxt]);
    idx = nxt;
  }
  const tail = Math.min(len, 400);
  for (let i = 0; i < len; i++) out[i] *= (0.9 / peak) * Math.min(1, (len - i) / tail);
  return { buf, freq: sr / (n + 0.5) };
}

// ---------------------------------------------------------------- one-shot recipes
// Each recipe is (a: AudioSystem, d: destination node, t: start time, p: pitch) => duration (s).

const SFX = {
  // --- movement
  step(a, d, t, p) {
    a._noise(d, t, { freq: 850 * p, q: 1.1, dur: 0.08, gain: 0.3 });               // heel scuff
    a._noise(d, t + 0.03, { freq: 1500 * p, q: 1.5, dur: 0.04, gain: 0.1 });        // toe
    a._noise(d, t, { type: 'highpass', freq: 3200, dur: 0.03, gain: 0.06 });        // grit
    a._tone(d, t, { freq: 105 * p, freqEnd: 58, dur: 0.1, gain: 0.4 });             // thump
    return 0.15;
  },
  stepSoft(a, d, t, p) {
    a._noise(d, t, { type: 'lowpass', freq: 650 * p, dur: 0.07, gain: 0.1 });
    a._tone(d, t, { freq: 82 * p, freqEnd: 52, dur: 0.07, gain: 0.13 });
    return 0.12;
  },
  jump(a, d, t, p) {
    a._noise(d, t, { freq: 1900 * p, freqEnd: 900, q: 0.8, dur: 0.2, gain: 0.2, attack: 0.03 });
    a._formant(d, t, { dur: 0.15, gain: 0.1, breath: 1, formants: [[650 * p, 4, 1], [1300 * p, 5, 0.5]] });
    return 0.25;
  },
  land(a, d, t, p) {
    a._tone(d, t, { freq: 112 * p, freqEnd: 46, dur: 0.18, gain: 0.6 });
    a._noise(d, t, { type: 'lowpass', freq: 520, dur: 0.1, gain: 0.25 });
    a._noise(d, t + 0.01, { freq: 1200 * p, q: 1, dur: 0.06, gain: 0.1 });
    return 0.25;
  },
  landHeavy(a, d, t, p) {
    a._tone(d, t, { freq: 92 * p, freqEnd: 34, dur: 0.34, gain: 0.75 });
    a._noise(d, t, { color: 'brown', type: 'lowpass', freq: 320, dur: 0.28, gain: 0.4 });
    a._noise(d, t, { freq: 2400, q: 0.8, dur: 0.3, gain: 0.14, attack: 0.01 });      // grit spray
    for (let i = 0; i < 4; i++) {
      a._noise(d, t + rand(0.05, 0.3), { type: 'highpass', freq: rand(2500, 5000), dur: 0.025, gain: 0.05 });
    }
    return 0.45;
  },
  roll(a, d, t, p) {
    for (let i = 0; i < 3; i++) {
      a._noise(d, t + i * 0.13, { freq: rand(1100, 1900) * p, freqEnd: 800, q: 0.8, dur: 0.2, gain: 0.18, attack: 0.05 });
    }
    a._tone(d, t + 0.05, { freq: 95 * p, freqEnd: 55, dur: 0.12, gain: 0.3 });
    a._tone(d, t + 0.3, { freq: 85 * p, freqEnd: 50, dur: 0.12, gain: 0.22 });
    return 0.55;
  },
  climbGrab(a, d, t, p) {
    a._noise(d, t, { freq: 1400 * p, q: 2, dur: 0.045, gain: 0.3 });
    a._tone(d, t, { freq: 185 * p, freqEnd: 110, dur: 0.05, gain: 0.2 });
    return 0.1;
  },
  cloth(a, d, t, p) {
    a._noise(d, t, { freq: 2200 * p, freqEnd: 1200, q: 0.8, dur: 0.24, gain: 0.15, attack: 0.07 });
    return 0.28;
  },
  whoosh(a, d, t, p) {
    a._noise(d, t, { freq: 450 * p, freqEnd: 2100 * p, q: 1.5, dur: 0.5, gain: 0.3, attack: 0.22 });
    a._noise(d, t + 0.1, { color: 'pink', freq: 900 * p, freqEnd: 350, q: 0.9, dur: 0.45, gain: 0.2, attack: 0.15 });
    return 0.6;
  },

  // --- combat
  drawSword(a, d, t, p) {
    a._noise(d, t, { freq: 2600 * p, freqEnd: 6500 * p, q: 6, dur: 0.36, gain: 0.22, attack: 0.05 });
    a._noise(d, t, { freq: 4200 * p, freqEnd: 9000, q: 10, dur: 0.33, gain: 0.12, attack: 0.08 });
    a._partials(d, t + 0.27, 3100 * p, ANVIL, 0.7, 0.05);                          // blade leaves the scabbard
    return 1.0;
  },
  sheathe(a, d, t, p) {
    a._noise(d, t, { freq: 6000 * p, freqEnd: 2300 * p, q: 6, dur: 0.3, gain: 0.2, attack: 0.03 });
    a._tone(d, t + 0.27, { freq: 210 * p, freqEnd: 120, dur: 0.06, gain: 0.3 });   // guard meets the throat
    a._noise(d, t + 0.27, { freq: 1800, q: 1.5, dur: 0.03, gain: 0.15 });
    return 0.4;
  },
  swing(a, d, t, p) {
    a._noise(d, t, { freq: 900 * p, freqEnd: 2700 * p, q: 2.5, dur: 0.2, gain: 0.3, attack: 0.08 });
    return 0.25;
  },
  swingHeavy(a, d, t, p) {
    a._noise(d, t, { freq: 520 * p, freqEnd: 1900 * p, q: 2, dur: 0.32, gain: 0.38, attack: 0.14 });
    a._noise(d, t, { color: 'pink', freq: 220 * p, freqEnd: 520, q: 1, dur: 0.3, gain: 0.2, attack: 0.12 });
    return 0.38;
  },
  clang(a, d, t, p) {
    a._partials(d, t, rand(1000, 1300) * p, BLADE, 0.6, 0.17);
    a._noise(d, t, { type: 'highpass', freq: 4000, dur: 0.025, gain: 0.3 });
    return 0.7;
  },
  parry(a, d, t, p) {
    const f = rand(1600, 1900) * p;
    a._partials(d, t, f, BLADE, 0.7, 0.15);
    a._partials(d, t, f * 3.02, [[1, 0.6, 1], [1.007, 0.6, 0.9], [1.52, 0.35, 0.6]], 0.9, 0.07); // beating shimmer
    a._noise(d, t, { type: 'highpass', freq: 7000, dur: 0.22, gain: 0.12 });
    return 1.0;
  },
  hitFlesh(a, d, t, p) {
    a._tone(d, t, { freq: 145 * p, freqEnd: 60, dur: 0.13, gain: 0.6 });
    a._noise(d, t, { color: 'brown', type: 'lowpass', freq: 700, dur: 0.09, gain: 0.35 });
    a._noise(d, t, { freq: 1100 * p, q: 0.8, dur: 0.04, gain: 0.1 });
    return 0.2;
  },
  stab(a, d, t, p) {
    a._noise(d, t, { freq: 3000 * p, q: 1, dur: 0.045, gain: 0.3 });
    a._partials(d, t, 2400 * p, ANVIL, 0.12, 0.04);
    a._tone(d, t + 0.012, { freq: 100 * p, freqEnd: 50, dur: 0.16, gain: 0.55 });
    return 0.25;
  },
  death(a, d, t, p) {
    a._formant(d, t, { dur: 0.3, gain: 0.1, breath: 1, attack: 0.04, formants: [[600 * p, 4, 1], [1100 * p, 5, 0.5]] });
    a._noise(d, t + 0.05, { freq: 1700, freqEnd: 900, q: 0.8, dur: 0.3, gain: 0.14, attack: 0.08 });
    a._tone(d, t + 0.28, { freq: 86 * p, freqEnd: 40, dur: 0.3, gain: 0.6 });       // body
    a._noise(d, t + 0.28, { color: 'brown', type: 'lowpass', freq: 400, dur: 0.25, gain: 0.35 });
    a._tone(d, t + 0.46, { freq: 74 * p, freqEnd: 42, dur: 0.18, gain: 0.3 });      // limb settles
    a._noise(d, t + 0.44, { freq: 1400, freqEnd: 800, q: 0.8, dur: 0.22, gain: 0.1, attack: 0.05 });
    return 0.8;
  },
  grunt(a, d, t, p) {
    a._formant(d, t, { f0: 108 * p, f0End: 80 * p, dur: rand(0.15, 0.2), gain: 0.3, breath: 0.4,
      formants: [[560 * p, 5, 1], [950 * p, 6, 0.6], [2400, 8, 0.15]] });
    return 0.25;
  },

  // --- AI
  suspicious(a, d, t, p) {
    a._pluck(d, t, 185 * p, { gain: 0.34, bright: 3400 });                          // F#3 ...
    a._pluck(d, t + 0.15, 261.63 * p, { gain: 0.38, bright: 3800 });                // ... up to C4: unresolved
    return 1.6;
  },
  alert(a, d, t, p) {
    for (const f of [73.42, 73.42 * 1.013, 155.56 * 0.992, 155.56 * 1.006, 220.4]) {
      a._tone(d, t, { type: 'sawtooth', freq: f * p, dur: 1.6, gain: 0.14, attack: 0.04, lp: 1100 });
    }
    a._dum(d, t, 1);
    a._noise(d, t, { color: 'brown', type: 'lowpass', freq: 240, dur: 0.5, gain: 0.3 });
    return 1.7;
  },
  guardShout(a, d, t, p) {
    const fm = [[780 * p, 4, 1], [1300 * p, 5, 0.7], [2800, 6, 0.4]];
    a._formant(d, t, { f0: 175 * p, f0End: 190 * p, dur: 0.09, gain: 0.3, breath: 0.25, formants: fm });
    a._formant(d, t + 0.1, { f0: 215 * p, f0End: 150 * p, dur: 0.24, gain: 0.45, breath: 0.2, formants: fm });
    return 0.4;
  },
  crowdGasp(a, d, t, p) {
    a._noise(d, t, { color: 'pink', freq: 1200 * p, freqEnd: 2300 * p, q: 0.8, dur: 0.75, gain: 0.22, attack: 0.28 });
    a._noise(d, t, { color: 'pink', freq: 600 * p, freqEnd: 900 * p, q: 1.2, dur: 0.6, gain: 0.14, attack: 0.22 });
    return 0.85;
  },

  // --- world / UI
  bell(a, d, t, p) {
    a._bell(d, t, 220 * p, 0.9, 4.5);
    return 4.6;
  },
  uiClick(a, d, t, p) {
    a._tone(d, t, { freq: 1300 * p, freqEnd: 800 * p, dur: 0.045, gain: 0.22, attack: 0.001 });
    a._noise(d, t, { type: 'highpass', freq: 5000, dur: 0.012, gain: 0.07 });
    return 0.08;
  },
  uiHover(a, d, t, p) {
    a._tone(d, t, { freq: 2100 * p, dur: 0.04, gain: 0.07, attack: 0.002 });
    return 0.07;
  },
  objective(a, d, t) {
    [220, 293.66, 369.99].forEach((f, i) => {                                      // A3 D4 F#4
      a._pluck(d, t + i * 0.13, f, { gain: 0.34 + i * 0.03, bright: 4200 });
    });
    a._tone(d, t + 0.26, { freq: 739.98, dur: 0.9, gain: 0.04, attack: 0.01 });     // soft sparkle
    return 1.9;
  },
  missionComplete(a, d, t) {
    const times = [0, 0.16, 0.32, 0.48, 0.62, 0.78, 1.0];
    [0, 4, 7, 8, 9, 11, 14].forEach((deg, i) => {
      a._pluck(d, t + times[i], degFreq(deg), { gain: 0.3 + i * 0.015, bright: 3600 });
    });
    [7, 11, 14, 16].forEach((deg, i) => {                                          // final strum
      a._pluck(d, t + 1.36 + i * 0.028, degFreq(deg), { gain: 0.3, bright: 4200 });
    });
    a._pluck(d, t + 1.36, ROOT / 2, { gain: 0.4, bright: 1800, single: true });
    a._dum(d, t, 0.45);
    a._tek(d, t + 1.0, 0.25);
    a._dum(d, t + 1.36, 0.6);
    return 3.4;
  },
  fail(a, d, t) {
    for (const f of [110, 110 * 1.011, 116.54]) {
      a._tone(d, t, { type: 'sawtooth', freq: f, freqEnd: f * 0.6, dur: 2.2, gain: 0.2, attack: 0.15, lp: 480 });
    }
    a._tone(d, t, { freq: 55, freqEnd: 34, dur: 2.2, gain: 0.3, attack: 0.2 });
    return 2.3;
  },
};

// ---------------------------------------------------------------- the system

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this._failed = false;
    this.masterVolume = 0.8;
    this.musicVolume = 0.5;
    this.muted = false;
    this.state = { combat: false, tension: 0, height: 0, speed: 0, crowd: 0.3, paused: false };
    this._lis = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 };
    this._voices = [];             // live one-shot voices awaiting cleanup
    this._sfxCount = 0;
    this._lastPlayed = new Map();  // name -> ctx time
    this._last = new WeakMap();    // AudioParam -> last smoothed target
    this._plucks = new Map();      // semitone -> rendered string buffer
    // ambience / music runtime
    this._gust = 1; this._gustTarget = 1; this._gustT = 0;
    this._eventT = rand(6, 14);
    this._bellT = rand(50, 110);
    this._mix = 0;                 // combat cross-fade 0..1
    this._seqOn = false; this._step = 0; this._bar = 0; this._nextStep = 0;
    this._nextPhrase = 0;
  }

  // ------------------------------------------------------------ public API

  unlock() {
    if (this.ctx) {
      if (this.ctx.state !== 'running' && this.ctx.state !== 'closed') this._resume();
      return;
    }
    if (this._failed) return;
    const AC = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (!AC) { this._failed = true; return; }
    try {
      this.ctx = new AC();
      this._build();
      this._resume();
    } catch {
      try { this.ctx?.close?.(); } catch { /* ignore */ }
      this.ctx = null;
      this._failed = true;
    }
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  setListener(pos, forward) {
    const L = this._lis;
    if (pos) { L.x = num(pos.x, L.x); L.y = num(pos.y, L.y); L.z = num(pos.z, L.z); }
    if (forward) { L.fx = num(forward.x, L.fx); L.fy = num(forward.y, L.fy); L.fz = num(forward.z, L.fz); }
  }

  play(name, opts = {}) {
    if (!this.ready || !Object.hasOwn(SFX, name)) return;
    try {
      const now = this.ctx.currentTime;
      if (now - (this._lastPlayed.get(name) ?? -1) < RATE_LIMIT) return;
      this._prune(now);
      if (this._sfxCount >= MAX_VOICES) return;
      const o = opts ?? {};
      const sp = this._spatial(o.pos);
      if (!sp) return;
      const vol = clamp(num(o.volume, 1), 0, 2) * sp.gain;
      if (vol < 0.0005) return;
      this._lastPlayed.set(name, now);
      const pitch = clamp(num(o.pitch, 1), 0.25, 4) * rand(0.95, 1.05);
      const v = this._openVoice(this.sfxBus, vol, sp.pan, true);
      v.end = now + SFX[name](this, v.node, now, pitch) + 0.2;
    } catch { /* audio must never break the game loop */ }
  }

  setState(state) {
    if (!state || typeof state !== 'object') return;
    const s = this.state;
    if ('combat' in state) s.combat = !!state.combat;
    if ('paused' in state) s.paused = !!state.paused;
    if ('tension' in state) s.tension = clamp(num(state.tension, s.tension), 0, 1);
    if ('crowd' in state) s.crowd = clamp(num(state.crowd, s.crowd), 0, 1);
    if ('height' in state) s.height = Math.max(0, num(state.height, s.height));
    if ('speed' in state) s.speed = Math.max(0, num(state.speed, s.speed));
    this._applyLevels();
  }

  update(dt) {
    if (!this.ready) return;
    try {
      const d = clamp(num(dt, 0), 0, 0.1), now = this.ctx.currentTime;
      this._prune(now);
      this._updateAmbience(d, now);
      this._updateMusic(d, now);
    } catch { /* ignore */ }
  }

  setMasterVolume(v) { this.masterVolume = clamp(num(v, this.masterVolume), 0, 1); this._applyLevels(); }
  setMusicVolume(v) { this.musicVolume = clamp(num(v, this.musicVolume), 0, 1); this._applyLevels(); }
  setMuted(muted) { this.muted = !!muted; this._applyLevels(); }

  // ------------------------------------------------------------ graph construction

  _resume() {
    try { this.ctx.resume?.()?.catch?.(() => {}); } catch { /* ignore */ }
  }

  _gain(value, dest) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    if (dest) g.connect(dest);
    return g;
  }

  _filter(type, freq, q = 0.7, dest) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  /** StereoPanner where supported, otherwise a pass-through gain. */
  _pan(value, dest) {
    const ctx = this.ctx;
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = value;
    if (dest) p.connect(dest);
    return p;
  }

  /** Endless noise source feeding `dest`. */
  _loop(color, rate, dest) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._buf[color];
    src.loop = true;
    src.playbackRate.value = rate;
    src.connect(dest);
    src.start(0, rand(0, 3));
    return src;
  }

  _osc(type, freq, dest) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    o.connect(dest);
    o.start();
    return o;
  }

  _build() {
    const ctx = this.ctx;
    this._buf = { white: makeNoise(ctx, 'white'), pink: makeNoise(ctx, 'pink'), brown: makeNoise(ctx, 'brown') };

    // master gain -> gentle compressor -> destination
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 20; comp.ratio.value = 3;
    comp.attack.value = 0.008; comp.release.value = 0.25;
    comp.connect(ctx.destination);
    this.master = this._gain(this.muted ? 0 : this.masterVolume, comp);
    this.duck = this._gain(this.state.paused ? 0.25 : 1, this.master);
    this.sfxBus = this._gain(0.9, this.duck);
    this.ambBus = this._gain(0.8, this.duck);
    this.musicBus = this._gain(this.musicVolume, this.duck);

    // shared reverb, fed post-fader so bus volumes also scale their reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = makeImpulse(ctx);
    this.reverb.connect(this._gain(0.6, this.duck));
    this.sfxBus.connect(this._gain(0.07, this.reverb));
    this.musicBus.connect(this._gain(0.3, this.reverb));

    this._buildAmbience();
    this._buildMusic();
    this._nextPhrase = ctx.currentTime + rand(3, 6);
  }

  _buildAmbience() {
    // wind: body (resonant low-pass) + airy hiss, both driven from update()
    this.windFilter = this._filter('lowpass', 300, 1.4);
    this.windGain = this._gain(0, this.ambBus);
    this.windFilter.connect(this.windGain);
    this._loop('pink', 0.9, this.windFilter);
    this.airGain = this._gain(0, this.ambBus);
    this._loop('white', 1, this._filter('bandpass', 4500, 0.6, this.airGain));

    // crowd walla: two dark bands of pink noise, each slowly undulating
    this.murmurGain = this._gain(0, this.ambBus);
    const bands = [[380, 0.9, 0.7, 0.23, 0.3], [950, 1.4, 0.3, 0.41, 0.18]];
    for (const [freq, q, level, lfoHz, depth] of bands) {
      const g = this._gain(level, this.murmurGain);
      this._loop('pink', rand(0.6, 0.8), this._filter('bandpass', freq, q, g));
      this._osc('sine', lfoHz, this._gain(depth, g.gain));
    }

    // distant one-off events: dulled, pushed back into the reverb
    this.ambEvents = this._filter('lowpass', 4500, 0.5, this.ambBus);
    this.ambEvents.connect(this._gain(0.45, this.reverb));
  }

  _buildMusic() {
    const ctx = this.ctx;
    // drone: detuned saws on D2 with a soft octave and fifth
    this.droneFilter = this._filter('lowpass', 260, 1.2);
    this.droneGain = this._gain(0, this.musicBus);
    this.droneFilter.connect(this.droneGain);
    for (const [type, f, g] of [['sawtooth', 73.42, 0.5], ['sawtooth', 73.42 * 1.004, 0.5],
      ['triangle', 146.83 * 0.998, 0.25], ['sine', 110, 0.18]]) {
      this._osc(type, f, this._gain(g, this.droneFilter));
    }

    // tension: low tone pulsing at the combat tempo (amp = 0.5 +/- 0.5 via LFO)
    this.tensionGain = this._gain(0, this.musicBus);
    const pulse = this._gain(0.5, this.tensionGain);
    const pulseLp = this._filter('lowpass', 230, 0.8, pulse);
    this._osc('sawtooth', 73.42, this._gain(0.7, pulseLp));
    this._osc('sine', 155.56, this._gain(0.22, pulseLp)); // Eb3 rub against the root
    this._osc('sine', BPM / 60, this._gain(0.5, pulse.gain));

    // plucked strings: dry + a little body resonance + ping-pong delay
    this.pluckMix = this._gain(1);
    const body = this._filter('peaking', 240, 1, this.musicBus);
    body.gain.value = 3;
    this.pluckMix.connect(body);
    const dl = ctx.createDelay(1), dr = ctx.createDelay(1);
    dl.delayTime.value = 0.31; dr.delayTime.value = 0.47;
    this.pluckMix.connect(this._gain(0.26, dl));
    dl.connect(this._filter('lowpass', 1800, 0.5, this._gain(0.42, dr)));
    dr.connect(this._gain(0.34, dl));
    dl.connect(this._pan(-0.6, this.musicBus));
    dr.connect(this._pan(0.6, this.musicBus));

    this.mExplore = this._gain(1, this.pluckMix);  // free phrases
    this.mOst = this._gain(0, this.pluckMix);      // combat ostinato
    this.mDrums = this._gain(0, this.musicBus);    // combat frame drum
  }

  // ------------------------------------------------------------ level helpers

  _applyLevels() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.masterVolume, now, 0.03);
    this.duck.gain.setTargetAtTime(this.state.paused ? 0.25 : 1, now, 0.08);
    this.musicBus.gain.setTargetAtTime(this.musicVolume, now, 0.05);
  }

  /** Smoothly steer a param; skips redundant automation events. */
  _set(param, value, tc = 0.15) {
    if (Math.abs(this._last.get(param) - value) < 1e-4) return;
    this._last.set(param, value);
    param.setTargetAtTime(value, this.ctx.currentTime, tc);
  }

  /** Distance gain + stereo pan for a world position (null = out of earshot). */
  _spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const L = this._lis;
    const dx = num(pos.x) - L.x, dy = num(pos.y) - L.y, dz = num(pos.z) - L.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > MAX_DIST) return null;
    const gain = clamp(1 / (1 + (dist / 8) ** 2), 0, 1);
    // right = forward x up(0,1,0) = (-fz, 0, fx)
    const rx = -L.fz, rz = L.fx, rl = Math.hypot(rx, rz) || 1;
    const pan = dist > 0.05 ? clamp((dx * rx + dz * rz) / (rl * dist), -1, 1) * 0.85 : 0;
    return { gain, pan };
  }

  // ------------------------------------------------------------ voices

  _openVoice(bus, gain, pan, sfx) {
    const node = this._gain(gain);
    let tail = node;
    if (pan && this.ctx.createStereoPanner) {
      tail = this._pan(pan);
      node.connect(tail);
    }
    tail.connect(bus);
    const v = { node, tail, end: this.ctx.currentTime + 1, sfx };
    this._voices.push(v);
    if (sfx) this._sfxCount++;
    return v;
  }

  _prune(now) {
    const vs = this._voices;
    let w = 0;
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.end > now) { vs[w++] = v; continue; }
      v.node.disconnect();
      if (v.tail !== v.node) v.tail.disconnect();
      if (v.sfx) this._sfxCount--;
    }
    vs.length = w;
  }

  // ------------------------------------------------------------ synthesis primitives
  // Each primitive disconnects itself when its source ends, so nothing accumulates.

  /** Fast attack / exponential decay envelope. */
  _env(param, t, peak, attack, dur) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(Math.max(peak, 0.0002), t + Math.min(attack, dur * 0.9));
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  /** Filtered noise burst. o: { color, type, freq, freqEnd, q, dur, gain, attack } */
  _noise(dest, t, o) {
    const ctx = this.ctx, dur = o.dur, color = o.color ?? 'white';
    const type = o.type ?? 'bandpass', q = o.q ?? 1;
    const src = ctx.createBufferSource();
    src.buffer = this._buf[color];
    src.loop = true;
    const f = this._filter(type, o.freq, q);
    f.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    // Loudness compensation so `gain` is roughly comparable across bandwidths.
    const mid = Math.sqrt(o.freq * (o.freqEnd ?? o.freq));
    let comp = 1;
    if (type === 'bandpass') comp = Math.min(6, Math.sqrt((8000 * q) / mid));
    else if (type === 'lowpass') comp = Math.min(6, Math.sqrt(8000 / mid));
    if (color === 'pink') comp = 1 + 0.6 * comp;
    else if (color === 'brown') comp = 1.3;
    const g = ctx.createGain();
    this._env(g.gain, t, (o.gain ?? 0.3) * comp, o.attack ?? 0.003, dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, rand(0, 3));
    src.stop(t + dur + 0.03);
    src.onended = () => g.disconnect();
  }

  /** Enveloped oscillator. o: { type, freq, freqEnd, sweep, dur, gain, attack, lp } */
  _tone(dest, t, o) {
    const ctx = this.ctx, dur = o.dur;
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t);
    if (o.freqEnd) osc.frequency.exponentialRampToValueAtTime(o.freqEnd, t + (o.sweep ?? dur));
    const g = ctx.createGain();
    this._env(g.gain, t, o.gain ?? 0.4, o.attack ?? 0.004, dur);
    (o.lp ? osc.connect(this._filter('lowpass', o.lp)) : osc).connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.03);
    osc.onended = () => g.disconnect();
  }

  /** Bank of decaying sine partials (metal, bells). list: [[ratio, amp, decayScale], ...] */
  _partials(dest, t, base, list, dur, gain) {
    const ctx = this.ctx, sum = this._gain(gain, dest);
    let longest = 0, lastOsc = null;
    for (const [ratio, amp, decay] of list) {
      const osc = ctx.createOscillator(), g = ctx.createGain(), d = dur * decay;
      osc.frequency.value = base * ratio * rand(0.997, 1.003);
      this._env(g.gain, t, amp, 0.002, d);
      osc.connect(g).connect(sum);
      osc.start(t);
      osc.stop(t + d + 0.03);
      if (d >= longest) { longest = d; lastOsc = osc; }
    }
    if (lastOsc) lastOsc.onended = () => sum.disconnect();
  }

  /** Voice-like bark/breath: saw + noise through parallel formant band-passes (no words).
   *  o: { f0?, f0End?, dur, gain, attack, breath 0..1, formants: [[freq, q, amp], ...] } */
  _formant(dest, t, o) {
    const ctx = this.ctx, dur = o.dur, breath = o.breath ?? 0.3;
    const env = ctx.createGain(), pre = ctx.createGain();
    this._env(env.gain, t, (o.gain ?? 0.3) * 3, o.attack ?? 0.015, dur);
    const n = ctx.createBufferSource();
    n.buffer = this._buf.white;
    n.loop = true;
    n.connect(this._gain(breath * 3, pre));
    n.start(t, rand(0, 3));
    n.stop(t + dur + 0.03);
    n.onended = () => env.disconnect();
    if (o.f0) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(o.f0, t);
      osc.frequency.exponentialRampToValueAtTime(o.f0End ?? o.f0 * 0.8, t + dur);
      osc.connect(this._gain(1 - breath, pre));
      osc.start(t);
      osc.stop(t + dur + 0.03);
    }
    for (const [freq, q, amp] of o.formants) {
      pre.connect(this._filter('bandpass', freq, q, this._gain(amp, env)));
    }
    env.connect(dest);
  }

  _bell(dest, t, freq, gain = 1, dur = 4.5) {
    this._partials(dest, t, freq, BELL, dur, gain * 0.22);
    this._noise(dest, t, { freq: freq * 3, q: 1.5, dur: 0.07, gain: gain * 0.2 }); // clapper strike
  }

  /** Frame drum bass stroke. */
  _dum(dest, t, g = 1) {
    this._tone(dest, t, { freq: 130, freqEnd: 62, sweep: 0.12, dur: 0.34, gain: 0.8 * g, attack: 0.002 });
    this._noise(dest, t, { freq: 220, q: 1.2, dur: 0.12, gain: 0.12 * g });
    this._noise(dest, t, { type: 'highpass', freq: 2500, dur: 0.012, gain: 0.12 * g });
  }

  /** Frame drum rim stroke. */
  _tek(dest, t, g = 1) {
    this._noise(dest, t, { freq: 2800, q: 1.6, dur: 0.07, gain: 0.4 * g, attack: 0.001 });
    this._tone(dest, t, { type: 'triangle', freq: 520, freqEnd: 380, dur: 0.06, gain: 0.22 * g, attack: 0.001 });
  }

  _pluckBuffer(freq) {
    const semi = Math.round(12 * Math.log2(freq / 55));
    let p = this._plucks.get(semi);
    if (!p) {
      const f = 55 * 2 ** (semi / 12);
      p = renderPluck(this.ctx, f, clamp(2.3 - f / 500, 1.1, 2.2));
      this._plucks.set(semi, p);
    }
    return p;
  }

  /** Oud-like pluck: cached Karplus-Strong string, doubled as a detuned course.
   *  o: { gain, bright (low-pass Hz), single (one string only) } */
  _pluck(dest, t, freq, o = {}) {
    const ctx = this.ctx, p = this._pluckBuffer(freq);
    const g = this._gain(o.gain ?? 0.3, dest);
    const f = this._filter('lowpass', (o.bright ?? 3200) * rand(0.9, 1.1), 0.6, g);
    const cents = o.single ? [0] : [-4, 5];
    cents.forEach((c, i) => {
      const s = ctx.createBufferSource();
      s.buffer = p.buf;
      s.playbackRate.value = (freq / p.freq) * 2 ** (c / 1200);
      s.connect(f);
      s.start(Math.max(0, t + i * 0.004));
      if (i === cents.length - 1) s.onended = () => g.disconnect();
    });
  }

  // ------------------------------------------------------------ ambience

  _updateAmbience(dt, now) {
    const s = this.state;
    // slow random gusting
    this._gustT -= dt;
    if (this._gustT <= 0) { this._gustTarget = rand(0.55, 1.35); this._gustT = rand(2.5, 7); }
    this._gust += (this._gustTarget - this._gust) * Math.min(1, dt * 0.5);
    const gust = this._gust;
    const h = clamp(s.height / 35, 0, 1), sp = clamp(s.speed / 9, 0, 1);

    this._set(this.windGain.gain, (0.1 + 0.55 * h ** 0.8 + 0.1 * sp) * gust, 0.4);
    this._set(this.windFilter.frequency, 260 + 1500 * h + 320 * (gust - 0.55) + 300 * sp, 0.4);
    this._set(this.airGain.gain, (0.004 + 0.06 * h + 0.02 * sp) * gust, 0.4);
    this._set(this.murmurGain.gain, s.crowd * 0.8 * (1 - 0.6 * h), 0.6);

    if (s.paused) return;
    this._eventT -= dt;
    if (this._eventT <= 0) {
      this._eventT = rand(8, 22) / (0.6 + 0.8 * s.crowd);
      this._ambientEvent(now + 0.05);
    }
    this._bellT -= dt;
    if (this._bellT <= 0) {
      this._bellT = rand(120, 300);
      const tolls = 1 + ((Math.random() * 3) | 0);
      const v = this._openVoice(this.ambEvents, rand(0.16, 0.26), rand(-0.6, 0.6), false);
      for (let i = 0; i < tolls; i++) this._bell(v.node, now + 0.05 + i * 2.8, 196, 1, 5);
      v.end = now + tolls * 2.8 + 5.5;
    }
  }

  /** One sparse, quiet, far-away city sound. */
  _ambientEvent(t) {
    const kind = pick(['dog', 'hammer', 'birds', 'birds', 'coo']);
    const v = this._openVoice(this.ambEvents, rand(0.2, 0.45), rand(-0.8, 0.8), false);
    const d = v.node;
    let tt = t;
    if (kind === 'dog') {
      const f0 = rand(360, 460), n = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        this._formant(d, tt, { f0, f0End: f0 * 0.62, dur: 0.11, gain: 0.3, breath: 0.5, attack: 0.008,
          formants: [[820, 3, 1], [1500, 4, 0.5]] });
        tt += rand(0.22, 0.36);
      }
    } else if (kind === 'hammer') {
      const base = rand(1500, 2100), n = 3 + ((Math.random() * 3) | 0), gap = rand(0.4, 0.55);
      for (let i = 0; i < n; i++) {
        this._partials(d, tt, base, ANVIL, 0.3, 0.12);
        this._noise(d, tt, { freq: 2500, q: 1, dur: 0.02, gain: 0.12 });
        tt += gap * rand(0.94, 1.06);
      }
    } else if (kind === 'birds') {
      const n = 3 + ((Math.random() * 5) | 0);
      for (let i = 0; i < n; i++) {
        const f = rand(2600, 4200);
        this._tone(d, tt, { freq: f, freqEnd: f * rand(0.7, 1.4), dur: rand(0.06, 0.1), gain: 0.12, attack: 0.012 });
        tt += rand(0.08, 0.22);
      }
    } else { // pigeon coo
      const f = rand(290, 340), n = 2 + ((Math.random() * 2) | 0);
      for (let i = 0; i < n; i++) {
        const long = i === 1;
        this._tone(d, tt, { freq: f, freqEnd: f * (long ? 1.16 : 1.08), sweep: 0.15, dur: long ? 0.5 : 0.3, gain: 0.2, attack: 0.1 });
        tt += long ? 0.55 : 0.36;
      }
    }
    v.end = tt + 1;
  }

  // ------------------------------------------------------------ generative music

  _updateMusic(dt, now) {
    const s = this.state, ten = s.tension;
    // combat cross-fade: quick in, ~3 s out
    this._mix = clamp(this._mix + (s.combat ? dt / 0.7 : -dt / 3), 0, 1);
    const mix = this._mix;
    this._set(this.mOst.gain, mix, 0.05);
    this._set(this.mDrums.gain, mix * 0.7, 0.05);
    this._set(this.mExplore.gain, 1 - 0.85 * mix, 0.05);

    // drone: slow filter drift, darker with tension, a touch more open in combat
    const drift = 110 * Math.sin(now * 0.07) + 55 * Math.sin(now * 0.023 + 1.3);
    this._set(this.droneFilter.frequency, 270 + drift - 70 * ten + 160 * mix, 0.5);
    this._set(this.droneGain.gain, 0.13 + 0.03 * mix, 2);
    this._set(this.tensionGain.gain, 0.3 * Math.max(ten, mix * 0.35), 0.6);

    if (s.paused) return;

    // free plucked phrases (suppressed while the combat layer is up)
    if (now + LOOKAHEAD >= this._nextPhrase) {
      if (mix > 0.3) this._nextPhrase = now + rand(2, 4);
      else this._nextPhrase = this._schedulePhrase(Math.max(this._nextPhrase, now + 0.05)) + rand(2.5, 6) + ten * 5;
    }

    // combat step sequencer
    if (s.combat && !this._seqOn) {
      this._seqOn = true; this._step = 0; this._bar = 0; this._nextStep = now + 0.06;
    } else if (!s.combat && this._seqOn && mix <= 0.001) {
      this._seqOn = false;
    }
    if (this._seqOn) {
      if (this._nextStep < now - 0.2) this._nextStep = now + 0.05; // recover after a stall / pause
      while (this._nextStep < now + LOOKAHEAD) {
        this._scheduleStep(this._nextStep);
        this._nextStep += STEP;
      }
    }
  }

  /** Schedule one improvised phrase starting at t0; returns the time it ends. */
  _schedulePhrase(t0) {
    const ten = this.state.tension, out = this.mExplore;
    const hi = ten > 0.5 ? 8 : 12;
    const bright = 3100 - 1500 * ten;
    const n = Math.round(rand(3, 7 - 3 * ten));
    const unit = rand(0.26, 0.34) * (1 + 0.4 * ten);
    let deg = pick(ten > 0.5 ? [0, 1, 4] : [0, 2, 3, 4, 7]);
    let t = t0;
    if (Math.random() < 0.4) this._pluck(out, t, ROOT / 2, { gain: 0.2, bright: 1500, single: true }); // open bass string
    for (let i = 0; i < n; i++) {
      const last = i === n - 1;
      if (last) { // resolve to the nearest D or A (or hang on Eb when tense)
        const targets = ten > 0.6 && Math.random() < 0.4 ? [1, 8] : [0, 4, 7, 11];
        deg = targets.reduce((best, x) => (Math.abs(x - deg) < Math.abs(best - deg) ? x : best));
      }
      const at = t + rand(-0.012, 0.012), g = rand(0.15, 0.22) * (last ? 1.1 : 1);
      if (!last && i > 0 && Math.random() < 0.2) { // grace note from the neighbour above
        this._pluck(out, at - 0.07, degFreq(deg + 1), { gain: g * 0.6, bright });
      }
      this._pluck(out, at, degFreq(deg), { gain: g, bright });
      if (last && Math.random() < 0.25) { // short tremolo on the final note
        for (let k = 1; k <= 4; k++) this._pluck(out, at + k * 0.095, degFreq(deg), { gain: g * (0.8 - k * 0.13), bright, single: true });
      }
      t += last ? unit * 3 : unit * pick([1, 1, 1, 2, 2, 0.5]);
      const leap = Math.random() < 0.12 ? pick([-3, 3, 4]) : pick([-2, -1, -1, -1, 1, 1, 1, 2]);
      deg = clamp(deg + leap, 0, hi);
    }
    return t;
  }

  /** Schedule one 16th-note step of the combat layer at time t. */
  _scheduleStep(t) {
    const i = this._step, bar = this._bar;
    const hit = DRUMS[bar % 4][i], at = t + rand(0, 0.007);
    if (hit === 'D') this._dum(this.mDrums, at, rand(0.85, 1));
    else if (hit === 'T') this._tek(this.mDrums, at, rand(0.8, 1));
    else if (hit === 't') this._tek(this.mDrums, at, rand(0.3, 0.45));

    const deg = OSTINATI[bar % 4 === 3 ? 2 : bar % 2][i];
    const bright = 2500 + 1200 * this.state.tension;
    if (deg !== null) this._pluck(this.mOst, t + rand(0, 0.008), degFreq(deg), { gain: i % 4 === 0 ? 0.3 : 0.22, bright });
    if (i === 0) this._pluck(this.mOst, t, ROOT / 2, { gain: 0.34, bright: 1500, single: true });

    if (++this._step >= 16) { this._step = 0; this._bar++; }
  }
}

export default AudioSystem;
