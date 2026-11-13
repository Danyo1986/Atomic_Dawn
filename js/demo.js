// Startbildschirm: Live-Gefecht im Hintergrund des Menüs. Zwei Fronten (Allianz gegen Achsenmacht) rücken aus beiden
// Richtungen in Wellen an und kämpfen in der Kartenmitte; eine Kinokamera wechselt zwischen mehreren Einstellungen (camera/cut).
// Ohne Computergegner-Logik: die Einheiten bekommen nur Angriffsbewegungen. Leise, ohne Sprachansagen (AUDIO.speech/sfx).
import * as THREE from 'three';
import { CELL, MAPN, WORLD, WATER_LEVEL, setupTeams } from './config.js';
import { clearMaterials } from './assets.js';
import { Game } from './game.js';
import { nearestFree } from './path.js';
import { AUDIO } from './audio.js';

// Wellen je Spieler: abwechselnd, damit es abwechslungsreich bleibt
const WAVES = [
  ['tank', 'tank', 'ifv', 'rifle', 'rifle', 'rifle', 'rocket', 'buggy'],
  ['tank', 'flak', 'ifv', 'artillery', 'rifle', 'rocket', 'rocket', 'buggy'],
  ['tank', 'tank', 'tank', 'ifv', 'rifle', 'rifle', 'rocket'],
];
const WAVE_EVERY = 20;    // Sekunden zwischen Nachschubwellen
const MAX_UNITS = 72;     // darüber kommt kein Nachschub

export class Demo {
  constructor(app, scene, terrain, fx) {
    this.app = app; this.terrain = terrain; this.t = 0; this.wave = 0; this.next = 0.5;
    setupTeams(['allies', 'allies', 'axis', 'axis'], [0, 5, 1, 4]);   // Blau + Türkis gegen Rot + Orange
    clearMaterials();
    this.game = new Game(scene, terrain, fx, { players: 4, credits: 0, fog: false, me: 0,
      slots: [0, 0, 1, 1].map((a) => ({ human: false, ally: a, diff: 'normal' })) });
    // Fronten: auf einer Achse durch die Kartenmitte, je 80 m davor. Achse so gedreht, dass das Schlachtfeld frei von
    // Erzfeldern ist und befahrbar bleibt (sonst kämpfen alle zwischen Kristallen oder stauen sich am Wasser)
    const c = WORLD / 2, d = 80, T = terrain;
    let a = 0.55, best = 1e9;
    for (let k = 0; k < 24; k++) {
      const ang = k / 24 * Math.PI;
      let bad = 0;
      for (let s = -1.2; s <= 1.2; s += 0.1) for (let w = -2; w <= 2; w++) {
        const x = c + Math.cos(ang) * d * s - Math.sin(ang) * w * 8, z = c + Math.sin(ang) * d * s + Math.cos(ang) * w * 8;
        const i = Math.floor(z / CELL) * MAPN + Math.floor(x / CELL);
        if (i < 0 || i >= T.ore.length) { bad += 5; continue; }
        if (T.oreMax[i] > 0) bad += 3;
        if (!T.isPassable(Math.floor(x / CELL), Math.floor(z / CELL))) bad += 2;
      }
      if (bad < best) { best = bad; a = ang; }
    }
    this.side = [-1, 1].map((s) => this.cell(c + Math.cos(a) * d * s, c + Math.sin(a) * d * s));
    this.focus = { x: c, z: c };
    AUDIO.speech = false; AUDIO.sfx = 0.3;
    for (const set of terrain.oreSets || []) for (const m of set.parts) m.visible = false;   // Erzkristalle stören das Schlachtbild
    const I = app.input;
    I.lookAt(c, c); I.target.y = Math.max(0, terrain.heightAt(c, c)); I.dist = I.distT = 120; I.yaw = I.yawT = a + Math.PI / 2;   // Blick quer zur Front
    this.axis = a; this.seq = 0; this.lift = 0; this.push = { x: 0, z: 0 }; this.crowd = 0; this.shot = null; I.rig = null;   // Kinokamera (camera/cut)
    this.onCut = null; this.onCutSoon = null;   // Rückrufe für eine Blende (Oberfläche)
  }

  /** nächste befahrbare Zelle als Weltpunkt */
  cell(x, z) {
    const T = this.terrain, cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    const f = nearestFree(cx, cz, (X, Z) => T.isPassable(X, Z), 20) || [cx, cz];
    return { x: (f[0] + 0.5) * CELL, z: (f[1] + 0.5) * CELL };
  }

