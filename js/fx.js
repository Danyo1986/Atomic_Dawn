// Effekte: Partikel (Feuer, Rauch, Staub, Funken), Mündungsfeuer, Leuchtspuren, Brandflecken, Explosionslicht
import * as THREE from 'three';

/** Eine Rauchwolke in die Zelle (ox, oy, 128 px) zeichnen: viele weiche Ballen, spätere dunkler -> Struktur */
function puff(g, ox, oy, n, spread) {
  g.save(); g.beginPath(); g.rect(ox, oy, 128, 128); g.clip();
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, d = Math.sqrt(Math.random()) * spread;
    const x = ox + 64 + Math.cos(a) * d, y = oy + 64 + Math.sin(a) * d, r = 14 + Math.random() * 20;
    const v = i < n * 0.6 ? 255 : 150 + Math.floor(Math.random() * 105);
    const gr = g.createRadialGradient(x - r * 0.25, y - r * 0.25, 0, x, y, r);
    gr.addColorStop(0, `rgba(${v},${v},${v},${0.22 + Math.random() * 0.2})`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr; g.fillRect(ox, oy, 128, 128);
  }
  g.globalCompositeOperation = 'destination-in';   // weicher Rand, nichts blutet in die Nachbarzelle
  const e = g.createRadialGradient(ox + 64, oy + 64, 18, ox + 64, oy + 64, 62);
  e.addColorStop(0, 'rgba(0,0,0,1)'); e.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = e; g.fillRect(ox, oy, 128, 128);
  g.restore();
}

function spriteTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = kind === 'smoke' ? 256 : 128;
  const g = c.getContext('2d');
  if (kind === 'soft') {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else if (kind === 'smoke') { // 2x2 Varianten
    for (let k = 0; k < 4; k++) puff(g, (k % 2) * 128, (k >> 1) * 128, 34, 30 + k * 3);
  } else if (kind === 'scorch') {
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(46,38,30,1)'); gr.addColorStop(0.5, 'rgba(90,78,64,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = '#fff'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * 6.28, d = Math.random() * 50;
      g.fillStyle = `rgba(30,25,20,${Math.random() * 0.4})`;
      g.beginPath(); g.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 3 + Math.random() * 10, 0, 6.28); g.fill();
    }
    for (let i = 0; i < 26; i++) { // Brandstrahlen nach außen
      const a = Math.random() * 6.28, r0 = 8 + Math.random() * 14, r1 = 34 + Math.random() * 26;
      g.strokeStyle = `rgba(25,20,15,${0.15 + Math.random() * 0.3})`; g.lineWidth = 1 + Math.random() * 3;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * r0, 64 + Math.sin(a) * r0); g.lineTo(64 + Math.cos(a) * r1, 64 + Math.sin(a) * r1); g.stroke();
    }
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'source-over';
    // Rand weiß ausblenden
    const e = g.createRadialGradient(64, 64, 30, 64, 64, 64);
    e.addColorStop(0, 'rgba(255,255,255,0)'); e.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = e; g.fillRect(0, 0, 128, 128);
  }
  else if (kind === 'flare') { // Stern: heller Kern + Strahlen
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 60);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI + 0.3, len = i % 2 ? 62 : 44;
      const lg = g.createLinearGradient(64 - Math.cos(a) * len, 64 - Math.sin(a) * len, 64 + Math.cos(a) * len, 64 + Math.sin(a) * len);
      lg.addColorStop(0, 'rgba(255,255,255,0)'); lg.addColorStop(0.5, 'rgba(255,255,255,0.9)'); lg.addColorStop(1, 'rgba(255,255,255,0)');
      g.strokeStyle = lg; g.lineWidth = i % 2 ? 3 : 5;
      g.beginPath(); g.moveTo(64 - Math.cos(a) * len, 64 - Math.sin(a) * len); g.lineTo(64 + Math.cos(a) * len, 64 + Math.sin(a) * len); g.stroke();
    }
  } else if (kind === 'ring') { // Druckwelle
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.05)'); gr.addColorStop(0.82, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.92, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  } else if (kind === 'chunk') { // Trümmerstück
    g.fillStyle = '#fff';
    g.beginPath();
    for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28, r = 26 + Math.random() * 30; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
    g.closePath(); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.arc(74, 76, 22, 0, 6.28); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const VERT = `
attribute vec3 iPos; attribute vec4 iCol; attribute vec3 iSR;
uniform float uCells; uniform vec2 uLight;
varying vec2 vUv; varying vec4 vCol; varying float vSh;
void main() {
  vUv = (uv + vec2(mod(iSR.z, uCells), floor(iSR.z / uCells))) / uCells; vCol = iCol;
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iSR.y), s = sin(iSR.y);
  vec2 p = mat2(c, s, -s, c) * position.xy;
  vSh = dot(p, uLight);
  mv.xy += p * iSR.x;
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D map; uniform float uShade, uGain; varying vec2 vUv; varying vec4 vCol; varying float vSh;
void main() {
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vCol.rgb * t.rgb * (1.0 + uShade * vSh), min(1.0, t.a * uGain) * vCol.a);
  #include <colorspace_fragment>
}`;

const SUN = new THREE.Vector3(5, 10, 7).normalize(), _l = new THREE.Vector3(), XA = new THREE.Vector3(1, 0, 0);
const WIND = { x: 0.9, z: 0.45 };   // m/s, treibt Rauch und Staub einheitlich ab

/** Instanzierte Sprites. Farbe c0 -> (cm bei tm) -> c1, Alpha a0 -> a1 mit Einblenden (fin), Größe s0 -> s1 mit Auslauf (ease),
 *  wind = Anteil der Winddrift, frame = Zelle im Texturatlas. shade > 0: zur Sonne hin heller (Rauch wirkt plastisch). */
class Particles {
  constructor(scene, max, tex, additive, { cells = 1, shade = 0, order = 10, gain = 1 } = {}) {
    this.max = max; this.cells = cells;
    this.p = []; this.drop = 0;
    const geo = new THREE.InstancedBufferGeometry();
    const base = new THREE.PlaneGeometry(1, 1);
    geo.index = base.index; geo.attributes.position = base.attributes.position; geo.attributes.uv = base.attributes.uv;
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSR = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos); geo.setAttribute('iCol', this.aCol); geo.setAttribute('iSR', this.aSR);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: tex }, uCells: { value: cells }, uShade: { value: shade }, uGain: { value: gain }, uLight: { value: new THREE.Vector2(0, 1) } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    if (shade) this.mesh.onBeforeRender = (r, sc, cam) => { _l.copy(SUN).transformDirection(cam.matrixWorldInverse); mat.uniforms.uLight.value.set(_l.x, _l.y).normalize(); };
    scene.add(this.mesh);
    this.geo = geo;
  }
  emit(o) {
    const q = { x: o.x, y: o.y, z: o.z, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, life: 0, max: o.life || 1,
      s0: o.s0 ?? 1, s1: o.s1 ?? o.s0 ?? 1, c0: o.c0 || [1, 1, 1], c1: o.c1 || o.c0 || [1, 1, 1], cm: o.cm || null, tm: o.tm ?? 0.3, a0: o.a0 ?? 1, a1: o.a1 ?? 0,
      fin: o.fin || 0, ease: o.ease || 1, wind: o.wind || 0, frame: o.frame ?? Math.floor(Math.random() * this.cells * this.cells),
      drag: o.drag ?? 0.5, grav: o.grav ?? 0, rot: o.rot ?? Math.random() * 6.28, vr: o.vr ?? (Math.random() - 0.5) };
    if (this.p.length >= this.max) this.p[this.drop++ % this.max] = q;   // voll: ein altes Partikel überschreiben (kein teures shift)
    else this.p.push(q);
  }
  update(dt) {
    const P = this.p;
    let w = 0;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      q.life += dt;
      if (q.life >= q.max) continue;
      const d = Math.exp(-q.drag * dt);
      q.vx *= d; q.vy = q.vy * d + q.grav * dt; q.vz *= d;
      q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.rot += q.vr * dt;
      if (q.wind) { const k = q.wind * Math.min(1, q.life * 1.5) * dt; q.x += WIND.x * k; q.z += WIND.z * k; }
      P[w++] = q;
    }
    P.length = w;
    const pos = this.aPos.array, col = this.aCol.array, sr = this.aSR.array;
    for (let i = 0; i < w; i++) {
      const q = P[i], t = q.life / q.max;
      let c0 = q.c0, c1 = q.c1, k = t;
      if (q.cm) { if (t < q.tm) { c1 = q.cm; k = t / q.tm; } else { c0 = q.cm; k = (t - q.tm) / (1 - q.tm); } }
      const i3 = i * 3, i4 = i * 4;
      pos[i3] = q.x; pos[i3 + 1] = q.y; pos[i3 + 2] = q.z;
      col[i4] = c0[0] + (c1[0] - c0[0]) * k; col[i4 + 1] = c0[1] + (c1[1] - c0[1]) * k; col[i4 + 2] = c0[2] + (c1[2] - c0[2]) * k;
      let a = q.a0 + (q.a1 - q.a0) * t;
      if (t < q.fin) a *= t / q.fin;
      col[i4 + 3] = a;
      const e = q.ease === 1 ? t : 1 - Math.pow(1 - t, q.ease);
      sr[i3] = q.s0 + (q.s1 - q.s0) * e; sr[i3 + 1] = q.rot; sr[i3 + 2] = q.frame;
    }
    this.geo.instanceCount = w;
    if (w || this.had) {   // nur den belegten Teil der Puffer hochladen
      for (const [at, n] of [[this.aPos, 3], [this.aCol, 4], [this.aSR, 3]]) { at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(1, w) * n); at.needsUpdate = true; }
    }
    this.had = w > 0;
  }
}

