// A*-Wegfindung auf dem Zellraster (8 Richtungen, keine Eckenabkürzung) + Wegglättung
import { MAPN, CELL } from './config.js';

const SIZE = MAPN * MAPN;
const g = new Float32Array(SIZE);
const f = new Float32Array(SIZE);
const from = new Int32Array(SIZE);
const stamp = new Uint32Array(SIZE);
const closed = new Uint32Array(SIZE);
let cur = 1;

class Heap {
  constructor() { this.a = []; }
  push(k) { const a = this.a; a.push(k); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (f[a[p]] <= f[a[i]]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && f[a[l]] < f[a[m]]) m = l; if (r < a.length && f[a[r]] < f[a[m]]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];

/** nächste begehbare Zelle zu (cx,cz) suchen */
export function nearestFree(cx, cz, ok, maxR = 12) {
  if (ok(cx, cz)) return [cx, cz];
  for (let r = 1; r <= maxR; r++) {
    let best = null, bd = 1e9;
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      if (ok(cx + dx, cz + dz)) { const d = dx * dx + dz * dz; if (d < bd) { bd = d; best = [cx + dx, cz + dz]; } }
    }
    if (best) return best;
  }
  return null;
}

export function findPath(sx, sz, tx, tz, ok, maxNodes = 40000) {
  cur++;
  const start = sz * MAPN + sx, goal = tz * MAPN + tx;
  const h = (k) => { const x = k % MAPN, z = (k / MAPN) | 0; const dx = Math.abs(x - tx), dz = Math.abs(z - tz); return Math.max(dx, dz) + 0.414 * Math.min(dx, dz); };
  const open = new Heap();
  stamp[start] = cur; g[start] = 0; f[start] = h(start); from[start] = -1;
  open.push(start);
  let best = start, bestH = h(start), n = 0;
  while (open.size) {
    const k = open.pop();
    if (closed[k] === cur) continue;
    closed[k] = cur;
    if (k === goal) { best = k; break; }
    const hk = f[k] - g[k];
    if (hk < bestH) { bestH = hk; best = k; }
    if (++n > maxNodes) break;
    const x = k % MAPN, z = (k / MAPN) | 0;
    for (const [dx, dz, c] of DIRS) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= MAPN || nz >= MAPN) continue;
      const nk = nz * MAPN + nx;
      if (closed[nk] === cur) continue;
      if (!ok(nx, nz) && nk !== goal) continue;
      if (!ok(nx, nz)) continue;
      if (dx && dz && (!ok(x + dx, z) || !ok(x, z + dz))) continue;
      const ng = g[k] + c;
      if (stamp[nk] !== cur || ng < g[nk]) {
        stamp[nk] = cur; g[nk] = ng; f[nk] = ng + h(nk); from[nk] = k;
        open.push(nk);
      }
    }
  }
  const cells = [];
  for (let k = best; k !== -1; k = from[k]) { cells.push(k); if (k === start) break; }
  cells.reverse();
  return smoothPath(cells, ok);
}

function lineClear(a, b, ok) {
  let x0 = a % MAPN, z0 = (a / MAPN) | 0;
  const x1 = b % MAPN, z1 = (b / MAPN) | 0;
  const dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
  let err = dx - dz;
  for (;;) {
    if (!ok(x0, z0)) return false;
    if (x0 === x1 && z0 === z1) return true;
    const e2 = err * 2;
    if (e2 > -dz && e2 < dx) { // diagonal: beide Nachbarn prüfen
      if (!ok(x0 + sx, z0) || !ok(x0, z0 + sz)) return false;
    }
    if (e2 > -dz) { err -= dz; x0 += sx; }
    if (e2 < dx) { err += dx; z0 += sz; }
  }
}

function smoothPath(cells, ok) {
  if (cells.length <= 2) return cells.slice(1).map(toWorld);
  const out = [];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && !lineClear(cells[i], cells[j], ok)) j--;
    out.push(cells[j]);
    i = j;
  }
  return out.map(toWorld);
}

function toWorld(k) { return { x: (k % MAPN + 0.5) * CELL, z: (((k / MAPN) | 0) + 0.5) * CELL }; }
