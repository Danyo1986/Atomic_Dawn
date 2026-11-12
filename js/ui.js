// Benutzeroberfläche: Seitenleiste, Radar, Info, Meldungen, Overlay (Lebensbalken, Rahmen, Marker)
import * as THREE from 'three';
import { UNITS, BUILDINGS, TABS, TEAMS, CELL, MAPN, WORLD, AIRFIELD_SLOTS, NUKE } from './config.js';
import { A } from './assets.js';
import { FOG } from './fog.js';
import { fmtMoney, clamp } from './util.js';
import { play } from './audio.js';

const $ = (id) => document.getElementById(id);

function drawRank(g, x, y, r) {
  g.save();
  g.strokeStyle = '#111'; g.lineWidth = 4; g.lineJoin = 'round';
  for (let k = 0; k < r; k++) {
    const yy = y - k * 5;
    g.beginPath(); g.moveTo(x - 5, yy - 2); g.lineTo(x, yy + 2); g.lineTo(x + 5, yy - 2); g.stroke();
    g.strokeStyle = r === 2 ? '#ffd24a' : '#e8e8e8'; g.lineWidth = 2; g.stroke(); g.strokeStyle = '#111'; g.lineWidth = 4;
  }
  g.restore();
}

export class UI {
  constructor(app) {
    this.app = app;
    this.tab = 'bld';
    this.items = {};
    this.shownCredits = 0;
    this.overlay = $('overlay');
    this.octx = this.overlay.getContext('2d');
    this.mini = $('mini'); this.mctx = this.mini.getContext('2d');
    this.markers = [];
    this.msgT = 0;
    this.buildTabs();
    this.bindTip();
    this.miniDrag = false;
    this.mini.addEventListener('mousedown', (e) => this.miniClick(e));
    this.mini.addEventListener('mousemove', (e) => { if (this.miniDrag) this.miniClick(e); });
    window.addEventListener('mouseup', () => { this.miniDrag = false; });
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get game() { return this.app.game; }

  // ------------------------------------------------------------- Tabs & Kacheln
  buildTabs() {
    const tabs = $('tabs');
    tabs.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.innerHTML = `${t.label}<i class="dot"></i>`;
      b.onclick = () => { this.tab = t.key; play('click'); this.renderGrid(); };
      b.dataset.key = t.key;
      tabs.appendChild(b);
    }
  }
  allItems() {
    const out = [];
    for (const [k, d] of Object.entries(BUILDINGS)) if (d.buildable !== false && (!d.faction || d.faction === TEAMS[0].faction)) out.push({ key: k, d, kind: 'b' });
    for (const [k, d] of Object.entries(UNITS)) out.push({ key: k, d, kind: 'u' });
    return out;
  }
  renderGrid() {
    const g = $('grid');
    g.innerHTML = '';
    this.items = {};
    for (const it of this.allItems()) {
      if (it.d.key !== this.tab) continue;
      const el = document.createElement('div');
      el.className = 'item';
      el.innerHTML = `<img src="${A.thumbs[it.key] || ''}"><div class="prog" style="--p:100%"></div><div class="cnt"></div>${it.d.air ? '<div class="cap"></div>' : ''}<div class="rdy">BEREIT</div><div class="nm"><span>${it.d.name}</span><em>${it.d.cost}</em></div>`;
      el.addEventListener('mousedown', (e) => this.itemClick(e, it));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
      el.dataset.key = it.key;
      g.appendChild(el);
      this.items[it.key] = { el, it, prog: el.querySelector('.prog'), cnt: el.querySelector('.cnt'), cap: el.querySelector('.cap'), capKey: '' };
    }
    for (const b of $('tabs').children) b.classList.toggle('on', b.dataset.key === this.tab);
  }
  itemClick(e, it) {
    const game = this.game, p = game.human;
    e.preventDefault();
    if (e.button === 2) { game.cancelItem(p, it.key); return; }
    if (e.button !== 0) return;
    const q = p.queues[it.d.key];
    if (it.d.wall) { if (game.canBuild(p, 'wall')) { this.app.input.startPlacement('wall'); play('click'); } else play('deny'); return; }
    if (it.kind === 'b') {
      if (q.ready && q.type === it.key) { this.app.input.startPlacement(it.key); play('click'); return; }
      if (q.type === it.key) { q.paused = !q.paused; play('click'); return; }
      if (q.type) { play('deny'); return; }
      if (!game.queueItem(p, it.key)) play('deny');
    } else {
      const n = e.shiftKey ? 5 : 1;
      let ok = false;
      for (let i = 0; i < n; i++) ok = game.queueItem(p, it.key) || ok;
      if (!ok) play('deny');
    }
  }
  bindTip() {
    const tip = $('tip');
    $('grid').addEventListener('mousemove', (e) => {
      const el = e.target.closest('.item');
      if (!el) { tip.style.display = 'none'; return; }
      const key = el.dataset.key, d = UNITS[key] || BUILDINGS[key];
      const p = this.game?.human;
      const missing = [];
      if (p && d) {
        if (BUILDINGS[key] && !this.game.hasBuilding(p, 'hq')) missing.push('Hauptquartier');
        if (UNITS[key] && !this.game.hasBuilding(p, d.from)) missing.push(BUILDINGS[d.from].name);
        for (const r of d.req || []) if (!this.game.hasBuilding(p, r)) missing.push(BUILDINGS[r].name);
      }
      const pw = d.power ? `<span class="pw ${d.power < 0 ? 'neg' : 'pos'}">⚡ ${d.power > 0 ? '+' : ''}${d.power}</span>` : '';
      tip.innerHTML = `<h4>${d.name}</h4><div class="row"><span>$ ${d.cost}</span>${pw}<span style="color:#9aa">⏱ ${d.time}s</span></div><p>${d.desc}</p>${missing.length ? `<div class="req">Benötigt: ${missing.join(', ')}</div>` : ''}`;
      tip.style.display = 'block';
      const r = tip.getBoundingClientRect();
      tip.style.left = Math.min(window.innerWidth - r.width - 8, e.clientX - r.width - 16) + 'px';
      tip.style.top = clamp(e.clientY - 20, 8, window.innerHeight - r.height - 8) + 'px';
    });
    $('grid').addEventListener('mouseleave', () => { tip.style.display = 'none'; });
  }

