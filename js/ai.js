// Computergegner: Basisaufbau, Wirtschaft, Armee, Angriffswellen, Verteidigung
import { CELL, MAPN, WORLD, BUILDINGS, UNITS, NUKE } from './config.js';
import { dist, dist2 } from './util.js';
import { baseWorld } from './terrain.js';

const ORDER = ['power', 'refinery', 'barracks', 'power', 'factory', 'radar', 'turret', 'refinery', 'power', 'samturret', 'turret', 'helipad', 'power', 'silo', 'turret', 'barracks', 'factory', 'power', 'samturret', 'turret', 'refinery', 'power', 'turret', 'power', 'tesla', 'prism'];

export class AI {
  constructor(game, player) {
    this.g = game; this.p = player;
    this.t = Math.random();
    this.step = 0;
    this.wave = 0;
    this.waveSize = player.diff.wave;
    this.home = baseWorld(player.id);
    this.attackCooldown = player.diff.first * (0.75 + 0.2 * player.id + Math.random() * 0.15); // Gegner greifen versetzt an // erste Welle erst nach einigen Minuten
    this.defendT = 0;
  }

  update(dt) {
    const g = this.g, p = this.p;
    if (!p.alive) return;
    this.t -= dt;
    this.attackCooldown -= dt;
    if (this.t > 0) return;
    this.t = p.diff.react;
    const mine = g.units.filter((u) => u.owner === p.id && !u.dead);
    const hq = g.buildings.find((b) => b.owner === p.id && b.type === 'hq' && !b.dead);
    // Mobile Basis entfalten
    if (!hq) {
      for (const u of mine) if (u.type === 'mcv' && !u.path.length) {
        if (!g.cmdDeploy(u)) g.cmdMove([u], u.x + (Math.random() - 0.5) * 30, u.z + (Math.random() - 0.5) * 30, false, true);
      }
    }
    if (hq) this.home = { x: hq.x, z: hq.z };
    this.build(hq);
    this.produce(mine);
    this.army(mine);
    this.useNuke();
  }

  /** Atomrakete auf die wertvollste gegnerische Gebäudegruppe (ohne eigene Gebäude im Wirkradius) */
  useNuke() {
    const g = this.g, p = this.p, s = g.readySilo(p);
    if (!s) return;
    let best = null, bv = 0;
    for (const b of g.buildings) {
      if (b.dead || b.owner === p.id || !g.players[b.owner].alive) continue;
      let v = 0, own = false;
      for (const o of g.buildings) {
        if (o.dead || dist(o.x, o.z, b.x, b.z) > NUKE.radius) continue;
        if (o.owner === p.id) own = true; else v += o.def.cost;
      }
      if (own) continue;
      if (g.players[b.owner].human) v /= p.diff.focus;   // Schwierigkeit: wie sehr der Mensch bevorzugt bzw. geschont wird
      if (v > bv) { bv = v; best = b; }
    }
    if (best) g.launchNuke(s, best.x + (Math.random() - 0.5) * 6, best.z + (Math.random() - 0.5) * 6);
  }