  spawnWave() {
    const g = this.game;
    for (let p = 0; p < 4; p++) {
      const s = p < 2 ? 0 : 1, home = this.side[s], foe = this.side[1 - s];
      const list = WAVES[(this.wave + p) % WAVES.length];
      const head = Math.atan2(foe.z - home.z, foe.x - home.x);
      const fresh = [];
      list.forEach((type, i) => {
        // Aufstellung: Reihen quer zur Marschrichtung, zweiter Spieler einer Seite etwas versetzt
        const row = Math.floor(i / 4), col = (i % 4) - 1.5 + (p % 2 ? 0.5 : -0.5) * 5;
        const back = -12 - row * 9 - (p % 2) * 6;
        const x = home.x + Math.cos(head) * back - Math.sin(head) * col * 7;
        const z = home.z + Math.sin(head) * back + Math.cos(head) * col * 7;
        const q = this.cell(x, z);
        if (q.x < CELL || q.z < CELL || q.x > WORLD - CELL || q.z > WORLD - CELL) return;
        fresh.push(g.spawnUnit(type, p, q.x, q.z, head));
      });
      // alle (auch Überlebende früherer Wellen) rücken auf die gegnerische Front vor
      const army = g.units.filter((u) => u.owner === p && !u.dead && u.def.speed);
      const tx = foe.x + (Math.random() - 0.5) * 30, tz = foe.z + (Math.random() - 0.5) * 30;
      if (army.length) g.cmdMove(army, tx, tz, true, true);
      for (const u of fresh) u.vis = true;
    }
    this.wave++;
  }

  update(dt) {
    const g = this.game;
    dt = Math.min(dt, 0.05);
    this.t += dt;
    this.next -= dt;
    const alive = g.units.reduce((n, u) => n + (u.dead ? 0 : 1), 0);
    if (this.next <= 0) { this.next = WAVE_EVERY; if (alive < MAX_UNITS) this.spawnWave(); }
    g.update(dt);
    // kein Spielende im Hintergrund: Parteien bleiben „am Leben“, Meldungen verfallen
    g.events.length = 0;
    if (g.over || g.winner) { g.over = null; g.winner = null; }
    for (const p of g.players) p.alive = true;
    this.camera(dt);
  }

  // ------------------------------------------------------------- Kinokamera
  // Wechselnde Einstellungen (SHOTS), je 6–10 s, weiche Fahrten (ease) innerhalb, Schnitt dazwischen. Ergebnis geht als
  // app.input.rig = { pos, look, roll, fov, shift } an input.js (wirkt nur im Menü). Nur Optik: Math.random ist hier erlaubt.
  // Für eine Blende: app.demo.onCutSoon(sek, art) kommt CUT_LEAD s vor einem geplanten Schnitt, app.demo.onCut(art, vorher)
  // im Augenblick des Schnitts (auch bei vorzeitigem Abbruch); gleichzeitig Fensterereignisse 'democutsoon'/'democut'
  // (detail: kind, prev bzw. lead) – dafür muss man sich nicht je neuem Demo-Objekt anmelden. Prüfen: app.demo.nextShot('track') schaltet sofort um.

  /** Boden an (x, z): Gelände oder Wasserspiegel */
  ground(x, z) { return Math.max(this.terrain.heightAt(x, z), WATER_LEVEL); }

  /** Mindesthöhe der Kamera über (x, z): höchster Boden ringsum plus Bäume/Felsen/Häuser in der Nähe */
  floor(x, z) {
    const T = this.terrain;
    let h = -1e9;
    for (const [dx, dz] of RING) {
      const px = x + dx, pz = z + dz, cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
      const b = cx >= 0 && cz >= 0 && cx < MAPN && cz < MAPN ? T.blocked[cz * MAPN + cx] : 0;
      h = Math.max(h, this.ground(px, pz) + (OBSTACLE[b] || 0));
    }
    return h;
  }

  /** Sichtlinie Kamera → Blickpunkt frei vom Gelände? */
  sight(p, l) {
    for (let i = 1; i < 10; i++) {
      const k = i / 10, x = p.x + (l.x - p.x) * k, z = p.z + (l.z - p.z) * k, y = p.y + (l.y - p.y) * k;
      if (this.ground(x, z) > y - 0.5) return false;
    }
    return true;
  }