  // ------------------------------------------------------------- Aktualisierung
  update(dt) {
    const game = this.game; if (!game) return;
    const p = game.human;
    this.shownCredits += (p.credits - this.shownCredits) * Math.min(1, dt * 8);
    if (Math.abs(p.credits - this.shownCredits) < 1) this.shownCredits = p.credits;
    $('credits').textContent = fmtMoney(this.shownCredits);
    const prod = p.power.prod, use = p.power.use;
    const pu = $('powUse');
    pu.style.width = (prod > 0 ? clamp(use / prod, 0, 1) * 100 : use > 0 ? 100 : 0) + '%';
    pu.classList.toggle('low', p.low);
    $('powTxt').textContent = `${use} / ${prod}`;
    const t = Math.floor(game.time);
    $('clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
    // Tabs
    for (const b of $('tabs').children) {
      const key = b.dataset.key, q = p.queues[key];
      const any = this.allItems().some((it) => it.d.key === key && game.canBuild(p, it.key));
      b.disabled = !any && !q.type;
      const dot = b.querySelector('.dot');
      dot.classList.toggle('show', !!q.type);
      dot.classList.toggle('ready', !!q.ready);
    }
    if ($('tabs').querySelector(`[data-key="${this.tab}"]`).disabled) {
      const first = [...$('tabs').children].find((b) => !b.disabled);
      if (first && first.dataset.key !== this.tab) { this.tab = first.dataset.key; this.renderGrid(); }
    }
    // Kacheln
    for (const [key, o] of Object.entries(this.items)) {
      const d = o.it.d, q = p.queues[d.key];
      const avail = game.canBuild(p, key);
      const active = q.type === key;
      o.el.classList.toggle('off', !avail && !active);
      o.el.classList.toggle('ready', !!(active && q.ready));
      o.el.classList.toggle('paused', !!(active && q.paused));
      o.el.classList.toggle('busy', o.it.kind === 'b' && !o.it.d.wall && !!q.type && !active);
      o.prog.style.setProperty('--p', active ? (q.progress * 100).toFixed(1) + '%' : '100%');
      const n = o.it.kind === 'u' ? q.list.filter((x) => x === key).length : 0;
      o.cnt.textContent = n > 0 ? n : '';   // Anzahl der Aufträge dieser Art (laufender eingeschlossen), schon ab dem ersten
      if (o.cap) { // Flottenbalken: belegt (blau), in Auftrag (gelb), frei
        const c = game.airCapacity(p, key), k = c.used + '/' + c.queued + '/' + c.cap;
        if (k !== o.capKey) {
          o.capKey = k;
          let h = '';
          for (let i = 0; i < c.cap; i++) h += `<i class="${i < c.used ? 'on' : i < c.used + c.queued ? 'q' : ''}"></i>`;
          o.cap.innerHTML = h + `<b>${c.used}/${c.cap}</b>`;
          o.cap.title = `${c.used} von ${c.cap} Plätzen belegt`;
        }
        if (avail && c.used + c.queued >= c.cap && !active) o.el.classList.add('off');
      }
    }
    // Superwaffe: Knopf mit Ladebalken, solange eine Abschussbasis steht
    const silo = game.silo(p), nb = $('btnNuke');
    nb.style.display = silo ? 'block' : 'none';
    if (silo) {
      const c = silo.charge || 0, rdy = !!game.readySilo(p);
      nb.style.setProperty('--p', (c * 100).toFixed(1) + '%');
      nb.classList.toggle('ready', rdy);
      const txt = rdy ? '☢ Atomrakete bereit (N)' : silo.launching ? '☢ Start …' : silo.rise < 1 ? '☢ Atomrakete' : `☢ Atomrakete ${Math.floor(c * 100)} %${p.low ? ' – Energie fehlt' : ''}`;
      if ($('nukeTxt').textContent !== txt) $('nukeTxt').textContent = txt;
    } else if (this.app.input.mode === 'nuke') this.app.input.setMode(null);
    // Radar
    const radar = game.hasBuilding(p, 'radar') && !p.low;
    $('radarOff').style.display = radar ? 'none' : 'flex';
    this.miniT = (this.miniT || 0) - dt;
    if (radar && this.miniT <= 0) { this.miniT = 0.2; this.drawMini(); }
    this.updateInfo();
    // Meldungen aus dem Spiel
    while (game.events.length) {
      const e = game.events.shift();
      if (e.type === 'attack') { this.lastAttack = e; this.message('Basis wird angegriffen! (Leertaste)', true, 'attack'); }
      else if (e.type === 'msg') this.message(e.text);
      else if (e.type === 'nuke') { this.lastAttack = e; this.message(e.text + ' (Leertaste)', true, 'nuke'); }
    }
  }

  message(text, warn = false, dedupe = null) {
    const box = $('msgs');
    if (dedupe) { const ex = box.querySelector(`[data-d="${dedupe}"]`); if (ex) ex.remove(); }
    const d = document.createElement('div');
    d.textContent = text; if (warn) d.className = 'warn';
    if (dedupe) d.dataset.d = dedupe;
    box.appendChild(d);
    while (box.children.length > 5) box.firstChild.remove();
    setTimeout(() => { d.style.opacity = 0; setTimeout(() => d.remove(), 700); }, 5000);
  }

  updateInfo() {
    const game = this.game, sel = [...game.selection];
    const key = sel.map((e) => e.id + ':' + (e.rank || 0)).join(',') + '|' + sel.map((e) => Math.round(e.hp / e.maxHp * 20)).join(',')
      + (sel.length === 1 && sel[0].type === 'helipad' ? '|' + game.padLoad(sel[0], true) + game.padLoad(sel[0], false) : '');
    if (key === this.infoKey) return;
    this.infoKey = key;
    const box = $('info');
    if (!sel.length) { box.innerHTML = '<span class="dim">Nichts ausgewählt</span>'; return; }
    if (sel.length === 1) {
      const e = sel[0];
      const hp = e.hp / e.maxHp;
      let extra = '';
      if (e.def.cargo) extra = `<div class="dim">Ladung: ${Math.round(e.cargo)} / ${e.def.cargo}</div>`;
      else if (e.kind === 'unit' && e.def.weapon) extra = `<div class="dim" style="color:${e.rank === 2 ? '#ffd24a' : e.rank ? '#e8e8e8' : ''}">${['Rekrut', 'Veteran ›', 'Elite ››'][e.rank || 0]}</div>`;
      else if (e.kind === 'building' && e.def.power) extra = `<div class="dim">Energie: ${e.def.power > 0 ? '+' : ''}${e.def.power}</div>`;
      if (e.type === 'helipad' && e.owner === 0) {
        const seg = (n, cls) => Array.from({ length: AIRFIELD_SLOTS }, (_, i) => `<i class="${i < n ? cls : ''}"></i>`).join('');
        extra += `<div class="capRow"><span>Jagdbomber</span><div class="cap">${seg(game.padLoad(e, true), 'on')}</div></div><div class="capRow"><span>Hubschrauber</span><div class="cap">${seg(game.padLoad(e, false), 'heli')}</div></div>`;
      }
      if (e.owner !== 0) extra += `<div class="dim" style="color:${TEAMS[e.owner].css}">${TEAMS[e.owner].name}</div>`;
      box.innerHTML = `<img src="${A.thumbs[e.type] || ''}"><div><div class="t">${e.def.name}</div><div class="hp"><i style="width:${hp * 100}%;background:${hp > 0.5 ? '#57d98a' : hp > 0.25 ? '#f2c03a' : '#ff5a4a'}"></i></div><div class="dim">${Math.ceil(e.hp)} / ${e.maxHp}</div>${extra}</div>`;
    } else {
      const c = {};
      for (const e of sel) c[e.def.name] = (c[e.def.name] || 0) + 1;
      box.innerHTML = `<div><div class="t">${sel.length} Einheiten</div><div class="multi">${Object.entries(c).map(([n, k]) => `<span>${k}× ${n}</span>`).join('')}</div></div>`;
    }
  }

  // ------------------------------------------------------------- Radar
  drawMini() {
    const g = this.mctx, game = this.game, S = this.mini.width;
    if (this.app.miniBase) g.drawImage(this.app.miniBase, 0, 0, S, S);
    const sc = S / WORLD;
    const T = game.terrain;
    g.fillStyle = '#4aa8ff';
    for (const k of T.oreCells) if (T.ore[k] > 40) g.fillRect((k % MAPN) * CELL * sc, Math.floor(k / MAPN) * CELL * sc, CELL * sc + 0.5, CELL * sc + 0.5);
    for (const b of game.buildings) {
      if (b.dead || (b.owner !== 0 && !b.seen && FOG.enabled)) continue;
      g.fillStyle = TEAMS[b.owner].css;
      g.fillRect(b.cx * CELL * sc, b.cz * CELL * sc, b.w * CELL * sc, b.h * CELL * sc);
    }
    for (const u of game.units) {
      if (u.dead || !u.vis) continue;
      g.fillStyle = game.selection.has(u) ? '#ffffff' : TEAMS[u.owner].css;
      const s = u.def.inf ? 2 : 3;
      g.fillRect(u.x * sc - s / 2, u.z * sc - s / 2, s, s);
    }
    // Nebel
    if (FOG.enabled) {
      const img = this.fogImg || (this.fogImg = g.createImageData(MAPN, MAPN));
      for (let i = 0; i < MAPN * MAPN; i++) {
        img.data[i * 4 + 3] = FOG.explored[i] ? (FOG.visible[i] ? 0 : 110) : 255;
      }
      const c = this.fogCanvas || (this.fogCanvas = Object.assign(document.createElement('canvas'), { width: MAPN, height: MAPN }));
      c.getContext('2d').putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(c, 0, 0, S, S);
    }
    // Kamerasichtfeld
    const poly = this.app.input.viewPolygon();
    if (poly) {
      g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 1.5;
      g.beginPath(); poly.forEach((p, i) => (i ? g.lineTo(p.x * sc, p.z * sc) : g.moveTo(p.x * sc, p.z * sc))); g.closePath(); g.stroke();
    }
    if (this.lastAttack && game.time - this.lastAttack.t < 4 && Math.floor(game.time * 4) % 2) {
      g.strokeStyle = '#ff4030'; g.lineWidth = 2;
      g.beginPath(); g.arc(this.lastAttack.x * sc, this.lastAttack.z * sc, 10, 0, 6.28); g.stroke();
    }
  }
  miniClick(e) {
    const game = this.game; if (!game) return;
    if (!game.hasBuilding(game.human, 'radar') || game.human.low) return;
    const r = this.mini.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * WORLD, z = (e.clientY - r.top) / r.height * WORLD;
    if (e.button === 2 && e.type === 'mousedown') { this.app.input.commandAt(x, z); return; }
    if (e.buttons & 1) { this.miniDrag = true; this.app.input.lookAt(x, z); }
  }

  // ------------------------------------------------------------- Overlay
  addMarker(x, z, color) { this.markers.push({ x, z, t: 0, color }); }

  drawOverlay(dt, camera) {
    const cv = this.overlay, g = this.octx;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio);
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const game = this.game; if (!game) return;
    const v = new THREE.Vector3();
    const proj = (x, y, z) => { v.set(x, y, z).project(camera); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, ok: v.z < 1 }; };
    const hover = this.app.input.hover;
    const bar = (cx, cy, w, frac, col) => {
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(cx - w / 2 - 1, cy - 1, w + 2, 6);
      g.fillStyle = col; g.fillRect(cx - w / 2, cy, w * frac, 4);
    };
    const hpCol = (f) => (f > 0.5 ? '#57d98a' : f > 0.25 ? '#f2c03a' : '#ff5a4a');
    for (const u of game.units) {
      if (u.dead || !u.vis) continue;
      const sel = game.selection.has(u);
      const dmg = u.hp < u.maxHp;
      if (!sel && hover !== u && !(dmg && u.owner === 0)) continue;
      const top = u.def.inf ? 3.4 : u.def.air ? 3.5 : 4.2;
      const p = proj(u.x, u.y + top, u.z); if (!p.ok) continue;
      const w = u.def.inf ? 22 : 40;
      bar(p.x, p.y, w, u.hp / u.maxHp, hpCol(u.hp / u.maxHp));
      if (u.def.cargo) { g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(p.x - w / 2 - 1, p.y + 6, w + 2, 4); g.fillStyle = '#ffc94a'; g.fillRect(p.x - w / 2, p.y + 7, w * u.cargo / u.def.cargo, 2); }
      if (u.rank) drawRank(g, p.x - w / 2 - 9, p.y + 2, u.rank);
      if (u.group && sel) { g.fillStyle = '#fff'; g.font = '600 11px Inter'; g.fillText(u.group, p.x + w / 2 + 3, p.y + 5); }
    }
    for (const u of game.units) { // Rangabzeichen auch ohne Lebensbalken
      if (u.dead || !u.vis || !u.rank || game.selection.has(u) || hover === u || (u.hp < u.maxHp && u.owner === 0)) continue;
      const p = proj(u.x, u.y + (u.def.inf ? 3.4 : u.def.air ? 3.5 : 4.2), u.z); if (!p.ok) continue;
      drawRank(g, p.x, p.y + 2, u.rank);
    }
    for (const b of game.buildings) { // Belegung der eigenen Flugfelder: Jagdbomber (blau), Hubschrauber (orange)
      if (b.dead || b.owner !== 0 || b.type !== 'helipad' || b.rise < 1) continue;
      const p = proj(b.x, b.y + 12, b.z); if (!p.ok || p.x < -60 || p.x > W + 60 || p.y < -30 || p.y > H + 30) continue;
      const sw = 13, gap = 2, tw = AIRFIELD_SLOTS * (sw + gap) - gap;
      [[game.padLoad(b, true), '#57c8ff', '✈'], [game.padLoad(b, false), '#ffb03a', 'H']].forEach(([n, col, lab], r) => {
        const y = p.y - 16 + r * 9;
        g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(p.x - tw / 2 - 13, y - 1, tw + 15, 7);
        g.fillStyle = col; g.font = '700 8px Inter'; g.fillText(lab, p.x - tw / 2 - 11, y + 5);
        for (let i = 0; i < AIRFIELD_SLOTS; i++) { g.fillStyle = i < n ? col : 'rgba(255,255,255,.18)'; g.fillRect(p.x - tw / 2 + i * (sw + gap), y, sw, 5); }
      });
    }
    for (const b of game.buildings) {
      if (b.dead || !b.obj.visible) continue;
      const sel = game.selection.has(b);
      if (!sel && hover !== b && b.hp >= b.maxHp) continue;
      if (!sel && hover !== b && b.owner !== 0) continue;
      const p = proj(b.x, b.y + 9, b.z); if (!p.ok) continue;
      const w = 30 + b.w * 12;
      bar(p.x, p.y, w, b.hp / b.maxHp, hpCol(b.hp / b.maxHp));
      if (b.repairing) { g.fillStyle = '#7bd3ff'; g.font = '700 12px Inter'; g.fillText('⚙ Reparatur', p.x - 34, p.y - 6); }
      if (sel && b.owner === 0) {
        // Rahmen
        const c = [[b.cx, b.cz], [b.cx + b.w, b.cz], [b.cx + b.w, b.cz + b.h], [b.cx, b.cz + b.h]].map(([x, z]) => proj(x * CELL, b.y + 0.4, z * CELL));
        g.strokeStyle = 'rgba(109,255,138,.8)'; g.lineWidth = 1.5;
        g.beginPath(); c.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath(); g.stroke();
        if (b.rally) {
          const r = proj(b.rally.x, game.terrain.heightAt(b.rally.x, b.rally.z), b.rally.z), s = proj(b.x, b.y + 1, b.z);
          g.setLineDash([6, 5]); g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(r.x, r.y); g.stroke(); g.setLineDash([]);
          g.beginPath(); g.arc(r.x, r.y, 5, 0, 6.28); g.stroke();
        }
      }
    }
    // Atomrakete: Zielkreise bis zum Einschlag (pulsierend), bei der Zielwahl Wirkradius am Mauszeiger
    const ring = (x, z, r, col, a, w = 2) => {
      g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = w; g.beginPath();
      let pen = false;   // Punkte hinter der Kamera unterbrechen den Linienzug (sonst Striche quer übers Bild)
      for (let i = 0; i <= 40; i++) {
        const t = i / 40 * 6.283, px = x + Math.cos(t) * r, pz = z + Math.sin(t) * r; const q = proj(px, game.terrain.heightAt(px, pz) + 0.4, pz);
        const ok = q.ok && v.z > -1 && Math.abs(q.x - W / 2) < W * 3 && Math.abs(q.y - H / 2) < H * 3;
        if (!ok) { pen = false; continue; }
        pen ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y); pen = true;
      }
      g.stroke(); g.globalAlpha = 1;
    };
    for (const m of game.nukeMarks || []) {
      if (m.until < game.time) continue;
      const k = (game.time * 1.6) % 1;
      ring(m.x, m.z, NUKE.radius, '#ff3a2a', 0.85, 2.5);
      ring(m.x, m.z, NUKE.radius * k, '#ff3a2a', 0.6 * (1 - k));
    }
    for (const Z of game.radZones || []) {   // verstrahlte Zonen: grüner Rand, pulsiert
      const k = 0.45 + 0.25 * Math.sin(game.time * 4);
      ring(Z.x, Z.z, Z.r, '#9dff5a', k, 1.5);
    }
    if (this.app.input.mode === 'nuke') {
      const gp = this.app.input.ground(this.app.input.mouse.x, this.app.input.mouse.y);
      if (gp) { ring(gp.x, gp.z, NUKE.radius, '#ff5a3a', 0.9, 2); ring(gp.x, gp.z, 2, '#ff5a3a', 0.9, 2); }
    }
    // Befehlsmarker
    for (const m of this.markers) {
      m.t += dt;
      const p = proj(m.x, game.terrain.heightAt(m.x, m.z) + 0.3, m.z);
      const k = m.t / 0.6;
      g.strokeStyle = m.color; g.globalAlpha = Math.max(0, 1 - k); g.lineWidth = 2;
      g.beginPath(); g.ellipse(p.x, p.y, 6 + k * 18, (6 + k * 18) * 0.55, 0, 0, 6.28); g.stroke();
      g.globalAlpha = 1;
    }
    this.markers = this.markers.filter((m) => m.t < 0.6);
    // Auswahlrahmen
    const box = this.app.input.box;
    if (box) {
      g.strokeStyle = 'rgba(120,255,150,.9)'; g.fillStyle = 'rgba(120,255,150,.08)'; g.lineWidth = 1;
      g.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
      g.strokeRect(box.x0 + 0.5, box.y0 + 0.5, box.x1 - box.x0, box.y1 - box.y0);
    }
  }

  showEnd(result) {
    const game = this.game;
    $('endTitle').textContent = result === 'win' ? 'Sieg' : 'Niederlage';
    $('endTitle').className = result === 'win' ? 'win' : 'lose';
    const rows = game.players.map((p) => `<tr><td style="color:${TEAMS[p.team].css}">${TEAMS[p.team].name}${p.human ? ' (Du)' : ''}</td><td>${p.stats.built}</td><td>${p.stats.lost}</td><td>${p.stats.kills}</td><td>${p.stats.bBuilt}</td><td>${p.stats.bLost}</td><td>${Math.round(p.stats.ore)}</td></tr>`).join('');
    $('endStats').innerHTML = `<tr><th>Fraktion</th><th>Einheiten</th><th>Verloren</th><th>Abschüsse</th><th>Gebäude</th><th>Zerstört</th><th>Erz $</th></tr>${rows}`;
    $('end').classList.remove('hidden');
  }
}