export class FX {
  constructor(scene) {
    this.scene = scene;
    const softTex = spriteTex('soft'), smokeTex = spriteTex('smoke');
    this.smoke = new Particles(scene, 3000, smokeTex, false, { cells: 2, shade: 0.55, order: 10, gain: 1.6 });
    this.blaze = new Particles(scene, 900, smokeTex, false, { cells: 2, order: 10.5, gain: 2.1 });   // Feuerball/Flammen: deckend, liegt über dem Rauch
    this.fire = new Particles(scene, 2200, softTex, true, { order: 11 });                 // Glut, Funken, Leuchten (additiv)
    this.flare = new Particles(scene, 400, spriteTex('flare'), true, { order: 11 });
    this.debris = new Particles(scene, 800, spriteTex('chunk'), false, { order: 10.2 });
    this.time = 0; this.load = 1; this.trails = [];
    this.flakes = new Particles(scene, 1300, softTex, false, { order: 12 });               // Schneefall (nur Winterkarte)
    this.snow = false; this.dustCol = [0.55, 0.48, 0.38];
    // Druckwellen am Boden (kleiner Pool)
    const ringGeo = new THREE.PlaneGeometry(1, 1); ringGeo.rotateX(-Math.PI / 2);
    const ringTex = spriteTex('ring');
    this.rings = [];
    for (let i = 0; i < 16; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, opacity: 0, color: 0xd9c9a6, polygonOffset: true, polygonOffsetFactor: -5 }));
      m.visible = false; m.renderOrder = 9; m.frustumCulled = false; scene.add(m);
      this.rings.push({ m, t: 0, max: 1, r0: 1, r1: 5, a: 0.5 });
    }
    this.ringI = 0;
    // Glut am Boden nach einer Explosion (additiv, verglimmt)
    this.glows = [];
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ map: softTex, transparent: true, depthWrite: false, opacity: 0, color: 0xff7a22, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -6 }));
      m.visible = false; m.renderOrder = 9; m.frustumCulled = false; scene.add(m);
      this.glows.push({ m, t: 0, max: 1, a: 0.5 });
    }
    this.glowI = 0;
    this.shake = 0; this.view = { x: 0, z: 0, dist: 80 }; // Kameraerschütterung (input.js liest shake, schreibt view)
    // Leuchtspuren / Projektile
    const tg = new THREE.BoxGeometry(1, 1, 1);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false });
    this.tracers = new THREE.InstancedMesh(tg, this.tracerMat, 600);
    this.tracers.frustumCulled = false; this.tracers.count = 0; scene.add(this.tracers);
    this.tracerList = [];
    // Energiestrahlen (Teslablitz, Prismastrahl): additive Stäbe, Farbe = Helligkeit, verblassen
    this.beamMesh = new THREE.InstancedMesh(tg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), 2400);
    this.beamMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(2400 * 3), 3);
    this.beamMesh.frustumCulled = false; this.beamMesh.count = 0; this.beamMesh.renderOrder = 12; scene.add(this.beamMesh);
    this.beams = []; this._c = new THREE.Color();
    // Raketen-Körper
    const rg = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 6); rg.rotateZ(Math.PI / 2);
    this.rockets = new THREE.InstancedMesh(rg, new THREE.MeshStandardMaterial({ color: 0x3c4038, metalness: 0.6, roughness: 0.5 }), 400);
    this.rockets.frustumCulled = false; this.rockets.count = 0; scene.add(this.rockets);
    // Brandflecken
    const dg = new THREE.PlaneGeometry(1, 1); dg.rotateX(-Math.PI / 2);
    const dm = new THREE.MeshBasicMaterial({ map: spriteTex('scorch'), blending: THREE.MultiplyBlending, transparent: true, depthWrite: false, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -4 });
    this.decals = new THREE.InstancedMesh(dg, dm, 300);
    this.decals.frustumCulled = false; this.decals.count = 0; this.decalI = 0; scene.add(this.decals);
    this.decalAge = [];
    // Lichtpool (feste Anzahl -> keine Shader-Neukompilierung)
    this.lights = [];
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffa040, 0, 40, 1.6); scene.add(l); this.lights.push({ l, t: 0, max: 1, i0: 0 }); }
    this.li = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.emitters = []; // dauerhafte Emitter (Gebäudedampf, Brände)
    this.big = [];      // Großeffekte mit eigenem Ablauf (Atomexplosion, Verstrahlung): Funktionen (dt) => false = fertig
    // Fahrspuren: zusammenhängende Bänder je Kette/Radreihe, folgen Kurven und Gelände; Verblassen rechnet die Grafikkarte
    const MAXQ = this.trackMax = 7000;
    const tc = document.createElement('canvas'); tc.width = 64; tc.height = 128;
    const tg2 = tc.getContext('2d');
    for (let x = 0; x < 64; x += 16) {           // obere Bildhälfte: Kettenglieder (Querstege mit Mittelführung)
      const gr = tg2.createLinearGradient(x, 0, x + 16, 0);
      gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.8)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.25)'); gr.addColorStop(1, 'rgba(255,255,255,0.2)');
      tg2.fillStyle = gr; tg2.fillRect(x, 10, 16, 44);
      tg2.clearRect(x + 10, 29, 6, 6);
    }
    for (let x = 0; x < 64; x += 8) {            // untere Bildhälfte: Reifenprofil (Stollen im Fischgrätmuster)
      tg2.fillStyle = 'rgba(255,255,255,0.3)'; tg2.fillRect(x, 78, 8, 36);
      tg2.fillStyle = 'rgba(255,255,255,0.9)';
      tg2.beginPath(); tg2.moveTo(x, 78); tg2.lineTo(x + 4, 78); tg2.lineTo(x + 8, 95); tg2.lineTo(x + 4, 95); tg2.fill();
      tg2.beginPath(); tg2.moveTo(x + 4, 97); tg2.lineTo(x + 8, 97); tg2.lineTo(x + 4, 114); tg2.lineTo(x, 114); tg2.fill();
    }
    const ttex = new THREE.CanvasTexture(tc); ttex.wrapS = THREE.RepeatWrapping; ttex.anisotropy = 4;
    const tgeo = new THREE.BufferGeometry();
    this.tPos = new THREE.BufferAttribute(new Float32Array(MAXQ * 12), 3).setUsage(THREE.DynamicDrawUsage);
    this.tUv = new THREE.BufferAttribute(new Float32Array(MAXQ * 8), 2).setUsage(THREE.DynamicDrawUsage);
    this.tInfo = new THREE.BufferAttribute(new Float32Array(MAXQ * 8).fill(-1e6), 2).setUsage(THREE.DynamicDrawUsage);   // Entstehungszeit, Stärke
    const idx = new Uint32Array(MAXQ * 6);
    for (let i = 0; i < MAXQ; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    tgeo.setAttribute('position', this.tPos); tgeo.setAttribute('uv', this.tUv); tgeo.setAttribute('aInfo', this.tInfo); tgeo.setIndex(new THREE.BufferAttribute(idx, 1));
    this.trackU = { map: { value: ttex }, uTime: { value: 0 }, uLife: { value: 48 } };
    const tmat = new THREE.ShaderMaterial({
      uniforms: this.trackU, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
      vertexShader: 'attribute vec2 aInfo; uniform float uTime, uLife; varying float vF; varying vec2 vUv; void main(){ vUv = uv; float k = (uTime - aInfo.x) / uLife; vF = aInfo.y * (1.0 - smoothstep(0.35, 1.0, k)) * step(k, 1.0); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform sampler2D map; varying float vF; varying vec2 vUv; void main(){ float a = texture2D(map, vUv).a * vF * 1.45; if (a < 0.004) discard; gl_FragColor = vec4(0.16, 0.12, 0.085, a); }',   // gedämpft: Spur dunkelt den Boden ab, statt ihn zu übermalen
    });
    this.tracks = new THREE.Mesh(tgeo, tmat);
    this.tracks.frustumCulled = false; this.tracks.renderOrder = 8; this.trackI = 0; this.trackLo = 1e9; this.trackHi = -1;
    scene.add(this.tracks);
  }

  flash(x, y, z, size = 1, color = 0xffa040) {
    let L = this.lights[0];
    for (const c of this.lights) if (c.l.intensity < L.l.intensity) L = c;
    L.l.position.set(x, y + 1.5, z); L.l.color.setHex(color); L.i0 = 60 * size; L.l.intensity = L.i0; L.t = 0; L.max = 0.12 + size * 0.12;
    L.l.distance = 18 + size * 14;
  }

  /** Kameraerschütterung, fällt mit dem Abstand zum Bildmittelpunkt ab */
  shakeAt(x, z, amt) {
    const d = Math.hypot(x - this.view.x, z - this.view.z);
    const k = Math.max(0, 1 - d / (this.view.dist * 1.2 + 25));
    this.shake = Math.max(this.shake, amt * k);
  }

  /** Druckwelle/Staubring am Boden */
  shock(x, y, z, size = 1, color = 0xd9c9a6, alpha = 0.55) {
    const R = this.rings[this.ringI++ % this.rings.length];
    R.m.position.set(x, y + 0.12, z); R.m.material.color.setHex(color);
    R.t = 0; R.max = 0.35 + size * 0.25; R.r0 = 1.5 * size; R.r1 = 9 * size + 4; R.a = alpha; R.m.visible = true;
    R.m.scale.setScalar(R.r0); R.m.material.opacity = alpha;
  }

  /** Mündungsfeuer. kind: 'gun' (Gewehr/MK), 'cannon' (mit seitlichen Strahlen der Mündungsbremse), 'rocket' */
  muzzle(x, y, z, dx, dz, size = 1, kind = 'gun') {
    const px = -dz, pz = dx;
    this.flare.emit({ x: x + dx * 0.4 * size, y, z: z + dz * 0.4 * size, life: 0.06, s0: 3.2 * size, s1: 4.6 * size, c0: [1, 0.9, 0.65], c1: [1, 0.55, 0.2], a0: 1, a1: 0, vr: 0 });
    const n = kind === 'cannon' ? 6 : 3;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      this.fire.emit({ x: x + dx * k * 1.6 * size, y, z: z + dz * k * 1.6 * size, vx: dx * (10 + k * 14) * size, vz: dz * (10 + k * 14) * size, life: 0.07 + k * 0.05,
        s0: (1.5 - k * 0.7) * size, s1: (0.7 - k * 0.3) * size, c0: [1, 0.88, 0.55], c1: [1, 0.4, 0.1], a0: 1, a1: 0, drag: 6 });
    }
    if (kind === 'cannon') {
      for (const sg of [1, -1]) for (let i = 0; i < 3; i++) // Mündungsbremse: Strahlen zur Seite
        this.fire.emit({ x, y, z, vx: (px * sg * 9 + dx * 2) * size * (0.6 + i * 0.3), vz: (pz * sg * 9 + dz * 2) * size * (0.6 + i * 0.3), life: 0.09, s0: 1.0 * size, s1: 0.4 * size, c0: [1, 0.85, 0.5], c1: [1, 0.35, 0.1], a0: 0.9, a1: 0, drag: 7 });
      for (let i = 0; i < 7; i++) { // Pulverdampf vor der Mündung
        const sp = 4 + Math.random() * 12;
        this.smoke.emit({ x: x + dx * 0.6, y, z: z + dz * 0.6, vx: dx * sp + (Math.random() - 0.5) * 3 + px * (Math.random() - 0.5) * 5, vy: 0.4 + Math.random() * 1.2, vz: dz * sp + (Math.random() - 0.5) * 3 + pz * (Math.random() - 0.5) * 5,
          life: 1.4 + Math.random() * 1.2, s0: 0.9 * size, s1: (3.5 + Math.random() * 2) * size, c0: [0.62, 0.6, 0.57], c1: [0.8, 0.79, 0.77], a0: 0.42, a1: 0, drag: 2.6, wind: 0.8, ease: 1.8 });
      }
      this.flash(x, y, z, 0.5 * size, 0xffb060);
    } else {
      for (let i = 0; i < Math.max(1, Math.round(2 * size)); i++) this.smoke.emit({ x, y, z, vx: dx * 3 + (Math.random() - 0.5), vy: 0.8, vz: dz * 3 + (Math.random() - 0.5), life: 1.0, s0: 0.6 * size, s1: 2.4 * size, c0: [0.75, 0.73, 0.7], a0: 0.3, a1: 0, drag: 1.5 });
      if (size >= 0.5) this.flash(x, y, z, 0.3 * size, 0xffb060);
    }
  }

  /** Rückstrahl beim Raketenstart (entgegen der Flugrichtung) */
  backblast(x, y, z, dx, dz, size = 1) {
    this.flare.emit({ x, y, z, life: 0.08, s0: 2.2 * size, s1: 3.4 * size, c0: [1, 0.85, 0.6], a0: 0.9, a1: 0, vr: 0 });
    for (let i = 0; i < 6; i++) {
      const sp = 4 + Math.random() * 9;
      this.smoke.emit({ x, y, z, vx: -dx * sp + (Math.random() - 0.5) * 3, vy: 0.3 + Math.random() * 1.5, vz: -dz * sp + (Math.random() - 0.5) * 3, life: 1.2 + Math.random(), s0: 0.7 * size, s1: (3 + Math.random() * 2) * size, c0: [0.85, 0.84, 0.82], a0: 0.45, a1: 0, drag: 2.4, wind: 0.8, ease: 1.8 });
    }
    for (let i = 0; i < 2; i++) this.fire.emit({ x: x - dx * i * 0.5, y, z: z - dz * i * 0.5, vx: -dx * 8, vz: -dz * 8, life: 0.1, s0: 1.1 * size, s1: 0.4 * size, c0: [1, 0.8, 0.45], c1: [1, 0.35, 0.1], a0: 1, a1: 0, drag: 5 });
  }

  /** Funken beim Einschlag auf Panzerung; (nx, nz) = Richtung, aus der das Geschoss kam */
  sparks(x, y, z, nx = 0, nz = 0, n = 6, size = 1) {
    this.flare.emit({ x, y, z, life: 0.07, s0: 1.3 * size, s1: 2.2 * size, c0: [1, 0.92, 0.7], a0: 1, a1: 0 });
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = 3 + Math.random() * 9;
      this.fire.emit({ x, y, z, vx: Math.cos(a) * sp * 0.7 - nx * sp * 0.6, vy: 2 + Math.random() * 7, vz: Math.sin(a) * sp * 0.7 - nz * sp * 0.6, life: 0.25 + Math.random() * 0.35,
        s0: 0.2 * size, s1: 0.06, c0: [1, 0.9, 0.6], c1: [1, 0.4, 0.1], a0: 1, a1: 0.3, drag: 1, grav: -22 });
    }
  }

  /** Einschlag im Boden (Fehlschuss, Beschuss von Infanterie) */
  groundHit(x, y, z, size = 1) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * 6.28;
      this.smoke.emit({ x, y: y + 0.15, z, vx: Math.cos(a) * 1.5, vy: 2 + Math.random() * 2.5, vz: Math.sin(a) * 1.5, life: 0.7 + Math.random() * 0.5, s0: 0.35 * size, s1: 1.6 * size, c0: [0.5, 0.43, 0.34], a0: 0.5, a1: 0, drag: 3 });
    }
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * 6.28, sp = 1 + Math.random() * 3;
      this.debris.emit({ x, y: y + 0.1, z, vx: Math.cos(a) * sp, vy: 3 + Math.random() * 4, vz: Math.sin(a) * sp, life: 0.6, s0: 0.12 * size, s1: 0.08 * size, c0: [0.3, 0.25, 0.2], a0: 1, a1: 0.6, drag: 0.5, grav: -20, vr: 8 });
    }
  }

  /** Trümmer, die im Bogen wegfliegen */
  debrisBurst(x, y, z, size = 1, n = 8, color = [0.12, 0.12, 0.12]) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.28, sp = (4 + Math.random() * 11) * (0.7 + size * 0.3);
      this.debris.emit({ x, y: y + 0.6, z, vx: Math.cos(a) * sp, vy: 6 + Math.random() * 11 * (0.6 + size * 0.4), vz: Math.sin(a) * sp, life: 1.1 + Math.random() * 0.9,
        s0: (0.25 + Math.random() * 0.45) * size, s1: (0.2 + Math.random() * 0.3) * size, c0: color, a0: 1, a1: 0.9, drag: 0.3, grav: -24, vr: (Math.random() - 0.5) * 16 });
    }
  }

  /** Glut am Boden */
  glow(x, y, z, size = 1, life = 1.5, alpha = 0.5) {
    const G = this.glows[this.glowI++ % this.glows.length];
    G.m.position.set(x, y + 0.1, z); G.m.scale.setScalar(size); G.t = 0; G.max = life; G.a = alpha; G.m.material.opacity = alpha; G.m.visible = true;
  }

  /** Explosion. kind: 'ground' (Einschlag im Boden, Erdfontäne), 'vehicle' (Feuerball, brennende Trümmer),
   *  'building' (dazu viel Staub), 'air' (in der Luft: kein Staub, keine Bodenspuren), 'hit' (Treffer am Ziel: ohne Fontäne und Trümmerfahnen).
   *  Die Partikelzahl sinkt automatisch, wenn schon sehr viel los ist (this.load). */
  explosion(x, y, z, size = 1, scorch = true, kind = 'ground') {
    const air = kind === 'air', ground = kind === 'ground', L = this.load;
    const N = (n) => Math.max(1, Math.round(n * L));
    const R = Math.random;
    // 1 Blitz + Leuchten
    this.flare.emit({ x, y: y + 0.8, z, life: 0.1, s0: 5 * size, s1: 11 * size, c0: [1, 0.86, 0.6], c1: [1, 0.5, 0.2], a0: 0.75, a1: 0, vr: 0 });
    this.fire.emit({ x, y: y + 0.8, z, life: 0.32, s0: 3 * size, s1: 7.5 * size, ease: 3, c0: [1, 0.62, 0.25], c1: [0.9, 0.2, 0.03], a0: 0.5, a1: 0 });
    // 2 Feuerball: quillt schnell auf, wird orange, dann rußig
    const fb = ground ? 0.75 : 1;
    for (let i = 0, n = N(4 + size * 5); i < n; i++) {
      const a = R() * 6.28, el = air ? (R() - 0.5) * 3 : R() * 1.3, sp = (2 + R() * 5) * size * fb, ch = Math.cos(el);
      this.blaze.emit({ x, y: y + 0.6, z, vx: Math.cos(a) * ch * sp, vy: Math.sin(el) * sp + (air ? 0 : 2.5 * size), vz: Math.sin(a) * ch * sp, life: 0.5 + R() * 0.5,
        s0: (0.8 + R() * 0.6) * size * fb, s1: (2.6 + R() * 2.6) * size * fb, ease: 3, c0: i % 3 ? [1, 0.93, 0.62] : [1, 0.72, 0.3], cm: i % 2 ? [1, 0.46, 0.08] : [0.85, 0.27, 0.04], tm: 0.28 + R() * 0.12, c1: [0.05, 0.02, 0.012], a0: 1, a1: 0, drag: 3.2, vr: (R() - 0.5) * 2 });
    }
    if (!air) {   // Staubring am Boden (zuerst, damit er unter Rauch und Feuer liegt)
      for (let i = 0, n = N(kind === 'building' ? 16 : 11); i < n; i++) {
        const a = i / n * 6.28 + R() * 0.4, sp = (5.5 + R() * 3.5) * size;
        this.smoke.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: 0.4, vz: Math.sin(a) * sp, life: 1.4 + R() * 0.8, s0: 1.3 * size, s1: 4.4 * size, ease: 2, c0: [0.52, 0.45, 0.36], a0: 0.34, a1: 0, drag: 2.5, wind: 0.6 });
      }
    }
    // 3 Rauch: blendet ein, während der Feuerball verlischt, steigt und treibt mit dem Wind ab
    for (let i = 0, n = N(3 + size * 6); i < n; i++) {
      const a = R() * 6.28, sp = (0.5 + R() * 2.4) * size;
      this.smoke.emit({ x: x + Math.cos(a) * size * 0.6, y: y + 0.9, z: z + Math.sin(a) * size * 0.6, vx: Math.cos(a) * sp, vy: (air ? 0.6 : 2.2 + R() * 3.6) * (0.6 + size * 0.5), vz: Math.sin(a) * sp, life: 2.8 + R() * 3,
        s0: 1.7 * size, s1: (5.5 + R() * 5) * size, ease: 2, fin: 0.12, c0: ground ? [0.09, 0.075, 0.06] : [0.018, 0.016, 0.015], c1: [0.24, 0.23, 0.22], a0: 0.85, a1: 0, drag: 0.9, wind: 1 });
    }
    // 4 Funken
    for (let i = 0, n = N(9 * size); i < n; i++) {
      const a = R() * 6.28, sp = 7 + R() * 15;
      this.fire.emit({ x, y: y + 0.5, z, vx: Math.cos(a) * sp, vy: (air ? -4 : 5) + R() * 13, vz: Math.sin(a) * sp, life: 0.6 + R() * 0.9, s0: 0.3, s1: 0.07, c0: [1, 0.88, 0.5], c1: [1, 0.3, 0.05], a0: 1, a1: 0.35, drag: 0.5, grav: -20 });
    }
    // 5 Trümmer; größere Brocken ziehen brennend eine Rauchfahne
    this.debrisBurst(x, y, z, size, N(3 + size * 5), ground ? [0.3, 0.25, 0.19] : [0.12, 0.12, 0.12]);
    if (kind !== 'ground' && kind !== 'hit') for (let i = 0, n = N(1.5 + size * 2); i < n; i++) {
      const a = R() * 6.28, sp = 5 + R() * 9;
      if (this.trails.length < 28) this.trails.push({ x, y: y + 1, z, vx: Math.cos(a) * sp, vy: (air ? 2 : 9) + R() * 8, vz: Math.sin(a) * sp, gy: air ? y - 60 : y, t: 0, e: 0, life: 1.8 + R(), s: 0.6 + size * 0.35 });
    }
    if (!air) {
      // 6 Erdfontäne, Druckwelle, Glut
      if (ground) for (let i = 0, n = N(4 + size * 3); i < n; i++) {
        const a = R() * 6.28, sp = R() * 2.5 * size;
        this.smoke.emit({ x, y: y + 0.3, z, vx: Math.cos(a) * sp, vy: (9 + R() * 8) * Math.sqrt(size), vz: Math.sin(a) * sp, life: 0.9 + R() * 0.5, s0: 0.7 * size, s1: 2.6 * size, c0: [0.34, 0.28, 0.2], c1: [0.48, 0.42, 0.33], a0: 0.9, a1: 0, drag: 0.9, grav: -17 });
      }
      this.shock(x, y, z, size);
      this.glow(x, y, z, 4.5 * size, 0.9 + size * 0.9, 0.55);
      if (scorch) this.decal(x, y, z, 3 + size * 2.5);
    }
    this.flash(x, y, z, size);
    this.shakeAt(x, z, 0.5 * size);
  }

  /** Atomexplosion (R = Wirkradius): Bildschirmblitz, glühender Feuerball (Fresnel-Kugel, steigt auf und wird zur Pilzkappe),
   *  Druckwellen, Kondensationsring, Bodenwalze, Pilzstamm und nach außen rollende Kappe, Brände im Krater. Läuft ~13 s. */
  nuke(x, y, z, R) {
    const Rn = Math.random, scene = this.scene;
    // Bildschirmblitz, wenn der Einschlag in der Nähe des Bildausschnitts liegt
    if (Math.hypot(x - this.view.x, z - this.view.z) < this.view.dist * 1.6 + 60) {
      const el = document.createElement('div'); el.className = 'nukeFlash';
      document.getElementById('view').appendChild(el); setTimeout(() => el.remove(), 1700);
    }
    this.flash(x, y + 10, z, 7, 0xfff4dc);
    this.shake = Math.max(this.shake, 2.4); this.shakeAt(x, z, 2.6);
    this.shock(x, y, z, R / 9 * 1.5, 0xfff0d0, 0.9);
    this.decal(x, y, z, R * 1.7);
    this.glow(x, y, z, R * 0.9, 10, 0.9);
    this.debrisBurst(x, y, z, 2.5, 30, [0.25, 0.2, 0.15]);
    for (let i = 0; i < 12; i++) { const a = Rn() * 6.28, sp = 10 + Rn() * 14; this.trails.push({ x, y: y + 2, z, vx: Math.cos(a) * sp, vy: 14 + Rn() * 14, vz: Math.sin(a) * sp, gy: y, t: 0, e: 0, life: 2.2 + Rn() * 1.5, s: 1.2 }); }
    // Feuerball
    const ballMat = new THREE.ShaderMaterial({
      uniforms: { uCol: { value: new THREE.Color(1, 1, 1) }, uA: { value: 1 } },
      vertexShader: 'varying vec3 vN, vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 uCol; uniform float uA; varying vec3 vN, vV; void main(){ float f = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0); gl_FragColor = vec4(uCol * (0.45 + 0.9 * f), pow(f, 1.4) * uA); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), ballMat);
    ball.renderOrder = 12; ball.frustumCulled = false; scene.add(ball);
    // Kondensationsring (Wilson-Wolke)
    this.ringTex ??= spriteTex('ring');
    const ring = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ map: this.ringTex, color: 0xf4f4f0, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.renderOrder = 11; ring.frustumCulled = false; scene.add(ring);
    const HEAT = [[0, [1, 1, 0.95]], [0.25, [1, 0.9, 0.55]], [1, [1, 0.55, 0.15]], [2.5, [0.9, 0.3, 0.06]], [4.5, [0.35, 0.08, 0.02]]];
    const heat = (t) => { for (let i = 1; i < HEAT.length; i++) if (t < HEAT[i][0]) { const [t0, a] = HEAT[i - 1], [t1, b] = HEAT[i], k = (t - t0) / (t1 - t0); return a.map((v, j) => v + (b[j] - v) * k); } return HEAT[HEAT.length - 1][1]; };
    const TOP = R * 1.75;   // Höhe der Pilzkappe
    let t = 0, lit = 0;
    this.big.push((dt) => {
      t += dt;
      const rb = R * 0.3 * (1 - Math.exp(-t * 7)) * (1 + 0.25 * Math.min(1, t / 4));
      const yb = y + rb * 0.75 + Math.min(TOP, Math.max(0, t - 0.35) * TOP / 3.6);
      const hc = heat(t), fade = t < 3.8 ? 1 : Math.max(0, 1 - (t - 3.8) / 1.6);
      ball.position.set(x, yb, z); ball.scale.set(rb, rb * (1 - 0.3 * Math.min(1, t / 4)), rb);
      ballMat.uniforms.uCol.value.setRGB(hc[0] * 1.6, hc[1] * 1.6, hc[2] * 1.6); ballMat.uniforms.uA.value = fade;
      if (lit < 3 && t > [0, 0.5, 1.3][lit]) { this.flash(x, yb, z, [7, 5, 3.5][lit], [0xfff4dc, 0xffb060, 0xff7a30][lit]); lit++; }
      if (t > 0.15 && t < 0.2 + dt) this.shock(x, y, z, R / 9 * 2.4, 0xc9b38e, 0.75);
      // Kondensationsring
      if (t > 0.3 && t < 2.4) { const k = (t - 0.3) / 2.1; ring.visible = true; ring.position.set(x, y + R * 0.75 + k * R * 0.5, z); ring.scale.setScalar(R * (0.3 + 1.1 * k)); ring.material.opacity = 0.45 * Math.sin(k * Math.PI); }
      else ring.visible = false;
      // Bodenwalze: Staub schießt radial nach außen
      if (t < 2.6) for (let i = Math.ceil(dt * 70); i > 0; i--) { const a = Rn() * 6.28; this.smoke.emit({ x: x + Math.cos(a) * 3, y: y + 0.8, z: z + Math.sin(a) * 3, vx: Math.cos(a) * (24 + Rn() * 10), vy: 0.8 + Rn(), vz: Math.sin(a) * (24 + Rn() * 10), life: 2.6 + Rn(), s0: 3, s1: 11, ease: 2, c0: [0.5, 0.43, 0.34], a0: 0.55, a1: 0, drag: 1.1, wind: 0.5 }); }
      // Flammen im Feuerball
      if (t < 3.2) for (let i = Math.ceil(dt * 40); i > 0; i--) { const a = Rn() * 6.28, r = Rn() * rb * 0.8; this.blaze.emit({ x: x + Math.cos(a) * r, y: yb + (Rn() - 0.5) * rb, z: z + Math.sin(a) * r, vx: Math.cos(a) * 3, vy: 3 + Rn() * 3, vz: Math.sin(a) * 3, life: 0.8 + Rn() * 0.6, s0: rb * 0.35, s1: rb * 0.7, ease: 3, c0: [1, 0.9, 0.6], cm: [1, 0.5, 0.1], tm: 0.3, c1: [0.12, 0.05, 0.03], a0: 1, a1: 0, drag: 2 }); }
      // Pilzstamm: Aufwind von unten, unten breiter Staubrock
      if (t > 0.2 && t < 10) for (let i = Math.ceil(dt * 36); i > 0; i--) {
        const h = Rn(), sy = y + 1 + h * (yb - y - rb * 0.6), w = 1.2 + Math.pow(1 - h, 3) * 9, a = Rn() * 6.28, g = Math.max(0, 1 - t / 3) * h;
        this.smoke.emit({ x: x + Math.cos(a) * w * Rn(), y: sy, z: z + Math.sin(a) * w * Rn(), vx: Math.cos(a) * 0.4, vy: 6 + Rn() * 4, vz: Math.sin(a) * 0.4, life: 1.8 + Rn() * 1.2, s0: 2.2 + Math.pow(1 - h, 2) * 4, s1: 4.5 + Math.pow(1 - h, 2) * 6, ease: 2,
          c0: [0.38 + 0.55 * g, 0.31 + 0.22 * g, 0.25 + 0.05 * g], c1: [0.3, 0.28, 0.27], a0: 0.75, a1: 0, drag: 1.4, wind: 0.3 });
      }
      // Pilzkappe: Ring um die Kappe, oben nach außen, außen nach unten (rollt), glüht anfangs von innen
      if (t > 0.5 && t < 9.5) for (let i = Math.ceil(dt * (t < 5 ? 70 : 26)); i > 0; i--) {
        // Torus: Winkel um den Kappenring, oben nach außen, außen nach unten, unten nach innen (Rollbewegung)
        const a = Rn() * 6.28, ph = Rn() * 6.28, grow = Math.min(1, t / 4), Rc = rb * (0.7 + 0.7 * grow), rr = rb * (0.45 + 0.25 * grow), g = Math.max(0, 1 - t / 4.5);
        const cr = Rc + Math.cos(ph) * rr, ch = yb + Math.sin(ph) * rr * 0.75, vr = -Math.sin(ph) * 3 + 2.2, vy = Math.cos(ph) * 2.2;
        this.smoke.emit({ x: x + Math.cos(a) * cr, y: ch, z: z + Math.sin(a) * cr, vx: Math.cos(a) * vr, vy, vz: Math.sin(a) * vr, life: 6 + Rn() * 4, s0: rb * 0.7, s1: rb * 1.5, ease: 2,
          c0: [0.3 + 0.7 * g, 0.24 + 0.36 * g, 0.2 + 0.08 * g], c1: [0.33, 0.31, 0.3], fin: 0.05, a0: 0.85, a1: 0, drag: 0.9, wind: 0.7 });
        if (Rn() < 0.5) this.smoke.emit({ x: x + (Rn() - 0.5) * Rc, y: yb + rr * 0.6, z: z + (Rn() - 0.5) * Rc, vy: 1, life: 7, s0: rb * 1.0, s1: rb * 1.8, ease: 2, c0: [0.3 + 0.6 * g, 0.25 + 0.3 * g, 0.21 + 0.06 * g], c1: [0.35, 0.33, 0.32], a0: 0.8, a1: 0, drag: 1, wind: 0.7 });   // Kappendach
      }
      // Brände im Einschlagsgebiet
      if (t < 11 && Rn() < dt * 14) { const a = Rn() * 6.28, r = Rn() * R * 0.75; this.flame(x + Math.cos(a) * r, y + 0.3, z + Math.sin(a) * r, 1 + Rn()); }
      if (t > 13) { scene.remove(ball); scene.remove(ring); ball.geometry.dispose(); ballMat.dispose(); ring.geometry.dispose(); ring.material.dispose(); return false; }
    });
  }

  /** Verstrahlte Zone: grün pulsierende Bodenfläche mit hellem Rand, aufsteigende Leuchtpartikel und Dunst; blendet nach dur Sekunden aus */
  radiation(x, y, z, R, dur) {
    if (!this.radTex) {
      const c = document.createElement('canvas'); c.width = c.height = 256;
      const g = c.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      gr.addColorStop(0, 'rgba(150,255,70,0.75)'); gr.addColorStop(0.55, 'rgba(90,220,40,0.35)'); gr.addColorStop(0.86, 'rgba(110,240,50,0.3)');
      gr.addColorStop(0.94, 'rgba(190,255,90,0.85)'); gr.addColorStop(1, 'rgba(120,255,60,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.globalCompositeOperation = 'destination-out';   // Flecken: ungleichmäßig verstrahlter Boden
      for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, r = Math.random() * 100; g.fillStyle = `rgba(0,0,0,${0.15 + Math.random() * 0.3})`; g.beginPath(); g.arc(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, 6 + Math.random() * 16, 0, 6.28); g.fill(); }
      this.radTex = new THREE.CanvasTexture(c); this.radTex.colorSpace = THREE.SRGBColorSpace;
    }
    const geo = new THREE.PlaneGeometry(2, 2); geo.rotateX(-Math.PI / 2);
    const disc = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.radTex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -7, toneMapped: false }));
    disc.position.set(x, y + 0.25, z); disc.scale.setScalar(R); disc.renderOrder = 9; disc.frustumCulled = false; this.scene.add(disc);
    const Rn = Math.random;
    let t = 0;
    this.big.push((dt) => {
      t += dt;
      const a = Math.min(1, t / 1.5) * Math.min(1, (dur - t) / 2.5) * (0.8 + 0.2 * Math.sin(t * 3.2));
      disc.material.opacity = 0.55 * Math.max(0, a); disc.rotation.y += dt * 0.05;
      if (a > 0) {
        for (let i = Math.ceil(dt * 30 * a); i > 0; i--) { const an = Rn() * 6.28, r = Math.sqrt(Rn()) * R; this.fire.emit({ x: x + Math.cos(an) * r, y: y + 0.3 + Rn() * 1.5, z: z + Math.sin(an) * r, vx: (Rn() - 0.5) * 0.6, vy: 0.8 + Rn() * 1.6, vz: (Rn() - 0.5) * 0.6, life: 1.6 + Rn() * 1.4, s0: 0.25 + Rn() * 0.3, s1: 0.05, c0: [0.55, 1, 0.3], c1: [0.15, 0.6, 0.1], a0: 0.9 * a, a1: 0, drag: 0.6, wind: 0.4 }); }
        if (Rn() < dt * 5 * a) { const an = Rn() * 6.28, r = Math.sqrt(Rn()) * R * 0.9; this.smoke.emit({ x: x + Math.cos(an) * r, y: y + 0.8, z: z + Math.sin(an) * r, vy: 0.4, life: 4, s0: 4, s1: 9, ease: 2, c0: [0.35, 0.5, 0.25], a0: 0.2 * a, a1: 0, drag: 0.5, wind: 0.8 }); }
      }
      if (t >= dur) { this.scene.remove(disc); geo.dispose(); disc.material.dispose(); return false; }
    });
  }

  /** Winterkarte: Schneefall an, aufgewirbelter Staub wird zu Schnee */
  setSnow(on) { this.snow = on; this.dustCol = on ? [0.8, 0.83, 0.88] : [0.55, 0.48, 0.38]; }

  dust(x, y, z, s = 1) {
    this.smoke.emit({ x: x + (Math.random() - 0.5) * 2, y: y + 0.3, z: z + (Math.random() - 0.5) * 2, vx: (Math.random() - 0.5), vy: 0.6, vz: (Math.random() - 0.5), life: 1.6, s0: 1 * s, s1: 3.5 * s, ease: 1.6, fin: 0.1, c0: this.dustCol, a0: 0.3, a1: 0, drag: 1, wind: 0.7 });
  }
  smokePuff(x, y, z, dark = true, s = 1) {
    this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5) * 0.6, vy: 2 + Math.random(), vz: (Math.random() - 0.5) * 0.6, life: 3.5, s0: 1.2 * s, s1: 6 * s, ease: 1.5, fin: 0.08, wind: 1,
      c0: dark ? [0.03, 0.028, 0.026] : [0.9, 0.9, 0.9], c1: dark ? [0.2, 0.19, 0.185] : [0.95, 0.95, 0.95], a0: dark ? 0.6 : 0.4, a1: 0, drag: 0.4 });
  }
  /** Flamme eines Brandes: Zunge (deckend, gelb -> rot -> Ruß) mit gelegentlichem Leuchten und Funken */
  flame(x, y, z, s = 1) {
    const px = x + (Math.random() - 0.5) * s, pz = z + (Math.random() - 0.5) * s;
    this.blaze.emit({ x: px, y, z: pz, vx: WIND.x * 0.6, vy: 2.4 + Math.random() * 2.2, vz: WIND.z * 0.6, life: 0.45 + Math.random() * 0.35, s0: 1.25 * s, s1: 0.35 * s, c0: [1, 0.86, 0.45], cm: [1, 0.42, 0.08], tm: 0.4, c1: [0.25, 0.05, 0.02], a0: 0.9, a1: 0, drag: 0.5 });
    if (Math.random() < 0.35) this.fire.emit({ x: px, y: y + 0.3, z: pz, life: 0.25, s0: 2.6 * s, s1: 3.4 * s, c0: [1, 0.5, 0.15], a0: 0.22, a1: 0 });
    if (Math.random() < 0.18) this.fire.emit({ x: px, y: y + 0.5, z: pz, vx: (Math.random() - 0.5) * 2 + WIND.x, vy: 3 + Math.random() * 4, vz: (Math.random() - 0.5) * 2 + WIND.z, life: 0.8 + Math.random() * 0.6, s0: 0.16, s1: 0.05, c0: [1, 0.75, 0.35], c1: [1, 0.3, 0.05], a0: 1, a1: 0, drag: 0.6, grav: -1.5 });
  }
  /** Abgasstoß (Diesel) beim Anfahren */
  exhaust(x, y, z, s = 1) {
    this.smoke.emit({ x, y, z, vx: (Math.random() - 0.5) * 0.8, vy: 1.6 + Math.random(), vz: (Math.random() - 0.5) * 0.8, life: 0.9 + Math.random() * 0.5, s0: 0.35 * s, s1: 1.7 * s, ease: 1.6, c0: [0.1, 0.1, 0.1], c1: [0.3, 0.3, 0.3], a0: 0.5, a1: 0, drag: 1.2, wind: 1 });
  }
  /** Schweißfunken (Baustelle) */
  weld(x, y, z) {
    this.flare.emit({ x, y, z, life: 0.09, s0: 1.2, s1: 2.0, c0: [0.75, 0.88, 1], a0: 0.9, a1: 0 });
    for (let i = 0; i < 4; i++) { const a = Math.random() * 6.28, sp = 1 + Math.random() * 4; this.fire.emit({ x, y, z, vx: Math.cos(a) * sp, vy: 1 + Math.random() * 4, vz: Math.sin(a) * sp, life: 0.3 + Math.random() * 0.4, s0: 0.14, s1: 0.04, c0: [1, 0.92, 0.7], c1: [1, 0.45, 0.1], a0: 1, a1: 0.2, drag: 1, grav: -16 }); }
  }
  /** Rotorabwind: Staub, der vom Hubschrauber weg nach außen treibt */
  rotorWash(x, y, z, r = 4) {
    const a = Math.random() * 6.28;
    this.smoke.emit({ x: x + Math.cos(a) * r * 0.5, y: y + 0.3, z: z + Math.sin(a) * r * 0.5, vx: Math.cos(a) * 7, vy: 0.5, vz: Math.sin(a) * 7, life: 1.1, s0: 1, s1: 3.6, ease: 2, fin: 0.15, c0: [0.56, 0.5, 0.4], a0: 0.26, a1: 0, drag: 2.2 });
  }

  tracer(x0, y0, z0, x1, y1, z1, speed, color = 0xffd38a, w = 0.08, len = 3) {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    this.tracerList.push({ x0, y0, z0, x1, y1, z1, d, t: 0, speed, w, len, color });
  }

  /** Gerader Strahl als Stab (w = Dicke, life in s, delay = Verzögerung, fl = flackert) */
  beam(x0, y0, z0, x1, y1, z1, color = 0x9fe8ff, w = 0.3, life = 0.3, delay = 0, fl = false, gain = 1) {
    if (this.beams.length < 3000) this.beams.push({ x0, y0, z0, x1, y1, z1, c: new THREE.Color(color).multiplyScalar(gain), w, life, t: -delay, fl });
  }

  /** Zickzackpfad durch fortgesetzte Mittelpunktverschiebung (natürliche Blitzform): grobe Haken, feine Zacken */
  boltPath(x0, y0, z0, x1, y1, z1, disp, seg = 0.7) {
    let P = [[x0, y0, z0], [x1, y1, z1]];
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    for (let len = d; len > seg && P.length < 129; len /= 2, disp *= 0.55) {
      const Q = [P[0]];
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], l = Math.hypot(dx, dy, dz) || 1;
        let rx = Math.random() - 0.5, ry = Math.random() - 0.5, rz = Math.random() - 0.5;
        const k = (rx * dx + ry * dy + rz * dz) / (l * l);   // nur quer zur Richtung verschieben
        rx -= dx * k; ry -= dy * k; rz -= dz * k;
        Q.push([(a[0] + b[0]) / 2 + rx * 2 * disp, (a[1] + b[1]) / 2 + ry * 2 * disp, (a[2] + b[2]) / 2 + rz * 2 * disp], b);
      }
      P = Q;
    }
    return P;
  }

  /** Linienzug als Blitzkanal: heller Kern + farbiger Schein */
  boltLine(P, color, w, life, delay, gain = 1) {
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i];
      this.beam(a[0], a[1], a[2], b[0], b[1], b[2], 0xffffff, w, life, delay, true, gain);
      this.beam(a[0], a[1], a[2], b[0], b[1], b[2], color, w * 3.2, life, delay, true, gain);
    }
  }

  /** Blitz: Hauptkanal mit Verästelungen; mehrere Entladungen zucken über fast denselben Kanal (Nachblitze, schwächer werdend),
   *  danach glimmt der ionisierte Kanal kurz nach. branches = Zahl der Äste (0 = keine) */
  bolt(x0, y0, z0, x1, y1, z1, color = 0x6f7fff, w = 0.08, pulses = 4, branches = -1) {
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const base = this.boltPath(x0, y0, z0, x1, y1, z1, Math.min(d * 0.16, 3.5), Math.max(0.35, Math.min(0.8, d / 12)));
    const nb = branches < 0 ? Math.round(1 + d / 7) : branches;
    const arms = [];
    for (let b = 0; b < nb; b++) {   // Äste: zweigen vom Hauptkanal ab, laufen schräg nach vorn/unten aus
      const i0 = 1 + Math.floor(Math.random() * (base.length * 0.75)), a = base[Math.min(i0, base.length - 2)], n = base[Math.min(i0 + 1, base.length - 1)];
      const L = d * (0.12 + Math.random() * 0.22) + 0.8;
      let dx = n[0] - a[0], dy = n[1] - a[1], dz = n[2] - a[2]; const l = Math.hypot(dx, dy, dz) || 1;
      dx = dx / l + (Math.random() - 0.5) * 1.4; dy = dy / l - Math.random() * 0.6; dz = dz / l + (Math.random() - 0.5) * 1.4;
      const m = Math.hypot(dx, dy, dz);
      arms.push(this.boltPath(a[0], a[1], a[2], a[0] + dx / m * L, a[1] + dy / m * L, a[2] + dz / m * L, L * 0.22, 0.45));
    }
    let delay = 0;
    for (let p = 0; p < pulses; p++) {
      const g = p === 0 ? 1.25 : 1 - p * 0.15, life = p === 0 ? 0.11 : 0.07 + Math.random() * 0.04;
      const P = p === 0 ? base : base.map((q, i) => i === 0 || i === base.length - 1 ? q : [q[0] + (Math.random() - 0.5) * 0.35, q[1] + (Math.random() - 0.5) * 0.35, q[2] + (Math.random() - 0.5) * 0.35]);
      this.boltLine(P, color, w * (p === 0 ? 1.15 : 1), life, delay, g);
      for (const A of arms) if (p === 0 || Math.random() < 0.5) this.boltLine(A, color, w * 0.6, life * 0.9, delay, g * 0.8);
      delay += life * 0.75 + Math.random() * 0.05;
    }
    for (let i = 1; i < base.length; i++) {   // Nachglühen des Kanals
      const a = base[i - 1], b = base[i];
      this.beam(a[0], a[1], a[2], b[0], b[1], b[2], color, w * 7, 0.35, delay * 0.5, false, 0.22);
    }
  }

  decal(x, y, z, size) {
    const i = this.decalI++ % 300;
    this._q.setFromAxisAngle(this._v.set(0, 1, 0), Math.random() * 6.28);
    this._m.compose(this._v.set(x, y + 0.05, z), this._q, this._s.set(size, 1, size));
    this.decals.setMatrixAt(i, this._m);
    this.decals.count = Math.min(300, Math.max(this.decals.count, i + 1));
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Ein Stück Fahrspur von (ax, ay, az) nach (bx, by, bz); (pax, paz) / (pbx, pbz) = Querrichtung am Anfang / Ende, hw = halbe Breite,
   *  u0 / u1 = Lauflänge in Musterwiederholungen, tyre = Reifen- statt Kettenprofil, k = Stärke */
  trackQuad(ax, ay, az, pax, paz, bx, by, bz, pbx, pbz, hw, u0, u1, tyre, k) {
    const i = this.trackI++ % this.trackMax, P = this.tPos.array, U = this.tUv.array, I = this.tInfo.array, p = i * 12, q = i * 8;
    P[p] = ax - pax * hw; P[p + 1] = ay; P[p + 2] = az - paz * hw; P[p + 3] = ax + pax * hw; P[p + 4] = ay; P[p + 5] = az + paz * hw;
    P[p + 6] = bx - pbx * hw; P[p + 7] = by; P[p + 8] = bz - pbz * hw; P[p + 9] = bx + pbx * hw; P[p + 10] = by; P[p + 11] = bz + pbz * hw;
    const v0 = tyre ? 0.03 : 0.53, v1 = tyre ? 0.47 : 0.97;   // CanvasTexture: Bild oben = v 1
    U[q] = u0; U[q + 1] = v0; U[q + 2] = u0; U[q + 3] = v1; U[q + 4] = u1; U[q + 5] = v0; U[q + 6] = u1; U[q + 7] = v1;
    for (let j = 0; j < 8; j += 2) { I[q + j] = this.time; I[q + j + 1] = k; }
    if (i < this.trackLo) this.trackLo = i;
    if (i > this.trackHi) this.trackHi = i;
  }

  update(dt, rockets) {
    this.time += dt;
    this.trackU.uTime.value = this.time;
    if (this.trackHi >= 0) {   // nur die neu geschriebenen Spurstücke hochladen
      const lo = this.trackLo, n = this.trackHi - lo + 1;
      for (const [at, k] of [[this.tPos, 12], [this.tUv, 8], [this.tInfo, 8]]) { at.addUpdateRange(lo * k, n * k); at.needsUpdate = true; }
      this.trackLo = 1e9; this.trackHi = -1;
    }
    // brennende Trümmer: Wurfbahn mit Rauchfahne
    let tw = 0;
    for (const T of this.trails) {
      T.t += dt; T.vy -= 20 * dt;
      T.x += T.vx * dt; T.y += T.vy * dt; T.z += T.vz * dt;
      if (T.y <= T.gy) { if (T.vy < -4) this.groundHit(T.x, T.gy, T.z, 1.1 * T.s); continue; }
      if (T.t > T.life) continue;
      T.e += dt;
      while (T.e > 0.04) {
        T.e -= 0.04;
        this.smoke.emit({ x: T.x, y: T.y, z: T.z, vy: 0.5, life: 0.9 + Math.random() * 0.6, s0: 0.45 * T.s, s1: 1.9 * T.s, ease: 1.6, c0: [0.04, 0.037, 0.034], c1: [0.25, 0.24, 0.23], a0: 0.55 * (1 - T.t / T.life), a1: 0, drag: 1, wind: 0.8 });
        this.fire.emit({ x: T.x, y: T.y, z: T.z, life: 0.14, s0: 0.75 * T.s, s1: 0.25 * T.s, c0: [1, 0.72, 0.3], c1: [1, 0.3, 0.05], a0: 0.9, a1: 0 });
      }
      this.trails[tw++] = T;
    }
    this.trails.length = tw;
    if (this.snow) {   // Flocken fallen im Sichtbereich der Kamera
      const span = this.view.dist * 2.4 + 30;
      for (let i = Math.min(12, Math.ceil(dt * 170)); i > 0; i--) {
        this.flakes.emit({ x: this.view.x + (Math.random() - 0.5) * span, y: 14 + Math.random() * 22, z: this.view.z + (Math.random() - 0.6) * span, vx: 1.2, vy: -(3 + Math.random() * 2.5), vz: 0.6,
          life: 6, s0: 0.2 + Math.random() * 0.16, c0: [0.95, 0.97, 1], a0: 0.8, a1: 0.8, drag: 0, wind: 1.5, vr: 0 });
      }
    }
    this.flakes.update(dt);
    this.fire.update(dt); this.smoke.update(dt); this.blaze.update(dt); this.flare.update(dt); this.debris.update(dt);
    this.load = Math.min(1, Math.max(0.45, 1.3 - (this.smoke.p.length + this.blaze.p.length * 2 + this.fire.p.length * 0.5) / 2400));
    for (const G of this.glows) {
      if (!G.m.visible) continue;
      G.t += dt;
      const k = G.t / G.max;
      if (k >= 1) { G.m.visible = false; continue; }
      G.m.material.opacity = G.a * (1 - k) * (1 - k);
    }
    this.shake *= Math.exp(-dt * 7);
    if (this.big.length) this.big = this.big.filter((f) => f(dt) !== false);
    for (const R of this.rings) {
      if (!R.m.visible) continue;
      R.t += dt;
      const k = R.t / R.max;
      if (k >= 1) { R.m.visible = false; continue; }
      R.m.scale.setScalar(R.r0 + (R.r1 - R.r0) * (1 - (1 - k) * (1 - k)));
      R.m.material.opacity = R.a * (1 - k);
    }
    for (const L of this.lights) {
      if (L.l.intensity <= 0) continue;
      L.t += dt; L.l.intensity = Math.max(0, L.i0 * (1 - L.t / L.max));
    }
    // Leuchtspuren
    this.beamMesh.count = 0;
    let w = 0;
    const m = this._m, q = this._q, v = this._v, s = this._s;
    for (const t of this.tracerList) {
      t.t += dt * t.speed;
      if (t.t - t.len > t.d) continue;
      const a = Math.max(0, t.t - t.len) / t.d, b = Math.min(t.t, t.d) / t.d;
      const ax = t.x0 + (t.x1 - t.x0) * a, ay = t.y0 + (t.y1 - t.y0) * a, az = t.z0 + (t.z1 - t.z0) * a;
      const bx = t.x0 + (t.x1 - t.x0) * b, by = t.y0 + (t.y1 - t.y0) * b, bz = t.z0 + (t.z1 - t.z0) * b;
      const l = Math.hypot(bx - ax, by - ay, bz - az);
      if (l < 0.01 || w >= 600) continue;
      v.set(bx - ax, by - ay, bz - az).normalize();
      q.setFromUnitVectors(XA, v);
      m.compose(this._p.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), q, s.set(l, t.w, t.w));
      this.tracers.setMatrixAt(w++, m);
      this.tracerList[w - 1 + 0] = t;
    }
    this.tracerList.length = w;
    this.tracers.count = w;
    this.tracers.instanceMatrix.needsUpdate = true;
    // Energiestrahlen
    let bw = 0;
    const BM = this.beamMesh, cc = this._c;
    for (const B of this.beams) {
      B.t += dt;
      if (B.t >= B.life) continue;
      this.beams[bw++] = B;
      if (B.t < 0) continue;
      const f = 1 - B.t / B.life, l = Math.hypot(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0);
      if (l < 0.01 || BM.count >= 2400) continue;
      v.set(B.x1 - B.x0, B.y1 - B.y0, B.z1 - B.z0).divideScalar(l);
      q.setFromUnitVectors(XA, v);
      m.compose(this._p.set((B.x0 + B.x1) / 2, (B.y0 + B.y1) / 2, (B.z0 + B.z1) / 2), q, s.set(l, B.w, B.w));
      BM.setMatrixAt(BM.count, m);
      BM.setColorAt(BM.count++, cc.copy(B.c).multiplyScalar(f * f * 1.6 * (B.fl ? 0.55 + 0.45 * Math.random() : 1)));   // Blitze flackern
    }
    this.beams.length = bw;
    BM.instanceMatrix.needsUpdate = true; BM.instanceColor.needsUpdate = true;
    // Raketen (aus Spielzustand)
    let r = 0;
    for (const p of rockets) {
      if (r >= 400) break;
      v.set(p.vx, p.vy, p.vz).normalize();
      q.setFromUnitVectors(XA, v);
      m.compose(this._p.set(p.x, p.y, p.z), q, s.set(1, 1, 1));
      this.rockets.setMatrixAt(r++, m);
    }
    this.rockets.count = r;
    this.rockets.instanceMatrix.needsUpdate = true;
  }
}
