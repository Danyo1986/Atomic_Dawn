// Spielzustand & Simulation: Einheiten, Gebäude, Produktion, Kampf, Erzernte, Energie
import * as THREE from 'three';
import { CELL, MAPN, WORLD, UNITS, BUILDINGS, WEAPONS, TEAMS, DIFFICULTY, AIRFIELD_SLOTS, NUKE } from './config.js';
import { clamp, angDiff, turnTo, dist, dist2 } from './util.js';
import { instantiate, attachInfantryWeapon, BLINK } from './assets.js';
import { findPath, nearestFree } from './path.js';
import { FOG, updateFog, visGrid, isVisible, isExplored } from './fog.js';
import { play, say } from './audio.js';
import { rand } from './rng.js';

const INF_SCALE = 1.45;
const AIR_ALT = 15;
const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _n = new THREE.Vector3();
const _nearA = [], _nearB = [], _nearC = [], _box = new THREE.Box3();

// ---- Körperform der Bodeneinheiten: Kapsel = Strecke längs der Fahrtrichtung (halbe Länge segA) + Radius
const segA = (d) => d._segA ?? (d._segA = d.inf || !d.len ? 0 : Math.max(0, d.len / 2 - d.radius));
const reachOf = (d) => d._reach ?? (d._reach = segA(d) + Math.abs(d.lenOff || 0) + d.radius);   // größte Ausdehnung um den Mittelpunkt
const MAX_REACH = Math.max(...Object.values(UNITS).filter((d) => !d.air).map(reachOf));
const SEP_GAP = 0.4, SEP_SLOP = 0.03;                                     // Luft zwischen Fahrzeugen / Toleranz gegen Zittern
const _sA = [0, 0, 0, 0], _sB = [0, 0, 0, 0], _cp = [0, 0, 0, 0];
/** Gewicht beim Auseinanderschieben: Infanterie leicht, große Fahrzeuge schwer, stehende Einheiten dreifach */
const heft = (u) => (u.def.inf ? 0.12 : u.def.radius ** 2 * (1 + segA(u.def) * 0.5)) * (u.path.length || u.speed > 0.5 ? 1 : 3);
/** Kapselstrecke einer Einheit nach out = [x0, z0, x1, z1] */
function bodySeg(u, out) {
  const d = u.def, a = segA(d), c = Math.cos(u.heading), s = Math.sin(u.heading), o = d.lenOff || 0;
  const mx = u.x + c * o, mz = u.z + s * o;
  out[0] = mx - c * a; out[1] = mz - s * a; out[2] = mx + c * a; out[3] = mz + s * a;
  return out;
}
/** nächste Punkte zweier Strecken p, q -> out = [px, pz, qx, qz] */
function closestSeg(p, q, out) {
  const d1x = p[2] - p[0], d1z = p[3] - p[1], d2x = q[2] - q[0], d2z = q[3] - q[1], rx = p[0] - q[0], rz = p[1] - q[1];
  const a = d1x * d1x + d1z * d1z, e = d2x * d2x + d2z * d2z, f = d2x * rx + d2z * rz;
  let s = 0, t = 0;
  if (a < 1e-9) t = e < 1e-9 ? 0 : clamp(f / e, 0, 1);
  else {
    const c = d1x * rx + d1z * rz;
    if (e < 1e-9) s = clamp(-c / a, 0, 1);
    else {
      const b = d1x * d2x + d1z * d2z, den = a * e - b * b;
      s = den > 1e-9 ? clamp((b * f - c * e) / den, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); }
    }
  }
  out[0] = p[0] + d1x * s; out[1] = p[1] + d1z * s; out[2] = q[0] + d2x * t; out[3] = q[1] + d2z * t;
  return out;
}
const _ray = new THREE.Raycaster(), DOWN = new THREE.Vector3(0, -1, 0);

let NEXT_ID = 1;
// Veteranenränge: 0 Rekrut, 1 Veteran, 2 Elite
export const RANK = { dmg: [1, 1.25, 1.5], armor: [1, 0.85, 0.7], rof: [1, 0.9, 0.8], name: ['', 'Veteran', 'Elite'] };

export class Game {
  constructor(scene, terrain, fx, opts) {
    this.scene = scene; this.terrain = terrain; this.fx = fx; this.opts = opts;
    this.time = 0;
    this.units = []; this.buildings = []; this.byId = new Map();
    this.projectiles = [];
    this.bgrid = new Int32Array(MAPN * MAPN); // Gebäude-ID je Zelle
    this.hash = new Map();
    this.selection = new Set();
    this.events = []; // UI-Meldungen
    this.over = null;
    this.players = [];
    // Plätze: opts.slots[i] = { human, ally, diff, name } (Mehrspieler-Lobby); ohne: Spieler 0 = Mensch, alle anderen KI, jeder gegen jeden
    const slots = opts.slots || Array.from({ length: opts.players }, (_, i) => ({ human: i === 0, ally: i, diff: opts.difficulty }));
    slots.forEach((s, i) => {
      this.players.push({
        id: i, team: i, ally: s.ally ?? i, human: !!s.human, name: s.name || '', credits: opts.credits, power: { prod: 0, use: 0 }, low: false,
        queues: { bld: mkQ(), def: mkQ(), inf: mkQ(), veh: mkQ(), air: mkQ() },
        count: {}, alive: true, diff: s.human ? null : DIFFICULTY[s.diff || opts.difficulty || 'normal'],
        stats: { built: 0, lost: 0, kills: 0, bBuilt: 0, bLost: 0, ore: 0 },
      });
    });
    this.net = !!opts.net;          // Mehrspieler (Lockstep): keine Zeitlupe am Ende, Sicht je Team in der Simulation
    this.fogOn = opts.fog !== false; // Kriegsnebel gilt für alle gleich (Lobby-Einstellung)
    this.me = opts.me || 0;          // Index des Spielers an diesem Rechner
    this.human = this.players[this.me];   // = lokaler Spieler (Meldungen, Oberfläche, Sicht); p === this.human = von einem Menschen gesteuert
    this.allyVis = new Map();        // Sicht je Team (Simulation: menschliche Truppen greifen nur Gesehenes an)
    this.fogTimer = 0; this.oreTimer = 0; this.checkTimer = 0; this.fxTimer = 0;
    this.timers = []; this.anims = [];   // Zeitplan und laufende Abläufe im Spieltakt (pausieren mit, unabhängig von der Bildrate)
  }

  /** fn nach sec Sekunden Spielzeit ausführen */
  after(sec, fn) { this.timers.push({ at: this.time + sec, fn }); }

