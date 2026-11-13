// Spielkonstanten, Einheiten-, Gebäude- und Waffendefinitionen
export const CELL = 4;            // Meter pro Rasterzelle
export const MAPN = 160;          // Zellen pro Kante
export const WORLD = CELL * MAPN; // 640 m Spielfläche
// Kartenprofile (Wert im Menü = Seed). ridge/lake = Stärke von Höhenzügen/Seen, roads = Dichte des Wegenetzes (1–3)
export const MAPS = {
  1:  { name: 'Grenzland',  ridge: 1.0, lake: 0.8, forest: 0.18, roads: 2 },
  7:  { name: 'Seenplatte', ridge: 0.35, lake: 2.1, forest: 0.24, roads: 3 },
  23: { name: 'Hochebene',  ridge: 1.5, lake: 0.35, forest: 0.12, roads: 2 },
  42: { name: 'Frostheim',  ridge: 0.1, lake: 0, forest: 0.14, roads: 0, city: true, snow: true },   // verschneite Stadt: Straßenraster + Häuser (terrain.js layoutCity)
};
export const AIRFIELD_SLOTS = 3;   // je Flugfeld: so viele Jagdbomber und so viele Hubschrauber
export const MARGIN = 60;         // Gelände außerhalb der Spielfläche
export const WATER_LEVEL = -1.2;

/** Parteien: Tarnanstrich (camo = Farbton, ersetzt das gezeichnete Oliv der Vorlagen), Lack/Ausrüstung, Uniform,
 *  Teamfarben der Verbände (Orange der Vorlagen wird zur Teamfarbe; je Partei eine Farbfamilie) */
export const FACTIONS = {
  // pattern = Tarnflecken auf Lack (olive) und Uniform: [dunkel, hell, schwarz]
  allies: { name: 'Allianz', camo: [0.34, 0.48, 0.7], paint: 0x56687e, olive: 0x7d93b0, gear: 0x3a4a5e, cloth: 0x8d9db3, uniform: 0x7088a6, pattern: [0x4a5d78, 0xb3c1d2, 0x283140],
    css: ['#3f8bea', '#9cc8ff'], units: ['1. Panzerarmee', 'Rote Brigade', 'Grenzwacht', 'Wüstenkorps', 'Luftlandedivision', 'Küstenkorps', 'Nordflotte', 'Ehrengarde'] },
  axis: { name: 'Achsenmacht', camo: [0.72, 0.3, 0.22], paint: 0x7c4639, olive: 0xa25a48, gear: 0x5a332b, cloth: 0xab7c68, uniform: 0x8e5c48, pattern: [0x683a2d, 0xc99c74, 0x30211c],
    css: ['#e2483a', '#ff9c84'], units: ['Eisenbrigade', 'Rote Garde', 'Waldlegion', 'Sonnenlegion', 'Stahlfront', 'Eismeerkorps', 'Purpurgarde', 'Sturmlegion'] },
};

/** Verbandsfarben: 8 klar unterscheidbare Farbtöne für alle Spieler beider Parteien (jede Farbe nur einmal je Spiel).
 *  [Farbe, CSS, Farbname]; FACTIONS[f].colors[i] = [Farbe, CSS, Verbandsname, Farbname] (Verbandsname je Partei) */
export const COLORS = [
  [0x2f6fff, '#3d7dff', 'Blau'], [0xe8322a, '#f0402f', 'Rot'], [0x2ec84a, '#38d457', 'Grün'], [0xf5d21e, '#f7da36', 'Gelb'],
  [0xff8a14, '#ff9628', 'Orange'], [0x18d6e0, '#2ee0e8', 'Türkis'], [0x9b4dff, '#a862ff', 'Violett'], [0xff4fb8, '#ff62c2', 'Pink'],
];
for (const F of Object.values(FACTIONS)) F.colors = COLORS.map((c, i) => [c[0], c[1], F.units[i], c[2]]);

export const TEAMS = [{}, {}, {}, {}];   // je Spieler (Index = Spieler-id), wird von setupTeams gefüllt

