// Geländegenerierung: Höhen, Splat-Texturierung, Wasser, Passierbarkeit, Erz, Vegetation
import * as THREE from 'three';
import { CELL, MAPN, WORLD, MARGIN, WATER_LEVEL, ORE_MAX, MAPS } from './config.js';
import { mulberry32, makeNoise, smooth, clamp, lerp } from './util.js';
import { A, makeInstanced } from './assets.js';
import { FOG, FOG_VERT_HEAD, FOG_VERT_BODY, FOG_FRAG_HEAD, FOG_FRAG_BODY, patchMaterial } from './fog.js';

const RES = 2;                              // Meter pro Höhenstützpunkt
const L = WORLD + MARGIN * 2;
const N = Math.round(L / RES) + 1;           // Stützpunkte pro Kante

export const BASE_CELLS = [[18, 18], [MAPN - 18, MAPN - 18], [MAPN - 18, 18], [18, MAPN - 18]];
export const baseWorld = (i) => ({ x: (BASE_CELLS[i][0] + 0.5) * CELL, z: (BASE_CELLS[i][1] + 0.5) * CELL });

// Stadtkarte: Straßenraster (alle SP Zellen eine SW Zellen breite Straße ab Zelle SO), dazwischen Blöcke von 9 x 9 Zellen
const SP = 12, SW = 3, SO = 3;
const streetCell = (c) => ((c - SO) % SP + SP) % SP < SW;
/** Abstand (m) zur nächsten Straßenachse */
const streetDist = (m) => { const p = SP * CELL, d = (((m - (SO + SW / 2) * CELL) % p) + p) % p; return Math.min(d, p - d); };
// Grundflächen der Stadthäuser in Zellen [Breite, Tiefe] - passend zu tools/blender_city.py
const CITY = { c_house1: [3, 3], c_house2: [4, 3], c_house3: [3, 3], c_rowhouse: [6, 3], c_apartment: [7, 3], c_apartment2: [5, 3], c_tower_res: [4, 4],
  c_tower_office: [4, 4], c_office: [6, 4], c_market: [7, 4], c_shops: [5, 3], c_factory: [7, 5], c_hall: [6, 4], c_warehouse: [6, 4] };

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const t = clamp(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

export class Terrain {
  constructor(seed, nPlayers) {
    this.seed = seed;
    const R0 = mulberry32(seed * 7 + 3);
    this.profile = MAPS[seed] || { name: 'Zufall', ridge: 0.5 + R0() * 1.0, lake: 0.4 + R0() * 1.1, forest: 0.12 + R0() * 0.14, roads: 1 + Math.floor(R0() * 3) };
    this.city = !!this.profile.city; this.snow = !!this.profile.snow;
    A.snow = this.snow;   // Bäume/Büsche bekommen Schnee (assets.js treeMaterial)
    this.rand = mulberry32(seed);
    this.noise = makeNoise(this.rand);
    this.nPlayers = nPlayers;
    this.h = new Float32Array(N * N);
    this.passable = new Uint8Array(MAPN * MAPN);   // Gelände
    this.blocked = new Uint8Array(MAPN * MAPN);    // Gebäude/Bäume (Belegung)
    this.ore = new Float32Array(MAPN * MAPN);
    this.oreMax = new Float32Array(MAPN * MAPN);
    this.dirtMask = new Float32Array(N * N);
    this.generate();
  }

  // -------------------------------------------------------------- Höhen
  maskAt(x, z) {
    // 1 = Basis/Fahrweg (flach halten), 0 = freie Natur
    if (this.city && x > 0 && z > 0 && x < WORLD && z < WORLD) return 1;   // Stadt: ganze Spielfläche eben und frei von Wildwuchs
    const c = WORLD / 2;
    let m = 0;
    for (let i = 0; i < 4; i++) {
      const b = baseWorld(i);
      m = Math.max(m, 1 - smooth(44, 70, Math.hypot(x - b.x, z - b.z)));
    }
    m = Math.max(m, 1 - smooth(30, 52, Math.hypot(x - c, z - c)));
    for (const r of this.roadSegs) {
      if (x < r.x0 - r.w1 || x > r.x1 + r.w1 || z < r.z0 - r.w1 || z > r.z1 + r.w1) continue;
      m = Math.max(m, 1 - smooth(r.w0, r.w1, segDist(x, z, r.ax, r.az, r.bx, r.bz)));
    }
    for (const f of this.oreFields) m = Math.max(m, 1 - smooth(f.r * CELL + 4, f.r * CELL + 14, Math.hypot(x - f.x, z - f.z)));
    return m;
  }

  rawHeight(x, z) {
    const n = this.noise;
    let h = n.fbm(x / 110, z / 110, 4) * 2.6 + n.fbm(x / 28 + 9, z / 28 - 3, 3) * 0.55;
    const m = this.maskAt(x, z);
    const ridge = n.fbm(x / 120 + 100, z / 120 - 40, 3);
    const P = this.profile;
    h += P.ridge * (7.5 * smooth(0.22, 0.34, ridge) + 2.5 * smooth(0.45, 0.6, ridge)) * (1 - m);
    const lake = n.fbm(x / 105 - 50, z / 105 + 20, 3);
    const lt = 0.36 - 0.13 * (P.lake - 1);
    h -= 4.5 * Math.min(1.3, P.lake) * smooth(lt - 0.11, lt, lake) * (1 - m) * (1 - smooth(0.2, 0.3, ridge));
    // Wege/Basen nie unter Wasser (Dämme durch Seen)
    h = lerp(h, Math.max(h, WATER_LEVEL + 1.1), smooth(0.3, 0.8, m));
    // Rand: Berge außerhalb der Spielfläche
    const ox = Math.max(0, -x, x - WORLD), oz = Math.max(0, -z, z - WORLD);
    const out = Math.hypot(ox, oz);
    if (out > 0) h += out * 0.28 + smooth(0, 40, out) * (8 + n.fbm(x / 30, z / 30, 3) * 10);
    if (this.city) h = lerp(h, 0.4, 0.94 * (1 - smooth(0, 30, out)));   // Stadt liegt eben
    // Basen flach
    for (let i = 0; i < 4; i++) {
      const b = baseWorld(i);
      const k = 1 - smooth(34, 52, Math.hypot(x - b.x, z - b.z));
      h = lerp(h, 0.4, k * 0.85);
    }
    return h;
  }

  generate() {
    const R = this.rand;
    // Erzfelder festlegen (vor Höhen, da Maske sie flach hält)
    const c = WORLD / 2;
    this.oreFields = [];
    for (let i = 0; i < 4; i++) {
      const b = baseWorld(i);
      const dx = c - b.x, dz = c - b.z, l = Math.hypot(dx, dz);
      // seitlich versetzt Richtung Kartenmitte
      const px = -dz / l, pz = dx / l;
      this.oreFields.push({ x: b.x + dx / l * 62 + px * 26, z: b.z + dz / l * 62 + pz * 26, r: 3.2 });
    }
    for (let i = 0; i < 4; i++) { // zweites Feld weiter draußen
      const b = baseWorld(i);
      const dx = c - b.x, dz = c - b.z, l = Math.hypot(dx, dz);
      const px = -dz / l, pz = dx / l;
      this.oreFields.push({ x: b.x + dx / l * 105 - px * 48, z: b.z + dz / l * 105 - pz * 48, r: 3 });
    }
    this.oreFields.push({ x: c, z: c, r: 5.5 });
    const E = 62;
    this.oreFields.push({ x: c, z: E, r: 3.6 }, { x: c, z: WORLD - E, r: 3.6 }, { x: E, z: c, r: 3.6 }, { x: WORLD - E, z: c, r: 3.6 });
    this.buildRoads();
    for (let pass = 0; pass < 3; pass++) {
      this.computeHeights();
      const miss = this.unreachable();
      if (!miss.length) break;
      console.warn('Karte: unerreichbare Punkte, ergänze Wege', miss.length);
      for (const t of miss) this.addRoad([[t.x, t.z], [c, c]], 7, 16);
    }
    if (this.city) this.layoutCity();
    // Erz
    for (const f of this.oreFields) {
      const fx = f.x / CELL, fz = f.z / CELL;
      for (let cz = Math.floor(fz - f.r - 1); cz <= fz + f.r + 1; cz++) for (let cx = Math.floor(fx - f.r - 1); cx <= fx + f.r + 1; cx++) {
        if (cx < 0 || cz < 0 || cx >= MAPN || cz >= MAPN) continue;
        const d = Math.hypot(cx + 0.5 - fx, cz + 0.5 - fz) + (R() - 0.5) * 1.2;
        if (d < f.r && this.passable[cz * MAPN + cx]) {
          const k = cz * MAPN + cx;
          this.ore[k] = this.oreMax[k] = ORE_MAX * (0.55 + 0.45 * (1 - d / f.r));
        }
      }
    }
  }

  /** Stadt anlegen: je Block (9 x 9 Zellen zwischen den Straßen) zwei Häuserzeilen. Hohe Häuser stehen in der Südzeile,
   *  niedrige in der Nordzeile - so verdeckt aus der Spielkamera (Blick nach Norden) kein Hochhaus eine Straße.
   *  Viertel: Zentrum (Hochhäuser, Büros, Läden), Wohnring, Industrie im Westen und Osten, Vorstadt mit Parks. */
  layoutCity() {
    const R = this.rand, c = MAPN / 2;
    this.cityItems = []; this.cityTrees = [];
    const pick = (a) => a[Math.floor(R() * a.length)];
    const put = (id, cx, cz) => {
      const [w, d] = CITY[id];
      for (let z = cz; z < cz + d; z++) for (let x = cx; x < cx + w; x++) this.blocked[z * MAPN + x] = 4;
      this.cityItems.push({ id, x: (cx + w / 2) * CELL, z: (cz + d / 2) * CELL, r: 0 });
    };
    /** Zeile von links nach rechts füllen; Häuser stehen an der Südkante der Zeile */
    const row = (bx, z0, depth, ids, gap) => {
      let x = bx, n = 0;
      while (x < bx + 9) {
        if (R() < gap) { x += 2; continue; }
        const fit = ids.filter((id) => CITY[id][0] <= bx + 9 - x && CITY[id][1] <= depth);
        if (!fit.length) break;
        const id = pick(fit);
        put(id, x, z0 + depth - CITY[id][1]);
        x += CITY[id][0] + (R() < 0.5 ? 1 : 0); n++;
      }
      return n;
    };
    const ZONES = {
      down: { s: ['c_tower_office', 'c_tower_office', 'c_tower_res', 'c_office', 'c_office', 'c_market'], n: ['c_shops', 'c_shops', 'c_apartment2', 'c_rowhouse'], sd: 4, gap: 0.08 },
      res: { s: ['c_apartment', 'c_apartment', 'c_apartment2', 'c_apartment2', 'c_tower_res', 'c_rowhouse', 'c_market'], n: ['c_house1', 'c_house2', 'c_house3', 'c_rowhouse', 'c_shops'], sd: 4, gap: 0.12 },
      ind: { s: ['c_factory', 'c_hall', 'c_hall', 'c_warehouse'], n: ['c_shops', 'c_house1'], sd: 5, gap: 0.2, ngap: 0.6 },
      sub: { s: ['c_house1', 'c_house2', 'c_house3'], n: ['c_house1', 'c_house2', 'c_house3'], sd: 3, gap: 0.35 },
    };
    const lampAt = (x, z, r) => this.cityItems.push({ id: 'c_lamp', x, z, r });
    for (let bz = SO + SW; bz + 9 <= MAPN - 2; bz += SP) for (let bx = SO + SW; bx + 9 <= MAPN - 2; bx += SP) {
      const mx = bx + 4.5, mz = bz + 4.5;
      if (BASE_CELLS.some(([x, z]) => Math.hypot(mx - x, mz - z) < 27)) continue;                       // Bauland der Basen
      if (this.oreFields.some((f) => Math.hypot(mx - f.x / CELL, mz - f.z / CELL) < f.r + 8.5)) continue; // Erzfelder
      const d = Math.hypot(mx - c, mz - c);
      const zone = d < 27 ? 'down' : Math.abs(mx - c) > 40 && Math.abs(mz - c) < 30 ? 'ind' : d < 58 ? 'res' : 'sub';
      const Z = ZONES[zone];
      // Laternen an den vier Blockecken (leuchten zur Straße)
      for (const lx of [bx * CELL + 1.5, (bx + 9) * CELL - 1.5]) { lampAt(lx, bz * CELL + 0.6, Math.PI); lampAt(lx, (bz + 9) * CELL - 0.6, 0); }
      const park = zone === 'sub' ? R() < 0.45 : zone === 'res' ? R() < 0.12 : false;
      if (park) {   // Park: Tannen, frei begehbare Wege dazwischen
        for (let z = bz + 1; z < bz + 8; z++) for (let x = bx + 1; x < bx + 8; x++) if (R() < 0.3) {
          this.blocked[z * MAPN + x] = 2;
          this.cityTrees.push({ x: (x + 0.5) * CELL + (R() - 0.5) * 1.5, z: (z + 0.5) * CELL + (R() - 0.5) * 1.5 });
        }
        continue;
      }
      row(bx, bz + 9 - Z.sd, Z.sd, Z.s, Z.gap);                 // Südzeile (hohe Häuser)
      row(bx, bz + 1, 3, Z.n, Z.ngap ?? Z.gap + 0.1);           // Nordzeile (niedrige Häuser)
      // Hof zwischen den Zeilen: geparkte Autos, einzelne Tannen
      for (let i = 0, n = 1 + Math.floor(R() * 4); i < n; i++) {
        const x = bx + 0.6 + R() * 7.8, z = bz + (R() < 0.75 ? 4.5 : 0.45);
        if (this.blocked[Math.floor(z) * MAPN + Math.floor(x)]) continue;
        this.cityItems.push({ id: 'c_car' + (1 + Math.floor(R() * 3)), x: x * CELL, z: z * CELL, r: (R() < 0.6 ? 0 : Math.PI / 2) + (R() - 0.5) * 0.2 });
      }
      if (R() < 0.5) {
        const x = bx + Math.floor(R() * 9), z = bz;
        if (!this.blocked[z * MAPN + x]) { this.blocked[z * MAPN + x] = 2; this.cityTrees.push({ x: (x + 0.5) * CELL, z: (z + 0.5) * CELL }); }
      }
    }
  }

  /** Wegenetz: Basen -> Mitte, Ring über die Kantenmitten, je nach Profil weitere Querverbindungen */
  buildRoads() {
    const c = WORLD / 2, E = 92, lvl = this.profile.roads;
    this.roads = []; this.roadSegs = [];
    if (this.city) return;   // Stadt: Straßenraster statt Feldwege
    const B = [0, 1, 2, 3].map((i) => { const b = baseWorld(i); return [b.x, b.z]; });
    const M = { t: [c, E], r: [WORLD - E, c], b: [c, WORLD - E], l: [E, c] };
    const C = [c, c];
    for (const b of B) this.addRoad([b, C], 9, 21);
    // Ring: 0 (oben links) - oben - 2 (oben rechts) - rechts - 1 - unten - 3 - links - 0
    for (const [a, m, b] of [[B[0], M.t, B[2]], [B[2], M.r, B[1]], [B[1], M.b, B[3]], [B[3], M.l, B[0]]]) { this.addRoad([a, m], 7, 17); this.addRoad([m, b], 7, 17); }
    if (lvl >= 2) for (const m of Object.values(M)) this.addRoad([m, C], 7, 17);
    if (lvl >= 3) for (const [a, b] of [[M.t, M.r], [M.r, M.b], [M.b, M.l], [M.l, M.t]]) this.addRoad([a, b], 6, 15);
  }
  addRoad([a, b], w0, w1) {
    const R = this.rand, n = 6, pts = [];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz), px = -dz / l, pz = dx / l;
    for (let i = 0; i <= n; i++) {
      const t = i / n, off = (i === 0 || i === n) ? 0 : (R() - 0.5) * Math.min(26, l * 0.12);
      pts.push([a[0] + dx * t + px * off, a[1] + dz * t + pz * off]);
    }
    this.roads.push({ pts, w0, w1 });
    for (let i = 0; i < n; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      this.roadSegs.push({ ax, az, bx, bz, w0, w1, x0: Math.min(ax, bx), x1: Math.max(ax, bx), z0: Math.min(az, bz), z1: Math.max(az, bz) });
    }
  }
  /** Breitensuche ab Basis 0: welche Basen/Erzfelder sind nicht erreichbar? */
  unreachable() {
    const seen = new Uint8Array(MAPN * MAPN), q = new Int32Array(MAPN * MAPN);
    const [sx, sz] = BASE_CELLS[0];
    let h = 0, t = 0; q[t++] = sz * MAPN + sx; seen[q[0]] = 1;
    while (h < t) {
      const k = q[h++], x = k % MAPN, z = (k / MAPN) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= MAPN || nz >= MAPN) continue;
        const nk = nz * MAPN + nx;
        if (!seen[nk] && this.passable[nk]) { seen[nk] = 1; q[t++] = nk; }
      }
    }
    const pts = [1, 2, 3].map((i) => baseWorld(i)).concat(this.oreFields);
    return pts.filter((p) => !seen[Math.floor(p.z / CELL) * MAPN + Math.floor(p.x / CELL)]);
  }

  computeHeights() {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = -MARGIN + i * RES, z = -MARGIN + j * RES;
      this.h[j * N + i] = this.rawHeight(x, z);
    }
    // leichte Glättung
    const tmp = new Float32Array(this.h);
    for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
      const k = j * N + i;
      this.h[k] = (tmp[k] * 4 + tmp[k - 1] + tmp[k + 1] + tmp[k - N] + tmp[k + N]) / 8;
    }
    // Passierbarkeit je Zelle
    for (let cz = 0; cz < MAPN; cz++) for (let cx = 0; cx < MAPN; cx++) {
      let mn = 1e9, mx = -1e9;
      for (let sz = 0; sz <= 2; sz++) for (let sx = 0; sx <= 2; sx++) {
        const hh = this.heightAt(cx * CELL + sx * CELL / 2, cz * CELL + sz * CELL / 2);
        mn = Math.min(mn, hh); mx = Math.max(mx, hh);
      }
      this.passable[cz * MAPN + cx] = (mn > WATER_LEVEL + 0.15 && mx - mn < 2.6) ? 1 : 0;
    }
  }

  heightAt(x, z) {
    const gx = clamp((x + MARGIN) / RES, 0, N - 1.001), gz = clamp((z + MARGIN) / RES, 0, N - 1.001);
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j;
    const k = j * N + i, h = this.h;
    return lerp(lerp(h[k], h[k + 1], fx), lerp(h[k + N], h[k + N + 1], fx), fz);
  }
  normalAt(x, z, out = new THREE.Vector3()) {
    const e = 1.5;
    return out.set(this.heightAt(x - e, z) - this.heightAt(x + e, z), 2 * e, this.heightAt(x, z - e) - this.heightAt(x, z + e)).normalize();
  }
  isPassable(cx, cz) { return cx >= 0 && cz >= 0 && cx < MAPN && cz < MAPN && this.passable[cz * MAPN + cx] === 1 && this.blocked[cz * MAPN + cx] === 0; }

  // -------------------------------------------------------------- Mesh
  build(scene) {
    const geo = new THREE.PlaneGeometry(L, L, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(WORLD / 2, 0, WORLD / 2);
    const pos = geo.attributes.position;
    // PlaneGeometry: Reihenfolge Zeilen von -z nach +z nach rotateX? -> Position direkt abgleichen
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v);
      pos.setY(v, this.heightAt(x, z));
    }
    geo.computeVertexNormals();
    this.geo = geo;
    this.computeSplat();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const T = A.tex;
    const snow = this.snow;   // Winter: Schneefeld, Schnee, Fels, Asphalt (Straßen), zertrampelte Erde (Basen)
    const sets = snow ? ['snow_field_aerial', 'snow_02', 'aerial_rocks_02', 'asphalt_snow', 'aerial_ground_rock']
      : ['sparse_grass', 'aerial_grass_rock', 'aerial_rocks_02', 'coast_sand_01', 'aerial_ground_rock'];
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, FOG.uniforms);
      sets.forEach((s, i) => { sh.uniforms['tD' + i] = { value: T[s].diff }; sh.uniforms['tN' + i] = { value: T[s].nor }; });
      sh.vertexShader = FOG_VERT_HEAD + 'attribute vec4 splat; varying vec4 vSplat; varying vec3 vTW; varying vec3 vTN;\n' +
        sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + FOG_VERT_BODY +
          'vSplat = splat; vTW = (modelMatrix * vec4(transformed,1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = FOG_FRAG_HEAD +
        'uniform sampler2D tD0,tD1,tD2,tD3,tD4,tN0,tN1,tN2,tN3,tN4; varying vec4 vSplat; varying vec3 vTW; varying vec3 vTN;\n' +
        sh.fragmentShader
          .replace('#include <map_fragment>', `
            vec2 tuv = vTW.xz / 9.0;
            vec2 ruv = vTW.xz / 14.0 + vec2(vTW.y * 0.08);
            vec4 sw = vSplat;
            float wBase = clamp(1.0 - sw.x - sw.y - sw.z - sw.w, 0.0, 1.0);
            float macro = texture2D(tD0, vTW.xz / 97.0).g;
            vec3 bw = pow(abs(normalize(vTN)), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
            vec3 rockC = texture2D(tD2, vTW.zy / 14.0).rgb * bw.x + texture2D(tD2, ruv).rgb * bw.y + texture2D(tD2, vTW.xy / 14.0).rgb * bw.z;
            float mix2 = smoothstep(0.3, 0.62, texture2D(tD1, vTW.xz / 61.0).g);
            vec3 d1 = texture2D(tD4, tuv * 0.7).rgb, d2 = texture2D(tD4, vec2(tuv.y, -tuv.x) * 0.29 + 0.37).rgb;
            vec3 dirtC = mix(min(d1, d2 * 1.08), d1, 0.2);   // helle Steine der Kachel fallen weg -> kein sichtbares Raster
            vec3 grassC = mix(texture2D(tD0, tuv).rgb, texture2D(tD0, vec2(-tuv.y, tuv.x) * 0.37 + 0.21).rgb, 1.0 - mix2);
            ${snow ? `rockC = mix(rockC, vec3(0.86, 0.89, 0.93), smoothstep(0.55, 0.9, normalize(vTN).y) * 0.75);
            dirtC = mix(dirtC, grassC * vec3(0.8, 0.78, 0.76), 0.5);
            grassC *= vec3(0.9, 0.93, 0.98);` : ''}
            vec3 col = grassC * wBase + texture2D(tD1, tuv * 0.8).rgb * sw.x${snow ? ' * vec3(0.88, 0.92, 0.98)' : ''}
                     + rockC * sw.y + texture2D(tD3, tuv * ${snow ? '2.2' : '1.4'}).rgb${snow ? ' * vec3(0.5, 0.52, 0.57)' : ''} * sw.z
                     + min(dirtC, vec3(0.55)) * vec3(0.92, 0.84, 0.74) * sw.w;
            ${this.city ? `{   // Stadt: gestrichelte Mittellinie auf den Straßen (Raster 48 m, Achse bei 18 m), nicht auf Kreuzungen
              vec2 sd = abs(mod(vTW.xz - 18.0 + 24.0, 48.0) - 24.0);
              float lane = 0.0;
              if (sd.y > 7.5) lane = (1.0 - smoothstep(0.1, 0.22, sd.x)) * step(0.5, fract(vTW.z / 6.0));
              if (sd.x > 7.5) lane = max(lane, (1.0 - smoothstep(0.1, 0.22, sd.y)) * step(0.5, fract(vTW.x / 6.0)));
              float edge = (1.0 - smoothstep(0.0, 0.5, abs(min(sd.x, sd.y) - 5.3))) * 0.5;   // Schneewall am Fahrbahnrand
              col = mix(col, vec3(0.8, 0.83, 0.87), max(lane * 0.6, edge) * sw.z);
            }` : ''}
            col *= 0.78 + macro * 0.55;
            diffuseColor.rgb = col;
          `)
          .replace('#include <normal_fragment_maps>', `
            vec3 tn = (texture2D(tN0, tuv).xyz * 2.0 - 1.0) * wBase + (texture2D(tN1, tuv * 0.8).xyz * 2.0 - 1.0) * sw.x
                    + (texture2D(tN2, ruv).xyz * 2.0 - 1.0) * sw.y + (texture2D(tN3, tuv * 1.4).xyz * 2.0 - 1.0) * sw.z
                    + (texture2D(tN4, tuv * 0.7).xyz * 2.0 - 1.0) * sw.w;
            vec3 wn = normalize(normalize(vTN) * max(tn.z, 0.2) + vec3(tn.x, 0.0, -tn.y) * 1.2);
            normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
          `)
          .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(0.97, 0.55, 1.0 - smoothstep(-1.6, -0.6, vTW.y));')
          .replace('#include <dithering_fragment>', FOG_FRAG_BODY + '\n#include <dithering_fragment>');
    };
    mat.customProgramCacheKey = () => 'terrain' + (snow ? 'Snow' : '') + (this.city ? 'City' : '');
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.name = 'terrain';
    scene.add(mesh);
    this.mesh = mesh;

    // Wasser
    const wgeo = new THREE.PlaneGeometry(L, L, 1, 1);
    wgeo.rotateX(-Math.PI / 2);
    wgeo.translate(WORLD / 2, WATER_LEVEL, WORLD / 2);
    const wn = T.water.clone(); wn.needsUpdate = true; wn.repeat.set(L / 18, L / 18);
    const wmat = new THREE.MeshStandardMaterial({ color: 0x16323a, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.86, normalMap: wn, envMapIntensity: 1.3 });
    wmat.normalScale.set(0.35, 0.35);
    if (snow) { wmat.color.set(0xa4bcc8); wmat.opacity = 0.95; wmat.roughness = 0.28; wmat.normalScale.set(0.12, 0.12); }   // zugefroren
    patchMaterial(wmat);
    this.water = new THREE.Mesh(wgeo, wmat);
    this.water.receiveShadow = true;
    scene.add(this.water);

    this.buildOre(scene);
    this.buildVegetation(scene);
    if (this.city) this.buildCity(scene);
  }

  computeSplat() {
    const pos = this.geo.attributes.position;
    const splat = new Float32Array(pos.count * 4);
    const n = this.noise, c = WORLD / 2;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), z = pos.getZ(v), h = pos.getY(v);
      const nx = this.geo.attributes.normal.getY(v);
      const slope = Math.sqrt(Math.max(0, 1 - nx * nx)) / Math.max(nx, 0.05);
      let rock = smooth(0.38, 0.75, slope);
      const outside = Math.max(0, -x, x - WORLD, -z, z - WORLD);
      rock = Math.max(rock, smooth(15, 45, outside) * smooth(-0.2, 0.3, n(x / 25, z / 25)));
      let sand = smooth(WATER_LEVEL + 1.3, WATER_LEVEL + 0.3, h) * (1 - rock);
      let dirt = 0, nearBase = 1e9;
      for (let i = 0; i < 4; i++) { const b = baseWorld(i); nearBase = Math.min(nearBase, Math.hypot(x - b.x, z - b.z)); }
      if (this.city && outside <= 0) {   // Asphalt der Straßen (belegt den Sand-Kanal), läuft an den Basen aus
        const a = (1 - smooth(5.0, 6.4, Math.min(streetDist(x), streetDist(z)) + n(x / 5, z / 5) * 0.6)) * smooth(50, 80, nearBase);
        sand = Math.max(sand, a * 0.96);
      }
      for (let i = 0; i < this.nPlayers; i++) {
        const b = baseWorld(i);
        dirt = Math.max(dirt, 1 - smooth(26, 40, Math.hypot(x - b.x, z - b.z) + n(x / 9, z / 9) * 6));
      }
      const wob = n(x / 7, z / 7) * 2.5;
      for (const r of this.roadSegs) {
        if (x < r.x0 - 10 || x > r.x1 + 10 || z < r.z0 - 10 || z > r.z1 + 10) continue;
        const rw = r.w0 * 0.42;
        dirt = Math.max(dirt, (1 - smooth(rw, rw + 4, segDist(x, z, r.ax, r.az, r.bx, r.bz) + wob)) * 0.95);
      }
      for (const f of this.oreFields) dirt = Math.max(dirt, 1 - smooth(f.r * CELL - 2, f.r * CELL + 6, Math.hypot(x - f.x, z - f.z) + n(x / 6, z / 6) * 3));
      dirt *= (1 - rock) * (1 - sand);
      const g2 = smooth(0.0, 0.45, n.fbm(x / 45 + 7, z / 45 - 2, 3)) * (1 - rock) * (1 - sand) * (1 - dirt);
      // Normieren
      let s = g2 + rock + sand + dirt;
      const k = s > 1 ? 1 / s : 1;
      splat[v * 4] = g2 * k; splat[v * 4 + 1] = rock * k; splat[v * 4 + 2] = sand * k; splat[v * 4 + 3] = dirt * k;
    }
    this.geo.setAttribute('splat', new THREE.BufferAttribute(splat, 4));
  }

  /** Bereich für Gebäude einebnen */
  flatten(x0, z0, x1, z1, hh) {
    const i0 = Math.max(0, Math.floor((x0 + MARGIN) / RES) - 1), i1 = Math.min(N - 1, Math.ceil((x1 + MARGIN) / RES) + 1);
    const j0 = Math.max(0, Math.floor((z0 + MARGIN) / RES) - 1), j1 = Math.min(N - 1, Math.ceil((z1 + MARGIN) / RES) + 1);
    const pos = this.geo.attributes.position;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = -MARGIN + i * RES, z = -MARGIN + j * RES;
      const inside = x >= x0 && x <= x1 && z >= z0 && z <= z1;
      const k = j * N + i;
      this.h[k] = inside ? hh : lerp(this.h[k], hh, 0.5);
      pos.setY(k, this.h[k]);
    }
    pos.needsUpdate = true;
    this.geo.computeVertexNormals();
  }

  // -------------------------------------------------------------- Erz
  buildOre(scene) {
    const cells = [];
    for (let k = 0; k < this.ore.length; k++) if (this.oreMax[k] > 0) cells.push(k);
    this.oreCells = cells;
    const R = this.rand;
    this.oreSets = ['ore1', 'ore2', 'ore3'].map((id) => makeInstanced(A.models[id].scene, cells.length, { team: 0 }));
    this.oreInfo = cells.map((k) => ({ k, set: Math.floor(R() * 3), rot: R() * 6.28, ox: (R() - 0.5) * 1.2, oz: (R() - 0.5) * 1.2, idx: 0 }));
    const counts = [0, 0, 0];
    for (const o of this.oreInfo) o.idx = counts[o.set]++;
    for (const s of this.oreSets) for (const p of s.parts) scene.add(p);
    this.oreSets.forEach((s, i) => s.setCount(counts[i]));
    this.updateOreVisuals();
  }
  updateOreVisuals() {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
    for (const o of this.oreInfo) {
      const cx = o.k % MAPN, cz = Math.floor(o.k / MAPN);
      const amt = this.ore[o.k] / ORE_MAX;
      const x = (cx + 0.5) * CELL + o.ox, z = (cz + 0.5) * CELL + o.oz;
      const sc = amt > 0.02 ? 0.45 + amt * 0.75 : 0.0001;
      p.set(x, this.heightAt(x, z) - 0.15, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
      s.set(sc, sc * (0.7 + amt * 0.5), sc);
      m.compose(p, q, s);
      this.oreSets[o.set].setMatrix(o.idx, m);
    }
    this.oreSets.forEach((s) => s.update());
  }
  regrowOre(dt) {
    let changed = false;
    for (const k of this.oreCells) {
      if (this.ore[k] < this.oreMax[k]) { this.ore[k] = Math.min(this.oreMax[k], this.ore[k] + dt * 0.3); changed = true; }
    }
    return changed;
  }

  // -------------------------------------------------------------- Vegetation & Requisiten
  buildVegetation(scene) {
    const R = this.rand, n = this.noise;
    const place = {}; // id -> [{x,z,s,r,c}]
    const add = (id, x, z, s, extra = {}) => { (place[id] ||= []).push({ x, z, s, r: R() * Math.PI * 2, ...extra }); };
    const nearImportant = (x, z) => this.maskAt(x, z) > 0.35;
    const trees = ['pine1', 'pine2', 'pine3', 'tree1', 'tree2', 'tree3'], BUSH = ['bush1', 'bush2', 'bush3'];
    const TN = this.snow ? 3 : 6;   // im Winter nur Nadelbäume
    for (const t of this.cityTrees || []) add(trees[Math.floor(R() * 3)], t.x, t.z, 0.75 + R() * 0.4, { col: true });
    // Spielfläche
    for (let cz = 0; cz < MAPN; cz++) for (let cx = 0; cx < MAPN; cx++) {
      const k = cz * MAPN + cx;
      const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
      if (this.oreMax[k] > 0) continue;
      const forest = n.fbm(x / 55 + 200, z / 55 + 13, 3);
      const imp = nearImportant(x, z);
      if (this.passable[k] && !imp && forest > this.profile.forest && R() < 0.75) {
        const pine = n(x / 70, z / 70) > -0.1;
        const id = trees[(pine || this.snow ? 0 : 3) + Math.floor(R() * 3)];
        add(id, x + (R() - 0.5) * 1.5, z + (R() - 0.5) * 1.5, 0.8 + R() * 0.45, { col: true });
        this.blocked[k] = 2; // Baum
        if (R() < 0.5) add(BUSH[Math.floor(R() * 3)], x + (R() - 0.5) * 3, z + (R() - 0.5) * 3, 0.7 + R() * 0.6, { col: true });
      } else if (!this.passable[k]) {
        const h = this.heightAt(x, z);
        if (h > WATER_LEVEL + 0.5 && R() < 0.3) add(['namaqualand_boulder_02', 'namaqualand_boulder_05', 'namaqualand_boulder_02'][Math.floor(R() * 3)], x + (R() - 0.5) * 2, z + (R() - 0.5) * 2, 1.2 + R() * 1.6);
        else if (h > WATER_LEVEL + 0.5 && R() < 0.12) add(trees[Math.floor(R() * TN)], x, z, 0.8 + R() * 0.4, { col: true });
      } else if (!imp) {
        const r = R();
        if (r < 0.025) { add(trees[Math.floor(R() * TN)], x, z, 0.75 + R() * 0.5, { col: true }); this.blocked[k] = 2; }
        else if (r < 0.06) add(BUSH[Math.floor(R() * 3)], x + (R() - 0.5) * 2, z + (R() - 0.5) * 2, 0.6 + R() * 0.7, { col: true });
        else if (r < 0.075) { add(['namaqualand_boulder_05', 'namaqualand_boulder_02', 'rock_moss_set_01'][Math.floor(R() * 3)], x, z, 0.8 + R() * 0.8); this.blocked[k] = 3; }
        else if (r < 0.08) add(['dead_tree_trunk', 'tree_stump_01', 'quiver_tree_02'][Math.floor(R() * 3)], x, z, 1 + R() * 0.4);
      } else if (R() < 0.012 && this.maskAt(x, z) < 0.8) {
        add(BUSH[Math.floor(R() * 3)], x + (R() - 0.5) * 2, z + (R() - 0.5) * 2, 0.5 + R() * 0.4, { col: true });
      }
    }
    // Außenbereich (dichter Wald / Felsen) – nur Optik
    for (let i = 0; i < 1400; i++) {
      const x = -MARGIN + R() * L, z = -MARGIN + R() * L;
      const out = Math.max(-x, x - WORLD, -z, z - WORLD);
      if (out < 3) continue;
      if (R() < 0.75) add(trees[Math.floor(R() * TN)], x, z, 0.8 + R() * 0.6, { col: true });
      else add(['namaqualand_boulder_02', 'namaqualand_boulder_05', 'namaqualand_boulder_02', 'rock_moss_set_01'][Math.floor(R() * 3)], x, z, 1.5 + R() * 2.5);
    }
    // Verlassener Außenposten in der Mitte (Deko)
    const c = WORLD / 2;
    if (!this.city) for (let i = 0; i < 6; i++) add('concrete_road_barrier', c - 30 + i * 1.7, c + 30, 1.6, { r: 0 });
    if (!this.city) for (let i = 0; i < 6; i++) add('concrete_road_barrier', c + 30 - i * 1.7, c - 30, 1.6, { r: 0 });
    const deco = ['old_military_crate', 'wooden_military_crate', 'Barrel_01', 'metal_jerrycan_green', 'old_tyre', 'propane_tank'];
    for (let i = 0; i < (this.city ? 0 : 40); i++) {
      const a = R() * 6.28, d = 25 + R() * 10;
      add(deco[Math.floor(R() * deco.length)], c + Math.cos(a) * d, c + Math.sin(a) * d, 1.5);
    }
    // Zielhöhen der Requisiten (Poly Haven Modelle sind maßstabsgetreu, leicht vergrößert für RTS-Lesbarkeit)
    const SCALE = { namaqualand_boulder_02: 1.4, namaqualand_boulder_05: 1.8, rock_moss_set_01: 0.6, quiver_tree_02: 3.2, dead_tree_trunk: 1.4, tree_stump_01: 1.3 };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    // In Kacheln aufteilen, damit Sichtfeld-Culling greift
    const CH = 110;
    for (const [id, all] of Object.entries(place)) {
      const src = (A.models[id] || A.props[id]).scene;
      const isModel = !!A.models[id];
      const chunks = new Map();
      for (const it of all) { const k = Math.floor((it.x + MARGIN) / CH) * 16 + Math.floor((it.z + MARGIN) / CH); (chunks.get(k) || chunks.set(k, []).get(k)).push(it); }
      for (const list of chunks.values()) {
        const set = makeInstanced(src, list.length, { team: isModel ? 0 : -1 });
        list.forEach((it, i) => {
          const sc = it.s * (SCALE[id] || 1);
          p.set(it.x, this.heightAt(it.x, it.z) - (isModel ? 0.3 : 0.1), it.z);
          q.setFromAxisAngle(up, it.r);
          s.set(sc, sc, sc);
          m.compose(p, q, s);
          set.setMatrix(i, m);
          if (it.col) { const v = 0.7 + R() * 0.35; col.setRGB(v * (0.95 + R() * 0.15), v, v * (0.85 + R() * 0.1)); set.setColor(i, col); }
        });
        set.setCount(list.length);
        const cx = list.reduce((a, it) => a + it.x, 0) / list.length, cz = list.reduce((a, it) => a + it.z, 0) / list.length;
        const inside = cx > -10 && cz > -10 && cx < WORLD + 10 && cz < WORLD + 10;
        const big = /pine|tree|boulder|rock_moss|quiver/.test(id);
        for (const part of set.parts) { part.frustumCulled = true; part.castShadow = big && inside; part.computeBoundingSphere(); part.boundingSphere.radius += 12; scene.add(part); }
      }
    }
  }

  /** Stadthäuser, Laternen, Autos: je Modell ein InstancedMesh für die ganze Karte */
  buildCity(scene) {
    const by = {};
    for (const it of this.cityItems) (by[it.id] ||= []).push(it);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
    for (const [id, list] of Object.entries(by)) {
      const set = makeInstanced(A.models[id].scene, list.length, { team: 0 });
      list.forEach((it, i) => {
        p.set(it.x, this.heightAt(it.x, it.z) - 0.04, it.z);
        q.setFromAxisAngle(up, it.r);
        m.compose(p, q, s);
        set.setMatrix(i, m);
      });
      set.setCount(list.length);
      for (const part of set.parts) { part.castShadow = id !== 'c_lamp'; scene.add(part); }
    }
  }

  // -------------------------------------------------------------- Minimap-Grundbild
  minimapCanvas(size = 256) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d');
    const img = g.createImageData(size, size);
    const n = this.noise;
    for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
      const x = (px + 0.5) / size * WORLD, z = (py + 0.5) / size * WORLD;
      const h = this.heightAt(x, z);
      const nr = this.normalAt(x, z);
      const shade = clamp(0.75 + (nr.x * -0.6 + nr.z * -0.6), 0.4, 1.2);
      let r = 74, gg = 92, b = 50;
      const v = n(x / 30, z / 30) * 8;
      if (h < WATER_LEVEL) { r = 22; gg = 52; b = 64; }
      else if (h < WATER_LEVEL + 0.8) { r = 150; gg = 135; b = 100; }
      else if (nr.y < 0.8) { r = 100; gg = 96; b = 88; }
      else if (this.roadSegs.some((s) => x > s.x0 - 8 && x < s.x1 + 8 && z > s.z0 - 8 && z < s.z1 + 8 && segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.w0 * 0.42 + 1.5)) { r = 128; gg = 112; b = 80; }
      const k = Math.floor(z / CELL) * MAPN + Math.floor(x / CELL);
      if (this.snow) {   // Winterfarben
        if (h < WATER_LEVEL) { r = 150; gg = 178; b = 194; } else if (nr.y < 0.8) { r = 128; gg = 128; b = 132; } else { r = 206; gg = 212; b = 220; }
        if (this.city && (streetCell(Math.floor(x / CELL)) || streetCell(Math.floor(z / CELL)))) { r = 96; gg = 98; b = 104; }
        if (this.blocked[k] === 4) { r = 118; gg = 92; b = 80; }
      }
      if (this.blocked[k] === 2) { r = 38; gg = 64; b = 34; }
      const i = (py * size + px) * 4;
      img.data[i] = clamp((r + v) * shade, 0, 255); img.data[i + 1] = clamp((gg + v) * shade, 0, 255); img.data[i + 2] = clamp((b + v) * shade, 0, 255); img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
  }
}
