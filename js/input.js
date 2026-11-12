// Kamera, Auswahl, Befehle, Platzierung, Tastenkürzel
import * as THREE from 'three';
import { CELL, MAPN, WORLD, BUILDINGS, UNITS } from './config.js';
import { clamp, dist } from './util.js';
import { instantiate } from './assets.js';
import { isVisible, isExplored, FOG } from './fog.js';
import { play, AUDIO, initAudio } from './audio.js';

const svgCursor = (svg, x = 16, y = 16, fb = 'default') => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") ${x} ${y}, ${fb}`;
const CUR = {
  normal: 'default',
  select: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#7dff9a" stroke-width="2.5"><path d="M4 11V4h7M21 4h7v7M28 21v7h-7M11 28H4v-7"/></g></svg>'),
  move: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#7dff9a" stroke-width="2.5"><circle cx="16" cy="16" r="5"/><path d="M16 2v6M16 24v6M2 16h6M24 16h6"/></g></svg>'),
  attack: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#ff4a3a" stroke-width="2.5"><circle cx="16" cy="16" r="9"/><path d="M16 1v9M16 22v9M1 16h9M22 16h9"/></g><circle cx="16" cy="16" r="2" fill="#ff4a3a"/></svg>'),
  ore: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#ffc94a" stroke-width="2.5"><path d="M6 22l10-14 10 14z"/><path d="M11 22l5-7 5 7"/></g></svg>'),
  deny: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#ff4a3a" stroke-width="3"><circle cx="16" cy="16" r="11"/><path d="M8 8l16 16"/></g></svg>'),
  sell: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="#1a1206" stroke="#ffc94a" stroke-width="2"/><text x="16" y="22" font-size="17" font-family="Arial" font-weight="bold" fill="#ffc94a" text-anchor="middle">$</text></svg>'),
  repair: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="13" fill="#061218" stroke="#7bd3ff" stroke-width="2"/><path d="M19 9a4 4 0 0 0-4.5 5.3L9 19.8V23h3.2l5.5-5.5A4 4 0 0 0 23 13l-2.3 2.3-2-.5-.5-2z" fill="#7bd3ff"/></svg>'),
  deploy: svgCursor('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><g fill="none" stroke="#7dff9a" stroke-width="2.5"><rect x="7" y="7" width="18" height="18"/><path d="M16 3v8M16 21v8M3 16h8M21 16h8"/></g></svg>'),
};

