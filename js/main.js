// Einstieg: Renderer, Szene, Licht, Nachbearbeitung, Menüs, Hauptschleife
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { CELL, WORLD, UNITS, BUILDINGS, TEAMS, FACTIONS, setupTeams } from './config.js';
import { A, loadAll, renderThumbs, clearMaterials } from './assets.js';
import { Terrain, baseWorld } from './terrain.js';
import { FX } from './fx.js';
import { Game } from './game.js';
import { AI } from './ai.js';
import { UI } from './ui.js';
import { Input } from './input.js';
import { FOG } from './fog.js';
import { initAudio, setVolume, say } from './audio.js';

const $ = (id) => document.getElementById(id);
const view = $('view');

const app = {
  state: 'loading', paused: false, game: null, terrain: null, scene: null, ais: [],
  pause() { if (this.state !== 'game') return; this.paused = true; $('pause').classList.remove('hidden'); },
  resume() { this.paused = false; $('pause').classList.add('hidden'); },
};
window.APP = app; // für Fehlersuche
app.FOG = FOG;

// ------------------------------------------------------------------ Renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.domElement.className = 'three';
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
view.prepend(renderer.domElement);
app.renderer = renderer;

const camera = new THREE.PerspectiveCamera(36, 1, 1, 1600);
let composer, gtao, bloom, scene, sun, fx;
let quality = 'mid';

function setupScene() {
  scene = new THREE.Scene();
  app.scene = scene;
  scene.environment = A.env;
  scene.environmentIntensity = 0.55;
  scene.background = A.sky;
  scene.backgroundBlurriness = 0.25;
  scene.backgroundIntensity = 0.9;
  scene.fog = new THREE.Fog(0xb7c4cc, 260, 900);
  sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.castShadow = true;
  const sz = quality === 'high' ? 4096 : quality === 'mid' ? 2048 : 1024;
  sun.shadow.mapSize.set(sz, sz);
  const S = 120;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 10, far: 500 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xbfd6ff, 0x4a4030, 0.5));
  fx = new FX(scene);
  setupComposer();
}