/** Belegt TEAMS nach den Parteien der Spieler (factions[i] = 'allies' | 'axis'); jeder Spieler bekommt eine andere Farbe (COLORS).
 *  picks[i] = gewünschter Farbindex (Menü/Lobby); ohne Wunsch: zufällige noch freie Farbe. */
export function setupTeams(factions, picks = []) {
  const used = new Set();
  factions.forEach((f, i) => { if (picks[i] != null) used.add(picks[i]); });
  factions.forEach((f, i) => {
    const F = FACTIONS[f];
    let k = picks[i];
    if (k == null) {
      const free = COLORS.map((_, j) => j).filter((j) => !used.has(j));
      k = free.length ? free[Math.floor(Math.random() * free.length)] : i % COLORS.length;
      used.add(k);
    }
    const c = F.colors[k];
    TEAMS[i] = { name: F.name + ' – ' + c[2], short: F.name, color: c[0], css: c[1], paint: F.paint, olive: F.olive, gear: F.gear, cloth: F.cloth, uniform: F.uniform, camo: F.camo, pattern: F.pattern, faction: f };
  });
}
setupTeams(['allies', 'axis', 'axis', 'axis']);

// Panzerungsklassen: inf, light, heavy, air, building
export const WEAPONS = {
  rifle:      { dmg: 16, rof: 0.75, proj: 'bullet', vs: { inf: 1, light: 0.35, heavy: 0.12, air: 0.3, building: 0.12 }, sound: 'rifle', aa: true },
  atrocket:   { dmg: 70, rof: 2.4, proj: 'rocket', speed: 55, vs: { inf: 0.3, light: 1, heavy: 1, air: 0.9, building: 0.6 }, sound: 'rocket', aa: true, splash: 1.5 },
  autocannon: { dmg: 22, rof: 0.35, proj: 'tracer', speed: 220, vs: { inf: 0.9, light: 0.8, heavy: 0.35, air: 1, building: 0.3 }, sound: 'autocannon', aa: true, burst: 3 },
  cannon:     { dmg: 95, rof: 2.3, proj: 'shell', speed: 190, vs: { inf: 0.45, light: 1, heavy: 1, air: 0, building: 0.8 }, sound: 'cannon', splash: 2 },
  mlrs:       { dmg: 70, rof: 7, proj: 'arc', speed: 55, vs: { inf: 1, light: 0.9, heavy: 0.6, air: 0, building: 1 }, sound: 'mlrs', splash: 7, salvo: 6, inaccuracy: 5 },
  hellfire:   { dmg: 60, rof: 1.6, proj: 'rocket', speed: 70, vs: { inf: 0.6, light: 1, heavy: 0.9, air: 0, building: 0.7 }, sound: 'rocket', salvo: 2, splash: 2 },
  howitzer:   { dmg: 120, rof: 4.6, proj: 'arc', speed: 75, vs: { inf: 1, light: 0.9, heavy: 0.7, air: 0, building: 1 }, sound: 'cannon', splash: 6, inaccuracy: 3, shellArc: true },
  jetmissile: { dmg: 95, rof: 2.4, proj: 'rocket', speed: 95, vs: { inf: 0.5, light: 1, heavy: 1, air: 0, building: 0.9 }, sound: 'rocket', salvo: 2, splash: 2.5 },
  tcannon:    { dmg: 85, rof: 1.6, proj: 'shell', speed: 200, vs: { inf: 0.6, light: 1, heavy: 1, air: 0.45, building: 0.6 }, sound: 'cannon', splash: 2, twin: true, aa: true },
  hmg:        { dmg: 9, rof: 0.3, proj: 'tracer', speed: 230, vs: { inf: 1, light: 0.35, heavy: 0.08, air: 0.5, building: 0.1 }, sound: 'mg', aa: true, burst: 4 },
  flak:       { dmg: 20, rof: 0.5, proj: 'tracer', speed: 240, vs: { inf: 0.8, light: 0.55, heavy: 0.15, air: 1.7, building: 0.15 }, sound: 'autocannon', aa: true, burst: 4 },
  tesla:      { dmg: 150, rof: 2.4, proj: 'zap', energy: true, vs: { inf: 1.6, light: 1, heavy: 0.8, air: 0, building: 0.5 }, sound: 'zap', splash: 1.2 },
  prism:      { dmg: 125, rof: 2.8, proj: 'beam', energy: true, vs: { inf: 0.9, light: 1, heavy: 1, air: 0, building: 0.7 }, sound: 'beam', splash: 2.6 },
  sam:        { dmg: 80, rof: 2.8, proj: 'rocket', speed: 85, vs: { inf: 0.35, light: 0.8, heavy: 0.6, air: 1.3, building: 0.4 }, sound: 'rocket', aa: true, splash: 2, salvo: 2, aaPref: true },
};

