// Mathe, Zufall, Rauschen
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
export const dist = (ax, az, bx, bz) => Math.sqrt(dist2(ax, az, bx, bz));
export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
export function turnTo(a, b, max) { const d = angDiff(a, b); return Math.abs(d) <= max ? b : a + Math.sign(d) * max; }

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 2D-Simplex-Rauschen (nach Stefan Gustavson), seedbar
export function makeNoise(rand) {
  const p = new Uint8Array(512);
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  const g = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  function n2(x, y) {
    const s = (x + y) * F2, i = Math.floor(x + s), j = Math.floor(y + s);
    const t = (i + j) * G2, x0 = x - (i - t), y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = 1 - i1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2, x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt;
    tt = 0.5 - x0 * x0 - y0 * y0; if (tt > 0) { const q = g[p[ii + p[jj]] & 7]; tt *= tt; n += tt * tt * (q[0] * x0 + q[1] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1; if (tt > 0) { const q = g[p[ii + i1 + p[jj + j1]] & 7]; tt *= tt; n += tt * tt * (q[0] * x1 + q[1] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2; if (tt > 0) { const q = g[p[ii + 1 + p[jj + 1]] & 7]; tt *= tt; n += tt * tt * (q[0] * x2 + q[1] * y2); }
    return 70 * n;
  }
  n2.fbm = (x, y, oct = 4) => { let a = 1, f = 1, s = 0, t = 0; for (let o = 0; o < oct; o++) { s += n2(x * f, y * f) * a; t += a; a *= 0.5; f *= 2; } return s / t; };
  return n2;
}

export function fmtMoney(v) { return '$ ' + Math.floor(v).toLocaleString('de-DE'); }