export class Input {
  constructor(app, dom, camera) {
    this.app = app; this.dom = dom; this.camera = camera;
    this.target = new THREE.Vector3(160, 0, 160);
    this.dist = 95; this.distT = 95; this.yaw = 0; this.yawT = 0; this.pitch = 0.98;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, in: false, down: null };
    this.box = null; this.hover = null; this.mode = null; // 'place' | 'sell' | 'repair' | 'attackMove'
    this.groups = {};
    this.lastClick = { t: 0, id: 0 };
    this.ray = new THREE.Raycaster();
    this.ghost = null;
    this.bind();
  }
  get game() { return this.app.game; }

  bind() {
    const d = this.dom;
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('mousedown', (e) => this.onDown(e));
    window.addEventListener('mousemove', (e) => this.onMove(e));
    window.addEventListener('mouseup', (e) => this.onUp(e));
    d.addEventListener('mouseenter', () => { this.mouse.in = true; });
    d.addEventListener('mouseleave', () => { this.mouse.in = false; });
    d.addEventListener('wheel', (e) => { e.preventDefault(); this.distT = clamp(this.distT * (e.deltaY > 0 ? 1.12 : 0.89), 32, 200); }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    document.getElementById('btnSell').onclick = () => this.setMode(this.mode === 'sell' ? null : 'sell');
    document.getElementById('btnRepair').onclick = () => this.setMode(this.mode === 'repair' ? null : 'repair');
    document.getElementById('btnNuke').onclick = () => this.toggleNuke();
  }

  // ------------------------------------------------------------- Kamera
  update(dt) {
    const k = this.keys;
    let mx = 0, mz = 0;
    if (k.has('ArrowUp') || k.has('KeyW')) mz -= 1;
    if (k.has('ArrowDown')) mz += 1;
    if (k.has('ArrowLeft')) mx -= 1;
    if (k.has('ArrowRight')) mx += 1;
    const r = this.dom.getBoundingClientRect();
    if (this.mouse.in && !this.mouse.down && document.pointerLockElement == null && this.app.state === 'game') {
      const e = 6;
      if (this.mouse.x < r.left + e) mx -= 1;
      if (this.mouse.x > r.right - e && this.mouse.x < r.right) mx += 1;
      if (this.mouse.y < r.top + e) mz -= 1;
      if (this.mouse.y > r.bottom - e) mz += 1;
    }
    if (k.has('KeyQ')) this.yawT += dt * 1.6;
    if (k.has('KeyE')) this.yawT -= dt * 1.6;
    const sp = this.dist * 1.2 * dt;
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.target.x += (mx * c + mz * s) * sp;
    this.target.z += (-mx * s + mz * c) * sp;
    this.target.x = clamp(this.target.x, 0, WORLD); this.target.z = clamp(this.target.z, 0, WORLD);
    this.dist += (this.distT - this.dist) * Math.min(1, dt * 10);
    this.yaw += (this.yawT - this.yaw) * Math.min(1, dt * 8);
    const T = this.game ? this.game.terrain : this.app.terrain;
    const ty = T ? Math.max(0, T.heightAt(this.target.x, this.target.z)) : 0;
    this.target.y += (ty - this.target.y) * Math.min(1, dt * 4);
    const pitch = this.pitch - (1 - (this.dist - 32) / 168) * 0.12;
    const cam = this.camera;
    cam.position.set(this.target.x + Math.sin(this.yaw) * Math.cos(pitch) * this.dist, this.target.y + Math.sin(pitch) * this.dist, this.target.z + Math.cos(this.yaw) * Math.cos(pitch) * this.dist);
    cam.lookAt(this.target);
    const fx = this.game && this.game.fx;
    if (fx) { // Erschütterung durch nahe Explosionen
      fx.view.x = this.target.x; fx.view.z = this.target.z; fx.view.dist = this.dist;
      if (fx.shake > 0.004) { const a = fx.shake * (0.4 + this.dist * 0.012); cam.position.x += (Math.random() - 0.5) * a; cam.position.y += (Math.random() - 0.5) * a; cam.position.z += (Math.random() - 0.5) * a; }
    }
    AUDIO.listener.x = this.target.x; AUDIO.listener.z = this.target.z; AUDIO.listener.zoom = this.dist;
    if (this.game && this.app.state === 'game') { this.updateHover(); this.updateGhost(); }
  }
  lookAt(x, z) { this.target.x = clamp(x, 0, WORLD); this.target.z = clamp(z, 0, WORLD); }

  viewPolygon() {
    const r = this.dom.getBoundingClientRect();
    const pts = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]].map(([x, y]) => this.groundAtPlane(x, y));
    return pts.every(Boolean) ? pts : null;
  }
  groundAtPlane(sx, sy, h = 0) {
    this.setRay(sx, sy);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y > -0.01) return null;
    const t = (h - o.y) / d.y;
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  setRay(sx, sy) {
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2((sx - r.left) / r.width * 2 - 1, -((sy - r.top) / r.height) * 2 + 1), this.camera);
  }
  /** Schnittpunkt mit dem Gelände per Strahlmarsch */
  ground(sx, sy) {
    this.setRay(sx, sy);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const T = this.game.terrain;
    let t = 0, prev = 0;
    for (let i = 0; i < 400; i++) {
      t += 1.5;
      const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= Math.max(T.heightAt(x, z), -1.2)) {
        let a = prev, b = t;
        for (let j = 0; j < 12; j++) { const m = (a + b) / 2; const yy = o.y + d.y * m; const xx = o.x + d.x * m, zz = o.z + d.z * m; if (yy <= Math.max(T.heightAt(xx, zz), -1.2)) b = m; else a = m; }
        return { x: o.x + d.x * b, z: o.z + d.z * b };
      }
      prev = t;
    }
    return null;
  }

  screenOf(x, y, z) {
    const r = this.dom.getBoundingClientRect();
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height, ok: v.z < 1 };
  }

  pick(sx, sy) {
    const game = this.game;
    let best = null, bd = 1e9;
    for (const u of game.units) {
      if (u.dead || u.dying !== undefined || !u.vis) continue;
      const p = this.screenOf(u.x, u.y + (u.def.inf ? 1.3 : 1.5), u.z);
      if (!p.ok) continue;
      const rad = Math.max(12, (u.def.inf ? 1.2 : u.def.radius) * 900 / this.dist * 0.35);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < rad && d < bd) { bd = d; best = u; }
    }
    if (best) return best;
    const g = this.ground(sx, sy);
    if (!g) return null;
    const b = game.buildingAtCell(Math.floor(g.x / CELL), Math.floor(g.z / CELL));
    if (b && (b.owner === 0 || b.seen || !FOG.enabled)) return b;
    return null;
  }

  updateHover() {
    if (!this.mouse.in || this.box) { this.hover = null; return; }
    this.hoverT = (this.hoverT || 0) + 1;
    if (this.hoverT % 3) return;
    this.hover = this.pick(this.mouse.x, this.mouse.y);
    this.dom.style.cursor = this.cursorFor();
  }
  cursorFor() {
    const game = this.game, h = this.hover, sel = [...game.selection].filter((e) => e.owner === 0);
    if (this.mode === 'place') return 'default';
    if (this.mode === 'sell') return h && h.kind === 'building' && h.owner === 0 ? CUR.sell : CUR.deny;
    if (this.mode === 'repair') return h && h.kind === 'building' && h.owner === 0 && h.hp < h.maxHp ? CUR.repair : CUR.deny;
    if (this.mode === 'attackMove' || this.mode === 'nuke') return CUR.attack;
    if (h && h.owner !== 0 && sel.some((u) => u.kind === 'unit' && u.def.weapon && game.canHit(u, h))) return CUR.attack;
    if (h && h.owner === 0) { if (sel.length === 1 && h === sel[0] && h.type === 'mcv') return CUR.deploy; return CUR.select; }
    const units = sel.filter((u) => u.kind === 'unit');
    if (units.length) {
      const g = this.ground(this.mouse.x, this.mouse.y);
      if (g) {
        const k = Math.floor(g.z / CELL) * MAPN + Math.floor(g.x / CELL);
        if (units.some((u) => u.def.cargo) && game.terrain.ore[k] > 20) return CUR.ore;
        const T = game.terrain;
        if (!units.some((u) => u.def.air) && !T.passable[k] && isExplored(g.x, g.z)) return CUR.deny;
      }
      return CUR.move;
    }
    return 'default';
  }

  /** Zielwahl der Atomrakete an/aus (nur wenn die eigene Abschussbasis startbereit ist) */
  toggleNuke() {
    if (this.mode === 'nuke') { this.setMode(null); return; }
    if (this.game.readySilo(this.game.human)) { this.setMode('nuke'); play('click'); } else play('deny');
  }

  setMode(m) {
    if (this.mode === 'place' && m !== 'place') this.clearGhost();
    this.mode = m;
    document.getElementById('btnSell').classList.toggle('on', m === 'sell');
    document.getElementById('btnRepair').classList.toggle('on', m === 'repair');
    document.getElementById('btnNuke').classList.toggle('on', m === 'nuke');
    const hint = document.getElementById('modeHint');
    const txt = { nuke: 'Atomrakete: Ziel anklicken · Rechtsklick: Abbruch', sell: 'Verkaufen: Gebäude anklicken (Rechtsklick: Abbruch)', repair: 'Reparieren: Gebäude anklicken', attackMove: 'Angriffsbewegung: Ziel anklicken', place: this.placeType === 'wall' ? 'Mauer: Klicken oder Ziehen · R: drehen · Rechtsklick: Abbruch' : 'Platzieren: Linksklick · Rechtsklick: Abbruch' }[m];
    hint.style.display = txt ? 'block' : 'none'; hint.textContent = txt || '';
    this.dom.style.cursor = this.cursorFor();
  }

  // ------------------------------------------------------------- Platzierung
  startPlacement(type) {
    this.clearGhost();
    this.placeType = type;
    const nodes = instantiate(BUILDINGS[type].model, 0);
    this.ghostMat = new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.38, depthWrite: false });
    nodes.root.traverse((o) => { if (o.isMesh) { o.material = this.ghostMat; o.castShadow = false; } });
    const d = BUILDINGS[type];
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(d.w * CELL, d.h * CELL, d.w, d.h).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x40ff80, transparent: true, opacity: 0.25, wireframe: false, depthWrite: false }));
    const grid = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(d.w * CELL, d.h * CELL).rotateX(-Math.PI / 2)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    pad.position.y = 0.4; grid.position.y = 0.45;
    this.ghost = new THREE.Group(); this.ghost.add(nodes.root, pad, grid);
    this.ghostPad = pad;
    this.app.scene.add(this.ghost);
    if (type === 'wall') this.setWallRot(this.wallRot || 0);
    this.setMode('place');
  }
  /** Mauer: 0 = waagerecht (Ost-West), 1 = senkrecht (Nord-Süd); dreht die Vorschau mit */
  setWallRot(r) { this.wallRot = r; if (this.ghost && this.placeType === 'wall') this.ghost.children[0].rotation.y = r ? Math.PI / 2 : 0; }
  clearGhost() { if (this.ghost) { this.app.scene.remove(this.ghost); this.ghost = null; } }
  ghostCell() {
    const g = this.ground(this.mouse.x, this.mouse.y);
    if (!g) return null;
    const d = BUILDINGS[this.placeType];
    return [Math.round(g.x / CELL - d.w / 2), Math.round(g.z / CELL - d.h / 2)];
  }
  updateGhost() {
    if (this.mode !== 'place' || !this.ghost) return;
    const c = this.ghostCell(); if (!c) return;
    const d = BUILDINGS[this.placeType];
    const p = this.game.footprintCenter(this.placeType, c[0], c[1]);
    this.ghost.position.set(p.x, this.game.terrain.heightAt(p.x, p.z), p.z);
    const ok = this.game.canPlace(this.game.human, this.placeType, c[0], c[1]) && (this.placeType !== 'wall' || this.game.human.credits >= BUILDINGS.wall.cost);
    const col = ok ? 0x40ff80 : 0xff4030;
    this.ghostMat.color.setHex(col); this.ghostPad.material.color.setHex(col);
  }

  // ------------------------------------------------------------- Maus
  onDown(e) {
    initAudio();
    this.lastWall = null; this.lastWallC = null;
    if (this.app.state !== 'game' || this.app.paused) return;
    this.mouse.down = { b: e.button, x: e.clientX, y: e.clientY, tx: this.target.x, tz: this.target.z };
    if (e.button === 1) e.preventDefault();
  }
  onMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY;
    const d = this.mouse.down;
    if (!d || this.app.state !== 'game') return;
    if (d.b === 1) {
      const s = this.dist / 600;
      const dx = (e.clientX - d.x) * s, dy = (e.clientY - d.y) * s;
      const c = Math.cos(this.yaw), sn = Math.sin(this.yaw);
      this.target.x = clamp(d.tx - (dx * c + dy * sn) * 1.5, 0, WORLD);
      this.target.z = clamp(d.tz - (-dx * sn + dy * c) * 1.5, 0, WORLD);
    }
    if (d.b === 0 && this.mode === 'place' && this.placeType === 'wall') {
      const c = this.ghostCell();
      if (c && c.join() !== this.lastWall) {
        // lückenlos ziehen: Zellen zwischen der letzten und der aktuellen auffüllen; Richtung des Ziehens bestimmt die Ausrichtung
        const L = this.lastWallC || c, dx = c[0] - L[0], dz = c[1] - L[1], n = Math.max(Math.abs(dx), Math.abs(dz));
        if (n) this.setWallRot(Math.abs(dz) > Math.abs(dx) ? 1 : 0);
        for (let i = this.lastWallC ? 1 : 0; i <= n; i++) {
          const x = L[0] + Math.round(dx * i / (n || 1)), z = L[1] + Math.round(dz * i / (n || 1));
          this.game.placeWall(this.game.human, x, z, this.wallRot || 0);
        }
        this.lastWall = c.join(); this.lastWallC = c;
      }
      return;
    }
    if (d.b === 0 && this.mode !== 'place' && (Math.abs(e.clientX - d.x) > 6 || Math.abs(e.clientY - d.y) > 6)) {
      const r = this.dom.getBoundingClientRect();
      this.box = { x0: Math.min(d.x, e.clientX) - r.left, y0: Math.min(d.y, e.clientY) - r.top, x1: Math.max(d.x, e.clientX) - r.left, y1: Math.max(d.y, e.clientY) - r.top };
    }
  }
  onUp(e) {
    const d = this.mouse.down;
    this.mouse.down = null;
    if (!d || this.app.state !== 'game' || this.app.paused) { this.box = null; return; }
    if (d.b === 0) {
      if (this.box) { this.boxSelect(e.shiftKey); this.box = null; return; }
      this.leftClick(e);
    } else if (d.b === 2) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) this.rightClick(e);
    }
  }

  leftClick(e) {
    const game = this.game;
    if (this.mode === 'place') {
      const c = this.ghostCell();
      if (this.placeType === 'wall') { if (c && c.join() !== this.lastWall && !game.placeWall(game.human, c[0], c[1], this.wallRot || 0)) play('deny'); this.lastWall = null; this.lastWallC = null; return; }
      if (c && game.placeReady(game.human, this.placeType, c[0], c[1])) { this.clearGhost(); this.setMode(null); }
      else play('deny');
      return;
    }
    const h = this.pick(e.clientX, e.clientY);
    if (this.mode === 'sell') { if (h && h.kind === 'building' && h.owner === 0) { game.sell(h); } else play('deny'); if (!e.shiftKey) this.setMode(null); return; }
    if (this.mode === 'repair') { if (h && h.kind === 'building' && h.owner === 0 && h.hp < h.maxHp) { h.repairing = !h.repairing; play('click'); } else play('deny'); if (!e.shiftKey) this.setMode(null); return; }
    if (this.mode === 'nuke') {
      const g = this.ground(e.clientX, e.clientY), s = game.readySilo(game.human);
      if (g && s && game.launchNuke(s, g.x, g.z)) this.app.ui.addMarker(g.x, g.z, '#ff3a2a'); else play('deny');
      this.setMode(null);
      return;
    }
    if (this.mode === 'attackMove') {
      const units = this.myUnits();
      if (h && h.owner !== 0) game.cmdAttack(units, h);
      else { const g = this.ground(e.clientX, e.clientY); if (g) { game.cmdMove(units, g.x, g.z, true); this.app.ui.addMarker(g.x, g.z, '#ff6a4a'); } }
      this.setMode(null);
      return;
    }
    const now = performance.now();
    if (h && h.owner === 0 && h.kind === 'unit') {
      if (now - this.lastClick.t < 350 && this.lastClick.id === h.type) { this.selectSameOnScreen(h.type, e.shiftKey); this.lastClick.t = 0; return; }
      this.lastClick = { t: now, id: h.type };
      if (game.selection.size === 1 && game.selection.has(h) && h.type === 'mcv') { game.cmdDeploy(h); return; }
      if (e.shiftKey) { if (game.selection.has(h)) game.selection.delete(h); else game.selection.add(h); }
      else { game.selection.clear(); game.selection.add(h); }
      play('select');
    } else if (h) {
      game.selection.clear(); game.selection.add(h); play('select');
    } else if (!e.shiftKey) game.selection.clear();
  }

  rightClick(e) {
    const game = this.game;
    if (this.mode) { this.setMode(null); return; }
    const g = this.ground(e.clientX, e.clientY);
    const h = this.pick(e.clientX, e.clientY);
    const sel = [...game.selection];
    if (sel.length === 1 && sel[0].kind === 'building' && sel[0].owner === 0) {
      if (g) { sel[0].rally = { x: g.x, z: g.z }; play('click'); this.app.ui.addMarker(g.x, g.z, '#7dff9a'); }
      return;
    }
    if (h && h.owner !== 0) { const u = this.myUnits(); if (u.length) { game.cmdAttack(u, h); this.app.ui.addMarker(h.x, h.z, '#ff4a3a'); } return; }
    if (h && h.owner === 0 && h.type === 'refinery') {
      const hv = this.myUnits().filter((u) => u.def.cargo);
      if (hv.length) { for (const u of hv) { u.hState = 'toDock'; u.order = null; u.path = []; } play('order'); return; }
    }
    if (g) this.commandAt(g.x, g.z);
  }

  commandAt(x, z) {
    const game = this.game, units = this.myUnits();
    if (!units.length) return;
    const k = Math.floor(z / CELL) * MAPN + Math.floor(x / CELL);
    const harv = units.filter((u) => u.def.cargo), rest = units.filter((u) => !u.def.cargo);
    if (harv.length && game.terrain.ore[k] > 20) { game.cmdHarvest(harv, x, z); this.app.ui.addMarker(x, z, '#ffc94a'); if (rest.length) game.cmdMove(rest, x, z); return; }
    game.cmdMove(units, x, z);
    this.app.ui.addMarker(x, z, '#7dff9a');
  }

  myUnits() { return [...this.game.selection].filter((e) => e.kind === 'unit' && e.owner === 0 && !e.dead); }

  boxSelect(add) {
    const game = this.game, b = this.box, r = this.dom.getBoundingClientRect();
    if (!add) game.selection.clear();
    let any = false;
    for (const u of game.units) {
      if (u.owner !== 0 || u.dead || u.dying !== undefined) continue;
      const p = this.screenOf(u.x, u.y + 1, u.z);
      const x = p.x - r.left, y = p.y - r.top;
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) { game.selection.add(u); any = true; }
    }
    // Sammler nur wenn nichts anderes
    const sel = [...game.selection];
    if (sel.some((u) => !u.def.cargo)) for (const u of sel) if (u.def.cargo) game.selection.delete(u);
    if (any) play('select');
  }
  selectSameOnScreen(type, add) {
    const game = this.game, r = this.dom.getBoundingClientRect();
    if (!add) game.selection.clear();
    for (const u of game.units) {
      if (u.owner !== 0 || u.type !== type || u.dead) continue;
      const p = this.screenOf(u.x, u.y, u.z);
      if (p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom) game.selection.add(u);
    }
    play('select');
  }

  // ------------------------------------------------------------- Tastatur
  onKey(e, down) {
    if (e.target && e.target.tagName === 'SELECT') return;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (!down || this.app.state !== 'game') return;
    initAudio();
    const game = this.game;
    if (e.code === 'Escape') {
      if (this.mode) { this.setMode(null); return; }
      if (this.app.paused) this.app.resume(); else this.app.pause();
      return;
    }
    if (this.app.paused) return;
    const units = this.myUnits();
    const digit = e.code.startsWith('Digit') ? e.code.slice(5) : null;
    if (digit && digit !== '0') {
      if (e.ctrlKey) {
        e.preventDefault();
        for (const u of game.units) if (u.group === digit) u.group = null;
        this.groups[digit] = units.map((u) => u.id);
        for (const u of units) u.group = digit;
        play('click');
      } else if (this.groups[digit]) {
        const list = this.groups[digit].map((id) => game.byId.get(id)).filter((u) => u && !u.dead);
        if (!list.length) return;
        const now = performance.now();
        if (this.lastGroup === digit && now - this.lastGroupT < 400) { const c = list[0]; this.lookAt(c.x, c.z); }
        this.lastGroup = digit; this.lastGroupT = now;
        game.selection.clear(); list.forEach((u) => game.selection.add(u)); play('select');
      }
      return;
    }
    switch (e.code) {
      case 'KeyS': if (units.length) { game.cmdStop(units); play('click'); } break;
      case 'KeyA': if (units.length) this.setMode('attackMove'); break;
      case 'KeyD': { const m = units.find((u) => u.type === 'mcv'); if (m) game.cmdDeploy(m); break; }
      case 'KeyH': { const hq = game.buildings.find((b) => b.owner === 0 && b.type === 'hq') || game.buildings.find((b) => b.owner === 0) || game.units.find((u) => u.owner === 0); if (hq) this.lookAt(hq.x, hq.z); break; }
      case 'KeyR': if (this.mode === 'place' && this.placeType === 'wall') { this.setWallRot(this.wallRot ? 0 : 1); play('click'); break; }   // Mauer drehen
        this.setMode(this.mode === 'repair' ? null : 'repair'); break;
      case 'KeyV': this.setMode(this.mode === 'sell' ? null : 'sell'); break;
      case 'KeyN': this.toggleNuke(); break;
      case 'KeyM': AUDIO.enabled = !AUDIO.enabled; this.app.ui.message(AUDIO.enabled ? 'Ton an' : 'Ton aus'); break;
      case 'Space': { const a = this.app.ui.lastAttack; if (a) this.lookAt(a.x, a.z); e.preventDefault(); break; }
      case 'KeyP': this.app.pause(); break;
    }
  }
}