  build(hq) {
    const g = this.g, p = this.p, q = p.queues.bld, qd = p.queues.def;
    if (!hq) return;
    // fertige Gebäude platzieren
    for (const Q of [q, qd]) {
      if (Q.ready) {
        const spot = this.findSpot(Q.type);
        if (spot) g.placeReady(p, Q.type, spot[0], spot[1]);
        else { p.credits += Q.spent; Q.type = null; Q.ready = false; Q.spent = 0; Q.progress = 0; }
      }
    }
    if (!q.type) {
      let next = null;
      const rising = g.buildings.some((b) => b.owner === p.id && b.rise < 1 && !b.dead);
      if (!rising && (p.low || p.power.prod - p.power.use < 40)) next = 'power';
      else {
        while (this.step < ORDER.length) {
          const t = ORDER[this.step];
          if (t === 'silo' && !p.diff.nuke) { this.step++; continue; }   // Superwaffe nicht auf „Leicht“
          const have = p.count[t] || 0;
          const want = ORDER.slice(0, this.step + 1).filter((x) => x === t).length;
          if (have >= want) { this.step++; continue; }
          next = t; break;
        }
        if (!next && p.credits > 3000 && Math.random() < 0.3) next = Math.random() < 0.5 ? 'power' : 'refinery';
        // Flugfelder voll belegt: bis zu zwei weitere bauen, um die Luftflotte zu vergrößern
        if (!next && p.credits > 2500 && (p.count.helipad || 0) > 0 && (p.count.helipad || 0) < 3 && !g.freePad(p, true) && !g.freePad(p, false)) next = 'helipad';
      }
      if (next && BUILDINGS[next].key === 'def') { if (!qd.type && g.canBuild(p, next) && p.credits > BUILDINGS[next].cost * 0.5) g.queueItem(p, next); this.step++; }
      else if (next && g.canBuild(p, next) && p.credits > BUILDINGS[next].cost * 0.3) g.queueItem(p, next);
    }
  }

  findSpot(type) {
    const g = this.g, p = this.p, d = BUILDINGS[type];
    const hc = { x: Math.floor(this.home.x / CELL), z: Math.floor(this.home.z / CELL) };
    const c = WORLD / 2;
    const towards = Math.atan2(c - this.home.z, c - this.home.x);
    let best = null, bs = -1e9;
    for (let i = 0; i < 160; i++) {
      let a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 12;
      if (d.key === 'def') { a = towards + (Math.random() - 0.5) * 1.8; r = 8 + Math.random() * 6; }
      const cx = Math.round(hc.x + Math.cos(a) * r - d.w / 2), cz = Math.round(hc.z + Math.sin(a) * r - d.h / 2);
      if (!g.canPlace(p, type, cx, cz)) continue;
      // Abstand zu anderen Gebäuden halten (Wege frei)
      let s = -r * (d.key === 'def' ? 0 : 1);
      let tight = false;
      for (const b of g.buildings) if (b.owner === p.id && !b.dead) {
        if (cx < b.cx + b.w + 1 && cx + d.w > b.cx - 1 && cz < b.cz + b.h + 1 && cz + d.h > b.cz - 1) { tight = true; break; }
      }
      if (tight && d.key !== 'def') continue;
      if (type === 'refinery') { // nahe Erz
        const k = g.findOre((cx + 2) * CELL, (cz + 1) * CELL, null, 30);
        if (k >= 0) s -= Math.sqrt(dist2((cx + 2) * CELL, (cz + 1) * CELL, (k % MAPN) * CELL, Math.floor(k / MAPN) * CELL)) * 0.3;
      }
      s += Math.random();
      if (s > bs) { bs = s; best = [cx, cz]; }
    }
    return best;
  }

  produce(mine) {
    const g = this.g, p = this.p;
    const harv = mine.filter((u) => u.type === 'harvester').length;
    const refs = p.count.refinery || 0;
    const reserve = p.queues.bld.type ? 400 : 0;
    const fighters = mine.filter((u) => u.def.weapon && !u.def.cargo).length;
    const capped = fighters >= p.diff.army; // Truppen-Obergrenze je Schwierigkeit
    // Fahrzeuge
    const qv = p.queues.veh;
    if (qv.list.length < 2 && p.credits > reserve + 400) {
      let t = null;
      if (refs && harv < Math.min(refs * 2, 4) && g.canBuild(p, 'harvester')) t = 'harvester';
      else {
        const r = Math.random();
        if (capped) t = null; else if (r < 0.36) t = 'tank'; else if (r < 0.48) t = 'buggy'; else if (r < 0.65) t = 'ifv'; else if (r < 0.8) t = 'flak'; else t = g.canBuild(p, 'artillery') ? 'artillery' : 'tank';
        if (!(p.count.hq) && !mine.some((u) => u.type === 'mcv') && g.canBuild(p, 'mcv')) t = 'mcv';
      }
      if (t && g.canBuild(p, t)) g.queueItem(p, t);
    }
    const qi = p.queues.inf;
    if (!capped && qi.list.length < 2 && p.credits > reserve + 150 && g.canBuild(p, 'rifle')) g.queueItem(p, Math.random() < 0.55 ? 'rifle' : 'rocket');
    const qa = p.queues.air;
    if (!capped && qa.list.length < 1 && p.credits > reserve + 1500 && g.canBuild(p, 'heli') && Math.random() < p.diff.air) g.queueItem(p, g.canBuild(p, 'jet') && g.freePad(p, true) && Math.random() < 0.4 ? 'jet' : 'heli');
  }