// radius = halbe Breite (Kreis für Zielen/Auswahl); len = Rumpflänge in m, lenOff = Versatz der Rumpfmitte nach vorn:
// Bodenfahrzeuge kollidieren als Kapsel (Strecke längs der Fahrtrichtung + radius), siehe game.js separate
export const UNITS = {
  rifle:     { name: 'Schütze', desc: 'Infanterie mit Sturmgewehr. Stark gegen Infanterie.', cost: 120, time: 5, hp: 125, speed: 4.6, armor: 'inf', weapon: 'rifle', range: 22, sight: 30, from: 'barracks', model: 'rifleman', radius: 0.8, inf: true, key: 'inf' },
  rocket:    { name: 'Panzerjäger', desc: 'Raketen gegen Fahrzeuge und Luftziele.', cost: 300, time: 8, hp: 115, speed: 4.0, armor: 'inf', weapon: 'atrocket', range: 28, sight: 32, from: 'barracks', model: 'bazooka', radius: 0.8, inf: true, key: 'inf', launcher: true },
  buggy:     { name: 'Wiesel', desc: 'Schneller Späh-Buggy mit schwerem Maschinengewehr. Stark gegen Infanterie, schwach gegen Panzer, große Sichtweite.', cost: 450, time: 7, hp: 300, speed: 15, turn: 3.4, armor: 'light', weapon: 'hmg', range: 26, sight: 44, from: 'factory', model: 'buggy', radius: 2.1, len: 5.6, turretTurn: 7, wheels: true, key: 'veh' },
  ifv:       { name: 'Schakal', desc: 'Schneller Schützenpanzer mit Maschinenkanone. Flugabwehrfähig.', cost: 650, time: 10, hp: 520, speed: 11, turn: 2.6, armor: 'light', weapon: 'autocannon', range: 28, sight: 38, from: 'factory', model: 'ifv', radius: 2.5, len: 7.8, turretTurn: 4.5, key: 'veh' },
  tank:      { name: 'Wolf', desc: 'Kampfpanzer. Schwer gepanzert, starke Kanone.', cost: 950, time: 14, hp: 1000, speed: 7.8, turn: 1.7, armor: 'heavy', weapon: 'cannon', range: 34, sight: 38, from: 'factory', model: 'tank', radius: 2.8, len: 9.0, turretTurn: 2.2, key: 'veh' },
  flak:      { name: 'Luchs', desc: 'Flugabwehrpanzer mit Zwillings-Maschinenkanone und Radar. Stark gegen Luftziele und Infanterie, schwach gegen Panzer.', cost: 850, time: 12, hp: 620, speed: 9, turn: 2.0, armor: 'light', weapon: 'flak', range: 36, sight: 44, from: 'factory', model: 'flak', radius: 2.8, len: 8.3, turretTurn: 5, pitchAir: 0.5, key: 'veh' },
  artillery: { name: 'Donner', desc: 'Panzerhaubitze mit großer Reichweite und Flächenschaden. Mindestdistanz.', cost: 1200, time: 16, hp: 420, speed: 8, turn: 1.6, armor: 'light', weapon: 'howitzer', range: 78, minRange: 16, sight: 36, from: 'factory', model: 'artillery', radius: 2.8, len: 7.2, turretTurn: 1.3, req: ['radar'], key: 'veh' },
  harvester: { name: 'Erzsammler', desc: 'Sammelt Erz und bringt es zur Raffinerie.', cost: 1400, time: 14, hp: 1100, speed: 7, turn: 1.5, armor: 'heavy', sight: 26, from: 'factory', model: 'harvester', radius: 3.0, len: 9.6, lenOff: 0.85, cargo: 800, req: ['refinery'], key: 'veh' },
  mcv:       { name: 'Mobile Basis', desc: 'Lässt sich zum Hauptquartier entfalten (D).', cost: 3000, time: 25, hp: 1600, speed: 5.5, turn: 1.1, armor: 'heavy', sight: 30, from: 'factory', model: 'mcv', radius: 3.4, len: 9.6, req: ['radar'], key: 'veh' },
  heli:      { name: 'Hornisse', desc: 'Kampfhubschrauber mit Panzerabwehrraketen. 3 je Flugfeld.', cost: 1500, time: 16, hp: 520, speed: 18, turn: 2.4, armor: 'air', weapon: 'hellfire', range: 32, sight: 44, from: 'helipad', model: 'heli', radius: 3.0, scale: 0.72, air: true, key: 'air' },
  jet:       { name: 'Falke', desc: 'Jagdbomber: parkt auf einem Flugfeld (3 je Flugfeld), startet auf Befehl, greift Bodenziele an und landet danach wieder.', scale: 0.6, cost: 1800, time: 18, hp: 420, speed: 38, turn: 1.5, armor: 'air', weapon: 'jetmissile', range: 34, sight: 46, from: 'helipad', model: 'jet', radius: 3.4, air: true, jet: true, alt: 24, req: ['radar'], key: 'air' },
};