  /** flach genug für eine tiefe Einstellung? Höhenspanne und Hindernisse rund um (x, z) */
  flat(x, z, r = 14, span = 4) {
    let lo = 1e9, hi = -1e9;
    for (let dz = -r; dz <= r; dz += r / 2) for (let dx = -r; dx <= r; dx += r / 2) {
      const h = this.ground(x + dx, z + dz); lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return hi - lo < span && this.floor(x, z) < this.ground(x, z) + 1.5;
  }

  /** Schwerpunkt der Kämpfenden (gleitend) bzw. der letzten Treffer */
  hotspot(recent) {
    const g = this.game;
    let sx = 0, sz = 0, n = 0;
    if (recent) for (const u of g.units) if (g.time - u.lastHit < 2.5) { sx += u.x; sz += u.z; n++; }
    if (!n) for (const u of g.units) if (!u.dead && u.target && !u.target.dead) { sx += u.x; sz += u.z; n++; }
    if (!n) for (const u of g.units) if (!u.dead) { sx += u.x; sz += u.z; n++; }
    return n ? { x: sx / n, z: sz / n } : { x: this.focus.x, z: this.focus.z };
  }

  camera(dt) {
    const I = this.app.input;
    const h = this.hotspot(false);
    this.focus.x += (h.x - this.focus.x) * Math.min(1, dt * 0.35); this.focus.z += (h.z - this.focus.z) * Math.min(1, dt * 0.35);
    let s = this.shot;
    if (!s || s.t >= s.dur || s.abort) s = this.cut();
    s.t += dt;
    if (!s.cued && s.dur - s.t < CUT_LEAD) {
      s.cued = true;
      if (this.onCutSoon) this.onCutSoon(CUT_LEAD, s.kind);
      window.dispatchEvent(new CustomEvent('democutsoon', { detail: { lead: CUT_LEAD, kind: s.kind } }));
    }
    const k = Math.min(1, s.t / s.dur), e = k * k * (3 - 2 * k);
    const f = s.frame(k, e, dt);   // { p, l } Kamera und Blickpunkt (Weltkoordinaten)
    const p = f.p, l = f.l;
    // Handkamera: weiches Rauschen aus Sinusschwingungen mit zufälligen Phasen je Einstellung
    const t = s.t, ph = s.ph, a = s.hand;
    const n = (i, w) => Math.sin(t * w + ph[i]) * 0.65 + Math.sin(t * w * 2.7 + ph[i + 3]) * 0.35;
    if (a) { p.x += n(0, 0.9) * a; p.y += n(1, 1.1) * a * 0.7; p.z += n(2, 0.8) * a; l.x += n(1, 0.7) * a * 1.6; l.y += n(2, 0.6) * a * 1.2; }
    // Erschütterung durch nahe Explosionen (fx.shakeAt schreibt fx.shake; Bezug ist fx.view)
    const fx = this.game.fx, d = Math.hypot(l.x - p.x, l.y - p.y, l.z - p.z);
    fx.view.x = l.x; fx.view.z = l.z; fx.view.dist = Math.min(d, 120);
    if (fx.shake > 0.004) {
      const q = fx.shake * (0.3 + d * 0.01);
      p.x += (Math.random() - 0.5) * q; p.y += (Math.random() - 0.5) * q; p.z += (Math.random() - 0.5) * q;
      l.y += (Math.random() - 0.5) * q * 0.6;
    }
    // Abstand zu Einheiten: Kamera weicht seitlich aus, statt durch Fahrzeuge oder Soldaten zu fahren
    if (s.fresh) this.push = { x: 0, z: 0 };
    let ax = 0, az = 0, gap = 1e9;
    for (const u of this.game.units) {
      if (u.dead || u.def.air) continue;
      const dx = p.x + this.push.x - u.x, dz = p.z + this.push.z - u.z, r = u.def.radius + 4, q = dx * dx + dz * dz;
      if (q < r * r) { const dl = Math.sqrt(q) || 1; ax += dx / dl * (r - dl); az += dz / dl * (r - dl); gap = Math.min(gap, dl - u.def.radius); }
    }
    // im Gedränge (Kolonne) reicht Ausweichen nicht: dann über die Fahrzeuge hinweg anheben
    const crowd = gap < 4 ? Math.min(5, (4 - gap) * 1.4) : 0;
    if (s.fresh) this.crowd = crowd;
    this.crowd += (crowd - this.crowd) * Math.min(1, dt * (crowd > this.crowd ? 3 : 0.8));
    p.y += this.crowd;
    if (s.fresh) this.push = { x: ax, z: az };
    else follow(this.push, { x: this.push.x + ax, z: this.push.z + az }, dt, 5);
    follow(this.push, { x: 0, z: 0 }, dt, 0.4);
    p.x += this.push.x; p.z += this.push.z;
    // nie ins Gelände: Mindesthöhe über Boden und Hindernissen; Anheben schnell, Absenken langsam
    const need = this.floor(p.x, p.z) + (s.low ? 1.2 : 2.5) - p.y;
    if (s.fresh) { this.lift = Math.max(0, need); s.fresh = false; }
    this.lift += (Math.max(0, need) - this.lift) * Math.min(1, dt * (need > this.lift ? 8 : 1.2));
    p.y += this.lift;
    p.y = Math.max(p.y, this.ground(p.x, p.z) + 0.9);
    if (s.low) {   // tiefe Einstellung: verdeckt oder hochgedrückt → nächste Einstellung
      s.bad = this.lift > 3 || !this.sight(p, l) ? (s.bad || 0) + dt : 0;
      if (s.bad > 0.5) s.abort = true;
    }
    const r = I.rig || (I.rig = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 0, shift: SHIFT });
    r.pos.set(p.x, p.y, p.z); r.look.set(l.x, l.y, l.z);
    r.roll = (s.roll || 0) + (a ? n(0, 0.5) * a * 0.05 : 0);
    r.fov = s.fov || 0; r.shift = SHIFT;
    // Spielkamera mitführen: Blickpunkt/Abstand für Hörposition, Schattenausschnitt (main.js fitShadow) und Spielstart
    I.target.x = Math.min(WORLD, Math.max(0, l.x)); I.target.z = Math.min(WORLD, Math.max(0, l.z));
    I.dist = I.distT = Math.min(200, Math.max(32, d * 1.25));
    I.yaw = I.yawT = Math.atan2(p.x - l.x, p.z - l.z);
  }