function setupComposer() {
  const size = renderer.getSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x * renderer.getPixelRatio(), size.y * renderer.getPixelRatio(), { type: THREE.HalfFloatType, samples: quality === 'low' ? 0 : 4 });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  gtao = null;
  if (quality === 'high') {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1.2, samples: 12 });
    gtao.blendIntensity = 0.85;
    composer.addPass(gtao);
  }
  if (quality !== 'low') {
    bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.35, 0.5, 0.92);
    composer.addPass(bloom);
  }
  composer.addPass(new OutputPass());
  if (quality !== 'low') composer.addPass(new ShaderPass({ // Farbabstimmung + Vignette (nach Tonemapping)
    uniforms: { tDiffuse: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb;
        float l = dot(c, vec3(0.299,0.587,0.114));
        c = mix(vec3(l), c, 1.12);
        c = (c - 0.5) * 1.06 + 0.5;
        c *= vec3(1.02, 1.0, 0.97);
        vec2 d = vUv - 0.5; c *= 1.0 - dot(d, d) * 0.55;
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`,
  }));
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'low' ? 1 : 1.5));
  renderer.setSize(w, h);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  if (composer) { composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(w, h); }
}
window.addEventListener('resize', resize);

// ------------------------------------------------------------------ Laden
async function boot() {
  resize();
  await loadAll(renderer, (f) => { $('loadFill').style.width = (f * 100).toFixed(0) + '%'; });
  $('loadTxt').textContent = 'Erzeuge Vorschaubilder …';
  await new Promise((r) => setTimeout(r, 30));
  const list = [];
  for (const [k, d] of Object.entries(BUILDINGS)) list.push({ key: k, model: d.model });
  for (const [k, d] of Object.entries(UNITS)) list.push({ key: k, model: d.model, launcher: d.launcher });
  app.thumbList = list;
  renderThumbs(renderer, list, 0);
  app.ui = new UI(app);
  app.input = new Input(app, view, camera);
  showMenu();
  requestAnimationFrame(loop);
}

function buildWorld(seed, players) {
  quality = $('optGfx').value;
  setupScene();
  resize();
  const t = new Terrain(seed, players);
  t.build(scene);
  fx.setSnow(t.snow);
  app.terrain = t;
  return t;
}

function showMenu() {
  app.state = 'menu'; app.game = null; app.paused = false;
  document.body.classList.add('ingame-hidden');
  $('loading').classList.add('hidden'); $('end').classList.add('hidden'); $('pause').classList.add('hidden');
  $('menu').classList.remove('hidden');
  FOG.uniforms.uFogOn.value = 0;
  FOG.enabled = false; FOG.data.fill(255); FOG.tex.needsUpdate = true;
  buildWorld(1, 4);
  app.input.lookAt(WORLD / 2, WORLD / 2); app.input.distT = 170; app.input.dist = 170;
  resize();
}

/** Bedienoberfläche in der Farbe der eigenen Partei */
function setFactionStyle(f) {
  const c = FACTIONS[f].css;
  document.documentElement.style.setProperty('--acc', c[0]);
  document.documentElement.style.setProperty('--acc2', c[1]);
  document.body.dataset.faction = f;
}

/** Farbwahl im Menü: Farbfelder der gewählten Partei, Auswahl je Partei gemerkt (Index in FACTIONS[..].colors) */
const colorSel = { allies: 0, axis: 0 };
function buildColorPicker() {
  const f = $('optFaction').value, box = $('optColor');
  box.innerHTML = '';
  FACTIONS[f].colors.forEach(([, css, name], i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.title = name; b.style.background = css;
    b.classList.toggle('on', i === colorSel[f]);
    b.onclick = () => { colorSel[f] = i; buildColorPicker(); };
    box.appendChild(b);
  });
  $('colorName').textContent = FACTIONS[f].colors[colorSel[f]][2];
}
$('optFaction').addEventListener('change', buildColorPicker);
buildColorPicker();

function startGame() {
  initAudio();
  const players = 1 + parseInt($('optEnemies').value, 10);
  let seed = parseInt($('optMap').value, 10);
  if (!seed) seed = 1 + Math.floor(Math.random() * 99999);
  $('menu').classList.add('hidden');
  $('loading').classList.remove('hidden'); $('loadTxt').textContent = 'Erzeuge Schlachtfeld …'; $('loadFill').style.width = '100%';
  // Parteien: Du gegen die andere Partei; Vorschaubilder und Materialien in den Parteifarben neu erzeugen
  const mine = $('optFaction').value, other = mine === 'allies' ? 'axis' : 'allies';
  setupTeams([mine, ...Array(players - 1).fill(other)], [colorSel[mine]]);
  clearMaterials();
  setFactionStyle(mine);
  setTimeout(() => {
    renderThumbs(renderer, app.thumbList, 0);
    const terrain = buildWorld(seed, players);
    const opts = { players, credits: parseInt($('optCredits').value, 10), difficulty: $('optDiff').value };
    const game = new Game(scene, terrain, fx, opts);
    app.game = game;
    app.miniBase = terrain.minimapCanvas(256);
    FOG.enabled = $('optFog').value === '1';
    FOG.explored.fill(0); FOG.visible.fill(0); FOG.data.fill(FOG.enabled ? 0 : 255); FOG.tex.needsUpdate = true;
    FOG.uniforms.uFogOn.value = FOG.enabled ? 1 : 0;
    // Startaufstellung
    for (let i = 0; i < players; i++) {
      const b = baseWorld(i);
      const c = WORLD / 2, a = Math.atan2(c - b.z, c - b.x);
      const m = game.spawnUnit('mcv', i, b.x, b.z, a);
      const fwd = (d, s) => ({ x: b.x + Math.cos(a) * d - Math.sin(a) * s, z: b.z + Math.sin(a) * d + Math.cos(a) * s });
      let p = fwd(16, -6); game.spawnUnit('tank', i, p.x, p.z, a);
      p = fwd(16, 6); game.spawnUnit('ifv', i, p.x, p.z, a);
      for (let k = 0; k < 4; k++) { p = fwd(22, -6 + k * 4); game.spawnUnit(k < 3 ? 'rifle' : 'rocket', i, p.x, p.z, a); }
      if (i > 0) setTimeout(() => game.cmdDeploy(m), 1500 + i * 400);
    }
    app.ais = game.players.filter((p) => !p.human).map((p) => new AI(game, p));
    const hb = baseWorld(0);
    app.input.lookAt(hb.x + 10, hb.z + 10); app.input.distT = 90;
    app.input.yaw = app.input.yawT = 0; // Norden oben, wie auf der Radarkarte
    document.body.classList.remove('ingame-hidden');
    resize();
    app.ui.tab = 'bld'; app.ui.renderGrid();
    $('loading').classList.add('hidden');
    app.state = 'game';
    game.updateFogOfWar();
    app.ui.message('Mobile Basis auswählen und D drücken (oder doppelt anklicken), um das Hauptquartier zu errichten.');
    app.ui.message('Du führst die ' + FACTIONS[mine].name + ' gegen die ' + FACTIONS[other].name + '.');
    say('Willkommen, Kommandant');
    game.selection.add(game.units.find((u) => u.owner === 0 && u.type === 'mcv'));
  }, 50);
}

$('btnStart').onclick = startGame;
$('btnResume').onclick = () => app.resume();
$('btnQuit').onclick = () => { app.resume(); showMenu(); };
$('btnAgain').onclick = () => showMenu();
$('btnMenu').onclick = () => app.pause();
$('optVol').oninput = (e) => setVolume(parseFloat(e.target.value));
document.addEventListener('visibilitychange', () => { if (document.hidden && app.state === 'game') app.pause(); });

// ------------------------------------------------------------------ Hauptschleife
let last = performance.now();
const sunDir = new THREE.Vector3(-0.55, 1, 0.35).normalize();
let shadowFrame = 0, shadowDirty = true;
const _lm = new THREE.Matrix4(), _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _az = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function fitShadow() {
  const tg = app.input.target;
  const t = new THREE.Vector3(tg.x, 0, tg.z);
  _lm.lookAt(t.clone().addScaledVector(sunDir, 200), t, _up);
  _lm.extractBasis(_ax, _ay, _az);
  let pts = app.input.viewPolygon();
  const D = app.input.dist;
  if (!pts) pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => ({ x: tg.x + a * D, z: tg.z + b * D }));
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  const v = new THREE.Vector3();
  for (const p of pts) for (const h of [0, 16]) {
    v.set(p.x - t.x, h, p.z - t.z);
    const lx = v.dot(_ax), ly = v.dot(_ay);
    x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); y0 = Math.min(y0, ly); y1 = Math.max(y1, ly);
  }
  const q = 6, m = 10; // Rand + Quantisierung gegen Flimmern
  x0 = Math.floor((x0 - m) / q) * q; x1 = Math.ceil((x1 + m) / q) * q; y0 = Math.floor((y0 - m) / q) * q; y1 = Math.ceil((y1 + m) / q) * q;
  const lim = 190;
  x0 = Math.max(x0, -lim); x1 = Math.min(x1, lim); y0 = Math.max(y0, -lim); y1 = Math.min(y1, lim);
  // Ziel auf Texelraster der Lichtebene einrasten
  const tex = Math.max(x1 - x0, y1 - y0) / sun.shadow.mapSize.x;
  const ox = Math.round(t.dot(_ax) / tex) * tex - t.dot(_ax), oy = Math.round(t.dot(_ay) / tex) * tex - t.dot(_ay);
  t.addScaledVector(_ax, ox).addScaledVector(_ay, oy);
  sun.target.position.copy(t);
  sun.position.copy(t).addScaledVector(sunDir, 200);
  const c = sun.shadow.camera;
  if (c.left !== x0 || c.right !== x1 || c.bottom !== y0 || c.top !== y1) { Object.assign(c, { left: x0, right: x1, bottom: y0, top: y1 }); c.updateProjectionMatrix(); }
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!scene) return;
  const game = app.game;
  if (app.state === 'menu') {
    app.input.yawT += dt * 0.04;
    app.input.update(dt);
  } else if (app.state === 'game') {
    if (!app.paused) {
      game.update(dt);
      for (const ai of app.ais) ai.update(dt);
      app.input.update(dt);
      if (game.over && !app.endShown) { app.endShown = true; setTimeout(() => app.ui.showEnd(game.over), 2500); }
      if (!game.over) app.endShown = false;
    }
    app.ui.update(dt);
  }
  if (!app.paused) fx.update(dt, game ? game.projectiles.filter((p) => p.rocket && p.vis) : []);
  if (app.terrain && app.terrain.water) app.terrain.water.material.normalMap.offset.set(now * 0.000012, now * 0.000008);
  // Schatten nur jedes 2. Bild neu (Hauptkosten); dann Schattenkamera eng an den Bildausschnitt anpassen
  shadowFrame++;
  if (shadowFrame % 2 === 0 || shadowDirty) { fitShadow(); renderer.shadowMap.needsUpdate = true; shadowDirty = false; }
  composer.render(dt);
  if (app.state === 'game') app.ui.drawOverlay(dt, camera);
}

boot().catch((e) => { console.error(e); $('loadTxt').textContent = 'Fehler beim Laden: ' + e.message; });
