// Startbildschirm-Optik (nur Darstellung, keine Spiellogik – Math.random ist hier erlaubt):
// Intro beim ersten Menüaufruf, Glut-/Aschepartikel (Canvas 2D) und Parallaxe über dem Live-Gefecht, leise Knopfklänge,
// Lichtschlitz-Blende Menü → Ladebildschirm und Einsatz-Briefing (Karte, Partei, Radar, abgehakte Ladeschritte).
// Einhängepunkte in main.js: progress(f) beim Erst-Laden, menuShown() am Ende von showMenu, launch(cfg) / loaded() in launchGame.
import { FACTIONS, MAPS, DIFFICULTY } from './config.js';
import { initAudio, play } from './audio.js';
import { VERSION } from './version.js';

const $ = (id) => document.getElementById(id);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => reduce.matches;
let token = 0;   // verwirft Zeitgeber eines abgelösten Ablaufs

// ------------------------------------------------------------------ Einsatz-Briefing (Ladebildschirm)
const BOOT_STEPS = ['Verbindung zum Kommando', 'Fahrzeug- und Gebäudemodelle', 'Texturen und Gelände', 'Materialien und Tarnanstrich', 'Vorschaubilder', 'Lagekarte: Live-Gefecht'];
const OPS = ['Morgenrot', 'Eisensturm', 'Nachtfalke', 'Stahlregen', 'Grauwolf', 'Donnerkeil', 'Feuerlinie', 'Schwarzer Mond', 'Steinadler', 'Sturmflut'];
let steps = BOOT_STEPS, cur = -1, ticker = 0, t0 = 0;