  /** Schnitt: nächste mögliche Einstellung der Reihe (ungeeignete werden übersprungen) */
  cut(kind) {
    const prev = this.shot ? this.shot.kind : null;
    let s = null;
    if (SHOTS.includes(kind)) s = this[kind]();
    for (let i = 0; !s && i < SHOTS.length; i++) {
      const k = SHOTS[this.seq++ % SHOTS.length];
      if (k !== prev) s = this[k]();
    }
    if (!s) s = this.wide();
    Object.assign(s, { t: 0, fresh: true, ph: Array.from({ length: 6 }, () => Math.random() * 100) });
    s.dur *= 0.9 + Math.random() * 0.2;
    this.shot = s;
    if (this.onCut) this.onCut(s.kind, prev);
    window.dispatchEvent(new CustomEvent('democut', { detail: { kind: s.kind, prev } }));
    return s;
  }

  /** zum Prüfen: sofort auf eine Einstellung schalten ('wide' | 'track' | 'flank' | 'orbit' | 'close'), liefert die Art */
  nextShot(kind) { return this.cut(kind).kind; }

  /** (a) weite Übersicht schräg von oben, langsame Fahrt heran und seitlich */
  wide() {
    const yaw0 = this.axis + Math.PI / 2 * (Math.random() < 0.5 ? 1 : -1) + (Math.random() - 0.5) * 1.2, dir = Math.random() < 0.5 ? 1 : -1;
    const c = { x: this.focus.x, z: this.focus.z };
    return { kind: 'wide', dur: 9, hand: 0.05, frame: (k, e, dt) => {
      follow(c, this.focus, dt, 0.5);
      const yaw = yaw0 + dir * 0.22 * e, D = 135 - 30 * e, el = 0.5 - 0.08 * e;
      const l = { x: c.x, y: this.ground(c.x, c.z), z: c.z };
      return { l, p: { x: c.x + Math.cos(yaw) * Math.cos(el) * D, y: l.y + Math.sin(el) * D, z: c.z + Math.sin(yaw) * Math.cos(el) * D } };
    } };
  }