  // ================================================================= Erzeugen
  spawnUnit(type, owner, x, z, heading = 0) {
    const def = UNITS[type];
    const nodes = instantiate(def.model, owner);
    const obj = new THREE.Group();
    obj.add(nodes.root);
    const u = {
      id: NEXT_ID++, kind: 'unit', type, def, owner, x, z, y: 0, heading, speed: 0, hp: def.hp, maxHp: def.hp,
      obj, nodes, path: [], order: null, target: null, cooldown: rand() * 0.5, turretYaw: 0, gunPitch: 0,
      guard: { x, z }, stuck: 0, lastD: 1e9, repath: 0, cargo: 0, hState: def.cargo ? 'toOre' : null, acquireT: rand() * 0.5,
      salvo: 0, salvoT: 0, alt: def.air ? (def.alt || AIR_ALT) : 0, dead: false, lastHit: -99, vis: true,
    };
    if (def.inf) {
      if (nodes.phase) nodes.phase(rand() * 6, rand() * 9);   // Gangphase aus dem Simulationszufall (bestimmt die Mündungslage)
      nodes.root.scale.setScalar(INF_SCALE);
      if (!nodes.figure) attachInfantryWeapon(nodes, def.launcher, owner);
      nodes.actions.idle.play();
      u.anim = 'idle';
    }
    if (def.scale) nodes.root.scale.setScalar(def.scale);
    if (nodes.load) nodes.load.visible = false;
    const ring = new THREE.Mesh(new THREE.RingGeometry(def.radius * 1.05, def.radius * 1.05 + (def.inf ? 0.12 : 0.22), 40),
      new THREE.MeshBasicMaterial({ color: 0x6dff8a, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.25; ring.visible = false; ring.renderOrder = 5;
    obj.add(ring); u.ring = ring;
    this.scene.add(obj);
    this.units.push(u); this.byId.set(u.id, u);
    const p = this.players[owner]; p.count[type] = (p.count[type] || 0) + 1; p.stats.built++;
    this.placeUnitObj(u, 1);
    return u;
  }

  footprintCenter(type, cx, cz) { const d = BUILDINGS[type]; return { x: (cx + d.w / 2) * CELL, z: (cz + d.h / 2) * CELL }; }

  placeBuilding(type, owner, cx, cz, instant = false) {
    const def = BUILDINGS[type];
    const c = this.footprintCenter(type, cx, cz);
    const T = this.terrain;
    let hs = 0, n = 0;
    for (let z = cz; z <= cz + def.h; z++) for (let x = cx; x <= cx + def.w; x++) { hs += T.heightAt(x * CELL, z * CELL); n++; }
    const hh = hs / n;
    T.flatten(cx * CELL - 0.5, cz * CELL - 0.5, (cx + def.w) * CELL + 0.5, (cz + def.h) * CELL + 0.5, hh);
    const nodes = instantiate(def.model, owner);
    const obj = new THREE.Group();
    obj.add(nodes.root);
    obj.position.set(c.x, hh - 0.05, c.z);
    this.scene.add(obj);
    const top = _box.setFromObject(nodes.root).max.y;
    const b = {
      id: NEXT_ID++, kind: 'building', type, def, owner, cx, cz, w: def.w, h: def.h, x: c.x, z: c.z, y: hh,
      hp: def.hp, maxHp: def.hp, obj, nodes, rise: instant ? 1 : 0, dead: false, lastHit: -99, repairing: false, selling: 0,
      cooldown: 0, target: null, turretYaw: -Math.PI / 2, acquireT: 0, dockUser: 0, fxT: Math.random(), seen: false,
      baseY: hh - 0.05, top: Math.max(1.5, top),
    };
    if (!instant) obj.position.y = b.baseY - b.top;
    for (let z = cz; z < cz + def.h; z++) for (let x = cx; x < cx + def.w; x++) { this.terrain.blocked[z * MAPN + x] = 1; this.bgrid[z * MAPN + x] = b.id; }
    if (type === 'refinery') { // Andockrampe (vordere linke Zellen) befahrbar lassen
      for (const [dx, dz] of [[0, 2], [1, 2]]) this.terrain.blocked[(cz + dz) * MAPN + cx + dx] = 0;
    }
    this.buildings.push(b); this.byId.set(b.id, b);
    const p = this.players[owner];
    p.count[type] = (p.count[type] || 0) + 1; p.stats.bBuilt++;
    this.updatePower(p);
    if (type === 'refinery') b.freeHarvester = true;
    if (def.superweapon && nodes.rocket) {   // Rakete: Ruhelage merken, beim Laden fährt sie aus dem Boden
      const R = nodes.rocket;
      b.charge = 0; b.rocketY0 = R.position.y; b.rocketH = new THREE.Box3().setFromObject(R).getSize(new THREE.Vector3()).y;
      R.visible = false;
    }
    if (def.wall) { this.orientWall(b); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const n = this.buildingAtCell(cx + dx, cz + dz); if (n && n.def.wall) this.orientWall(n); } }
    play('place', c.x, c.z);
    for (let i = 0; i < 10; i++) this.fx.dust(c.x + (Math.random() - 0.5) * def.w * CELL, hh, c.z + (Math.random() - 0.5) * def.h * CELL, 2);
    return b;
  }

  // ================================================================= Abfragen
  isEnemy(a, b) { return !this.allied(a.owner, b.owner); }
  /** Spieler-ids im selben Team (oder derselbe Spieler) */
  allied(a, b) { return a === b || (this.players[a] && this.players[b] && this.players[a].ally === this.players[b].ally); }
  /** gehört zum Team des Spielers an diesem Rechner (eigene Sicht, Auswahl verbündeter Gebäude im Nebel) */
  mine(o) { return o.owner === this.me; }
  friendly(o) { return this.allied(o.owner, this.me); }
  /** Sieht das Team von Spieler pid den Punkt? Deterministisch (Simulationstakt), unabhängig vom Rechner */
  seenBy(pid, x, z) {
    if (!this.fogOn) return true;
    const g = this.allyVis.get(this.players[pid].ally);
    if (!g) return true;
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return cx >= 0 && cz >= 0 && cx < MAPN && cz < MAPN && g[cz * MAPN + cx] === 1;
  }
  rebuildHash() {
    this.hash.clear();
    for (const u of this.units) {
      const k = Math.floor(u.z / 16) * 64 + Math.floor(u.x / 16);
      let l = this.hash.get(k); if (!l) this.hash.set(k, l = []); l.push(u);
    }
  }
  unitsNear(x, z, r, out = []) {
    out.length = 0;
    const x0 = Math.floor((x - r) / 16), x1 = Math.floor((x + r) / 16), z0 = Math.floor((z - r) / 16), z1 = Math.floor((z + r) / 16);
    const r2 = r * r;
    for (let gz = z0; gz <= z1; gz++) for (let gx = x0; gx <= x1; gx++) {
      const l = this.hash.get(gz * 64 + gx); if (!l) continue;
      for (const u of l) if (!u.dead && dist2(u.x, u.z, x, z) <= r2) out.push(u);
    }
    return out;
  }
  buildingAtCell(cx, cz) { if (cx < 0 || cz < 0 || cx >= MAPN || cz >= MAPN) return null; const id = this.bgrid[cz * MAPN + cx]; return id ? this.byId.get(id) : null; }
  /** Abstand Punkt -> Zielrand (Gebäude als Rechteck) */
  edgeDist(x, z, t) {
    if (t.kind === 'building') {
      const x0 = t.cx * CELL, z0 = t.cz * CELL, x1 = x0 + t.w * CELL, z1 = z0 + t.h * CELL;
      const dx = Math.max(x0 - x, 0, x - x1), dz = Math.max(z0 - z, 0, z - z1);
      return Math.hypot(dx, dz);
    }
    return Math.max(0, dist(x, z, t.x, t.z) - t.def.radius * 0.6);
  }
  hasBuilding(p, type) { return this.buildings.some((b) => b.owner === p.id && b.type === type && !b.dead && b.rise >= 1); }
  producers(p, type) { return this.buildings.filter((b) => b.owner === p.id && b.type === type && !b.dead && b.rise >= 1 && !b.selling); }

  canBuild(p, type) {
    const d = UNITS[type] || BUILDINGS[type];
    if (!d) return false;
    if (d.faction && d.faction !== TEAMS[p.team].faction) return false;   // Teslaturm nur Achsenmacht, Prismaturm nur Allianz
    if (BUILDINGS[type]) { if (d.buildable === false || !this.hasBuilding(p, 'hq')) return false; if (d.unique && (p.count[type] || 0) > 0) return false; }
    else if (!this.hasBuilding(p, d.from)) return false;
    for (const r of d.req || []) if (!this.hasBuilding(p, r)) return false;
    return true;
  }

  canPlace(p, type, cx, cz, { ignore = null, adjacency = true } = {}) {
    const d = BUILDINGS[type];
    if (cx < 1 || cz < 1 || cx + d.w > MAPN - 1 || cz + d.h > MAPN - 1) return false;
    const T = this.terrain;
    let mn = 1e9, mx = -1e9;
    for (let z = cz; z < cz + d.h; z++) for (let x = cx; x < cx + d.w; x++) {
      const k = z * MAPN + x;
      if (!T.passable[k] || T.blocked[k] || T.oreMax[k] > 0) return false;
      const h = T.heightAt((x + 0.5) * CELL, (z + 0.5) * CELL); mn = Math.min(mn, h); mx = Math.max(mx, h);
    }
    if (mx - mn > 2.5) return false;
    // Zufahrt vor Raffinerie-Rampen freihalten (2x2 Zellen unterhalb der Rampe)
    const hits = (x0, z0, w, h) => cx < x0 + w && cx + d.w > x0 && cz < z0 + h && cz + d.h > z0;
    for (const b of this.buildings) if (b.type === 'refinery' && !b.dead && hits(b.cx - 1, b.cz + 2, 3, 3) && !(b.cx === cx && b.cz === cz)) return false;
    if (type === 'refinery') {
      for (let z = cz + 3; z < cz + 5; z++) for (let x = cx - 1; x < cx + 2; x++) if (!T.isPassable(x, z)) return false;
    }
    const c = this.footprintCenter(type, cx, cz);
    const r = Math.max(d.w, d.h) * CELL * 0.75;
    for (const u of this.unitsNear(c.x, c.z, r + 4)) {
      if (u === ignore || u.def.air) continue;
      if (u.x > cx * CELL - 1 && u.x < (cx + d.w) * CELL + 1 && u.z > cz * CELL - 1 && u.z < (cz + d.h) * CELL + 1) return false;
    }
    if (adjacency) {
      const R = 5;
      const ok = this.buildings.some((b) => b.owner === p.id && !b.dead &&
        cx < b.cx + b.w + R && cx + d.w > b.cx - R && cz < b.cz + b.h + R && cz + d.h > b.cz - R);
      if (!ok) return false;
    }
    return true;
  }

  updatePower(p) {
    let prod = 0, use = 0;
    for (const b of this.buildings) {
      if (b.owner !== p.id || b.dead || b.rise < 1) continue;
      const pw = b.def.power || 0;
      if (pw > 0) prod += pw * (0.5 + 0.5 * b.hp / b.maxHp); else use -= pw;
    }
    const wasLow = p.low;
    p.power.prod = Math.round(prod); p.power.use = use; p.low = use > prod;
    if (p === this.human && p.low && !wasLow) say('Geringe Energie');
  }

  orientWall(b) {
    const w = (dx, dz) => { const n = this.buildingAtCell(b.cx + dx, b.cz + dz); return !!(n && n.def.wall && !n.dead); };
    const ew = w(1, 0) || w(-1, 0), ns = w(0, 1) || w(0, -1);
    b.nodes.root.rotation.y = (ns && !ew) || (!ns && !ew && b.wallRot) ? Math.PI / 2 : 0;   // ohne Nachbarn: gewählte Ausrichtung
    if (ns && ew && !b.cross) { b.cross = b.nodes.root.clone(); b.cross.rotation.y = Math.PI / 2; b.obj.add(b.cross); }
  }
  placeWall(p, cx, cz, rot = 0) {
    const d = BUILDINGS.wall;
    if (!this.canBuild(p, 'wall') || p.credits < d.cost || !this.canPlace(p, 'wall', cx, cz)) return false;
    p.credits -= d.cost;
    const b = this.placeBuilding('wall', p.id, cx, cz);
    if (b) { b.wallRot = rot; this.orientWall(b); }
    return true;
  }

  // ================================================================= Produktion
  queueItem(p, type) {
    const d = UNITS[type] || BUILDINGS[type];
    if (!this.canBuild(p, type)) return false;
    const q = p.queues[d.key];
    if (BUILDINGS[type]) {
      if (q.type) return false;
      q.type = type; q.progress = 0; q.spent = 0; q.ready = false; q.paused = false;
    } else {
      if (q.list.length >= 10) return false;
      if (d.air) { // Flottengröße: 3 Jagdbomber + 3 Hubschrauber je Flugfeld
        const c = this.airCapacity(p, type);
        if (c.used + c.queued >= c.cap) { if (p === this.human) say('Flugfelder voll belegt', 8); return false; }
      }
      q.list.push(type);
      if (!q.type) { q.type = q.list[0]; q.progress = 0; q.spent = 0; }
    }
    if (p === this.human) { play('build'); if (BUILDINGS[type]) say('Bauvorgang'); else say('Ausbildung', 6); }
    return true;
  }
  cancelItem(p, type) {
    const d = UNITS[type] || BUILDINGS[type];
    const q = p.queues[d.key];
    if (BUILDINGS[type]) {
      if (q.type !== type) return;
      p.credits += q.spent; q.type = null; q.ready = false; q.progress = 0; q.spent = 0;
    } else {
      const i = q.list.lastIndexOf(type);
      if (i < 0) return;
      if (i === 0 && q.list.filter((t) => t === type).length === 1) { p.credits += q.spent; q.progress = 0; q.spent = 0; }
      q.list.splice(i, 1);
      q.type = q.list[0] || null;
    }
    if (p === this.human) play('click');
  }

  tickProduction(p, dt) {
    let speed = (p.low ? 0.45 : 1) * (p.diff ? p.diff.speed : 1) * (this.opts.gameSpeed || 1);
    for (const [key, q] of Object.entries(p.queues)) {
      if (!q.type) continue;
      const d = UNITS[q.type] || BUILDINGS[q.type];
      if (!this.canBuild(p, q.type)) {
        if (BUILDINGS[q.type] && q.ready) continue;
        // Voraussetzung verloren -> Rückerstattung
        p.credits += q.spent; q.spent = 0; q.progress = 0;
        if (BUILDINGS[q.type]) q.type = null; else { q.list = q.list.filter((t) => this.canBuild(p, t)); q.type = q.list[0] || null; }
        continue;
      }
      if (q.ready || q.paused) continue;
      let mult = speed;
      if (UNITS[q.type]) mult *= 1 + 0.25 * (this.producers(p, d.from).length - 1);
      const dp = dt / d.time * mult;
      const want = Math.min(1, q.progress + dp);
      const need = d.cost * want - q.spent;
      if (need > p.credits) { if (p === this.human && p.credits < 5) say('Unzureichende Mittel', 12); continue; }
      p.credits -= need; q.spent += need; q.progress = want;
      if (q.progress >= 1) {
        if (BUILDINGS[q.type]) {
          q.ready = true;
          if (p === this.human) { say('Bau abgeschlossen'); play('ready'); }
        } else {
          const ok = this.deliverUnit(p, q.type);
          if (ok) { q.list.shift(); q.type = q.list[0] || null; q.progress = 0; q.spent = 0; }
          else q.progress = 0.999;
        }
      }
    }
  }

  deliverUnit(p, type) {
    const d = UNITS[type];
    const prods = this.producers(p, d.from);
    if (!prods.length) return false;
    if (d.jet) { // Jagdbomber brauchen einen freien Stellplatz; sonst wartet die Produktion
      const pad = this.freePad(p, true);
      if (!pad) { if (p === this.human) say('Kein freies Flugfeld', 20); return false; }
      const slot = this.freeSlot(pad), pp = this.padPos(pad, slot);
      const j = this.spawnUnit(type, p.id, pp.x, pp.z, -Math.PI / 2);
      j.pad = pad.id; j.slot = slot; j.jetState = 'parked'; j.alt = 0;
      if (p === this.human) say('Jagdbomber bereit', 3);
      return true;
    }
    let b = prods.find((x) => x.primary) || prods[0];
    if (d.air) { // Hubschrauber gehören zu einem Flugfeld mit freiem Platz und erscheinen dort
      b = this.freePad(p, false);
      if (!b) { if (p === this.human) say('Kein freies Flugfeld', 20); return false; }
    }
    const ex = new THREE.Vector3();
    (b.nodes.exit || b.obj).getWorldPosition(ex);
    if (!b.nodes.exit) ex.set(b.x + b.w * CELL / 2, 0, b.z);
    let ox = ex.x - b.x, oz = ex.z - b.z; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
    if (!d.air && !d.inf) { // Ausgang noch von einem Fahrzeug belegt: kurz warten (höchstens 3 s) und Wartende bitten, Platz zu machen
      const probe = { def: d, x: ex.x, z: ex.z, heading: Math.atan2(oz, ox) };
      bodySeg(probe, _sA);
      let busy = false;
      for (const v of this.unitsNear(ex.x, ex.z, reachOf(d) + MAX_REACH + 1, _nearC)) {
        if (v.def.air || v.def.inf || v.dying !== undefined) continue;
        const c = closestSeg(_sA, bodySeg(v, _sB), _cp);
        if (Math.hypot(c[2] - c[0], c[3] - c[1]) >= d.radius + v.def.radius) continue;
        busy = true;
        if (v.owner === p.id) this.makeWay(v, probe, ox, oz, (v.z - ex.z) * ox - (v.x - ex.x) * oz, true);
      }
      if (busy && this.time - (b.exitWait || (b.exitWait = this.time)) < 3) return false;
      b.exitWait = 0;
    }
    const u = this.spawnUnit(type, p.id, ex.x, ex.z, 0);
    if (d.air) { u.alt = 1; u.pad = b.id; }
    if (b.obj.visible && !d.inf) for (let i = 0; i < 4; i++) this.fx.dust(ex.x, b.y, ex.z, 1.3);
    // Sammelpunkt
    const rx = b.rally ? b.rally.x : ex.x + ox * (d.air ? 14 : 9) - oz * (rand() - 0.5) * 10;
    const rz = b.rally ? b.rally.z : ex.z + oz * (d.air ? 14 : 9) + ox * (rand() - 0.5) * 10;
    u.heading = Math.atan2(oz, ox);
    if (type === 'harvester') { u.hState = 'toOre'; }
    else this.cmdMove([u], rx, rz, false, true);
    if (p === this.human) say(d.inf ? 'Einheit bereit' : d.jet ? 'Jagdbomber bereit' : d.air ? 'Hubschrauber bereit' : 'Fahrzeug bereit', 3);
    return true;
  }

  placeReady(p, type, cx, cz) {
    const q = p.queues[BUILDINGS[type].key];
    if (!q.ready || q.type !== type) return false;
    if (!this.canPlace(p, type, cx, cz)) return false;
    this.placeBuilding(type, p.id, cx, cz);
    q.type = null; q.ready = false; q.progress = 0; q.spent = 0;
    return true;
  }

  // ================================================================= Befehle
  cmdMove(units, x, z, attackMove = false, quiet = false) {
    const ground = units.filter((u) => !u.def.air && u.def.speed);
    const air = units.filter((u) => u.def.air);
    // Zielzellen spiralförmig vergeben
    const T = this.terrain;
    let tcx = clamp(Math.floor(x / CELL), 0, MAPN - 1), tcz = clamp(Math.floor(z / CELL), 0, MAPN - 1);
    const ok = (cx, cz) => T.isPassable(cx, cz);
    const start = nearestFree(tcx, tcz, ok, 15);
    if (start) [tcx, tcz] = start;
    ground.sort((a, b) => dist2(a.x, a.z, x, z) - dist2(b.x, b.z, x, z));
    // Fahrtrichtung der Gruppe: Zielpunkte längs davon nach Fahrzeuglänge, quer nach Breite auseinander
    let gx0 = 0, gz0 = 0;
    for (const u of ground) { gx0 += u.x; gz0 += u.z; }
    let fx = x - gx0 / (ground.length || 1), fz = z - gz0 / (ground.length || 1);
    const fl = Math.hypot(fx, fz);
    if (fl > 0.5) { fx /= fl; fz /= fl; } else { fx = 1; fz = 0; }
    const placed = [];   // vergebene Zielpunkte [x, z, halbe Länge, halbe Breite, Infanterie]
    const fits = (cx, cz, hl, hw, inf) => {
      const px = (cx + 0.5) * CELL, pz = (cz + 0.5) * CELL;
      for (const q of placed) {
        if (inf && q[4]) continue;                     // Infanterie untereinander: bis zu 3 je Zelle
        const dx = q[0] - px, dz = q[1] - pz, gap = (inf || q[4] ? 0.3 + 1.7 : 0.6);   // 1,7 m = Streuung der Infanterie
        const lp = (dx * fx + dz * fz) / (hl + q[2] + gap), lq = (dz * fx - dx * fz) / (hw + q[3] + gap);
        if (lp * lp + lq * lq < 1) return false;
      }
      placed.push([px, pz, hl, hw, inf]);
      return true;
    };
    const halfLen = (d) => d.inf ? 0.8 : (d.len || d.radius * 2) / 2 + Math.abs(d.lenOff || 0);
    // dort stehende Einheiten und Zielpunkte laufender Fahrbefehle sind belegt (z. B. mehrere Fahrzeuge nacheinander zum selben Sammelpunkt)
    const mine = new Set(ground);
    for (const v of this.units) {
      if (v.dead || v.dying !== undefined || v.def.air || mine.has(v)) continue;
      const mv = v.order && (v.order.type === 'move' || v.order.type === 'attackMove');
      if (v.path.length && !mv) continue;
      const p = v.path.length ? v.path[v.path.length - 1] : v;
      if (dist2(p.x, p.z, x, z) > 45 * 45) continue;
      placed.push([p.x, p.z, halfLen(v.def), v.def.radius, !!v.def.inf]);
    }
    const used = new Map(), cells = [];   // Zellen spiralförmig nach Abstand; abgelehnte bleiben für kleinere Einheiten
    let ring = 0;
    const nextCell = (u) => {
      const inf = !!u.def.inf, hl = halfLen(u.def), hw = u.def.radius;
      for (let i = 0; ; i++) {
        if (i >= cells.length) {
          if (ring > 20) return [tcx, tcz];
          const rc = [];
          for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === ring && ok(tcx + dx, tcz + dz)) rc.push([tcx + dx, tcz + dz]);
          rc.sort((a, b) => ((a[0] - tcx) ** 2 + (a[1] - tcz) ** 2) - ((b[0] - tcx) ** 2 + (b[1] - tcz) ** 2));
          cells.push(...rc); ring++; i--; continue;
        }
        const c = cells[i], k = c[1] * MAPN + c[0], n = used.get(k) || 0;
        if (n >= (inf ? 3 : 1) || !fits(c[0], c[1], hl, hw, inf)) continue;
        used.set(k, inf ? n + 1 : 3);
        return c;
      }
    };
    for (const u of ground) {
      const c = nextCell(u);
      const gx = (c[0] + 0.5) * CELL + (u.def.inf ? (rand() - 0.5) * 2.4 : 0), gz = (c[1] + 0.5) * CELL + (u.def.inf ? (rand() - 0.5) * 2.4 : 0);
      u.order = { type: attackMove ? 'attackMove' : 'move', x: gx, z: gz };
      u.target = null;
      if (u.def.cargo) u.hState = 'manual';
      this.pathTo(u, gx, gz);
    }
    air.forEach((u, i) => {
      const a = i * 2.4, r = i ? 6 + i * 1.5 : 0;
      const gx = x + Math.cos(a) * r, gz = z + Math.sin(a) * r;
      u.order = { type: attackMove ? 'attackMove' : 'move', x: gx, z: gz }; u.target = null; u.path = [{ x: gx, z: gz }];
    });
    if (!quiet && !this.net && units.some((u) => this.mine(u))) play('order');
  }
  pathTo(u, x, z) {
    if (u.def.air) { u.path = [{ x, z }]; return; }
    const T = this.terrain;
    const sx = clamp(Math.floor(u.x / CELL), 0, MAPN - 1), sz = clamp(Math.floor(u.z / CELL), 0, MAPN - 1);
    let tx = clamp(Math.floor(x / CELL), 0, MAPN - 1), tz = clamp(Math.floor(z / CELL), 0, MAPN - 1);
    const ok = (cx, cz) => T.isPassable(cx, cz);
    const nf = nearestFree(tx, tz, ok, 10);
    if (nf) [tx, tz] = nf;
    const p = findPath(sx, sz, tx, tz, ok);
    if (p.length) {
      const last = p[p.length - 1];
      if (Math.floor(last.x / CELL) === tx && Math.floor(last.z / CELL) === tz && ok(Math.floor(x / CELL), Math.floor(z / CELL))) { last.x = x; last.z = z; }
    }
    u.path = p; u.stuck = 0; u.lastD = 1e9; u.progT = 0;
  }
  cmdAttack(units, target) {
    for (const u of units) {
      if (!u.def.weapon) { this.cmdMove([u], target.x, target.z, false, true); continue; }
      if (!this.canHit(u, target)) continue;
      u.order = { type: 'attack', target: target.id }; u.target = target; u.path = []; u.repath = 0;
      if (u.def.cargo) u.hState = 'manual';
    }
    if (!this.net && units.some((u) => this.mine(u))) play('order');
  }
  cmdStop(units) { for (const u of units) { u.order = null; u.path = []; u.target = null; u.guard = { x: u.x, z: u.z }; } }
  cmdHarvest(units, x, z) {
    for (const u of units) if (u.def.cargo) { u.hState = 'toOre'; u.order = null; u.prefOre = { x, z }; u.path = []; }
    play('order');
  }
  cmdDeploy(u) {
    if (u.type !== 'mcv') return false;
    const cx = Math.round(u.x / CELL - 2), cz = Math.round(u.z / CELL - 2);
    const p = this.players[u.owner];
    if (!this.canPlace(p, 'hq', cx, cz, { ignore: u, adjacency: false })) { if (p === this.human) { play('deny'); say('Hier nicht möglich', 3); } return false; }
    this.removeUnit(u);
    this.placeBuilding('hq', u.owner, cx, cz);
    if (p === this.human) say('Basis wird errichtet');
    return true;
  }
  sell(b) {
    if (b.selling || b.dead) return;
    const p = this.players[b.owner];
    p.credits += b.def.cost * 0.5 * (b.hp / b.maxHp);
    b.selling = 1;
    play('cash', b.x, b.z);
    if (p === this.human) say('Gebäude verkauft', 2);
  }

  // ================================================================= Befehle der Spieler (Lockstep)
  /** Führt einen Spielerbefehl aus. Allein sofort, im Mehrspieler auf allen Rechnern im selben Takt (net.js).
   *  Befehle tragen nur ids/Zellen/Koordinaten; alles wird hier gegen den Besitzer pid geprüft. */
  exec(pid, c) {
    const p = this.players[pid];
    if (!p || !p.alive || !c || typeof c.op !== 'string') return false;
    const own = (id) => { const o = this.byId.get(id); return o && o.owner === pid && !o.dead && o.dying === undefined ? o : null; };
    const units = () => (Array.isArray(c.ids) ? c.ids.slice(0, 400) : []).map(own).filter((o) => o && o.kind === 'unit');
    const num = (v) => (Number.isFinite(v) ? v : 0);
    const T = (t) => (UNITS[t] || BUILDINGS[t] ? t : null);
    switch (c.op) {
      case 'move': { const u = units(); if (u.length) this.cmdMove(u, num(c.x), num(c.z), !!c.am); return true; }
      case 'attack': {
        const t = this.byId.get(c.t), u = units();
        if (!t || t.dead || this.allied(t.owner, pid) || !u.length) return false;
        this.cmdAttack(u, t); return true;
      }
      case 'stop': this.cmdStop(units()); return true;
      case 'harvest': { const u = units(); if (u.length) this.cmdHarvest(u, num(c.x), num(c.z)); return true; }
      case 'dock': { for (const u of units()) if (u.def.cargo) { u.hState = 'toDock'; u.order = null; u.path = []; } return true; }
      case 'deploy': { const u = own(c.id); return u ? this.cmdDeploy(u) : false; }
      case 'queue': { const t = T(c.type); if (!t) return false; let ok = false; for (let i = 0; i < clamp(c.n | 0, 1, 5); i++) ok = this.queueItem(p, t) || ok; return ok; }
      case 'cancel': { const t = T(c.type); if (t) this.cancelItem(p, t); return true; }
      case 'hold': { const q = p.queues[c.key]; if (q && q.type) q.paused = !q.paused; return true; }
      case 'place': { const t = T(c.type); return t && BUILDINGS[t] ? this.placeReady(p, t, c.cx | 0, c.cz | 0) : false; }
      case 'wall': return this.placeWall(p, c.cx | 0, c.cz | 0, c.rot ? 1 : 0);
      case 'sell': { const b = own(c.id); if (b && b.kind === 'building') this.sell(b); return true; }
      case 'repair': { const b = own(c.id); if (b && b.kind === 'building' && (b.hp < b.maxHp || b.repairing)) b.repairing = !b.repairing; return true; }
      case 'rally': { const b = own(c.id); if (b && b.kind === 'building') b.rally = { x: num(c.x), z: num(c.z) }; return true; }
      case 'nuke': { const s = this.readySilo(p); return s ? this.launchNuke(s, num(c.x), num(c.z)) : false; }
    }
    return false;
  }

  /** Prüfsumme des Spielzustands (Mehrspieler: alle Rechner müssen gleich rechnen – sonst Meldung „asynchron“) */
  checksum() {
    let h = 2166136261 >>> 0;
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0; };
    for (const u of this.units) { mix(u.id); mix(Math.round(u.x * 64)); mix(Math.round(u.z * 64)); mix(Math.round(u.hp * 16)); }
    for (const b of this.buildings) { mix(b.id); mix(Math.round(b.hp * 16)); }
    for (const p of this.players) mix(Math.round(p.credits));
    mix(this.projectiles.length);
    return h;
  }

