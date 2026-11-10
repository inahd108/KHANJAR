// DOM heads-up display and menus.
import * as THREE from 'three';

const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const _v = new THREE.Vector3();

export class Hud {
  constructor(root, game) {
    this.root = root; this.game = game;
    root.innerHTML = '';
    // ---- loading
    this.loading = el('div', 'screen loading', `
      <div class="title-block"><div class="kicker">Jerusalem &middot; 1187</div><h1>KHANJAR</h1>
      <div class="bar"><div class="fill"></div></div><div class="load-text">Preparing</div></div>`);
    // ---- in-game HUD
    this.hud = el('div', 'hud hidden');
    this.hud.innerHTML = `
      <div class="objective"><div class="obj-label">Objective</div><div class="obj-text"></div><div class="obj-dist"></div></div>
      <div class="compass"><div class="compass-strip"></div><div class="compass-needle"></div><div class="compass-mark"></div></div>
      <div class="status"><div class="eye"><svg viewBox="0 0 64 40"><path class="lid" d="M2 20 Q32 -8 62 20 Q32 48 2 20 Z"/><circle class="iris" cx="32" cy="20" r="9"/></svg></div><div class="status-text">Unseen</div></div>
      <div class="health"><div class="pips"></div></div>
      <div class="prompt hidden"><span class="key">F</span><span class="prompt-text"></span></div>
      <div class="hint hidden"></div>
      <div class="banner hidden"><div class="banner-kicker"></div><div class="banner-title"></div></div>
      <div class="vignette-hurt"></div>
      <div class="markers"></div>
      <div class="reticle"></div>`;
    // ---- menus
    this.menu = el('div', 'screen menu hidden', `
      <div class="title-block">
        <div class="kicker">Jerusalem &middot; 1187</div>
        <h1>KHANJAR</h1>
        <div class="tagline">A blade above the rooftops of the Holy City</div>
        <button class="btn primary" data-act="start">Begin</button>
        <div class="row"><span class="label">Graphics</span>
          <button class="btn small q" data-q="low">Low</button><button class="btn small q" data-q="medium">Medium</button><button class="btn small q" data-q="high">High</button><button class="btn small q" data-q="ultra">Ultra</button></div>
        <div class="controls">
          <div><b>W A S D</b> move</div><div><b>Mouse</b> look</div><div><b>Shift</b> sprint &middot; run up walls</div><div><b>Space</b> jump &middot; grab &middot; leap off</div>
          <div><b>C</b> crouch &middot; drop &middot; dodge in a fight</div><div><b>F</b> silent strike &middot; leap strike</div><div><b>Left mouse</b> sabre combo</div><div><b>Right mouse</b> block &middot; parry</div>
          <div><b>Q</b> draw / sheathe</div><div><b>Esc</b> pause</div>
        </div>
        <div class="credit">An original game. Characters, animations, textures and props are CC0 assets by Quaternius and Poly Haven.</div>
      </div>`);
    this.pause = el('div', 'screen pause hidden', `
      <div class="panel"><h2>Paused</h2>
        <button class="btn primary" data-act="resume">Resume</button>
        <div class="row"><span class="label">Graphics</span>
          <button class="btn small q" data-q="low">Low</button><button class="btn small q" data-q="medium">Medium</button><button class="btn small q" data-q="high">High</button><button class="btn small q" data-q="ultra">Ultra</button></div>
        <div class="row"><span class="label">Sound</span><button class="btn small" data-act="mute">On</button></div>
        <button class="btn" data-act="restart">Restart mission</button>
        <div class="controls compact"><div><b>Shift</b> into a wall to climb</div><div><b>F</b> above or behind a guard</div><div><b>Right mouse</b> just before a blow to parry, then <b>F</b></div></div>
      </div>`);
    this.death = el('div', 'screen death hidden', `<div class="panel dark"><div class="kicker">The city keeps its secrets</div><h2>You have fallen</h2><button class="btn primary" data-act="retry">Rise again</button></div>`);
    this.complete = el('div', 'screen complete hidden', `<div class="panel dark"><div class="kicker">Jerusalem &middot; 1187</div><h2>The Castellan is dead</h2><div class="stats"></div><button class="btn primary" data-act="again">Play again</button></div>`);
    root.append(this.loading, this.hud, this.menu, this.pause, this.death, this.complete);

    this.$ = (s) => this.hud.querySelector(s);
    const pips = this.$('.pips'); this.pips = [];
    for (let i = 0; i < 5; i++) { const p = el('div', 'pip'); p.appendChild(el('div', 'pip-fill')); pips.appendChild(p); this.pips.push(p.firstChild); }
    // compass letters
    const strip = this.$('.compass-strip');
    this.compassItems = ['N', '·', 'NE', '·', 'E', '·', 'SE', '·', 'S', '·', 'SW', '·', 'W', '·', 'NW', '·'].map((t, i) => { const s = el('span', t.length > 1 || t === '·' ? 'minor' : 'major', t); strip.appendChild(s); return { el: s, ang: i * Math.PI / 8 }; });
    this.markerPool = [];
    this.hintTimer = 0; this.bannerTimer = 0; this.hurt = 0;
    root.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      game.audio.unlock(); game.audio.play('uiClick');
      if (b.dataset.q) game.setQuality(b.dataset.q);
      if (b.dataset.act) game.onMenu(b.dataset.act);
    });
    root.addEventListener('mouseover', (e) => { if (e.target.closest && e.target.closest('button')) game.audio.play('uiHover'); });
    this.setQuality(game.qualityName);
  }

  setQuality(q) { for (const b of this.root.querySelectorAll('.q')) b.classList.toggle('on', b.dataset.q === q); }
  setMuted(m) { const b = this.pause.querySelector('[data-act="mute"]'); if (b) b.textContent = m ? 'Off' : 'On'; }
  progress(f, text) { this.loading.querySelector('.fill').style.width = Math.round(f * 100) + '%'; if (text) this.loading.querySelector('.load-text').textContent = text; }
  show(name) {
    for (const s of ['loading', 'menu', 'pause', 'death', 'complete']) this[s].classList.toggle('hidden', s !== name);
    this.hud.classList.toggle('hidden', !(name === null || name === 'pause'));
    document.body.classList.toggle('playing', name === null);
  }
  setObjective(text) { this.$('.obj-text').innerHTML = text; this.hud.querySelector('.objective').classList.remove('flash'); void this.hud.offsetWidth; this.hud.querySelector('.objective').classList.add('flash'); }
  hint(text, time = 6) { const h = this.$('.hint'); h.innerHTML = text; h.classList.remove('hidden'); this.hintTimer = time; }
  banner(kicker, title, time = 4.5) { const b = this.$('.banner'); b.querySelector('.banner-kicker').textContent = kicker; b.querySelector('.banner-title').textContent = title; b.classList.remove('hidden'); b.classList.remove('in'); void b.offsetWidth; b.classList.add('in'); this.bannerTimer = time; }
  hurtFlash(a) { this.hurt = Math.min(1, this.hurt + a); }
  showStats(html) { this.complete.querySelector('.stats').innerHTML = html; }

  update(dt) {
    const g = this.game, p = g.player, cam = g.gfx.camera;
    // health
    const hp = p.health / p.maxHealth * 5;
    this.pips.forEach((f, i) => { f.style.transform = `scaleX(${Math.max(0, Math.min(1, hp - i))})`; });
    this.hud.querySelector('.health').classList.toggle('low', p.health < 35);
    // awareness
    const st = this.hud.querySelector('.status'); const text = this.$('.status-text');
    const aw = g.npcs.maxAwareness; const state = g.alertState;
    st.dataset.state = state;
    st.style.setProperty('--aw', aw.toFixed(2));
    text.textContent = state === 'hunted' ? 'Hunted' : state === 'search' ? 'They are searching' : aw > 0.12 ? 'Drawing eyes' : (p.crouching ? 'Hidden' : 'Unseen');
    // prompt
    const pr = this.$('.prompt');
    if (p.prompt && g.state === 'play') { pr.classList.remove('hidden'); this.$('.prompt-text').textContent = p.prompt.type === 'air' ? 'Leap strike' : p.prompt.type === 'finisher' ? 'Finish' : 'Silent strike'; }
    else pr.classList.add('hidden');
    // hint + banner timers
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.$('.hint').classList.add('hidden'); }
    if (this.bannerTimer > 0) { this.bannerTimer -= dt; if (this.bannerTimer <= 0) this.$('.banner').classList.add('hidden'); }
    this.hurt = Math.max(0, this.hurt - dt * 0.9);
    const low = p.health < 35 ? 0.35 + 0.15 * Math.sin(g.time * 5) : 0;
    this.$('.vignette-hurt').style.opacity = Math.max(this.hurt, low).toFixed(2);
    // compass: heading of the camera (0 = north = -z)
    const heading = Math.atan2(-Math.sin(g.cam.yaw), Math.cos(g.cam.yaw)); // camera looks opposite its offset; 0 = north (-z), clockwise
    const W = 360;
    for (const it of this.compassItems) {
      let d = it.ang - heading; d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const x = d / (Math.PI * 0.6) * (W / 2);
      it.el.style.transform = `translateX(${x.toFixed(1)}px)`; it.el.style.opacity = Math.abs(x) > W / 2 - 8 ? 0 : 1 - Math.abs(x) / (W / 2) * 0.6;
    }
    const mark = this.$('.compass-mark'); const obj = g.objectivePos;
    if (obj) {
      const ang = Math.atan2(obj.x - p.pos.x, -(obj.z - p.pos.z));
      let d = ang - heading; d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const x = Math.max(-W / 2 + 6, Math.min(W / 2 - 6, d / (Math.PI * 0.6) * (W / 2)));
      mark.style.transform = `translateX(${x.toFixed(1)}px)`; mark.style.opacity = 1;
      this.$('.obj-dist').textContent = Math.round(Math.hypot(obj.x - p.pos.x, obj.z - p.pos.z)) + ' m';
    } else { mark.style.opacity = 0; this.$('.obj-dist').textContent = ''; }
    // world markers: awareness diamonds over guards, objective beacon
    this.updateMarkers(cam);
  }

  updateMarkers(cam) {
    const g = this.game, layer = this.$('.markers');
    let used = 0;
    const put = (x, y, z, cls, fill = 0, label = '') => {
      _v.set(x, y, z).project(cam);
      if (_v.z > 1 || _v.z < -1) return;
      const sx = (_v.x * 0.5 + 0.5) * innerWidth, sy = (-_v.y * 0.5 + 0.5) * innerHeight;
      if (sx < -40 || sx > innerWidth + 40 || sy < -40 || sy > innerHeight + 40) return;
      let m = this.markerPool[used];
      if (!m) { m = el('div', 'marker'); m.appendChild(el('div', 'm-fill')); m.appendChild(el('div', 'm-label')); layer.appendChild(m); this.markerPool.push(m); }
      used++;
      m.className = 'marker ' + cls; m.style.display = 'block'; m.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;
      m.firstChild.style.height = Math.round(fill * 100) + '%'; m.lastChild.textContent = label;
    };
    if (g.state === 'play') {
      for (const n of g.npcs.npcs) {
        if (n.dead || !n.hostileKind || !n.root.visible) continue;
        const d = Math.hypot(n.pos.x - g.player.pos.x, n.pos.z - g.player.pos.z);
        if (n.isTarget && d < 70) { put(n.pos.x, n.pos.y + 2.35, n.pos.z, 'target' + (n.state === 'combat' ? ' hot' : ''), 1, d > 14 ? 'Castellan' : ''); continue; }
        if (d > 40) continue;
        if (n.state === 'combat') put(n.pos.x, n.pos.y + 2.2, n.pos.z, 'guard hot', 1);
        else if (n.state === 'stunned') put(n.pos.x, n.pos.y + 2.2, n.pos.z, 'guard open', 1);
        else if (n.awareness > 0.05 || n.state === 'search') put(n.pos.x, n.pos.y + 2.2, n.pos.z, 'guard' + (n.state === 'search' ? ' search' : ''), n.state === 'search' ? 1 : n.awareness);
      }
      const o = g.objectivePos;
      if (o && o.beacon) { const d = Math.hypot(o.x - g.player.pos.x, o.z - g.player.pos.z); if (d > 6) put(o.x, o.y + 2.5, o.z, 'beacon', 1, Math.round(d) + ' m'); }
    }
    for (let i = used; i < this.markerPool.length; i++) this.markerPool[i].style.display = 'none';
  }
}