  /** (b) tiefe Verfolgerkamera knapp über dem Boden hinter/neben einer vorrückenden Panzergruppe */
  track() {
    const g = this.game;
    const moving = g.units.filter((u) => !u.dead && !u.def.inf && !u.def.air && u.speed > 1.5);
    moving.sort(() => Math.random() - 0.5);
    for (const lead of moving.slice(0, 8)) {
      const grp = g.units.filter((u) => !u.dead && u.owner === lead.owner && !u.def.air && Math.hypot(u.x - lead.x, u.z - lead.z) < 28);
      const veh = grp.filter((u) => !u.def.inf).length;
      if (veh < 2) continue;
      const c = centroid(grp), hd = lead.heading, side = Math.random() < 0.5 ? 1 : -1;
      // Ausdehnung der Gruppe: hinterstes Fahrzeug und äußerstes auf der Kameraseite
      let rear = 0, wing = 0;
      for (const u of grp) {
        const dx = u.x - c.x, dz = u.z - c.z;
        rear = Math.max(rear, -(dx * Math.cos(hd) + dz * Math.sin(hd)));
        wing = Math.max(wing, (-dx * Math.sin(hd) + dz * Math.cos(hd)) * side);
      }
      const B = Math.min(40, rear + 18), S = Math.min(28, wing + 8);
      // Kamera schräg hinter der Gruppe (o = Gruppenmitte), fährt langsam näher heran
      const cam = (o, k, hh) => ({ x: o.x - Math.cos(hh) * (B - 4 * k) - Math.sin(hh) * side * (S - 2 * k), z: o.z - Math.sin(hh) * (B - 4 * k) + Math.cos(hh) * side * (S - 2 * k) });
      // Gelände flach und frei: am Start und dort, wo die Gruppe in der Einstellung hinfährt
      let ok = true;
      for (const k of [0, 0.5, 1]) {
        const o = { x: c.x + Math.cos(hd) * lead.speed * 8 * k, z: c.z + Math.sin(hd) * lead.speed * 8 * k }, q = cam(o, k, hd);
        if (!this.flat(q.x, q.z, 10, 3) || !this.flat(o.x, o.z, 16, 5)) { ok = false; break; }
      }
      if (!ok) continue;
      const p0 = cam(c, 0, hd); p0.y = this.ground(p0.x, p0.z) + 2.2;
      const l0 = { x: c.x + Math.cos(hd) * 14, z: c.z + Math.sin(hd) * 14 }; l0.y = this.ground(l0.x, l0.z) + 1.8;
      if (!this.sight(p0, l0)) continue;
      const st = { x: c.x, z: c.z, h: hd };
      return { kind: 'track', dur: 8.5, low: true, hand: 0.12, fov: 36, frame: (k, e, dt) => {
        const live = grp.filter((u) => !u.dead);
        if (live.length) { follow(st, centroid(live), dt, 2); const ld = live.includes(lead) ? lead : live[0]; st.h = turnTo(st.h, ld.heading, dt * 0.6); }
        const p = cam(st, e, st.h); p.y = this.ground(p.x, p.z) + 2.2 + 0.6 * e;
        const l = { x: st.x + Math.cos(st.h) * 14, z: st.z + Math.sin(st.h) * 14 }; l.y = this.ground(l.x, l.z) + 1.8;
        return { p, l };
      } };
    }
    return null;
  }

  /** (c) Seitenfahrt parallel zur Frontlinie, Blick von hinten über eine Seite auf den Zusammenstoß */
  flank() {
    const c = { x: this.focus.x, z: this.focus.z }, sg = Math.random() < 0.5 ? 1 : -1, dir = Math.random() < 0.5 ? 1 : -1;
    const mx = Math.cos(this.axis) * sg, mz = Math.sin(this.axis) * sg, px = -mz * dir, pz = mx * dir;
    return { kind: 'flank', dur: 9, hand: 0.06, frame: (k, e, dt) => {
      follow(c, this.focus, dt, 0.3);
      const w = -42 + 84 * e;
      const p = { x: c.x - mx * 58 + px * w, z: c.z - mz * 58 + pz * w };
      p.y = this.ground(p.x, p.z) + 13;
      const l = { x: c.x + mx * 12 + px * w * 0.6, z: c.z + mz * 12 + pz * w * 0.6 }; l.y = this.ground(l.x, l.z) + 2;
      return { p, l };
    } };
  }