  canHit(u, t) {
    const w = WEAPONS[u.def.weapon || u.def.weaponB];
    if (!w || t.dead) return false;
    const armor = t.kind === 'building' ? 'building' : t.def.armor;
    if (armor === 'air' && !w.aa) return false;
    return (w.vs[armor] || 0) > 0;
  }

  // ================================================================= Simulation
  update(dt) {
    if (this.over && !this.net) dt *= 0.3;   // Zeitlupe nach dem Ende nur allein (Mehrspieler: alle Rechner müssen gleich weiterrechnen)
    this.time += dt;
    this.rebuildHash();
    for (const p of this.players) if (p.alive) this.tickProduction(p, dt);
    for (const u of this.units) if (!u.dead) this.updateUnit(u, dt);
    this.separate(dt);
    for (const b of this.buildings) if (!b.dead) this.updateBuilding(b, dt);
    this.updateProjectiles(dt);
    this.updateRadiation(dt);
    if (this.timers.length) {
      const due = this.timers.filter((t) => t.at <= this.time);
      if (due.length) { this.timers = this.timers.filter((t) => t.at > this.time); for (const t of due) t.fn(); }
    }
    let aw = 0;
    for (let i = 0; i < this.anims.length; i++) { const a = this.anims[i]; if (a(dt) !== false) this.anims[aw++] = a; }
    this.anims.length = aw;
    for (const m of BLINK) m.emissiveIntensity = (this.time * 0.9) % 1 < 0.18 ? 9 : 0.6;   // rote Warnleuchten blitzen
    // tote Einheiten entfernen (Animation in dying)
    this.units = this.units.filter((u) => !u.removed);
    this.buildings = this.buildings.filter((b) => !b.removed);
    this.fogTimer -= dt;
    if (this.fogTimer <= 0) { this.fogTimer = 0.2; this.updateFogOfWar(); }
    this.oreTimer -= dt;
    if (this.oreTimer <= 0) { this.oreTimer = 1; this.terrain.regrowOre(1); this.terrain.updateOreVisuals(); }
    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 1; this.checkEnd(); for (const p of this.players) this.updatePower(p);
      for (const u of this.units) { // Hubschrauber, deren Flugfeld verloren ging: neues Feld mit freiem Platz suchen
        if (u.dead || !u.def.air || u.def.jet) continue;
        const b = u.pad ? this.byId.get(u.pad) : null;
        if (b && !b.dead) continue;
        const nb = this.freePad(this.players[u.owner], false, u);
        u.pad = nb ? nb.id : 0;
      }
    }
    for (const u of this.units) this.placeUnitObj(u, dt);
  }

  /** Sicht je Team (Simulation, für Teams mit Menschen) und daraus der Kriegsnebel dieses Rechners (Team des lokalen Spielers) */
  updateFogOfWar() {
    const src = new Map();
    for (const u of this.units) if (!u.dead) { const a = this.players[u.owner].ally; if (!src.has(a)) src.set(a, []); src.get(a).push({ x: u.x, z: u.z, r: u.def.sight }); }
    for (const b of this.buildings) if (!b.dead) { const a = this.players[b.owner].ally; if (!src.has(a)) src.set(a, []); src.get(a).push({ x: b.x, z: b.z, r: b.def.sight }); }
    const myAlly = this.human.ally;
    for (const p of this.players) {
      if (!p === this.human && p.ally !== myAlly) continue;
      if (this.allyVis.has(p.ally) && this.allyVis.get(p.ally).stamp === this.time) continue;
      const g = this.allyVis.get(p.ally) || new Uint8Array(MAPN * MAPN);
      visGrid(src.get(p.ally) || [], g);
      g.stamp = this.time;
      this.allyVis.set(p.ally, g);
    }
    updateFog(null, this.allyVis.get(myAlly));
    for (const u of this.units) u.vis = this.friendly(u) || isVisible(u.x, u.z);
    for (const b of this.buildings) { if (!b.seen && isVisible(b.x, b.z)) b.seen = true; b.obj.visible = this.friendly(b) || b.seen || !FOG.enabled; }
  }

  // ----------------------------------------------------------------- Einheiten
  updateUnit(u, dt) {
    const def = u.def;
    if (u.dying !== undefined) return;
    u.cooldown -= dt;
    if (u.rank === 2 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01 * dt);
    if (def.inf) u.nodes.mixer.update(dt);
    if (def.cargo && u.hState !== 'manual' && !u.order) { this.updateHarvester(u, dt); this.followPath(u, dt); return; }
    if (def.jet) { this.updateJet(u, dt); return; }

    // nach dem Platzmachen zurück auf den alten Standplatz, sobald dort frei ist
    if (u.home) {
      if (u.order || u.target) u.home = null;
      else if (!u.path.length && this.time > (u.yieldT || 0) + 2.5) {
        let free = true;
        for (const v of this.unitsNear(u.home.x, u.home.z, def.radius + 6, _nearB)) if (v !== u && !v.def.air && dist(v.x, v.z, u.home.x, u.home.z) < (def.radius + v.def.radius) * 1.3) { free = false; break; }
        if (free) { const h = u.home; u.home = null; u.guard = { x: h.x, z: h.z }; this.pathTo(u, h.x, h.z); }
        else u.yieldT = this.time;   // später noch einmal prüfen
      }
    }
    // Zielwahl / Auftrag
    const o = u.order;
    if (o && o.type === 'attack') {
      const t = this.byId.get(o.target);
      if (!t || t.dead) { u.order = null; u.target = null; u.guard = { x: u.x, z: u.z }; }
      else u.target = t;
    } else if (def.weapon) {
      u.acquireT -= dt;
      if (u.target && (u.target.dead || (u.target.owner === 0 && false))) u.target = null;
      if (u.acquireT <= 0) {
        u.acquireT = 0.4 + rand() * 0.2;
        const moving = o && o.type === 'move';
        if (!moving) {
          const r = o && o.type === 'attackMove' ? def.sight : (u.target ? def.range : def.sight);
          const lock = def.air && u.target && u.target.kind === 'building' && !u.target.dead && !u.target.selling;   // Luftangriff auf ein Gebäude läuft bis zur Zerstörung
          if (!lock && (!u.target || this.edgeDist(u.x, u.z, u.target) > def.range * 1.1)) u.target = this.findTarget(u, r);
        } else u.target = null;
      }
      // Leine im Wachmodus
      if (!o && u.target && !(def.air && u.target.kind === 'building') && dist(u.x, u.z, u.guard.x, u.guard.z) > def.sight * 1.6) { u.target = null; this.pathTo(u, u.guard.x, u.guard.z); }
    }

    const t = u.target;
    let firing = false;
    if (t && !t.dead) {
      const d = this.edgeDist(u.x, u.z, t);
      const inRange = d <= def.range && (!def.minRange || d >= def.minRange);
      if (inRange) {
        u.path = []; firing = true;
      } else if (d < (def.minRange || 0)) {
        // zu nah (Artillerie): zurücksetzen
        const a = Math.atan2(u.z - t.z, u.x - t.x);
        if (!u.path.length) this.pathTo(u, u.x + Math.cos(a) * 20, u.z + Math.sin(a) * 20);
      } else {
        u.repath -= dt;
        if (u.repath <= 0 || !u.path.length) {
          u.repath = 1.5 + rand();
          if (def.air) u.path = [{ x: t.x, z: t.z }];
          else this.pathTo(u, t.x, t.z);
        }
      }
      this.aim(u, t, dt, firing);
    } else {
      this.aimRest(u, dt);
    }
    if (o && (o.type === 'move' || o.type === 'attackMove') && !u.path.length && !firing) {
      u.order = null; u.guard = { x: u.x, z: u.z };
    }
    if (!firing || def.air) this.followPath(u, dt);
    else u.speed = Math.max(0, u.speed - 14 * dt);

    this.tickSalvo(u, dt);
    // Animationen
    if (def.inf) {
      const want = u.speed > 0.5 ? 'run' : 'idle';
      if (want !== u.anim) { u.nodes.actions[u.anim].fadeOut(0.2); u.nodes.actions[want].reset().fadeIn(0.2).play(); u.anim = want; }
      // Waffenhaltung: getragen bzw. im Anschlag, sobald gefeuert wird (Arme greifen per IK an die Waffe)
      if (u.nodes.pose) { u.aimK = (u.aimK || 0) + ((firing ? 1 : 0) - (u.aimK || 0)) * Math.min(1, dt * 9); u.nodes.pose(u.aimK); }
    }
    if (u.nodes.rotor) u.nodes.rotor.rotation.y += dt * 28;
    if (u.nodes.dish) u.nodes.dish.rotation.y += dt * 3.2;
    if (u.nodes.tailRotor) u.nodes.tailRotor.rotation.z += dt * 40;
    if (def.air) {
      const targetAlt = def.alt || AIR_ALT;
      u.alt += (targetAlt - u.alt) * Math.min(1, dt * 0.8);
    }
    // Schadensbild: angeschlagene Fahrzeuge qualmen, schwer beschädigte brennen
    if (!def.inf && u.vis && u.hp < u.maxHp * 0.5) {
      const bad = u.hp < u.maxHp * 0.25;
      if (Math.random() < dt * (bad ? 6 : 2.5)) this.fx.smokePuff(u.x + (Math.random() - 0.5), u.y + 1.6, u.z + (Math.random() - 0.5), true, bad ? 0.7 : 0.45);
      if (bad && Math.random() < dt * 5) this.fx.flame(u.x + (Math.random() - 0.5) * 1.2, u.y + 1.5, u.z + (Math.random() - 0.5) * 1.2, 0.7);
    }
    if (!def.inf && !def.air) {
      this.layTracks(u);
      if (u.vis) {
        const ch = Math.cos(u.heading), sh = Math.sin(u.heading);
        // Fahrstaub: wächst mit dem Tempo, abwechselnd hinter linker und rechter Kette
        if (u.speed > 2 && Math.random() < dt * (1.5 + u.speed * 0.7)) {
          const sd = (u.dustS = -(u.dustS || 1)) * def.radius * 0.55;
          this.fx.dust(u.x - ch * def.radius - sh * sd, u.y, u.z - sh * def.radius + ch * sd, 0.6 + u.speed * 0.04);
        }
        // Abgasstoß beim Anfahren
        if (u.acc > 2.5 && Math.random() < dt * 14) this.fx.exhaust(u.x - ch * def.radius * 0.8, u.y + 1.5, u.z - sh * def.radius * 0.8, def.radius / 2.6);
      }
    } else if (def.air && !def.jet && u.vis && Math.random() < dt * 6) {
      const gy = this.terrain.heightAt(u.x, u.z);
      if (gy > -0.8 && u.y - gy < 20) this.fx.rotorWash(u.x, gy, u.z, 4);   // Rotorabwind wirbelt Staub auf (nicht über Wasser)
    }
  }

  /** Fahrspur fortschreiben: je Seite ein Band vom letzten Punkt zum Heck, enger gesetzt in Kurven */
  layTracks(u) {
    const def = u.def;
    if (u.speed < 0.6 || !u.vis) { u.trk = null; return; }
    const T = this.terrain, ch = Math.cos(u.heading), sh = Math.sin(u.heading);
    const rx = u.x - ch * def.radius * 0.45, rz = u.z - sh * def.radius * 0.45;
    const k = u.trk;
    if (!k) { u.trk = { x: rx, z: rz, px: -sh, pz: ch, h: u.heading, u: Math.random() * 8 }; return; }
    const d = Math.hypot(rx - k.x, rz - k.z), dh = Math.abs(angDiff(k.h, u.heading));
    if (d < 0.3 || (d < 1.2 && dh < 0.16)) return;
    if (d < 6) {
      const tracked = u.nodes.treads.length === 2;
      const gauge = def.radius * (tracked ? 0.6 : 0.52), hw = def.radius * (tracked ? 0.2 : 0.12);
      const u1 = k.u + d / (tracked ? 1.4 : 1.0);
      const str = Math.min(0.55, 0.38 + dh / Math.max(d, 0.4) * 0.5);   // in Kurven gräbt sich die Kette tiefer ein
      for (let sg = -1; sg <= 1; sg += 2) {
        const ax = k.x + k.px * gauge * sg, az = k.z + k.pz * gauge * sg, bx = rx - sh * gauge * sg, bz = rz + ch * gauge * sg;
        this.fx.trackQuad(ax, T.heightAt(ax, az) + 0.07, az, k.px, k.pz, bx, T.heightAt(bx, bz) + 0.07, bz, -sh, ch, hw, k.u, u1, !tracked, str);
      }
      k.u = u1;
    }
    k.x = rx; k.z = rz; k.px = -sh; k.pz = ch; k.h = u.heading;
  }

  tickSalvo(u, dt) {
    if (u.salvo > 0) {
      u.salvoT -= dt;
      if (u.salvoT <= 0 && u.salvoTarget && !u.salvoTarget.dead) { u.salvo--; u.salvoT = 0.18; this.launch(u, u.salvoTarget); }
      else if (!u.salvoTarget || u.salvoTarget.dead) u.salvo = 0;
    }
  }

  /** Stellplatz eines Flugfelds: Mitte der Startbahn, Startrichtung Norden */
  padPos(b, slot = 0) { return { x: b.x + 4.7, z: b.z + 10.5 - slot * 10.5, y: b.y + 0.3 }; }   // drei Plätze hintereinander auf der Bahn, Nase nach Norden
  /** Zahl der lebenden Jagdbomber (jet = true) bzw. Hubschrauber eines Flugfelds */
  padLoad(b, jet, skip = null) {
    let n = 0;
    for (const u of this.units) if (u.pad === b.id && !u.dead && u !== skip && !!u.def.jet === jet) n++;
    return n;
  }
  /** erster freier Stellplatz (0..2) eines Flugfelds */
  freeSlot(b, skip = null) {
    const used = new Set();
    for (const u of this.units) if (u.pad === b.id && !u.dead && u !== skip && u.def.jet) used.add(u.slot || 0);
    for (let i = 0; i < AIRFIELD_SLOTS; i++) if (!used.has(i)) return i;
    return 0;
  }
  /** Flottengröße eines Spielers für Jagdbomber bzw. Hubschrauber: belegt, in Auftrag, Kapazität */
  airCapacity(p, type) {
    const jet = !!UNITS[type].jet;
    let used = 0;
    for (const u of this.units) if (u.owner === p.id && !u.dead && u.def.air && !!u.def.jet === jet) used++;
    const queued = p.queues.air.list.filter((t) => !!UNITS[t].jet === jet).length;
    const cap = this.buildings.filter((b) => b.owner === p.id && b.type === 'helipad' && !b.dead && b.rise >= 1 && !b.selling).length * AIRFIELD_SLOTS;
    return { used, queued, cap };
  }
  /** Nächstes eigenes Flugfeld ohne Jagdbomber (ein für u reserviertes zählt als frei) */
  freePad(p, jet = true, u = null) {
    let best = null, bd = 1e18;
    for (const b of this.buildings) {
      if (b.owner !== p.id || b.type !== 'helipad' || b.dead || b.rise < 1 || b.selling) continue;
      const load = this.padLoad(b, jet, u);
      if (load >= AIRFIELD_SLOTS) continue;
      const d = u ? dist2(u.x, u.z, b.x, b.z) : load;       // neue Maschinen: das am wenigsten belegte Feld
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  /** Jagdbomber: parkt auf seinem Flugfeld, startet auf Befehl, greift im Überflug an und landet danach wieder.
   *  Zustände (u.jetState): parked -> takeoff -> air -> return -> landing -> parked */
  updateJet(u, dt) {
    const def = u.def, o = u.order, ALT = def.alt || AIR_ALT;
    let pad = u.pad ? this.byId.get(u.pad) : null;
    if (pad && (pad.dead || pad.selling)) { pad = null; u.pad = 0; }
    let st = u.jetState || 'air';
    if (u.nodes.gear) u.nodes.gear.visible = u.alt < 9;
    const fly = (want, speed, rate = 1) => {
      u.heading = turnTo(u.heading, want, def.turn * rate * dt);
      u.turnRate = angDiff(u.heading, want);
      u.speed += (speed - u.speed) * Math.min(1, dt * 1.5);
      u.x = clamp(u.x + Math.cos(u.heading) * u.speed * dt, -40, WORLD + 40);
      u.z = clamp(u.z + Math.sin(u.heading) * u.speed * dt, -40, WORLD + 40);
    };
    const burner = () => {
      if (u.vis) for (const e of u.nodes.fx) if (e.kind === 'afterburner' && Math.random() < 0.8) {
        const v = new THREE.Vector3(); e.obj.getWorldPosition(v);
        this.fx.fire.emit({ x: v.x, y: v.y, z: v.z, life: 0.12, s0: 1.4, s1: 0.4, c0: [1, 0.7, 0.35], c1: [0.6, 0.3, 1], a0: 0.9, a1: 0 });
        if (Math.random() < 0.35) this.fx.smoke.emit({ x: v.x, y: v.y, z: v.z, life: 1.1, s0: 0.5, s1: 2.2, ease: 2, fin: 0.2, c0: [0.75, 0.75, 0.75], a0: 0.16, a1: 0, drag: 1 });
      }
    };

    if (st === 'parked') {
      if (!pad) st = 'takeoff';                      // Flugfeld verloren: Alarmstart
      else {
        const pp = this.padPos(pad, u.slot);
        u.x = pp.x; u.z = pp.z; u.heading = -Math.PI / 2; u.speed = 0; u.alt = 0; u.turnRate = 0; u.target = null; u.salvo = 0;
        if (o) { st = 'takeoff'; if (u.vis) play('rocket', u.x, u.z); }
      }
      u.jetState = st;
      if (st === 'parked') return;
    }
    if (st === 'takeoff') {                          // Startlauf geradeaus, dann Steigflug
      u.turnRate = 0;
      u.speed = Math.min(def.speed, u.speed + def.speed * 0.6 * dt);
      if (u.speed > def.speed * 0.3) u.alt = Math.min(ALT, u.alt + (5 + u.alt * 1.2) * dt);
      else if (u.vis && Math.random() < dt * 14) this.fx.dust(u.x - Math.cos(u.heading) * 6, u.y, u.z - Math.sin(u.heading) * 6, 1.4);
      u.x = clamp(u.x + Math.cos(u.heading) * u.speed * dt, -40, WORLD + 40);
      u.z = clamp(u.z + Math.sin(u.heading) * u.speed * dt, -40, WORLD + 40);
      if (u.alt > ALT * 0.75) st = 'air';
      u.jetState = st; burner();
      return;
    }
    if (st === 'return' || st === 'landing') {
      if (o || !pad) st = 'air';                     // neuer Befehl oder Flugfeld weg: durchstarten
      else {
        const pp = this.padPos(pad, u.slot);
        if (st === 'return') {                       // Anflugpunkt südlich der Bahn ansteuern
          const ax = pp.x, az = pp.z + 80, d = Math.hypot(ax - u.x, az - u.z);
          fly(Math.atan2(az - u.z, ax - u.x), def.speed * (d < 60 ? 0.7 : 1));
          u.alt += ((d < 90 ? 14 : ALT) - u.alt) * Math.min(1, dt * 0.8);
          if (d < 16) st = 'landing';
        } else {                                     // Endanflug nach Norden, sinken, ausrollen
          const dx = pp.x - u.x, dz = pp.z - u.z, d = Math.hypot(dx, dz);
          fly(Math.atan2(dz, dx), clamp(d * 0.55 + 5, 5, def.speed * 0.6), 2.2);
          u.alt += ((d > 6 ? Math.max(3.2, clamp((d - 8) / 70, 0, 1) * 14) : 0) - u.alt) * Math.min(1, dt * (d > 6 ? 3 : 6));
          if (u.alt < 1.5 && u.vis && Math.random() < dt * 10) this.fx.dust(u.x, u.y, u.z, 1.2);
          if (u.alt < 0.4 && !u.touched) { u.touched = true; if (u.vis) for (let i = 0; i < 5; i++) this.fx.smoke.emit({ x: u.x, y: u.y + 0.2, z: u.z, vx: Math.cos(u.heading) * 3, vz: Math.sin(u.heading) * 3, vy: 0.6, life: 1 + Math.random() * 0.5, s0: 0.6, s1: 2.6, ease: 2, c0: [0.8, 0.8, 0.78], a0: 0.35, a1: 0, drag: 1.5, wind: 1 }); }   // Reifenqualm beim Aufsetzen
          if (u.alt > 3) u.touched = false;
          if (d < 2.5 || (dz > -1 && Math.abs(dx) < 5)) st = 'parked';
          else if (dz > 8) st = 'return';            // vorbeigeflogen: neuer Anflug
        }
        u.target = null;
        u.jetState = st; burner();
        return;
      }
    }
    // ---- im Einsatz
    let t = null;
    if (o && o.type === 'attack') { t = this.byId.get(o.target); if (!t || t.dead) { u.order = null; t = null; u.guard = { x: u.x, z: u.z }; } }
    else {
      u.acquireT -= dt;
      if (u.target && u.target.dead) u.target = null;
      const lock = u.target && u.target.kind === 'building' && !u.target.dead && !u.target.selling;   // Gebäudeangriff wird zu Ende geflogen
      if (u.acquireT <= 0) { u.acquireT = 0.5; if (o && o.type === 'move') u.target = null; else if (!lock) u.target = this.findTarget(u, def.sight); }
      t = u.target;
    }
    // ohne Auftrag und ohne Ziel: zurück zum Flugfeld
    if (!u.order && !t) {
      u.idleT = (u.idleT || 0) + dt;
      if (u.idleT > 1) {
        if (!pad) { pad = this.freePad(this.players[u.owner], true, u); if (pad) { u.slot = this.freeSlot(pad, u); u.pad = pad.id; } }
        if (pad) { st = 'return'; u.idleT = 0; } else u.idleT = -4;   // kein Flugfeld frei: weiter kreisen
      }
    } else u.idleT = 0;
    let gx, gz, orbit = false;
    if (t) { gx = t.x; gz = t.z; }
    else if (u.path.length) { gx = u.path[0].x; gz = u.path[0].z; }
    else { gx = u.guard.x; gz = u.guard.z; orbit = true; }
    const dx = gx - u.x, dz = gz - u.z, d = Math.hypot(dx, dz);
    let want = Math.atan2(dz, dx);
    if (orbit) want += clamp((34 - d) / 34, 0, 1) * Math.PI / 2;
    if (t && d < 14) want = u.heading; // durchziehen
    fly(want, def.speed);
    if (!t && u.path.length && d < 10) u.path.shift();
    if (o && (o.type === 'move' || o.type === 'attackMove') && !u.path.length) { u.order = null; u.guard = { x: u.x, z: u.z }; }
    if (t && u.cooldown <= 0 && u.salvo <= 0 && this.edgeDist(u.x, u.z, t) <= def.range && Math.abs(angDiff(u.heading, Math.atan2(t.z - u.z, t.x - u.x))) < 0.4) this.fire(u, t);
    this.tickSalvo(u, dt);
    u.alt += (ALT - u.alt) * Math.min(1, dt * 0.8);
    u.jetState = st; burner();
  }

  findTarget(u, r) {
    let best = null, bd = 1e9;
    for (const e of this.unitsNear(u.x, u.z, r + 4)) {
      if (this.allied(e.owner, u.owner) || e.dead || e.dying !== undefined || !this.canHit(u, e)) continue;
      if (this.players[u.owner].human && !this.seenBy(u.owner, e.x, e.z)) continue;   // Menschen: nur Gesehenes (Sicht des Teams, deterministisch)
      const d = dist2(u.x, u.z, e.x, e.z) - (e.def.weapon ? 400 : 0);
      if (d < bd) { bd = d; best = e; }
    }
    if (best) return best;
    for (const b of this.buildings) {
      if (this.allied(b.owner, u.owner) || b.dead || b.selling) continue;
      if (!this.canHit(u, b)) continue;
      const d = this.edgeDist(u.x, u.z, b) * (b.def.wall ? 2.5 : 1);
      if (d <= r * (b.def.wall ? 2.5 : 1) && d * d < bd) { bd = d * d; best = b; }
    }
    return best;
  }

  aim(u, t, dt, firing) {
    const def = u.def;
    const want = Math.atan2(t.z - u.z, t.x - u.x);
    let aligned;
    if (u.nodes.turret) {
      const rel = angDiff(u.heading, want);
      u.turretYaw = turnTo(u.turretYaw, rel, (def.turretTurn || 3) * dt);
      aligned = Math.abs(angDiff(u.turretYaw, rel)) < 0.08;
      if (def.weapon === 'mlrs') u.gunPitch += ((firing ? 0.75 : 0) - u.gunPitch) * Math.min(1, dt * 2);
    } else {
      if (firing) u.heading = turnTo(u.heading, want, (def.inf ? 8 : def.turn || 2) * dt);
      aligned = Math.abs(angDiff(u.heading, want)) < 0.12;
    }
    if (def.weapon === 'mlrs') aligned = aligned && u.gunPitch > 0.6;
    if (def.pitchAir) u.gunPitch += ((t.def && t.def.air ? def.pitchAir : 0) - u.gunPitch) * Math.min(1, dt * 5);
    if (firing && aligned && u.cooldown <= 0 && u.salvo <= 0) this.fire(u, t);
  }
  aimRest(u, dt) {
    if (u.nodes.turret) u.turretYaw = turnTo(u.turretYaw, 0, (u.def.turretTurn || 2) * 0.5 * dt);
    u.gunPitch += (0 - u.gunPitch) * Math.min(1, dt * 2);
  }

  // ----------------------------------------------------------------- Bewegung
  followPath(u, dt) {
    const def = u.def;
    if (!def.speed) return;
    if (!u.path.length) { u.speed = Math.max(0, u.speed - 16 * dt); if (def.air) this.hover(u, dt); return; }
    const wp = u.path[0];
    const dx = wp.x - u.x, dz = wp.z - u.z, d = Math.hypot(dx, dz);
    const last = u.path.length === 1;
    if (d < (last ? 0.7 : CELL * 0.7)) { u.path.shift(); return; }
    // Ausweichen: um Einheiten herumlenken, hinter Vorausfahrenden bremsen statt auffahren
    let steer = 0, slow = 1;
    if (!def.air) {
      const av = this.avoid(u, Math.atan2(dz, dx), last ? d : 1e9);
      u.av = (u.av || 0) + (av.steer - (u.av || 0)) * Math.min(1, dt * 7);
      steer = u.av; slow = av.slow;
      if (av.wait) { u.waitT = (u.waitT || 0) + dt; if (u.waitT < 4) { u.progT = 0; u.lastD = d; } } else u.waitT = 0;
    }
    // Fortschrittskontrolle
    u.progT = (u.progT || 0) + dt;
    if (u.progT > 1.2) {
      if (u.lastD - d < 0.6) {
        u.stuck++;
        if (last && d < 7) { u.path = []; u.stuck = 0; return; }
        if (u.stuck > 3) { u.path = []; u.stuck = 0; return; }
        if (!def.air) { const g = u.path[u.path.length - 1], st = u.stuck; this.pathTo(u, g.x, g.z); u.stuck = st; u.lastD = d; return; }   // Zähler behalten: sonst ewiges Neuplanen
      } else u.stuck = 0;
      u.lastD = d; u.progT = 0;
    }
    const want = Math.atan2(dz, dx) + steer;
    const turn = def.inf ? 10 : def.turn;
    u.heading = turnTo(u.heading, want, turn * dt);
    const al = Math.cos(angDiff(u.heading, want));
    let ts = def.speed * slow * (def.inf || def.air ? 1 : Math.max(0, (al - 0.2) / 0.8) ** 1.5);
    if (last) ts = Math.min(ts, d * 1.4 + 1.5);
    // Steigung bremst
    if (!def.air && !def.inf) {
      const h0 = this.terrain.heightAt(u.x, u.z), h1 = this.terrain.heightAt(u.x + Math.cos(u.heading) * 2, u.z + Math.sin(u.heading) * 2);
      ts *= clamp(1 - (h1 - h0) * 0.25, 0.55, 1.15);
    }
    const acc = def.inf ? 30 : def.air ? 10 : 7;
    u.speed += clamp(ts - u.speed, -acc * 2 * dt, acc * dt);
    const nx = u.x + Math.cos(u.heading) * u.speed * dt, nz = u.z + Math.sin(u.heading) * u.speed * dt;
    if (def.air || this.walkable(u, nx, nz)) { u.x = nx; u.z = nz; }
    else { u.speed *= 0.3; if (this.walkable(u, nx, u.z)) u.x = nx; else if (this.walkable(u, u.x, nz)) u.z = nz; }
    u.x = clamp(u.x, 1, WORLD - 1); u.z = clamp(u.z, 1, WORLD - 1);
  }
  /** Vorausschau: liefert Lenkkorrektur (steer), Bremsfaktor (slow) und ob die Einheit nur wartet (wait).
   *  Stehende eigene Einheiten im Weg werden gebeten, Platz zu machen (makeWay). */
  avoid(u, want, goalD = 1e9) {
    const def = u.def;
    const fx = Math.cos(want), fz = Math.sin(want);
    const au = segA(def);
    const look = def.radius * 1.6 + u.speed * 0.9 + (def.inf ? 1 : 3);
    let steer = 0, slow = 1, wait = false;
    for (const v of this.unitsNear(u.x, u.z, look + au + MAX_REACH + 2, _nearA)) {
      if (v === u || v.dying !== undefined || v.def.air) continue;
      if (def.inf && v.def.inf) continue;             // Infanterie untereinander: weiche Trennung genügt
      const rx = v.x - u.x, rz = v.z - u.z;
      const ahead = rx * fx + rz * fz;
      if (ahead <= 0 || ahead > goalD + 1) continue;   // hinter dem eigenen Ziel: egal
      // Ausdehnung beider Kapseln quer und längs zur Fahrtrichtung (lange Fahrzeuge: Bug an Heck mit Luft)
      const av = segA(v.def), hx = Math.cos(v.heading), hz = Math.sin(v.heading);
      const k = def.inf || v.def.inf ? 0.75 : 1.0;
      const rr = (def.radius + v.def.radius + av * Math.abs(hz * fx - hx * fz)) * k;
      const rl = (def.radius + v.def.radius + au + av * Math.abs(hx * fx + hz * fz)) * k + (def.inf || v.def.inf ? 0 : SEP_GAP);
      const side = rz * fx - rx * fz;                  // > 0: v liegt auf der Seite steigender Winkel
      if (Math.abs(side) >= rr) continue;
      const moving = v.speed > 1;
      // stehende eigene Einheiten früh bitten, Platz zu machen
      // (nicht, wenn u selbst nur ausweicht – sonst schicken sich zwei Einheiten gegenseitig hin und her)
      if (!moving && !u.home && v.owner === u.owner && ahead < look * 1.8 + rl) this.makeWay(v, u, fx, fz, side);
      if (ahead > look + rl) continue;
      const gap = ahead - rl;
      if (moving && Math.cos(v.heading) * fx + Math.sin(v.heading) * fz > 0.6) {   // fährt in dieselbe Richtung: Abstand halten
        if (gap < 2) { slow = Math.min(slow, clamp(v.speed / def.speed + gap / 2 * 0.5, 0.25, 1)); wait = gap < 1; }
        continue;
      }
      const w = clamp(1 - gap / look, 0, 1) * (1 - Math.abs(side) / rr * 0.6);
      const dir = Math.abs(side) < rr * 0.25 ? -1 : (side > 0 ? -1 : 1);   // mittig voraus: beide weichen zur selben Hand aus
      steer += dir * w * 1.1;
      if (gap < 0.6) { slow = Math.min(slow, 0.5); wait = true; }
    }
    steer = clamp(steer, -0.8, 0.8);
    if (steer) { // nicht in unpassierbares Gelände ausweichen
      const T = this.terrain, L = look * 0.8;
      const free = (a) => T.isPassable(Math.floor((u.x + Math.cos(a) * L) / CELL), Math.floor((u.z + Math.sin(a) * L) / CELL));
      if (!free(want + steer)) steer = free(want - steer) ? -steer : 0;
    }
    return { steer, slow, wait };
  }

  /** Stehende Einheit v räumt den Weg für u: ein Schritt quer zur Fahrtrichtung von u. */
  makeWay(v, u, fx, fz, side, noHome = false) {
    if (!v.def.speed || v.def.cargo || v.order || v.path.length || v.target || (v.yieldT || 0) > this.time) return;
    v.yieldT = this.time + 1.0;
    const step = u.def.radius + v.def.radius + segA(v.def) * Math.abs(Math.sin(v.heading) * fx - Math.cos(v.heading) * fz) + 1.2;
    const s0 = side >= 0 ? 1 : -1;
    for (const sg of [s0, -s0]) {
      const x = v.x - fz * sg * step, z = v.z + fx * sg * step;
      if (x < 2 || z < 2 || x > WORLD - 2 || z > WORLD - 2) continue;
      if (!this.terrain.isPassable(Math.floor(x / CELL), Math.floor(z / CELL))) continue;
      let free = true;
      for (const o of this.unitsNear(x, z, v.def.radius + 4, _nearB)) {
        if (o === v || o === u || o.def.air || o.speed > 0.5) continue;
        if (dist(o.x, o.z, x, z) < o.def.radius + v.def.radius) { free = false; break; }
      }
      if (!free) continue;
      if (!v.home && !noHome) v.home = { x: v.x, z: v.z };     // alter Standplatz: dorthin geht es später zurück (nicht bei Fabrikausgang)
      v.path = [{ x, z }]; v.guard = { x, z }; v.stuck = 0; v.lastD = 1e9; v.progT = 0;
      return;
    }
  }

  hover(u, dt) { u.heading += Math.sin(this.time * 0.7 + u.id) * dt * 0.05; }
  walkable(u, x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    if (this.terrain.isPassable(cx, cz)) return true;
    // aus blockierter Zelle heraus darf man immer
    return !this.terrain.isPassable(Math.floor(u.x / CELL), Math.floor(u.z / CELL)) && (Math.floor(u.x / CELL) === cx && Math.floor(u.z / CELL) === cz || this.terrain.passable[cz * MAPN + cx] === 1);
  }

  /** Überlappungen auflösen (jeder Schritt, feste Reihenfolge: this.units, Partner aus dem Raster mit größerer id).
   *  Bodeneinheiten als Kapseln (Fahrzeuge mit SEP_GAP Luft, Infanterie untereinander enger), Korrektur beidseitig nach
   *  Gewicht (stehende Einheiten und schwere Fahrzeuge weichen weniger), nie in unpassierbare Zellen. */
  separate(dt) {
    const maxStep = 15 * dt;
    for (const u of this.units) {
      if (u.dead || u.dying !== undefined) continue;
      if (u.def.air) { this.separateAir(u, dt); continue; }
      const du = u.def, ru = reachOf(du);
      let segU = false;
      for (const v of this.unitsNear(u.x, u.z, ru + MAX_REACH + SEP_GAP, _nearC)) {
        if (v.id <= u.id || v.dying !== undefined || v.def.air) continue;
        const dv = v.def;
        const need = du.inf && dv.inf ? (du.radius + dv.radius) * 0.85 : du.radius + dv.radius + (du.inf || dv.inf ? 0 : SEP_GAP);
        const far = need + ru - du.radius + reachOf(dv) - dv.radius;      // Mittelpunkte weiter auseinander: sicher frei
        if (dist2(u.x, u.z, v.x, v.z) >= far * far) continue;
        if (!segU) { bodySeg(u, _sA); segU = true; }
        const c = closestSeg(_sA, bodySeg(v, _sB), _cp);
        let nx = c[2] - c[0], nz = c[3] - c[1], d = Math.hypot(nx, nz);
        const pen = need - d;
        if (pen <= SEP_SLOP) continue;
        if (d < 1e-3) { // Körperachsen kreuzen sich: von Mitte zu Mitte trennen
          nx = v.x - u.x; nz = v.z - u.z; d = Math.hypot(nx, nz);
          if (d < 1e-3) { nx = rand() - 0.5; nz = rand() - 0.5; d = Math.hypot(nx, nz); }
        }
        nx /= d; nz /= d;
        this.arriveNear(u, v); this.arriveNear(v, u);
        const hu = heft(u), hv = heft(v);
        const k = Math.min(pen * 0.6, maxStep), ku = k * hv / (hu + hv), kv = k - ku;
        const mu = this.nudge(u, -nx * ku, -nz * ku), mv = this.nudge(v, nx * kv, nz * kv);
        if (!mu && mv) this.nudge(v, nx * ku, nz * ku);        // eine Seite steht an Wand/Wasser: die andere weicht ganz
        else if (mu && !mv) this.nudge(u, -nx * kv, -nz * kv);
        segU = false;
      }
    }
  }
  /** Einheit um (dx, dz) verschieben, wenn begehbar (sonst nur längs einer Achse); true = bewegt */
  nudge(u, dx, dz) {
    const x = clamp(u.x + dx, 1, WORLD - 1), z = clamp(u.z + dz, 1, WORLD - 1);
    if (this.walkable(u, x, z)) { u.x = x; u.z = z; return true; }
    if (Math.abs(dx) > 1e-4 && this.walkable(u, x, u.z)) { u.x = x; return true; }
    if (Math.abs(dz) > 1e-4 && this.walkable(u, u.x, z)) { u.z = z; return true; }
    return false;
  }
  /** Ankunft: steht am Zielpunkt von u schon die stehende Einheit v, hält u hier an statt zu drängeln */
  arriveNear(u, v) {
    const o = u.order;
    if (!o || (o.type !== 'move' && o.type !== 'attackMove') || u.path.length !== 1 || v.path.length || v.speed > 0.5) return;
    const g = u.path[0], rr = reachOf(u.def) + reachOf(v.def);
    if (dist(g.x, g.z, v.x, v.z) < rr && dist(g.x, g.z, u.x, u.z) < rr + 2) u.path = [];
  }
  separateAir(u, dt) {
    for (const v of this.unitsNear(u.x, u.z, u.def.radius + 4, _nearC)) {
      if (v.id <= u.id || v.dying !== undefined || !v.def.air) continue;
      const rr = (u.def.radius + v.def.radius) * 1.6;
      let dx = v.x - u.x, dz = v.z - u.z; let d = Math.hypot(dx, dz);
      if (d >= rr) continue;
      if (d < 0.01) { dx = rand() - 0.5; dz = rand() - 0.5; d = Math.hypot(dx, dz); }
      const push = Math.min((rr - d) * 0.5, 6 * dt);
      u.x -= dx / d * push; u.z -= dz / d * push; v.x += dx / d * push; v.z += dz / d * push;
    }
  }

  placeUnitObj(u, dt) {
    if (u.dying !== undefined) return;   // Wracks und Gefallene bewegt ihr eigener Ablauf
    const T = this.terrain, o = u.obj, def = u.def;
    let y = T.heightAt(u.x, u.z);
    if (def.air) y = Math.max(y, -1.2) + u.alt + Math.sin(this.time * 1.3 + u.id) * 0.25 * Math.min(1, u.alt / 6) + (def.jet && u.alt < 1 ? 0.3 : 0);
    u.y = y;
    o.position.set(u.x, y, u.z);
    // Beschleunigung und Drehrate (für Federung, Schräglage, Kettenlauf)
    const live = dt < 0.5, idt = 1 / Math.max(dt, 0.008);
    const dh = angDiff(u.prevHeading ?? u.heading, u.heading); u.prevHeading = u.heading;
    const acc = live ? (u.speed - (u.prevSpeed ?? u.speed)) * idt : 0; u.prevSpeed = u.speed;
    u.acc = (u.acc || 0) + (acc - (u.acc || 0)) * Math.min(1, dt * 10);
    const yawRate = live ? dh * idt : 0;
    _q.setFromAxisAngle(UP, -u.heading);
    if (!def.inf && !def.air) {
      T.normalAt(u.x, u.z, _n);
      _q2.setFromUnitVectors(UP, _n);
      _q.premultiply(_q2);
      if (u.rock > 0.01) { // Wanne wippt beim Schuss nach hinten
        _q2.setFromAxisAngle(_v.set(-Math.sin(u.rockA), 0, Math.cos(u.rockA)), u.rock * 0.07);
        _q.premultiply(_q2);
        u.rock *= Math.exp(-dt * 6);
      }
      o.quaternion.slerp(_q, Math.min(1, dt * 8));
      // Federung: Bug hebt sich beim Anfahren, taucht beim Bremsen ein; Wanne neigt sich in Kurven nach außen, schwingt nach
      const h = Math.min(dt, 0.05);
      const tp = clamp(u.acc * 0.011, -0.075, 0.06) + Math.sin(this.time * 11 + u.id * 1.7) * 0.0035 * Math.min(1, u.speed / 6);
      const tr = clamp(-yawRate * u.speed * 0.012, -0.07, 0.07);
      u.spV = (u.spV || 0) + ((tp - (u.sp || 0)) * 70 - (u.spV || 0) * 8) * h; u.sp = (u.sp || 0) + u.spV * h;
      u.srV = (u.srV || 0) + ((tr - (u.sr || 0)) * 70 - (u.srV || 0) * 8) * h; u.sr = (u.sr || 0) + u.srV * h;
      const r = u.nodes.root.rotation; r.z = u.sp; r.x = u.sr;
    } else if (def.air) {
      // Neigung in Flugrichtung, Schräglage in der Kurve
      u.bank = (u.bank || 0) + (clamp(yawRate * 0.45, -0.4, 0.4) - (u.bank || 0)) * Math.min(1, dt * 3);
      _q2.setFromAxisAngle(_v.set(0, 0, 1), def.jet ? 0 : -Math.min(0.25, u.speed * 0.015) - clamp(u.acc * 0.012, -0.1, 0.12));
      _q.multiply(_q2);
      _q2.setFromAxisAngle(_v.set(1, 0, 0), def.jet ? clamp((u.turnRate || 0) * 2, -0.7, 0.7) : u.bank); _q.multiply(_q2);
      o.quaternion.slerp(_q, Math.min(1, dt * 4));
    } else o.quaternion.copy(_q);
    if (u.nodes.turret) u.nodes.turret.rotation.y = -u.turretYaw;
    if (u.nodes.treads && u.nodes.treads.length === 2) {
      // Kettenlauf: Geschwindigkeit + Drehung (Außenkette schneller), 1.36 m Band je Texturkachel
      const hw = def.radius * 0.65, v = u.speed * dt;
      u.nodes.treads[0].offset.x += (v + dh * hw) / 1.36;
      u.nodes.treads[1].offset.x += (v - dh * hw) / 1.36;
    }
    if (u.nodes.wheels) {
      // Räder und Laufrollen rollen mit dem Tempo (Radius aus dem Modell), Vorderräder schlagen in Kurven ein
      const steer = clamp(yawRate * 0.35, -0.5, 0.5);
      for (const w of u.nodes.wheels) {
        w.rotation.z -= u.speed * dt / Math.max(0.2, w.userData.r || w.position.y);
        if (w.name.startsWith('WheelF')) w.rotation.y += (-steer - w.rotation.y) * Math.min(1, dt * 8);
      }
    }
    if (u.nodes.gun && (u.type === 'artillery' || def.pitchAir)) u.nodes.gun.rotation.z = u.gunPitch;
    this.applyRecoil(u, dt);
    o.visible = u.vis;
    if (u.ring) u.ring.visible = this.selection.has(u);
  }

  /** Rohrrücklauf: Rohr springt beim Schuss zurück und läuft langsam wieder vor */
  applyRecoil(s, dt) {
    const g = s.nodes.gun;
    if (!g || !(s.recoil > 0) && !g.userData.moved) return;
    if (!g.userData.base) {
      g.userData.base = g.position.clone();
      const m = s.nodes.muzzles[0];
      g.userData.dir = m && m.parent === g && m.position.lengthSq() > 0.01 ? m.position.clone().normalize() : new THREE.Vector3(1, 0, 0);
    }
    s.recoil = Math.max(0, (s.recoil || 0) - dt * 2.6);
    g.position.copy(g.userData.base).addScaledVector(g.userData.dir, -s.recoil * s.recoil * (s.recoilAmt || 0.5));
    g.userData.moved = s.recoil > 0;
  }

  // ----------------------------------------------------------------- Erzsammler
  updateHarvester(u, dt) {
    const T = this.terrain, p = this.players[u.owner];
    const def = u.def;
    if (u.nodes.load) { u.nodes.load.visible = u.cargo > 1; u.nodes.load.scale.y = 0.3 + 0.7 * u.cargo / def.cargo; }
    switch (u.hState) {
      case 'toOre': {
        if (u.path.length) return;
        const k = Math.floor(u.z / CELL) * MAPN + Math.floor(u.x / CELL);
        if (T.ore[k] > 5) { u.oreCell = k; u.hState = 'harvest'; return; }   // auch wenn ein Nachbar ihn vom Zielfeld geschoben hat
        const pref = u.prefOre || { x: u.x, z: u.z };
        const c = this.findOre(pref.x, pref.z, u);
        u.prefOre = null;
        if (c < 0) { if (u.cargo > 0) u.hState = 'toDock'; else u.hState = 'idle'; u.idleT = 3; return; }
        u.oreCell = c;
        this.pathTo(u, (c % MAPN + 0.5) * CELL, (Math.floor(c / MAPN) + 0.5) * CELL);
        if (!u.path.length) u.hState = 'harvest';
        return;
      }
      case 'harvest': {
        const k = Math.floor(u.z / CELL) * MAPN + Math.floor(u.x / CELL);
        if (T.ore[k] <= 5) {
          if (u.cargo >= def.cargo * 0.98) { u.hState = 'toDock'; return; }
          const c = this.findOre(u.x, u.z, u, 3);
          if (c < 0) { u.hState = u.cargo > def.cargo * 0.3 ? 'toDock' : 'toOre'; return; }
          u.oreCell = c; u.hState = 'toOre';
          this.pathTo(u, (c % MAPN + 0.5) * CELL, (Math.floor(c / MAPN) + 0.5) * CELL);
          return;
        }
        const amt = Math.min(70 * dt, T.ore[k], def.cargo - u.cargo);
        T.ore[k] -= amt; u.cargo += amt;
        if (u.nodes.drum) u.nodes.drum.rotation.z -= dt * 6;
        u.heading += Math.sin(this.time * 0.8 + u.id) * dt * 0.4;
        if (u.vis && Math.random() < dt * 8) this.fx.dust(u.x + Math.cos(u.heading) * 4.5, u.y, u.z + Math.sin(u.heading) * 4.5, 1.2);
        if (u.cargo >= def.cargo - 0.5) u.hState = 'toDock';
        return;
      }
      case 'toDock': {
        const r = this.nearestRefinery(u);
        if (!r) { u.hState = 'idle'; u.idleT = 3; return; }
        const dp = this.dockPos(r);
        const d = dist(u.x, u.z, dp.x, dp.z);
        if (d < 3.5) {
          if (r.dockUser && r.dockUser !== u.id && this.byId.get(r.dockUser) && !this.byId.get(r.dockUser).dead) { u.path = []; return; }
          r.dockUser = u.id; u.dock = r.id; u.hState = 'unload'; u.path = []; return;
        }
        if (!u.path.length) {
          if (r.dockUser && r.dockUser !== u.id && d < 14) return; // warten
          this.pathTo(u, dp.x, dp.z);
          if (!u.path.length) u.path = [{ x: dp.x, z: dp.z }];
        }
        return;
      }
      case 'unload': {
        const r = this.byId.get(u.dock);
        if (!r || r.dead) { u.hState = 'toDock'; return; }
        const dp = this.dockPos(r);
        u.x += (dp.x - u.x) * Math.min(1, dt * 3); u.z += (dp.z - u.z) * Math.min(1, dt * 3);
        u.heading = turnTo(u.heading, Math.PI, dt * 1.5);
        const amt = Math.min(u.cargo, 220 * dt);
        u.cargo -= amt;
        const inc = amt * (p.diff ? p.diff.income : 1);
        p.credits += inc; p.stats.ore += inc;
        if (p === this.human && Math.random() < dt * 4) play('cash', u.x, u.z);
        if (u.cargo <= 0.5) { u.cargo = 0; r.dockUser = 0; u.hState = 'toOre'; this.pathTo(u, u.x + 9, u.z); }
        return;
      }
      case 'idle':
        u.idleT -= dt;
        if (u.idleT <= 0) u.hState = 'toOre';
        return;
    }
  }
  dockPos(r) {
    const v = new THREE.Vector3();
    if (r.nodes.dock) { r.nodes.dock.getWorldPosition(v); return { x: v.x, z: v.z }; }
    return { x: r.x, z: r.z + r.h * CELL / 2 + 3 };
  }
  nearestRefinery(u) {
    let best = null, bd = 1e18;
    for (const b of this.buildings) if (b.owner === u.owner && b.type === 'refinery' && !b.dead && b.rise >= 1 && !b.selling) {
      const d = dist2(u.x, u.z, b.x, b.z) + (b.dockUser && b.dockUser !== u.id ? 400 : 0);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }
  findOre(x, z, u, maxR = 60) {
    const T = this.terrain;
    let best = -1, bd = 1e18;
    const mr2 = (maxR * CELL) ** 2;
    for (const k of T.oreCells) {
      if (T.ore[k] < 40) continue;
      const cx = (k % MAPN + 0.5) * CELL, cz = (Math.floor(k / MAPN) + 0.5) * CELL;
      let d = dist2(x, z, cx, cz);
      if (d > mr2) continue;
      // andere Sammler meiden
      for (const o of this.units) {   // auch Nachbarfelder: Sammler sind fast 10 m lang
        if (o === u || !o.def.cargo || o.dead) continue;
        if (o.oreCell === k) d += 900;
        else if (dist2(o.x, o.z, cx, cz) < 64) d += 600;
      }
      // gefährliche Gebiete meiden (KI-Gebäude nahe)
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  // ----------------------------------------------------------------- Gebäude
  updateBuilding(b, dt) {
    const fx = this.fx;
    if (b.rise < 1) {
      // Aufbau: das Gebäude wächst unverzerrt aus dem Boden, Staub am Rand, Schweißfunken an der Oberkante
      b.rise = Math.min(1, b.rise + dt / (b.def.wall ? 0.9 : 1.8));
      const e = 1 - (1 - b.rise) ** 3;
      b.obj.position.y = b.baseY - b.top * (1 - e);
      if (b.obj.visible && !b.def.wall) {
        const hw = b.w * CELL / 2, hd = b.h * CELL / 2;
        if (Math.random() < dt * 16) { const sx = Math.random() < 0.5; fx.dust(b.x + (sx ? (Math.random() < 0.5 ? -hw : hw) : (Math.random() - 0.5) * 2 * hw), b.y, b.z + (sx ? (Math.random() - 0.5) * 2 * hd : (Math.random() < 0.5 ? -hd : hd)), 1.5); }
        if (Math.random() < dt * 7) fx.weld(b.x + (Math.random() - 0.5) * hw * 1.4, b.y + 0.4 + Math.random() * Math.min(3, b.top * e), b.z + (Math.random() - 0.5) * hd * 1.4);
      }
      if (b.rise >= 1) {
        b.obj.position.y = b.baseY;
        if (b.obj.visible && !b.def.wall) fx.shock(b.x, b.y, b.z, Math.max(b.w, b.h) * CELL / 14, 0xd9c9a6, 0.3);
        this.updatePower(this.players[b.owner]);
        if (b.freeHarvester) {
          b.freeHarvester = false;
          const dp = this.dockPos(b);
          const h = this.spawnUnit('harvester', b.owner, dp.x, dp.z, Math.PI);
          h.hState = 'toOre';
        }
      }
      return;
    }
    if (b.selling) {
      b.selling += dt;
      const sk = clamp((b.selling - 1) / 1.2, 0, 1);
      b.obj.position.y = b.baseY - b.top * sk * sk;   // Abbau: versinkt wieder
      if (sk > 0 && b.obj.visible && Math.random() < dt * 12) fx.dust(b.x + (Math.random() - 0.5) * b.w * CELL, b.y, b.z + (Math.random() - 0.5) * b.h * CELL, 1.6);
      if (b.selling > 2.2) {
        const n = Math.floor(b.def.cost / 700);
        for (let i = 0; i < n; i++) this.spawnUnit('rifle', b.owner, b.x + (rand() - 0.5) * 4, b.z + b.h * CELL / 2 + 2);
        this.removeBuilding(b, false);
      }
      return;
    }
    const N = b.nodes, low = this.players[b.owner].low;
    b.pow = (b.pow ?? 1) + ((low ? 0 : 1) - (b.pow ?? 1)) * Math.min(1, dt * 0.8);   // Strommangel: Antriebe laufen weich aus
    if (N.dish) { b.dishT = (b.dishT || b.id) + dt * 0.45 * b.pow; N.dish.rotation.y = Math.sin(b.dishT) * 0.35; }
    if (N.crane) {   // Kran schwenkt, solange gebaut wird, und fährt danach in die Ruhelage
      b.craneT = (b.craneT || 0) + dt * (b.busy ? 0.55 : 0) * b.pow;
      const want = b.busy ? Math.sin(b.craneT) * 0.4 : 0;
      b.craneA = (b.craneA || 0) + (want - (b.craneA || 0)) * Math.min(1, dt * 1.2);
      N.crane.rotation.y = b.craneA;
    }
    if (b.def.superweapon) this.updateSilo(b, dt);
    // Effekte
    b.fxT -= dt;
    if (b.fxT <= 0 && b.obj.visible) {
      b.fxT = 0.18;
      b.busy = this.busy(b);
      const v = _v;
      for (const e of N.fx) {
        e.obj.getWorldPosition(v);
        if (e.kind === 'steam') { if (b.pow > 0.3) fx.smokePuff(v.x, v.y, v.z, false, 1.4); }
        else if (e.kind === 'smoke' && Math.random() < (b.busy ? 1 : 0.3)) fx.smokePuff(v.x, v.y, v.z, true, b.busy ? 0.9 : 0.5);   // Schornstein qualmt bei Produktion kräftig
      }
      const W = b.def.weapon, M0 = N.muzzles && N.muzzles[0];
      if ((W === 'tesla' || W === 'prism') && M0 && b.pow > 0.3 && b.rise >= 1 && !b.selling) {
        M0.getWorldPosition(v);
        if (W === 'tesla' && Math.random() < 0.45) {
          const a = Math.random() * 6.28, r = 1.35 + Math.random() * 0.35, a2 = a + (Math.random() - 0.5) * 1.2;
          if (Math.random() < 0.6) fx.boltLine(fx.boltPath(v.x, v.y, v.z, v.x + Math.cos(a) * r, v.y - (0.6 + Math.random() * 1.6), v.z + Math.sin(a) * r, 0.3, 0.3), 0x6f7fff, 0.045, 0.09, 0, 0.9);
          else fx.boltLine(fx.boltPath(v.x + Math.cos(a) * r, v.y - 1.2, v.z + Math.sin(a) * r, v.x + Math.cos(a2) * r, v.y - 2.0, v.z + Math.sin(a2) * r, 0.25, 0.3), 0x6f7fff, 0.04, 0.08, 0, 0.8);
        } else if (W === 'prism' && Math.random() < 0.5) fx.flare.emit({ x: v.x, y: v.y, z: v.z, life: 0.5, s0: 2.2, s1: 3, c0: [0.5, 0.8, 1], a0: 0.45, a1: 0, vr: 0 });
      }
      const dmg = 1 - b.hp / b.maxHp;
      if (dmg > 0.4) {
        // feste Brandherde statt zufälligem Flackern: Rauchsäulen und Flammen bleiben an ihrer Stelle
        if (!b.fires) b.obj.updateMatrixWorld(true);
        if (!b.fires) b.fires = [0, 1, 2, 3].map(() => {
          const f = { x: (Math.random() - 0.5) * b.w * CELL * 0.6, z: (Math.random() - 0.5) * b.h * CELL * 0.6, y: 1, s: 0.8 + Math.random() * 0.6 };
          _ray.set(_v.set(b.x + f.x, b.y + 60, b.z + f.z), DOWN);            // Brandherd sitzt auf der Oberfläche (Dach, Tank, Hof), nicht im Inneren
          const hit = _ray.intersectObject(b.obj, true)[0];
          if (hit) f.y = Math.min(hit.point.y - b.y, b.top * 0.8) + 0.2;
          return f;
        });
        const n = dmg > 0.8 ? 4 : dmg > 0.65 ? 3 : dmg > 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) {
          const f = b.fires[i];
          if (Math.random() < 0.6) fx.smokePuff(b.x + f.x, b.y + f.y + 0.8, b.z + f.z, true, f.s);
          if (dmg > 0.55) { fx.flame(b.x + f.x, b.y + f.y, b.z + f.z, 1.3 * f.s); fx.flame(b.x + f.x, b.y + f.y, b.z + f.z, 1.3 * f.s); }
        }
      } else b.fires = null;
    }
    // Reparatur
    if (b.repairing) {
      const p = this.players[b.owner];
      const hp = Math.min(b.maxHp - b.hp, b.maxHp * 0.05 * dt);
      const cost = hp * b.def.cost / b.maxHp * 0.4;
      if (hp <= 0 || p.credits < cost) b.repairing = false;
      else { b.hp += hp; p.credits -= cost; }
    }
    // Geschützturm
    if (b.def.weapon) this.updateTurret(b, dt);
  }

  /** Wird in diesem Gebäude gerade produziert (Bauhof: wird gebaut)? */
  // ================================================================= Superwaffe (Abschussbasis)
  /** Aufladen (nur mit Energie); im letzten Drittel fährt die Rakete aus dem Boden auf die Startrampe */
  updateSilo(b, dt) {
    const p = this.players[b.owner], R = b.nodes.rocket;
    if (b.launching || !R) return;
    if (b.charge < 1) {
      b.charge = Math.min(1, b.charge + dt / NUKE.charge * (p.low ? 0 : 1));
      if (b.charge >= 1 && p === this.human) { say('Atomrakete bereit', 1); play('ready'); this.events.push({ type: 'msg', text: 'Atomrakete bereit – Ziel wählen (Taste N)' }); }
    }
    const k = clamp((b.charge - 0.66) / 0.34, 0, 1);
    R.visible = k > 0;
    R.position.y = b.rocketY0 - b.rocketH * (1 - k * (2 - k));
  }
  /** startbereite Abschussbasis eines Spielers */
  readySilo(p) { return this.buildings.find((b) => b.owner === p.id && b.def.superweapon && !b.dead && !b.selling && b.rise >= 1 && b.charge >= 1 && !b.launching) || null; }
  silo(p) { return this.buildings.find((b) => b.owner === p.id && b.def.superweapon && !b.dead) || null; }

  /** Start: Zündung mit Qualmwolke, Rakete steigt beschleunigt auf; nach der Flugzeit stürzt sie auf (x, z) */
  launchNuke(b, x, z) {
    if (!b || b.dead || b.charge < 1 || b.launching) return false;
    const R = b.nodes.rocket, fx = this.fx, p = this.players[b.owner];
    b.launching = true; b.charge = 0;
    const missile = R.clone(true);   // fallende Rakete (Kopie, die Basis kann inzwischen zerstört sein)
    p.stats.nukes = (p.stats.nukes || 0) + 1;
    (this.nukeMarks ??= []).push({ x, z, owner: b.owner, until: this.time + NUKE.flight + 2.2 });   // Zielkreis im Overlay bis zum Einschlag
    if (p === this.human) say('Atomrakete gestartet', 1);
    else if (this.allied(p.id, this.me)) { say('Verbündete Atomrakete gestartet', 1); this.events.push({ type: 'nuke', x, z, text: 'Verbündeter ' + this.playerName(p) + ' hat eine Atomrakete gestartet.' }); }
    else if (this.human.alive) { say('Warnung: Atomraketenstart erkannt', 1); this.events.push({ type: 'nuke', x, z, text: 'Warnung: feindliche Atomrakete gestartet!' }); }
    if (b.obj.visible) play('rocket', b.x, b.z);
    let t = 0;
    const v = new THREE.Vector3(), IGN = 1.4;
    this.anims.push((dt) => {
      t += dt;
      R.getWorldPosition(v);
      const vis = b.obj.visible && !b.removed;
      if (t < IGN) {   // Zündung: Feuer am Fuß, Qualm quillt seitlich über die Rampe
        if (vis) for (let i = 0; i < 3; i++) {
          const a = Math.random() * 6.28, sp = 5 + Math.random() * 7;
          fx.smoke.emit({ x: v.x, y: v.y + 0.5, z: v.z, vx: Math.cos(a) * sp, vy: 0.6 + Math.random(), vz: Math.sin(a) * sp, life: 2.5 + Math.random() * 1.5, s0: 2, s1: 7, ease: 2, c0: [0.86, 0.85, 0.83], a0: 0.5, a1: 0, drag: 1.4, wind: 0.6 });
        }
        if (vis) fx.fire.emit({ x: v.x, y: v.y + 0.3, z: v.z, life: 0.15, s0: 2.6, s1: 1, c0: [1, 0.85, 0.5], c1: [1, 0.35, 0.08], a0: 1, a1: 0 });
      } else {
        const tt = t - IGN;
        R.position.y = b.rocketY0 + 3 * tt * tt + 2 * tt;
        if (vis) {
          fx.fire.emit({ x: v.x, y: v.y - 0.4, z: v.z, vy: -14, life: 0.22, s0: 2.2, s1: 0.8, c0: [1, 0.9, 0.6], c1: [1, 0.4, 0.08], a0: 1, a1: 0 });
          fx.smoke.emit({ x: v.x + (Math.random() - 0.5), y: v.y - 1, z: v.z + (Math.random() - 0.5), vy: -2, life: 3 + Math.random() * 2, s0: 1.4, s1: 5, ease: 2, c0: [0.88, 0.87, 0.85], a0: 0.55, a1: 0, drag: 1, wind: 1 });
          if (tt < 0.1) fx.flash(v.x, v.y, v.z, 1.5, 0xffc070);
        }
      }
      if (t > IGN + 5) { R.visible = false; R.position.y = b.rocketY0 - b.rocketH; b.launching = false; return false; }
    });
    this.after(NUKE.flight, () => this.nukeFall(missile, b, x, z));
    return true;
  }

  /** Endanflug: die Rakete stürzt mit der Spitze voran senkrecht herab und detoniert am Boden */
  nukeFall(missile, src, x, z) {
    const fx = this.fx, y0 = this.terrain.heightAt(x, z);
    missile.visible = true;
    missile.rotation.set(Math.PI, 0, 0);   // Spitze nach unten (Ursprung = Raketenfuß, liegt jetzt oben)
    const H = src.rocketH || 9;
    let h = 220;
    missile.position.set(x, y0 + h + H, z);
    this.scene.add(missile);
    play('rocket', x, z);
    let vy = 70;
    this.anims.push((dt) => {
      vy += 30 * dt; h -= vy * dt;
      missile.position.y = y0 + Math.max(0, h) + H;
      fx.fire.emit({ x, y: missile.position.y + 0.3, z, vy: 18, life: 0.18, s0: 1.8, s1: 0.6, c0: [1, 0.85, 0.5], c1: [1, 0.35, 0.08], a0: 1, a1: 0 });
      fx.smoke.emit({ x, y: missile.position.y + 1, z, vy: 2, life: 2.2, s0: 1.2, s1: 4, ease: 2, c0: [0.85, 0.84, 0.82], a0: 0.4, a1: 0, drag: 1, wind: 1 });
      if (h <= 0) { this.scene.remove(missile); this.nukeMarks = (this.nukeMarks || []).filter((m) => m.x !== x || m.z !== z); this.nukeBlast(x, z, src); return false; }
    });
  }

  /** Detonation: Effektkette in fx.nuke (Blitz, Feuerball, Druckwellen, Atompilz), Folgeexplosionen am Boden,
   *  Sofortschaden (fällt zum Rand auf 25 %), danach verstrahlte Zone (NUKE.rad) für einige Sekunden */
  nukeBlast(x, z, src) {
    const fx = this.fx, y = this.terrain.heightAt(x, z), RR = NUKE.radius, R = Math.random;
    play('bigexplosion', x, z); play('explosion', x, z);
    this.after(0.35, () => play('bigexplosion', x, z));
    fx.nuke(x, y, z, RR);
    for (let i = 0; i < 14; i++) this.after(0.25 + i * 0.09, () => { const a = R() * 6.28, r = (0.3 + R() * 0.7) * RR * 0.85; const ex = x + Math.cos(a) * r, ez = z + Math.sin(a) * r; fx.explosion(ex, this.terrain.heightAt(ex, ez), ez, 1 + R(), true, 'ground'); });
    // Sofortschaden (auch an eigenen Truppen); Flugzeuge in Reiseflughöhe bleiben verschont. Ohne Verursacher: Einheiten sollen nicht zur Abschussbasis losfahren
    const dmgAt = (d) => NUKE.dmg * (1 - 0.75 * Math.min(1, d / RR));
    for (const e of this.unitsNear(x, z, RR + 3)) {
      if (e.dead || e.dying !== undefined || (e.def.air && (e.alt || 0) > 14)) continue;
      const d = dist(e.x, e.z, x, z);
      if (d <= RR) this.damage(e, dmgAt(d) * (NUKE.vs[e.def.armor] ?? 1), null);
    }
    for (const b of [...this.buildings]) {
      if (b.dead) continue;
      const d = this.edgeDist(x, z, b);
      if (d <= RR) this.damage(b, dmgAt(d) * NUKE.vs.building, null);
    }
    // Verstrahlung
    (this.radZones ??= []).push({ x, z, r: RR, until: this.time + NUKE.rad.time, tick: 0 });
    fx.radiation(x, y, z, RR, NUKE.rad.time);
  }

  /** Verstrahlte Zonen: alle 0,5 s Schaden an Einheiten und Gebäuden im Radius (Mitte voll, Rand 40 %) */
  updateRadiation(dt) {
    if (!this.radZones || !this.radZones.length) return;
    const RD = NUKE.rad;
    for (const Z of this.radZones) {
      Z.tick -= dt;
      if (Z.tick > 0) continue;
      Z.tick += 0.5;
      const f = (d) => 0.5 * (1 - 0.6 * Math.min(1, d / Z.r));
      for (const e of this.unitsNear(Z.x, Z.z, Z.r + 2)) {
        if (e.dead || e.dying !== undefined || (e.def.air && (e.alt || 0) > 6)) continue;
        const d = dist(e.x, e.z, Z.x, Z.z);
        if (d <= Z.r) this.damage(e, RD.dps * f(d) * (RD.vs[e.def.armor] ?? 1), null);
      }
      for (const b of [...this.buildings]) {
        if (b.dead) continue;
        const d = this.edgeDist(Z.x, Z.z, b);
        if (d <= Z.r) this.damage(b, RD.bdps * f(d), null);
      }
    }
    this.radZones = this.radZones.filter((Z) => Z.until > this.time);
  }

  busy(b) {
    for (const q of Object.values(this.players[b.owner].queues)) {
      if (!q.type || q.paused || q.ready) continue;
      const d = UNITS[q.type];
      if (d ? d.from === b.type : b.type === 'hq') return true;
    }
    return false;
  }

  updateTurret(b, dt) {
    const def = b.def, p = this.players[b.owner];
    b.cooldown -= dt * (p.low ? 0.5 : 1);
    b.acquireT -= dt;
    if (b.acquireT <= 0) {
      b.acquireT = 0.35;
      if (!b.target || b.target.dead || this.edgeDist(b.x, b.z, b.target) > def.range) {
        b.target = null;
        let bd = 1e9;
        for (const e of this.unitsNear(b.x, b.z, def.range)) {
          if (this.allied(e.owner, b.owner) || e.dying !== undefined || !this.canHit(b, e)) continue;
          const d = dist2(b.x, b.z, e.x, e.z) * (e.def.air && WEAPONS[def.weapon].aaPref ? 0.25 : 1);
          if (d < bd) { bd = d; b.target = e; }
        }
      }
    }
    this.applyRecoil(b, dt);
    this.tickSalvo(b, dt);   // Raketenturm: Salven
    const t = b.target;
    if (!t) return;
    const want = Math.atan2(t.z - b.z, t.x - b.x);
    b.turretYaw = turnTo(b.turretYaw, want, def.turretTurn * dt);
    if (b.nodes.turret) b.nodes.turret.rotation.y = -b.turretYaw - Math.PI / 2;   // Gebäudemodelle zeigen nach Norden (-Z)
    if (b.salvo > 0) return;
    if (Math.abs(angDiff(b.turretYaw, want)) < 0.06 && b.cooldown <= 0 && !p.low) this.fire(b, t);
    else if (Math.abs(angDiff(b.turretYaw, want)) < 0.06 && b.cooldown <= 0 && p.low && rand() < 0.5) this.fire(b, t);
  }

  // ----------------------------------------------------------------- Waffen
  muzzlePos(s, out) {
    const ms = s.nodes.muzzles;
    if (ms.length) { const m = ms[(s.shot = (s.shot || 0) + 1) % ms.length]; m.getWorldPosition(out); }
    else out.set(s.x, s.y + 2, s.z);
    if (s.def.weapon === 'tcannon') { // Zwillingsrohr: seitlich versetzen
      const side = (s.shot % 2 ? 1 : -1) * 0.28, a = s.turretYaw;
      out.x += -Math.sin(a) * side; out.z += Math.cos(a) * side;
    }
    return out;
  }

  fire(s, t) {
    const w = WEAPONS[s.def.weapon];
    s.cooldown = w.rof * (0.9 + rand() * 0.2) * RANK.rof[s.rank || 0];
    if (w.salvo) { s.salvo = w.salvo; s.salvoT = 0; s.salvoTarget = t; return; }
    this.launch(s, t);
    if (w.burst) { for (let i = 1; i < w.burst; i++) this.after(i * 0.09, () => { if (!s.dead && !t.dead) this.launch(s, t); }); }
  }

  launch(s, t) {
    const w = WEAPONS[s.def.weapon];
    const m = this.muzzlePos(s, new THREE.Vector3());
    const tx = t.x + (t.kind === 'building' ? (rand() - 0.5) * t.w * CELL * 0.5 : 0);
    const tz = t.z + (t.kind === 'building' ? (rand() - 0.5) * t.h * CELL * 0.5 : 0);
    const ty = t.kind === 'building' ? t.y + 2.5 : (t.y + (t.def.air ? 1.5 : t.def.inf ? 1.4 : 1.3));
    const dx = tx - m.x, dz = tz - m.z, dl = Math.hypot(dx, dz) || 1;
    const vis = s.vis !== false && (this.friendly(s) || isVisible(s.x, s.z) || isVisible(tx, tz));
    const ux = dx / dl, uz = dz / dl;
    const big = w.proj === 'shell' || w.shellArc;
    if (big) { s.recoil = 1; s.recoilAmt = w.shellArc ? 0.8 : 0.55; s.rock = 1; s.rockA = Math.atan2(uz, ux); }
    else if (w.proj === 'tracer') { s.recoil = 0.7; s.recoilAmt = 0.18; }
    if (vis) {
      const fx = this.fx;
      play(w.sound, s.x, s.z);
      if (w.proj === 'bullet') {
        fx.muzzle(m.x, m.y, m.z, ux, uz, 0.4);
        // ausgeworfene Hülse
        fx.debris.emit({ x: m.x - ux * 0.5, y: m.y, z: m.z - uz * 0.5, vx: -uz * 2.5 + (Math.random() - 0.5), vy: 2.5, vz: ux * 2.5 + (Math.random() - 0.5), life: 0.5, s0: 0.07, s1: 0.07, c0: [0.85, 0.65, 0.25], a0: 1, a1: 0.8, grav: -14, drag: 0.5, vr: 20 });
      } else if (w.proj === 'tracer') fx.muzzle(m.x, m.y, m.z, ux, uz, 0.7);
      else if (big) {
        fx.muzzle(m.x, m.y, m.z, ux, uz, w.shellArc ? 1.7 : 1.35, 'cannon');
        // Druckwelle wirbelt Staub unter der Mündung auf
        const gy = this.terrain.heightAt(m.x, m.z);
        if (m.y - gy < 5) {
          fx.shock(m.x, gy, m.z, 0.45, 0xcdbb95, 0.4);
          for (let i = 0; i < 5; i++) { const a = Math.random() * 6.28; fx.smoke.emit({ x: m.x, y: gy + 0.3, z: m.z, vx: Math.cos(a) * 5 + ux * 3, vy: 0.5, vz: Math.sin(a) * 5 + uz * 3, life: 1.2, s0: 1, s1: 3.2, c0: [0.55, 0.48, 0.38], a0: 0.3, a1: 0, drag: 2.5 }); }
        }
        fx.shakeAt(m.x, m.z, 0.12);
      } else if (!w.energy) {
        fx.muzzle(m.x, m.y, m.z, ux, uz, 0.6, 'rocket');
        fx.backblast(m.x - ux * 0.8, m.y, m.z - uz * 0.8, ux, uz, s.def && s.def.inf ? 0.7 : 1);
      }
    }
    const P = { w, owner: s.owner, src: s, target: t, x: m.x, y: m.y, z: m.z, sx: m.x, sy: m.y, sz: m.z, tx, ty, tz, t: 0, vis };
    if (w.proj === 'zap') {   // Teslaspule lädt kurz auf (Entladungen um die Kugel), dann schlägt der Blitz ein
      if (vis) this.teslaCharge(m);
      this.after(0.22, () => { if (s.dead) return; if (vis) this.energyFx(w, m, P.tx, P.ty, P.tz); this.hit(P); });
      return;
    }
    if (w.energy) { if (vis) this.energyFx(w, m, tx, ty, tz); this.hit(P); return; }   // Prismastrahl trifft sofort
    if (w.proj === 'bullet') {
      if (vis) this.fx.tracer(m.x, m.y, m.z, tx, ty, tz, 400, 0xffd38a, 0.05, 2.5);
      this.hit(P); return;
    }
    const d3 = Math.hypot(tx - m.x, ty - m.y, tz - m.z);
    if (w.proj === 'tracer' || w.proj === 'shell') {
      P.T = d3 / w.speed;
      if (vis) this.fx.tracer(m.x, m.y, m.z, tx, ty, tz, w.speed, 0xffc070, w.proj === 'shell' ? 0.16 : 0.09, w.proj === 'shell' ? 5 : 3);
    } else if (w.proj === 'rocket') {
      P.rocket = true; P.vx = dx / dl; P.vy = 0.15; P.vz = dz / dl; P.speed = w.speed;
    } else if (w.proj === 'arc') {
      const inacc = w.inaccuracy || 0;
      P.tx += (rand() - 0.5) * inacc * 2; P.tz += (rand() - 0.5) * inacc * 2; P.ty = this.terrain.heightAt(P.tx, P.tz);
      P.rocket = !w.shellArc; P.arc = true; P.T = Math.max(1.2, dl / w.speed); P.apex = 6 + dl * 0.3; P.vx = dx; P.vy = 1; P.vz = dz;
    }
    this.projectiles.push(P);
  }

  /** Teslaspule lädt auf: Bögen springen von der Kugel auf die Ringe, die Kugel glüht auf */
  teslaCharge(m) {
    const fx = this.fx;
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * 6.28, r = 1.4 + Math.random() * 0.4, dy = 0.6 + Math.random() * 1.6;
      fx.boltLine(fx.boltPath(m.x, m.y, m.z, m.x + Math.cos(a) * r, m.y - dy, m.z + Math.sin(a) * r, 0.35, 0.3), 0x6f7fff, 0.05, 0.1, i * 0.05, 1);
    }
    fx.flare.emit({ x: m.x, y: m.y, z: m.z, life: 0.25, s0: 1.5, s1: 5, c0: [0.55, 0.62, 1], a0: 0.4, a1: 1, vr: 0 });
  }

  /** Optik der Energiewaffen: Teslablitz zuckt von der Kugel zum Ziel, Prismastrahl aus dem Kristall */
  energyFx(w, m, tx, ty, tz) {
    const fx = this.fx, gy = this.terrain.heightAt(tx, tz);
    if (w.proj === 'zap') {
      fx.bolt(m.x, m.y, m.z, tx, ty, tz, 0x6f7fff, 0.09, 4);
      for (let i = 0; i < 3; i++) {   // Überschlag am Ziel: kurze Bögen in den Boden
        const a = Math.random() * 6.28, r = 1.2 + Math.random() * 2.2;
        fx.bolt(tx, ty, tz, tx + Math.cos(a) * r, gy + 0.05, tz + Math.sin(a) * r, 0x6f7fff, 0.05, 2, 0);
      }
      fx.flare.emit({ x: m.x, y: m.y, z: m.z, life: 0.25, s0: 4, s1: 6, c0: [0.75, 0.8, 1], a0: 1, a1: 0, vr: 0 });
      fx.flare.emit({ x: tx, y: ty, z: tz, life: 0.2, s0: 3.5, s1: 5, c0: [0.7, 0.75, 1], a0: 1, a1: 0, vr: 0 });
      fx.flash(tx, ty, tz, 0.7, 0x8fa0ff);
      for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, sp = 3 + Math.random() * 8;
        fx.fire.emit({ x: tx, y: ty, z: tz, vx: Math.cos(a) * sp, vy: 2 + Math.random() * 6, vz: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.3, s0: 0.25, s1: 0.05, c0: [0.85, 0.9, 1], c1: [0.4, 0.5, 1], a0: 1, a1: 0, drag: 1, grav: -18 }); }
      for (let i = 0; i < 3; i++) fx.smoke.emit({ x: tx, y: gy + 0.4, z: tz, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random(), vz: (Math.random() - 0.5) * 2, life: 1.4, s0: 0.8, s1: 2.6, c0: [0.25, 0.25, 0.27], a0: 0.4, a1: 0, drag: 1.5 });
      fx.glow(tx, gy, tz, 1.8, 0.9, 0.5);
      fx.shakeAt(tx, tz, 0.08);
    } else {
      fx.beam(m.x, m.y, m.z, tx, ty, tz, 0xffffff, 0.22, 0.35);
      fx.beam(m.x, m.y, m.z, tx, ty, tz, 0x58c8ff, 0.9, 0.45);
      fx.beam(m.x, m.y, m.z, tx, ty, tz, 0x2a6cff, 2.2, 0.5);
      fx.flare.emit({ x: m.x, y: m.y, z: m.z, life: 0.35, s0: 5, s1: 7, c0: [0.75, 0.95, 1], a0: 1, a1: 0, vr: 0 });
      fx.flare.emit({ x: tx, y: ty, z: tz, life: 0.3, s0: 5, s1: 8, c0: [0.7, 0.9, 1], a0: 1, a1: 0, vr: 0 });
      fx.flash(tx, ty, tz, 0.9, 0x7fd0ff);
      fx.explosion(tx, gy, tz, 0.5, true, 'hit');
      fx.shakeAt(tx, tz, 0.1);
    }
  }

  updateProjectiles(dt) {
    const fx = this.fx;
    const out = [];
    for (const P of this.projectiles) {
      P.t += dt;
      if (P.arc) {
        const k = Math.min(1, P.t / P.T);
        const nx = P.sx + (P.tx - P.sx) * k, nz = P.sz + (P.tz - P.sz) * k;
        const ny = P.sy + (P.ty - P.sy) * k + P.apex * 4 * k * (1 - k);
        P.vx = nx - P.x; P.vy = ny - P.y; P.vz = nz - P.z;
        P.x = nx; P.y = ny; P.z = nz;
        if (P.vis && P.rocket && Math.random() < 0.9) fx.smoke.emit({ x: P.x, y: P.y, z: P.z, vy: 0.3, life: 1.6, s0: 0.6, s1: 2.6, c0: [0.8, 0.78, 0.75], a0: 0.45, a1: 0, drag: 1 });
        if (P.vis && !P.rocket && Math.random() < 0.5) fx.smoke.emit({ x: P.x, y: P.y, z: P.z, life: 0.6, s0: 0.3, s1: 1.0, c0: [0.7, 0.68, 0.65], a0: 0.3, a1: 0, drag: 1 });
        if (P.vis) fx.fire.emit({ x: P.x, y: P.y, z: P.z, life: 0.08, s0: 0.9, s1: 0.4, c0: [1, 0.8, 0.4], a0: 1, a1: 0 });
        if (k >= 1) { this.hit(P); continue; }
      } else if (P.rocket) {
        const t = P.target;
        if (t && !t.dead) { P.tx = t.x; P.tz = t.z; P.ty = t.kind === 'building' ? t.y + 2.5 : t.y + 1.2; }
        const dx = P.tx - P.x, dy = P.ty - P.y, dz = P.tz - P.z, d = Math.hypot(dx, dy, dz);
        const step = P.speed * dt;
        if (d <= step + 0.5 || P.t > 6) { P.x = P.tx; P.y = P.ty; P.z = P.tz; this.hit(P); continue; }
        // sanft lenken
        const k = Math.min(1, dt * 6);
        P.vx += (dx / d - P.vx) * k; P.vy += (dy / d - P.vy) * k; P.vz += (dz / d - P.vz) * k;
        const l = Math.hypot(P.vx, P.vy, P.vz);
        P.x += P.vx / l * step; P.y += P.vy / l * step; P.z += P.vz / l * step;
        if (P.vis) {
          fx.smoke.emit({ x: P.x, y: P.y, z: P.z, vy: 0.2, life: 1.2, s0: 0.4, s1: 1.8, c0: [0.85, 0.83, 0.8], a0: 0.5, a1: 0, drag: 1 });
          fx.fire.emit({ x: P.x, y: P.y, z: P.z, life: 0.06, s0: 0.7, s1: 0.3, c0: [1, 0.8, 0.4], a0: 1, a1: 0 });
        }
      } else {
        if (P.t >= P.T) { this.hit(P); continue; }
      }
      out.push(P);
    }
    this.projectiles = out;
  }

  hit(P) {
    const w = P.w, fx = this.fx;
    const t = P.target;
    const vis = P.vis || isVisible(P.tx, P.tz);
    if (w.splash) {
      if (vis) {
        const airHit = t && !t.dead && t.kind === 'unit' && t.def.air && !P.arc;   // Flugabwehrrakete detoniert am Ziel, nicht am Boden
        if (!w.energy) fx.explosion(P.tx, P.arc ? P.ty : airHit ? P.ty : this.terrain.heightAt(P.tx, P.tz), P.tz, w.splash > 4 ? 1.1 : 0.55, true, airHit ? 'air' : P.arc ? 'ground' : 'hit');
        if (!w.energy) play('explosion', P.tx, P.tz);
      }
      for (const e of this.unitsNear(P.tx, P.tz, w.splash + 3)) {
        if (this.allied(e.owner, P.owner) || e.dying !== undefined) continue;
        if (e.def.air && !w.aa) continue;
        if (e.def.air && e !== t) continue;
        const d = e === t && !P.arc ? 0 : dist(e.x, e.z, P.tx, P.tz);
        if (d > w.splash + e.def.radius * 0.5) continue;
        this.damage(e, w.dmg * (1 - 0.6 * d / (w.splash + 1)) * w.vs[e.def.armor], P.src);
      }
      const b = this.buildingAtCell(Math.floor(P.tx / CELL), Math.floor(P.tz / CELL));
      if (b && !this.allied(b.owner, P.owner)) this.damage(b, w.dmg * w.vs.building, P.src);
      else if (t && t.kind === 'building' && !t.dead && t !== b && !P.arc) this.damage(t, w.dmg * w.vs.building, P.src);
    } else if (t && !t.dead) {
      const armor = t.kind === 'building' ? 'building' : t.def.armor;
      this.damage(t, w.dmg * (w.vs[armor] || 0), P.src);
      if (vis) {
        const hx = P.tx - P.sx, hz = P.tz - P.sz, hl = Math.hypot(hx, hz) || 1;
        if (armor === 'inf') fx.groundHit(P.tx + (Math.random() - 0.5) * 1.2, this.terrain.heightAt(P.tx, P.tz), P.tz + (Math.random() - 0.5) * 1.2, 0.8);
        else {
          const big = w.proj !== 'bullet';
          fx.sparks(P.tx - hx / hl * 0.8, P.ty, P.tz - hz / hl * 0.8, hx / hl, hz / hl, big ? 8 : 4, big ? 1.2 : 0.7);
          if (big && armor === 'building') fx.smoke.emit({ x: P.tx, y: P.ty, z: P.tz, vy: 1.5, life: 1.2, s0: 0.8, s1: 2.6, c0: [0.5, 0.48, 0.45], a0: 0.45, a1: 0, drag: 1.5 });
          if (Math.random() < 0.3) play('hit', P.tx, P.tz);
        }
      }
    }
  }

  damage(e, amt, src) {
    if (e.dead || amt <= 0) return;
    if (src && src.rank) amt *= RANK.dmg[src.rank];
    if (e.rank) amt *= RANK.armor[e.rank];
    e.hp -= amt; e.lastHit = this.time; e.attacker = src;
    const p = this.players[e.owner];
    if (e.kind === 'building' && p === this.human) { say('Unsere Basis wird angegriffen', 25); this.events.push({ type: 'attack', x: e.x, z: e.z, t: this.time }); }
    else if (e.kind === 'unit' && p === this.human && !e.def.cargo) say('Einheiten unter Beschuss', 30);
    if (e.kind === 'unit' && e.def.cargo && p === this.human) say('Erzsammler wird angegriffen', 20);
    // Vergeltung
    if (e.kind === 'unit' && src && !src.dead && !e.order && !e.target && e.def.weapon && this.canHit(e, src)) e.target = src;
    if (e.hp <= 0) {
      e.hp = 0;
      if (src && this.players[src.owner]) this.players[src.owner].stats.kills++;
      if (src && src.kind === 'unit' && !src.dead && !this.allied(src.owner, e.owner)) this.gainXp(src, e.def.cost || 100);
      if (e.kind === 'unit') this.killUnit(e); else this.destroyBuilding(e);
    }
  }

  gainXp(u, xp) {
    u.xp = (u.xp || 0) + xp;
    const need = Math.max(250, u.def.cost);
    const r = u.xp >= need * 3 ? 2 : u.xp >= need ? 1 : 0;
    if (r > (u.rank || 0)) {
      u.rank = r;
      if (u.vis) { for (let i = 0; i < 14; i++) this.fx.fire.emit({ x: u.x, y: u.y + 2, z: u.z, vx: (Math.random() - 0.5) * 3, vy: 3 + Math.random() * 3, vz: (Math.random() - 0.5) * 3, life: 0.7, s0: 0.6, s1: 0.1, c0: [1, 0.85, 0.3], a0: 1, a1: 0, grav: -4 }); }
      if (this.mine(u)) { say(r === 2 ? 'Elite-Einheit' : 'Einheit befördert', 4); play('ready'); }
    }
  }

  killUnit(u) {
    const vis = u.vis;
    u.dead = true;
    const p = this.players[u.owner];
    p.stats.lost++;
    this.selection.delete(u);
    if (u.def.inf) {
      u.dying = 0;
      if (u.nodes.actions[u.anim]) u.nodes.actions[u.anim].paused = true;   // Haltung einfrieren statt in die Grundstellung zu springen
      const o = u.obj; let t = 0, down = false;
      // fällt vom Angreifer weg nach hinten (oder zur Seite) um
      const src = u.attacker, ax = src ? Math.atan2(u.z - src.z, u.x - src.x) : u.heading + Math.PI;
      const axis = new THREE.Vector3(-Math.sin(ax), 0, Math.cos(ax)), q0 = o.quaternion.clone(), qf = new THREE.Quaternion();
      this.anims.push((dt) => {
        t += dt;
        const k = Math.min(1, t / 0.45), e = k * k;                 // beschleunigt wie ein Sturz
        qf.setFromAxisAngle(axis, -e * Math.PI / 2 * 0.96);
        o.quaternion.copy(q0).premultiply(qf);
        o.position.x = u.x + Math.cos(ax) * e * 0.6; o.position.z = u.z + Math.sin(ax) * e * 0.6;
        if (k >= 1 && !down) { down = true; if (vis) this.fx.dust(o.position.x, u.y, o.position.z, 0.6); }
        if (t > 2.4) o.position.y -= 0.75 * dt;
        if (t >= 3.6) { this.removeUnit(u); return false; }
      });
      if (vis) play('hit', u.x, u.z);
    } else {
      if (vis) {
        const big = u.def.radius > 2.7;
        this.fx.explosion(u.x, u.y, u.z, big ? 1.6 : 1.2, true, u.def.air ? 'air' : 'vehicle');
        play(big ? 'bigexplosion' : 'explosion', u.x, u.z);
      }
      // brennendes Wrack kurz zeigen
      u.dying = 0;
      u.obj.traverse((o) => { if (o.isMesh && o.material && !o.userData.wreck) { o.material = wreckMat(o.material); o.userData.wreck = true; } });
      if (u.ring) u.ring.visible = false;
      const o = u.obj, air = u.def.air; let t = 0;
      // Turm wird abgesprengt (Munitionsexplosion) und Folgeexplosionen
      const tur = !air && u.nodes.turret && Math.random() < 0.65 ? u.nodes.turret : null;
      const tv = tur ? { y0: tur.position.y, vx: (Math.random() - 0.5) * 3, vy: 6 + Math.random() * 5, vz: (Math.random() - 0.5) * 3, sx: (Math.random() - 0.5) * 9, sz: (Math.random() - 0.5) * 9, done: false } : null;
      if (vis && !air) {
        this.after(0.35 + Math.random() * 0.5, () => { if (!u.removed) { this.fx.explosion(u.x + (Math.random() - 0.5) * 2, u.y + 0.5, u.z + (Math.random() - 0.5) * 2, 0.6, false, 'hit'); play('explosion', u.x, u.z); } });
        this.fx.debrisBurst(u.x, u.y, u.z, 1.3, 8, [0.16, 0.18, 0.12]);
      }
      const y0 = o.position.y, tilt = (Math.random() - 0.5) * 0.12, spin = (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 3);
      let vy = 0, sunk = 0;
      this.anims.push((dt) => {
        t += dt;
        if (tv && !tv.done) {
          tv.vy -= 22 * dt;
          tur.position.x += tv.vx * dt; tur.position.y += tv.vy * dt; tur.position.z += tv.vz * dt;
          tur.rotation.x += tv.sx * dt; tur.rotation.z += tv.sz * dt;
          if (tur.position.y <= tv.y0 - 0.5 && tv.vy < 0) { tv.done = true; if (vis) { tur.getWorldPosition(_v); this.fx.dust(_v.x, u.y, _v.z, 1.5); } }
        }
        if (air) {
          if (!u.crashed) {   // trudelt brennend weiter in Flugrichtung zu Boden
            vy -= 16 * dt;
            u.x += Math.cos(u.heading) * u.speed * 0.6 * dt; u.z += Math.sin(u.heading) * u.speed * 0.6 * dt;
            o.position.x = u.x; o.position.z = u.z; o.position.y += vy * dt;
            o.rotateY(spin * dt); o.rotateX(1.6 * dt);
            const gy = this.terrain.heightAt(u.x, u.z);
            if (vis && Math.random() < dt * 30) this.fx.smokePuff(u.x, o.position.y + 0.5, u.z, true, 0.6);
            if (o.position.y <= gy + 0.4) {
              u.crashed = true; o.position.y = gy + 0.3;
              if (vis) { this.fx.explosion(u.x, gy, u.z, 1.4, true, 'vehicle'); play('explosion', u.x, u.z); }
            }
          }
        } else {
          // Wanne wird von der Explosion kurz angehoben und sackt schief zusammen
          const hop = t < 0.45 ? Math.sin(t / 0.45 * Math.PI) * 0.35 : 0;
          if (t > 3) sunk += 0.6 * dt;
          o.position.y = y0 + hop - sunk;
          u.nodes.root.rotation.x = tilt * Math.min(1, t / 0.45);
        }
        const fy = air ? o.position.y : u.y;
        if (vis && (!air || u.crashed) && t < 4.2) {
          if (Math.random() < dt * 18) this.fx.flame(u.x, fy + 1.3, u.z, 1.2);
          if (Math.random() < dt * 9) this.fx.smokePuff(u.x, fy + 2, u.z, true, 0.8);
        }
        if (air && u.crashed && t > 3) o.position.y -= 0.6 * dt;
        if (t >= 5) { this.removeUnit(u); return false; }
      });
    }
    if (p === this.human) say('Einheit verloren', 8);
  }
  removeUnit(u) {
    u.dead = true; u.removed = true;
    this.scene.remove(u.obj);
    this.byId.delete(u.id);
    this.selection.delete(u);
    const p = this.players[u.owner]; p.count[u.type] = Math.max(0, (p.count[u.type] || 1) - 1);
  }

  destroyBuilding(b) {
    b.dead = true;
    const p = this.players[b.owner];
    p.stats.bLost++;
    this.selection.delete(b);
    const vis = b.obj.visible;
    const fx = this.fx;
    if (vis) {
      play('bigexplosion', b.x, b.z);
      const R = Math.max(b.w, b.h) * CELL;
      fx.shock(b.x, b.y, b.z, R / 9, 0xd9c9a6, 0.6);
      fx.shakeAt(b.x, b.z, 0.9);
      fx.debrisBurst(b.x, b.y + 1.5, b.z, 1.8, 18, [0.2, 0.2, 0.18]);
      for (let i = 0; i < 16; i++) { // Staubwalze beim Einsturz
        const a = i / 16 * 6.28;
        fx.smoke.emit({ x: b.x + Math.cos(a) * R * 0.3, y: b.y + 0.6, z: b.z + Math.sin(a) * R * 0.3, vx: Math.cos(a) * 7, vy: 0.8, vz: Math.sin(a) * 7, life: 2.6 + Math.random(), s0: 3, s1: 9, c0: [0.56, 0.52, 0.46], a0: 0.55, a1: 0, drag: 1.6 });
      }
      for (let i = 0; i < 4 + b.w * b.h / 2; i++) {
        this.after(i * 0.14, () => fx.explosion(b.x + (Math.random() - 0.5) * b.w * CELL * 0.8, b.y + Math.random() * 3, b.z + (Math.random() - 0.5) * b.h * CELL * 0.8, 1.2 + Math.random(), true, 'building'));
      }
    }
    b.obj.traverse((o) => { if (o.isMesh) o.material = wreckMat(o.material); });
    // Einsturz: erst erschüttert, dann sackt der Bau beschleunigt und leicht schief zusammen; die Ruine schwelt nach
    let t = 0, fell = false;
    const tiltX = (Math.random() - 0.5) * 0.1, tiltZ = (Math.random() - 0.5) * 0.1, R = Math.max(b.w, b.h) * CELL;
    const spots = [0, 1, 2].map(() => ({ x: (Math.random() - 0.5) * b.w * CELL * 0.6, z: (Math.random() - 0.5) * b.h * CELL * 0.6 }));
    this.anims.push((dt) => {
      t += dt;
      const k = clamp((t - 0.3) / 1.5, 0, 1), e = k * k;
      b.obj.scale.y = 1 - 0.86 * e;
      b.obj.rotation.x = tiltX * e; b.obj.rotation.z = tiltZ * e;
      if (t < 0.3) { b.obj.position.x = b.x + (Math.random() - 0.5) * 0.12; b.obj.position.z = b.z + (Math.random() - 0.5) * 0.12; }
      if (k >= 1 && !fell) {
        fell = true;
        if (vis) for (let i = 0; i < 12; i++) { const a = i / 12 * 6.28; fx.smoke.emit({ x: b.x + Math.cos(a) * R * 0.35, y: b.y + 0.5, z: b.z + Math.sin(a) * R * 0.35, vx: Math.cos(a) * 6, vy: 1, vz: Math.sin(a) * 6, life: 2.4 + Math.random(), s0: 2.5, s1: 8, ease: 2, c0: [0.56, 0.52, 0.46], a0: 0.5, a1: 0, drag: 1.7, wind: 0.6 }); }
      }
      if (vis && t < 14) {
        const f = spots[Math.floor(Math.random() * 3)], fade = t < 9 ? 1 : (14 - t) / 5;
        if (Math.random() < dt * 5 * fade) fx.smokePuff(b.x + f.x, b.y + 1.2, b.z + f.z, true, 1.3);
        if (t < 8 && Math.random() < dt * 9) fx.flame(b.x + f.x, b.y + 0.6, b.z + f.z, 1.2);
      }
      if (t >= 14) return false;
    });
    if (p === this.human) say('Gebäude zerstört', 4);
    this.removeBuilding(b, true);
  }
  removeBuilding(b, rubble) {
    b.dead = true;
    for (let z = b.cz; z < b.cz + b.h; z++) for (let x = b.cx; x < b.cx + b.w; x++) { this.terrain.blocked[z * MAPN + x] = 0; this.bgrid[z * MAPN + x] = 0; }
    const p = this.players[b.owner]; p.count[b.type] = Math.max(0, (p.count[b.type] || 1) - 1);
    this.byId.delete(b.id);
    this.selection.delete(b);
    b.removed = true;
    if (rubble) this.after(25, () => this.scene.remove(b.obj)); else this.scene.remove(b.obj);
    if (rubble) this.fx.decal(b.x, b.y, b.z, Math.max(b.w, b.h) * CELL * 1.2);
    this.updatePower(p);
    // abhängige Produktion
    for (const u of this.units) if (u.dock === b.id) { u.dock = 0; if (u.hState === 'unload') u.hState = 'toDock'; }
  }

  checkEnd() {
    for (const p of this.players) {
      if (!p.alive) continue;
      const hasB = this.buildings.some((b) => b.owner === p.id && !b.dead);
      const hasU = this.units.some((u) => u.owner === p.id && !u.dead && (u.def.weapon || u.type === 'mcv'));
      if (!hasB && !hasU) {
        p.alive = false;
        if (p !== this.human) { const n = this.playerName(p); say(n + ' wurde vernichtet', 1); this.events.push({ type: 'msg', text: n + ' wurde vernichtet.' }); }
        // Restliche Einheiten zerstören
        for (const u of this.units) if (u.owner === p.id && !u.dead) this.killUnit(u);
      }
    }
    // Ende: nur noch ein Team übrig (Teams: opts.slots[..].ally). over gilt für diesen Rechner: 'win' / 'lose'
    const left = new Set(this.players.filter((p) => p.alive).map((p) => p.ally));
    if (left.size <= 1 && !this.winner) this.winner = { ally: [...left][0] ?? -1, t: this.time };
    if (!this.over) {
      const mineAlive = this.players.some((p) => p.ally === this.human.ally && p.alive);
      if (!mineAlive) { this.over = 'lose'; say('Mission gescheitert', 1); }
      else if (left.size === 1) { this.over = 'win'; say('Sieg. Mission erfüllt', 1); }
    }
  }
  /** Anzeigename eines Spielers: Spielername (Mehrspieler) bzw. Verband */
  playerName(p) { return p.name ? `${p.name} (${TEAMS[p.team].name})` : TEAMS[p.team].name; }
}

function mkQ() { return { type: null, progress: 0, spent: 0, ready: false, paused: false, list: [] }; }

const wreckCache = new Map();
function wreckMat(m) {
  if (wreckCache.has(m)) return wreckCache.get(m);
  const w = m.clone();
  if (w.color) w.color.multiplyScalar(0.18);
  if (w.emissive) w.emissive.setHex(0);
  w.onBeforeCompile = m.onBeforeCompile; w.customProgramCacheKey = m.customProgramCacheKey;
  wreckCache.set(m, w);
  return w;
}