function setSteps(list) {
  steps = list; cur = -1;
  $('ldSteps').innerHTML = list.map((s) => `<li>${s}</li>`).join('');
}
/** Schritte vor n abgehakt, Schritt n läuft; Balken und Prozentzahl folgen (frac überschreibt den Anteil) */
function stepTo(n, frac) {
  cur = n;
  [...$('ldSteps').children].forEach((li, i) => { li.classList.toggle('done', i < n); li.classList.toggle('act', i === n); });
  if (frac !== undefined) setPct(frac, true);
}
function setPct(f, fill) {
  const p = Math.max(0, Math.min(1, f));
  if (fill) $('loadFill').style.width = (p * 100).toFixed(0) + '%';
  $('ldPct').textContent = Math.round(p * 100) + '%';
}
function setFacts(list) {
  $('ldFacts').innerHTML = list.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
/** Radar: eigene Basis (Mitte unten), Gegner rot, Verbündete in Parteifarbe; leuchten auf, wenn der Strahl sie überstreicht */
function setBlips(own, foes) {
  const R = $('ldRadar'); R.querySelectorAll('.blip').forEach((b) => b.remove());
  const T = 3.6, add = (cls, ang, rad) => {
    const b = document.createElement('i'); b.className = 'blip ' + cls;
    const a = ang * Math.PI / 180;
    b.style.setProperty('--x', (50 + Math.sin(a) * rad * 46).toFixed(1) + '%');
    b.style.setProperty('--y', (50 - Math.cos(a) * rad * 46).toFixed(1) + '%');
    b.style.setProperty('--d', (ang / 360 * T - T).toFixed(2) + 's');
    R.appendChild(b);
  };
  for (let i = 0; i < own; i++) add('own', 190 + i * 40 + Math.random() * 20, 0.35 + Math.random() * 0.4);
  for (let i = 0; i < foes; i++) add('foe', 300 + (i * 120 / Math.max(1, foes)) + Math.random() * 40, 0.55 + Math.random() * 0.4);
  for (let i = 0; i < 4; i++) add('ping', Math.random() * 360, 0.2 + Math.random() * 0.75);
}
/** Koordinaten-Ticker unten (nur Anzeige) */
let lat = 50.7, lon = 7.1;
function tick() {
  lat += (Math.random() - 0.5) * 0.004; lon += (Math.random() - 0.5) * 0.004;
  const dms = (v) => { const d = Math.floor(v), m = (v - d) * 60, s = (m - Math.floor(m)) * 60; return `${String(d).padStart(3, '0')}°${String(Math.floor(m)).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"`; };
  const t = Math.floor((performance.now() - t0) / 1000);
  $('ldCoord').textContent = `N ${dms(lat)}  ·  O ${dms(lon)}  ·  Raster 32U ${4400 + Math.floor(Math.random() * 99)} ${5500 + Math.floor(Math.random() * 99)}  ·  T+${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}
function startTicker() { stopTicker(); t0 = performance.now(); tick(); ticker = setInterval(tick, 120); }
function stopTicker() { clearInterval(ticker); ticker = 0; }

/** Erst-Laden: Systemstart; f = Anteil 0..1 aus loadAll */
export function progress(f) {
  setPct(f, false);
  stepTo(f >= 1 ? 4 : f >= 0.8 ? 3 : f >= 0.4 ? 2 : 1);
}
function initBoot() {
  setSteps(BOOT_STEPS);
  setFacts([['Version', VERSION], ['Spielfeld', '640 × 640 m'], ['Parteien', 'Allianz · Achsenmacht'], ['Modus', 'Gefecht · Online']]);
  setBlips(3, 3);
  stepTo(1); setPct(0);
  startTicker();
}

function mapDesc(m) {
  if (m.city) return 'Stadtgebiet im Winter · Häuserkampf, enge Straßen';
  if (m.lake > 1.5) return 'Seen und Wälder · viele Wege, wenige Engstellen';
  if (m.ridge > 1.2) return 'Höhenzüge und offene Ebenen · weite Sicht';
  return 'Grenzgebiet mit Hügeln, Wald und Flussläufen';
}
function setBriefing(cfg) {
  const me = cfg.players[cfg.me], F = FACTIONS[me.faction];
  const foes = cfg.players.filter((p) => p.ally !== me.ally), friends = cfg.players.filter((p) => p !== me && p.ally === me.ally);
  const m = MAPS[cfg.map];
  const ai = foes.find((p) => !p.human);
  const fnames = [...new Set(foes.map((p) => FACTIONS[p.faction].name))].join(' · ');
  $('ldOp').textContent = (cfg.net ? 'Online-Einsatz' : 'Einsatzbefehl') + ' · Operation ' + OPS[Math.floor(Math.random() * OPS.length)];
  $('ldMap').textContent = m ? m.name : 'Unbekanntes Gelände';
  $('ldDesc').textContent = m ? mapDesc(m) : 'Zufallskarte · Sektor ' + String(cfg.map % 10000).padStart(4, '0');
  setFacts([
    ['Partei', F.name + (me.color != null && F.colors[me.color] ? ' · ' + F.colors[me.color][2] : '')],
    ['Gegner', foes.length + ' × ' + fnames],
    ['Verbündete', friends.length ? String(friends.length) : 'keine'],
    ['Schwierigkeit', ai ? DIFFICULTY[ai.diff || 'normal'].name : 'Mitspieler'],
    ['Startkapital', '$ ' + Number(cfg.credits).toLocaleString('de-DE')],
    ['Kriegsnebel', cfg.fog ? 'An' : 'Aus'],
  ]);
  setSteps(['Einsatzbefehl bestätigt', 'Verbände aufstellen', 'Gelände erzeugen', 'Aufklärung und Kriegsnebel', 'Truppen verlegen', 'Gefechtsbereit']);
  setBlips(1 + friends.length, foes.length);
  $('loadTxt').textContent = 'Erzeuge Schlachtfeld …';
}

/** Spielstart: Lichtschlitz-Blende, dahinter Wechsel Menü → Briefing. Rückgabe: ms bis main.js das Schlachtfeld aufbaut
 *  (der Aufbau blockiert kurz; Radar und Raster laufen als CSS-Animation weiter). */
export function launch(cfg) {
  const my = ++token, menu = $('menu'), load = $('loading');
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  stopEmbers();
  setBriefing(cfg);
  const show = () => {
    if (my !== token) return;
    menu.classList.add('hidden'); menu.classList.remove('leaving');
    load.classList.remove('hidden', 'out');
    startTicker(); stepTo(0, 0.04);
  };
  if (calm()) { show(); stepTo(2, 0.4); return 60; }
  menu.classList.add('leaving');
  const w = document.createElement('div'); w.id = 'wipe'; w.innerHTML = '<i class="wT"></i><i class="wB"></i><i class="wS"></i>';
  document.body.appendChild(w);
  setTimeout(show, 380);
  setTimeout(() => w.remove(), 1000);
  setTimeout(() => { if (my === token) stepTo(1, 0.18); }, 700);
  setTimeout(() => { if (my === token) stepTo(2, 0.36); }, 1000);
  return 1150;
}
/** Schlachtfeld steht: restliche Schritte abhaken, Ladebildschirm ausblenden (das Spiel läuft schon, Klicks gehen durch) */
export function loaded() {
  const my = ++token, load = $('loading');
  const end = () => { if (my !== token) return; load.classList.add('hidden'); load.classList.remove('out'); stopTicker(); };
  if (calm()) { stepTo(steps.length, 1); end(); return; }
  for (let i = 3; i <= steps.length; i++) setTimeout(() => { if (my === token) stepTo(i, i / steps.length); }, (i - 3) * 110);
  const t = (steps.length - 3) * 110 + 220;
  setTimeout(() => { if (my === token) load.classList.add('out'); }, t);
  setTimeout(end, t + 560);
}

// ------------------------------------------------------------------ Intro (einmal je Seitenaufruf)
let introDone = false;
/** Menü sichtbar (Ende von showMenu): beim ersten Mal Intro, sonst normales Hereingleiten; Glut und Parallaxe starten */
export function menuShown() {
  const menu = $('menu');
  token++; stopTicker();
  menu.classList.remove('leaving', 'introRun', 'introSkip');
  if (!introDone) { introDone = true; if (!calm()) playIntro(menu); }
  startEmbers();
}
function playIntro(menu) {
  const el = document.createElement('div');
  el.id = 'intro';
  el.innerHTML = '<div class="inBlack"></div><div class="inFlash"></div><div class="inGhost"></div><div class="inRing"></div><div class="inFlare"></div>'
    + '<div class="inLogo"><div class="logo"><span>ATOMIC</span> DAWN</div><div class="inSub">Modernes Echtzeit-Strategiespiel</div></div>'
    + '<div class="inSkip">Klick oder Taste: überspringen</div>';
  menu.appendChild(el);
  menu.classList.add('introRun');
  let done = false, timer = 0;
  const end = (skip) => {
    if (done) return; done = true;
    removeEventListener('pointerdown', onSkip, true); removeEventListener('keydown', onSkip, true);
    clearTimeout(timer);
    if (skip) {
      menu.classList.replace('introRun', 'introSkip');
      el.classList.add('skip'); setTimeout(() => el.remove(), 320);
    } else el.remove();
  };
  const onSkip = (e) => { if (e.type === 'pointerdown') { e.preventDefault(); e.stopPropagation(); } end(true); };
  addEventListener('pointerdown', onSkip, true); addEventListener('keydown', onSkip, true);
  timer = setTimeout(() => end(false), 3250);
}

// ------------------------------------------------------------------ Glut, Asche und Parallaxe über dem Gefecht
let cv = null, ctx = null, W = 0, H = 0, dpr = 1, parts = [], running = false, lastT = 0, sprites = null;
const mouse = { tx: 0, ty: 0, x: 0, y: 0 };
function sprite(r, g, b, core) {
  const c = document.createElement('canvas'); c.width = c.height = 32;
  const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  gr.addColorStop(0, core ? 'rgba(255,250,235,1)' : `rgba(${r},${g},${b},.55)`);
  gr.addColorStop(core ? 0.18 : 0.3, `rgba(${r},${g},${b},${core ? 0.85 : 0.3})`);
  gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = gr; x.fillRect(0, 0, 32, 32);
  return c;
}
function size() {
  dpr = Math.min(1.5, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function spawn(p, fresh) {
  const z = 0.45 + Math.random() * 0.95;   // Tiefe: nah = größer, schneller, stärkere Parallaxe
  p.z = z; p.ash = Math.random() < 0.3;
  p.x = W * (Math.random() < 0.75 ? 0.3 + Math.random() * 0.75 : Math.random());   // eher rechts, wo das Gefecht frei liegt
  p.y = fresh ? H * (0.25 + Math.random() * 0.8) : H + 10 + Math.random() * 40;
  p.vx = (Math.random() * 1.4 - 0.4) * 10 * z;    // leichter Wind nach rechts
  p.vy = -(16 + Math.random() * 42) * z * (p.ash ? 0.45 : 1);
  p.r = (p.ash ? 2.2 + Math.random() * 2.6 : 1.1 + Math.random() * 1.9) * z;
  p.life = 0; p.max = 5 + Math.random() * 7; p.ph = Math.random() * 6.28; p.sw = 0.5 + Math.random() * 1.5;
  p.s = p.ash ? sprites[3] : sprites[Math.floor(Math.random() * 3)];
  return p;
}
function startEmbers() {
  if (calm()) return;
  if (!cv) {
    cv = document.createElement('canvas'); cv.className = 'menuEmbers'; cv.setAttribute('aria-hidden', 'true');
    $('menu').querySelector('.menuFx').after(cv);
    ctx = cv.getContext('2d');
    wireCuts(cv);
    sprites = [sprite(255, 196, 90, true), sprite(255, 128, 40, true), sprite(235, 72, 28, true), sprite(190, 198, 208, false)];
    size();
    addEventListener('resize', () => { if (cv) size(); });
    addEventListener('pointermove', (e) => { mouse.tx = e.clientX / W * 2 - 1; mouse.ty = e.clientY / H * 2 - 1; }, { passive: true });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) startEmbers(); });
  }
  const n = W < 900 ? 60 : 110;
  while (parts.length < n) parts.push(spawn({}, true));
  parts.length = n;
  if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(frame); }
}
function stopEmbers() { running = false; }
function frame(t) {
  const menu = $('menu');
  if (!running || document.hidden || menu.classList.contains('hidden')) { running = false; return; }
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000)); lastT = t;
  const k = Math.min(1, dt * 2.5);
  mouse.x += (mouse.tx - mouse.x) * k; mouse.y += (mouse.ty - mouse.y) * k;
  const poster = menu.querySelector('.posterWrap');
  if (poster) poster.style.translate = `${(-mouse.x * 18).toFixed(1)}px ${(-mouse.y * 12).toFixed(1)}px`;
  ctx.clearRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'lighter';
  const ox = mouse.x * 26, oy = mouse.y * 14;
  for (const p of parts) {
    p.life += dt;
    if (p.life > p.max || p.y < -30) spawn(p, false);
    p.x += (p.vx + Math.sin(p.life * p.sw + p.ph) * 9 * p.z) * dt; p.y += p.vy * dt;
    const fade = Math.min(1, p.life / 0.8) * Math.min(1, (p.max - p.life) / 1.6);
    const fl = p.ash ? 0.5 : 0.65 + 0.35 * Math.sin(p.life * 11 + p.ph);
    const a = fade * fl * (p.ash ? 0.35 : 0.9);
    if (a <= 0.01) continue;
    const s = p.r * (p.ash ? 3 : 4.2);
    ctx.globalAlpha = a;
    ctx.drawImage(p.s, p.x + ox * p.z - s, p.y + oy * p.z - s, s * 2, s * 2);
  }
  ctx.globalAlpha = 1;
}

/** Schnitte der Kinokamera im Menü-Gefecht (js/demo.js meldet 'democutsoon' ≈ 0,4 s vorher und 'democut'):
 *  kurze Schwarzblende über dem Gefecht (unter Glut und Menü), nicht während Intro oder Blende */
function wireCuts(embers) {
  const cut = document.createElement('div'); cut.className = 'camCut'; cut.setAttribute('aria-hidden', 'true');
  embers.before(cut);
  let t = 0;
  const ok = () => { const m = $('menu'); return !calm() && !document.hidden && !m.classList.contains('hidden') && !m.classList.contains('leaving') && !$('intro'); };
  addEventListener('democutsoon', () => {
    if (!ok()) return;
    cut.classList.add('on'); clearTimeout(t);
    t = setTimeout(() => cut.classList.remove('on'), 900);   // Notausgang, falls kein Schnitt folgt
  });
  addEventListener('democut', () => {
    clearTimeout(t);
    if (cut.classList.contains('on')) t = setTimeout(() => cut.classList.remove('on'), 60);
  });
}

// ------------------------------------------------------------------ leise Knopfklänge (erst nach einer Nutzeraktion)
function wireSounds() {
  const menu = $('menu');
  let hover = null;
  menu.addEventListener('pointerdown', (e) => { if (e.target.closest('.panel button, .panel select, .panel input')) initAudio(); }, true);
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('.panel button');
    if (b && !b.disabled) play(b.closest('.modeTabs') ? 'select' : 'click');
  });
  menu.addEventListener('pointerover', (e) => {
    const b = e.target.closest('.panel button');
    if (b !== hover) { hover = b; if (b && !b.disabled) play('cash'); }
  });
}

initBoot();
wireSounds();