  /** (d) Kran-/Orbitfahrt um den Brennpunkt der letzten Treffer */
  orbit() {
    const h = this.hotspot(true), c = { x: h.x, z: h.z };
    const a0 = Math.random() * Math.PI * 2, dir = Math.random() < 0.5 ? 1 : -1, up = Math.random() < 0.6;
    return { kind: 'orbit', dur: 9, hand: 0.05, frame: (k, e, dt) => {
      follow(c, this.hotspot(true), dt, 0.25);
      const a = a0 + dir * 0.75 * e, R = 44 - 10 * e, y = up ? 7 + 22 * e : 29 - 20 * e;
      const p = { x: c.x + Math.cos(a) * R, z: c.z + Math.sin(a) * R }; p.y = this.ground(p.x, p.z) + y;
      return { p, l: { x: c.x, y: this.ground(c.x, c.z) + 2, z: c.z } };
    } };
  }

  /** (e) Nahaufnahme einer feuernden Einheit, über die Schulter Richtung Ziel, Handkamera */
  close() {
    const g = this.game;
    const fighting = g.units.filter((u) => !u.dead && !u.def.air && u.target && !u.target.dead && Math.hypot(u.target.x - u.x, u.target.z - u.z) < u.def.range * 1.3);
    fighting.sort((a, b) => (b.def.inf ? 0 : 2) + (b.recoil || 0) - (a.def.inf ? 0 : 2) - (a.recoil || 0) + (Math.random() - 0.5));
    for (const u of fighting.slice(0, 6)) {
      const inf = !!u.def.inf, side = Math.random() < 0.5 ? 1 : -1;
      const D0 = inf ? 9 : 22, D1 = inf ? 7 : 16, H = inf ? 2 : 4;
      const aim = { x: u.target.x, z: u.target.z }, st = { x: u.x, z: u.z };
      const at = (D) => {
        const ang = Math.atan2(aim.z - st.z, aim.x - st.x) + Math.PI + side * 0.55;
        const p = { x: st.x + Math.cos(ang) * D, z: st.z + Math.sin(ang) * D }; p.y = this.ground(p.x, p.z) + H;
        const dx = aim.x - st.x, dz = aim.z - st.z, dl = Math.hypot(dx, dz) || 1;
        const l = { x: st.x + dx / dl * 3, z: st.z + dz / dl * 3 }; l.y = this.ground(l.x, l.z) + (inf ? 1.2 : 1.8);   // Einheit im Bild, Ziel dahinter
        return { p, l };
      };
      const f0 = at(D0);
      if (!this.flat(f0.p.x, f0.p.z, 6, 2.5) || !this.sight(f0.p, f0.l)) continue;
      if (g.units.some((o) => o !== u && !o.dead && !o.def.air && Math.hypot(o.x - f0.p.x, o.z - f0.p.z) < o.def.radius + 6)) continue;   // freie Sicht, kein Gedränge
      return { kind: 'close', dur: 6.5, low: true, hand: inf ? 0.12 : 0.2, fov: 28, frame: (k, e, dt) => {
        if (!u.dead) follow(st, u, dt, 3);   // stirbt die Einheit, bleibt die Kamera stehen
        if (u.target && !u.target.dead) follow(aim, u.target, dt, 1.2);
        return at(D0 + (D1 - D0) * e);
      } };
    }
    return null;
  }
}

// Reihenfolge der Einstellungen (ungeeignete werden übersprungen, keine zweimal hintereinander)
const SHOTS = ['wide', 'track', 'orbit', 'close', 'flank', 'track', 'wide', 'close', 'orbit', 'flank'];
const SHIFT = 0.07;     // Motiv leicht rechts der Bildmitte (NDC): links liegt das Menü, rechts das Plakat
const CUT_LEAD = 0.4;   // so viele Sekunden vor einem geplanten Schnitt kommt onCutSoon
const RING = [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]];   // Abtastpunkte der Mindesthöhe
const OBSTACLE = { 2: 11, 3: 3, 4: 26 };                     // Zuschlag je Belegung: Baum, Fels, Haus

/** gleitend an p heranführen (Bildratenunabhängig genug für die Kamera) */
function follow(o, p, dt, rate) { const k = Math.min(1, dt * rate); o.x += (p.x - o.x) * k; o.z += (p.z - o.z) * k; }
function centroid(list) { let x = 0, z = 0; for (const u of list) { x += u.x; z += u.z; } return { x: x / list.length, z: z / list.length }; }
function turnTo(a, b, step) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + Math.max(-step, Math.min(step, d)); }
