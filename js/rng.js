// Zufall der Simulation mit festem Startwert (Mehrspieler: alle Rechner berechnen dasselbe Spiel, Lockstep).
// Regel: Alles, was den Spielzustand ändert (Zielpunkte, Nachladezeiten, KI-Entscheidungen), nimmt rand();
// reine Optik (Partikel, Klang, Wrackbewegung) bleibt bei Math.random – sie darf sich je Rechner unterscheiden.
let s = 1;

export function seedRand(seed) { s = (seed >>> 0) || 1; }

/** Gleichverteilt in [0, 1) – mulberry32 */
export function rand() {
  s = (s + 0x6D2B79F5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randState() { return s; }