  army(mine) {
    const g = this.g, p = this.p;
    const combat = mine.filter((u) => u.def.weapon && !u.def.cargo);
    // Verteidigung: kürzlich angegriffene eigene Objekte
    let threat = null;
    for (const b of g.buildings) if (b.owner === p.id && !b.dead && g.time - b.lastHit < 4 && b.attacker && !b.attacker.dead) { threat = b.attacker; break; }
    if (!threat) for (const u of mine) if (g.time - u.lastHit < 3 && u.attacker && !u.attacker.dead && dist(u.x, u.z, this.home.x, this.home.z) < 90) { threat = u.attacker; break; }
    const idle = combat.filter((u) => !u.order || u.order.type === 'move' && !u.path.length);
    if (threat) {
      const defenders = combat.filter((u) => dist(u.x, u.z, this.home.x, this.home.z) < 110 && (!u.order || u.order.type !== 'attack'));
      if (defenders.length) g.cmdAttack(defenders, threat);
    }
    // Sammeln
    const c = WORLD / 2;
    const ang = Math.atan2(c - this.home.z, c - this.home.x);
    const rally = { x: this.home.x + Math.cos(ang) * 40, z: this.home.z + Math.sin(ang) * 40 };
    for (const u of idle) if (!u.attacking && !u.def.jet && dist(u.x, u.z, rally.x, rally.z) > 25 && !u.target) g.cmdMove([u], rally.x + (Math.random() - 0.5) * 20, rally.z + (Math.random() - 0.5) * 20, false, true);
    // Angriffswelle
    const ready = combat.filter((u) => !u.attacking);
    if (ready.length >= this.waveSize && this.attackCooldown <= 0) {
      const target = this.pickTarget();
      if (target) {
        // nur die Wellengröße losschicken, der Rest bleibt zur Verteidigung daheim
        ready.sort((a, b) => dist2(a.x, a.z, target.x, target.z) - dist2(b.x, b.z, target.x, target.z));
        const wave = ready.slice(0, this.waveSize);
        g.cmdMove(wave, target.x, target.z, true, true);
        for (const u of wave) { u.attacking = true; u.waveTarget = target.id; }
        this.wave++;
        this.waveSize = Math.min(p.diff.max, p.diff.wave + this.wave * p.diff.grow);
        this.attackCooldown = p.diff.cool * (0.85 + Math.random() * 0.3);
      }
    }
    // Angreifer ohne Auftrag weiterschicken
    for (const u of combat) if (u.attacking && !u.order && !u.target) {
      const t = this.pickTarget(u);
      if (t) g.cmdMove([u], t.x, t.z, true, true);
    }
  }

  pickTarget(from) {
    const g = this.g, p = this.p;
    const o = from || this.home;
    let best = null, bd = 1e18;
    for (const b of g.buildings) {
      if (b.owner === p.id || b.dead) continue;
      let d = dist2(o.x, o.z, b.x, b.z);
      if (b.owner === 0) d *= p.diff.focus; // Vorliebe für den Menschen je nach Stufe
      if (b.def.weapon) d *= 1.3;
      if (b.def.wall) d *= 6;
      if (d < bd) { bd = d; best = b; }
    }
    if (!best) for (const u of g.units) if (u.owner !== p.id && !u.dead) { const d = dist2(o.x, o.z, u.x, u.z); if (d < bd) { bd = d; best = u; } }
    return best;
  }
}