export const BUILDINGS = {
  hq:       { name: 'Bauhof', desc: 'Hauptquartier: baut Gebäude. Verlust = keine neuen Gebäude.', cost: 3000, time: 0, hp: 3200, w: 4, h: 4, power: 30, sight: 44, model: 'hq', buildable: false },
  power:    { name: 'Kraftwerk', desc: 'Liefert 200 Energie.', cost: 800, time: 9, hp: 900, w: 3, h: 3, power: 200, sight: 24, model: 'power', key: 'bld' },
  refinery: { name: 'Erzraffinerie', desc: 'Verarbeitet Erz zu Geld. Inklusive Erzsammler.', cost: 2000, time: 16, hp: 1500, w: 4, h: 3, power: -40, sight: 28, model: 'refinery', req: ['power'], key: 'bld' },
  barracks: { name: 'Kaserne', desc: 'Bildet Infanterie aus.', cost: 500, time: 8, hp: 900, w: 3, h: 3, power: -20, sight: 26, model: 'barracks', req: ['power'], key: 'bld' },
  factory:  { name: 'Waffenfabrik', desc: 'Produziert Fahrzeuge.', cost: 2000, time: 18, hp: 1700, w: 4, h: 4, power: -50, sight: 28, model: 'factory', req: ['refinery'], key: 'bld' },
  radar:    { name: 'Radarstation', desc: 'Aktiviert die Radarkarte, ermöglicht Hightech.', cost: 1000, time: 12, hp: 1000, w: 3, h: 3, power: -60, sight: 40, model: 'radar', req: ['refinery'], key: 'bld' },
  helipad:  { name: 'Flugfeld', desc: 'Stützpunkt für 3 Jagdbomber und 3 Kampfhubschrauber. Weitere Flugfelder vergrößern die Flotte.', cost: 1000, time: 12, hp: 1400, w: 4, h: 8, power: -30, sight: 30, model: 'helipad', req: ['radar'], key: 'bld' },
  turret:   { name: 'Geschützturm', desc: 'Zwillingskanone gegen Bodenziele, bedingt auch gegen Luftziele.', cost: 700, time: 9, hp: 1300, w: 2, h: 2, power: -30, sight: 40, model: 'turret', req: ['barracks'], weapon: 'tcannon', range: 40, turretTurn: 2.5, key: 'def' },
  samturret: { name: 'Raketenturm', desc: 'Lenkraketen gegen Luft- und Bodenziele. Große Reichweite, bevorzugt Luftziele.', cost: 900, time: 11, hp: 1200, w: 2, h: 2, power: -40, sight: 46, model: 'samturret', req: ['radar'], weapon: 'sam', range: 42, turretTurn: 3.5, key: 'def' },
  tesla:    { name: 'Teslaturm', desc: 'Hochspannungsspule: Blitze treffen sofort, stark gegen Infanterie und Fahrzeuge. Nur gegen Bodenziele, braucht viel Energie. Nur Achsenmacht.', cost: 1500, time: 14, hp: 1400, w: 2, h: 2, power: -75, sight: 40, model: 'tesla', req: ['radar'], faction: 'axis', weapon: 'tesla', range: 32, turretTurn: 30, key: 'def' },
  prism:    { name: 'Prismaturm', desc: 'Bündelt Licht im Kristall zu einem Laserstrahl: große Reichweite, Flächenschaden. Nur gegen Bodenziele, braucht viel Energie. Nur Allianz.', cost: 1600, time: 15, hp: 1200, w: 2, h: 2, power: -80, sight: 48, model: 'prism', req: ['radar'], faction: 'allies', weapon: 'prism', range: 44, turretTurn: 30, key: 'def' },
  silo:     { name: 'Abschussbasis', desc: 'Superwaffe: Atomrakete. Lädt sich auf (nur mit ausreichend Energie), dann Ziel wählen (Taste N) – verwüstet ein großes Gebiet, auch eigene Truppen. Gegner werden beim Start gewarnt. Nur eine je Spieler.', cost: 3500, time: 40, hp: 2400, w: 4, h: 4, power: -120, sight: 30, model: 'silo', req: ['radar'], key: 'bld', unique: true, superweapon: true },
  wall:     { name: 'Mauer', desc: 'Befestigung, blockiert Wege. Klicken und mit gedrückter Maustaste ziehen, R dreht (waagerecht/senkrecht).', cost: 60, time: 0, hp: 700, w: 1, h: 1, power: 0, sight: 8, model: 'wall', key: 'def', wall: true },
};

/** Atomrakete der Abschussbasis: Ladezeit (s), Wirkradius (m), Sofortschaden in der Mitte (fällt nach außen auf 25 %), Flugzeit (s);
 *  rad = Verstrahlung danach: Dauer (s), Schaden je Sekunde in der Mitte für Einheiten (dps, mal vs) und Gebäude (bdps), am Rand 40 % */
export const NUKE = { charge: 300, radius: 28, dmg: 1900, flight: 9, vs: { inf: 1, light: 1, heavy: 0.85, air: 0.7, building: 0.85 },
  rad: { time: 15, dps: 70, bdps: 45, vs: { inf: 1.4, light: 1, heavy: 0.6, air: 1 } } };

export const TABS = [
  { key: 'bld', label: 'Gebäude' },
  { key: 'def', label: 'Verteidigung' },
  { key: 'inf', label: 'Infanterie' },
  { key: 'veh', label: 'Fahrzeuge' },
  { key: 'air', label: 'Luft' },
];

export const DIFFICULTY = {
  // speed = Bau-/Produktionstempo, income = Erzertrag, wave = erste Wellengröße, grow/max = Wachstum/Obergrenze,
  // first/cool = Sekunden bis zur ersten Welle / zwischen Wellen, focus = Abstandsfaktor für Ziele des Menschen (<1 bevorzugt, >1 meidet ihn),
  // army = Truppen-Obergrenze, air = Wahrscheinlichkeit für Luftbau
  easy:   { name: 'Leicht', speed: 0.5, income: 0.7, wave: 4, grow: 1, max: 10, first: 540, cool: 150, react: 3.0, focus: 1.5, army: 12, air: 0.1 },
  normal: { name: 'Normal', speed: 0.75, income: 0.85, wave: 6, grow: 1, max: 14, first: 420, cool: 110, react: 2.0, focus: 1.15, army: 20, air: 0.2, nuke: true },
  hard:   { name: 'Schwer', speed: 1.05, income: 1.05, wave: 8, grow: 2, max: 20, first: 300, cool: 75, react: 1.0, focus: 0.85, army: 32, air: 0.3, nuke: true },
};

export const ORE_MAX = 600; // Erz pro Zelle
