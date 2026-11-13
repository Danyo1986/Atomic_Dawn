// Laden von Modellen/Texturen, Materialzuordnung, Instanziierung, Vorschaubilder
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { TEAMS } from './config.js';
import { patchMaterial } from './fog.js';

export const A = { models: {}, props: {}, tex: {}, env: null, soldierClips: null, thumbs: {} };

const EMBLEM_IMAGES = ['factory', 'yard'];   // Vorlagen mit Parteiemblem (Achsenmacht: Original, Allianz: Stern)
const MODEL_FILES = ['tank', 'buggy', 'ifv', 'artillery', 'harvester', 'mcv', 'heli', 'hq', 'power', 'refinery', 'barracks', 'factory', 'silo',
  'radar', 'turret', 'samturret', 'tesla', 'prism', 'flak', 'helipad', 'jet', 'wall', 'ore1', 'ore2', 'ore3', 'pine1', 'pine2', 'pine3', 'tree1', 'tree2', 'tree3', 'bush1', 'bush2', 'bush3', 'rifleman', 'bazooka',
  'c_house1', 'c_house2', 'c_house3', 'c_rowhouse', 'c_apartment', 'c_apartment2', 'c_tower_res', 'c_tower_office', 'c_office', 'c_market', 'c_shops',
  'c_factory', 'c_hall', 'c_warehouse', 'c_lamp', 'c_car1', 'c_car2', 'c_car3'];   // c_*: Stadthäuser der Winterkarte (tools/blender_city.py)
const PROP_FILES = ['namaqualand_boulder_02', 'namaqualand_boulder_05', 'rock_moss_set_01', 'quiver_tree_02', 'dead_tree_trunk', 'tree_stump_01', 'old_military_crate', 'wooden_military_crate',
  'Barrel_01', 'metal_jerrycan_green', 'concrete_road_barrier', 'old_tyre', 'propane_tank'];
const TEX_SETS = ['sparse_grass', 'aerial_grass_rock', 'aerial_rocks_02', 'coast_sand_01', 'aerial_ground_rock', 'forest_leaves_02',
  'concrete_wall_008', 'concrete_floor_worn_001', 'corrugated_iron', 'metal_plate', 'hangar_concrete_floor',
  'snow_field_aerial', 'snow_02', 'asphalt_snow'];   // Winterkarte

export async function loadAll(renderer, onProgress) {
  const gltf = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const jobs = [];
  let done = 0, total = 0;
  const track = (p) => { total++; return p.then((r) => { done++; onProgress(done / total); return r; }); };

  for (const id of TEX_SETS) {
    A.tex[id] = {};
    for (const k of ['diff', 'nor', 'arm']) {
      jobs.push(track(tl.loadAsync(`assets/textures/${id}/${k}.jpg`).then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = maxAniso;
        if (k === 'diff') t.colorSpace = THREE.SRGBColorSpace;
        A.tex[id][k] = t;
      })));
    }
  }
  // Allianz: Gebäudevorlagen mit Stern statt Emblem (tools/make_faction_emblems.py)
  A.emblems = {};
  for (const id of EMBLEM_IMAGES) jobs.push(track(tl.loadAsync(`assets/textures/emblems/${id}_allies.jpg`).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; A.emblems['Art_' + id] = t; })));
  jobs.push(track(tl.loadAsync('assets/textures/water/waternormals.jpg').then((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; A.tex.water = t; })));
  for (const id of MODEL_FILES) jobs.push(track(gltf.loadAsync(`assets/models/${id}.glb`).then((g) => { A.models[id] = g; })));
  for (const id of PROP_FILES) jobs.push(track(gltf.loadAsync(`assets/props/${id}.glb`).then((g) => { A.props[id] = g; })));
  jobs.push(track(new RGBELoader().loadAsync('assets/hdri/sky.hdr').then((hdr) => {
    const pm = new THREE.PMREMGenerator(renderer);
    A.env = pm.fromEquirectangular(hdr).texture;
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    A.sky = hdr;
    pm.dispose();
  })));
  await Promise.all(jobs);
  prepareProps();
  bakeCamoCoords();
  optimizeModels();
  // Relief-Karten der Vorlagen schon beim Laden berechnen (sonst ruckt es beim ersten Auftritt eines Modells)
  for (const g of Object.values(A.models)) g.scene.traverse((o) => { if (o.isMesh && (o.material.name || '').startsWith('Art_')) getArtMaterial(o.material, 0); });
  A.soldierClips = A.models.soldier ? A.models.soldier.animations : null;   // alter Mixamo-Soldat (nicht mehr geladen)
}

// ------------------------------------------------------------------ Tarnanstrich
/** Je Modell einmal: Ruhelage-Position jedes Netzpunkts im Modellraum als Attribut aCamo. Das Tarnmuster hängt daran,
 *  läuft also über Wanne, Turm und Räder durchgehend und bewegt sich mit dem Fahrzeug (Turm/Räder nehmen es mit). */
function bakeCamoCoords() {
  const m4 = new THREE.Matrix4(), v = new THREE.Vector3();
  for (const g of Object.values(A.models)) {
    g.scene.updateMatrixWorld(true);
    m4.copy(g.scene.matrixWorld).invert();
    g.scene.traverse((o) => {
      if (!o.isMesh || o.geometry.attributes.aCamo) return;
      const P = o.geometry.attributes.position, M = new THREE.Matrix4().multiplyMatrices(m4, o.matrixWorld), out = new Float32Array(P.count * 3);
      for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(M); out[i * 3] = v.x; out[i * 3 + 1] = v.y; out[i * 3 + 2] = v.z; }
      o.geometry.setAttribute('aCamo', new THREE.BufferAttribute(out, 3));
    });
  }
}

// ------------------------------------------------------------------ Netze zusammenfassen
/* Die Vorlagen-Modelle bestehen je Knoten aus einem Netz pro Material (Panzer: 63 Netze, Soldat: 24) – jedes kostet einen
   Zeichenaufruf, im Schattenbild einen zweiten. optimizeModels() fasst sie beim Laden zusammen:
   - glatte Materialien (MIX) -> ein Netz je Knoten mit dem Sammelmaterial `Mix`; das Attribut aPal wählt Farbe, Rauheit,
     Metall, Leuchten und Texturanteil aus einer Tabelle des Teams (Uniform-Felder), das Bild bleibt gleich
   - Olive + OliveDark -> ein Netz `Olive`, der dunklere Ton steckt in der Scheitelfarbe
   - unbewegte Knoten (Wanne, Sockel, Laufrollen, Kettenwangen) wandern in ein gemeinsames Netz an der Modellwurzel */
const MIX = ['Steel', 'Frame', 'Alloy', 'White', 'Hazard', 'Rubber', 'Gear', 'Team', 'Skin', 'Light', 'TailLight', 'Nozzle', 'Emblem', 'Glow',
  'Plant', 'Wood', 'Coil', 'Cloth', 'Canopy', 'Glass'];
const MIX_GLOSS = 100;   // Scheiben (Canopy/Glass) nur als Kleinteil ins Sammelnetz – große behalten ihre starke Spiegelung
// Knoten, die das Spiel bewegt oder ein-/ausblendet: Ihre Netze bleiben an ihnen hängen
const ANIM_NODE = /^(Turret|Gun|Rotor|TailRotor|Drum|Load|Dish|Crane|Rocket|Antenna|Gear|Torso|Arms|LegL|LegR|EmblemAxis|EmblemAllies|Wheel[FR][LR]?\d*)$/;
const matName = (o) => (o.material.name || 'X').replace(/\.\d+$/, '');
const triCount = (ge) => (ge.index ? ge.index.count : ge.attributes.position.count) / 3;

/** Netze [{ geo, mat, pal, shade }] zu einer Geometrie verbinden (mat = Lage im Zielknoten). kind 'mix': aPal, 'olive': aCamo + color. */
function mergeParts(parts, kind) {
  let nv = 0, ni = 0;
  for (const p of parts) { nv += p.geo.attributes.position.count; ni += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
  const pal = kind === 'mix' ? new Float32Array(nv) : null;
  const camo = kind === 'olive' ? new Float32Array(nv * 3) : null, col = kind === 'olive' ? new Float32Array(nv * 3) : null;
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3(), n3 = new THREE.Matrix3();
  let vo = 0, io = 0;
  for (const p of parts) {
    const a = p.geo.attributes, n = a.position.count;
    n3.getNormalMatrix(p.mat);
    for (let i = 0; i < n; i++) {
      const k = (vo + i) * 3;
      v.fromBufferAttribute(a.position, i).applyMatrix4(p.mat); pos[k] = v.x; pos[k + 1] = v.y; pos[k + 2] = v.z;
      v.fromBufferAttribute(a.normal, i).applyMatrix3(n3).normalize(); nor[k] = v.x; nor[k + 1] = v.y; nor[k + 2] = v.z;
      if (a.uv) { uv[(vo + i) * 2] = a.uv.getX(i); uv[(vo + i) * 2 + 1] = a.uv.getY(i); }
    }
    if (pal) pal.fill(p.pal, vo, vo + n);
    if (camo) { camo.set(a.aCamo.array, vo * 3); col.fill(p.shade, vo * 3, (vo + n) * 3); }
    if (p.geo.index) { const s = p.geo.index.array; for (let i = 0; i < s.length; i++) idx[io + i] = s[i] + vo; io += s.length; }
    else { for (let i = 0; i < n; i++) idx[io + i] = vo + i; io += n; }
    vo += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (pal) g.setAttribute('aPal', new THREE.BufferAttribute(pal, 1));
  if (camo) { g.setAttribute('aCamo', new THREE.BufferAttribute(camo, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

function optimizeModels() {
  const stub = { mix: new THREE.MeshStandardMaterial({ name: 'Mix' }), olive: new THREE.MeshStandardMaterial({ name: 'Olive' }) };
  const stat = { before: 0, after: 0, ms: performance.now() };
  for (const g of Object.values(A.models)) {
    const root = g.scene;
    root.updateMatrixWorld(true);
    const sets = new Map();   // Zielknoten -> { mix: [], olive: [] }
    const used = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      stat.before++;
      if (o.isSkinnedMesh || !o.geometry.attributes.normal) return;
      const name = matName(o), olive = name === 'Olive' || name === 'OliveDark', pi = MIX.indexOf(name);
      if (!olive && (pi < 0 || ((name === 'Canopy' || name === 'Glass') && triCount(o.geometry) > MIX_GLOSS))) return;
      let owner = o;
      while (owner !== root && !ANIM_NODE.test(owner.name)) owner = owner.parent;
      if (!sets.has(owner)) sets.set(owner, { mix: [], olive: [] });
      const mat = new THREE.Matrix4().copy(owner.matrixWorld).invert().multiply(o.matrixWorld);
      sets.get(owner)[olive ? 'olive' : 'mix'].push({ geo: o.geometry, mat, pal: pi, shade: name === 'OliveDark' ? 0.72 : 1 });
      used.push(o);
    });
    if (!used.length) { root.traverse((o) => { if (o.isMesh) stat.after++; }); continue; }
    /** Netz-Knoten zu einem leeren Knoten machen (Kinder, Lage und Name bleiben) */
    const demote = (m) => {
      const n = new THREE.Group();
      n.name = m.name; n.position.copy(m.position); n.quaternion.copy(m.quaternion); n.scale.copy(m.scale); n.userData = m.userData;
      while (m.children.length) n.add(m.children[0]);
      m.parent.add(n); m.parent.remove(m);
      if (sets.has(m)) { sets.set(n, sets.get(m)); sets.delete(m); }
      return n;
    };
    for (const o of used) {
      if (o.children.length || sets.has(o)) { demote(o); continue; }
      const pa = o.parent;
      pa.remove(o);
      if (pa !== root && !pa.children.length && !sets.has(pa) && !ANIM_NODE.test(pa.name)) pa.parent.remove(pa);   // leer gewordene Laufrollen-Knoten
    }
    for (const [owner, s] of sets) {
      for (const kind of ['mix', 'olive']) {
        if (!s[kind].length) continue;
        const mesh = new THREE.Mesh(mergeParts(s[kind], kind), stub[kind]);
        mesh.name = (owner.name || 'Root') + '_' + kind;
        owner.add(mesh);
      }
    }
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isMesh) stat.after++; });
  }
  stat.ms = Math.round(performance.now() - stat.ms);
  A.meshStat = stat;   // Kontrolle in der Konsole: Netze vorher/nachher, Dauer
}

const lumaCache = new Map();
/** Mittlere Helligkeit einer Farbtextur (linear) – ersetzt die Detailtextur bei Sammelmaterial-Einträgen ohne eigene Textur */
function avgLuma(tex) {
  if (lumaCache.has(tex)) return lumaCache.get(tex);
  const c = document.createElement('canvas'); c.width = c.height = 16;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(tex.image, 0, 0, 16, 16);
  const d = g.getImageData(0, 0, 16, 16).data, col = new THREE.Color();
  let s = 0;
  for (let i = 0; i < d.length; i += 4) { col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace); s += col.r * 0.299 + col.g * 0.587 + col.b * 0.114; }
  lumaCache.set(tex, s / 256);
  return s / 256;
}

/** Sammelmaterial: Farbe, Leuchten, Rauheit/Metall, Texturanteil je Scheitel aus der Tabelle (Reihenfolge MIX) des Teams. */
function mixMaterial(team) {
  const m = texMat('metal_plate', { color: 0xffffff, emissive: 0xffffff, roughness: 1, metalness: 0 });   // emissive weiß: Wracks schalten das Leuchten über emissive = 0 ab
  const C = [], E = [], P = [];
  for (const n of MIX) {
    const s = getMaterial(n, team), c = s.color.clone(), l = s.userData.luma || 0;
    const tex = s.map === A.tex.metal_plate.diff ? 1 : 0;
    if (s.map && !tex) c.multiplyScalar(l > 0 ? 1 + (avgLuma(s.map) * 2.2 - 1) * l : avgLuma(s.map));   // andere Detailtextur (Stoff): als Mittelwert einrechnen
    const e = s.emissive.clone().multiplyScalar(s.emissiveIntensity);
    C.push(new THREE.Vector3(c.r, c.g, c.b)); E.push(new THREE.Vector3(e.r, e.g, e.b));
    P.push(new THREE.Vector4(s.roughness, s.metalness, tex, l));
  }
  m.userData.key = 'mix';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uPalC = { value: C }; sh.uniforms.uPalE = { value: E }; sh.uniforms.uPalP = { value: P };
    sh.vertexShader = 'attribute float aPal;\nvarying float vPal;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPal = aPal;');
    sh.fragmentShader = `varying float vPal;\nuniform vec3 uPalC[${MIX.length}]; uniform vec3 uPalE[${MIX.length}]; uniform vec4 uPalP[${MIX.length}];\n` + sh.fragmentShader
      .replace('#include <map_fragment>', `
        int palI = int(vPal + 0.5);
        vec4 palP = uPalP[palI];   // Rauheit, Metall, Texturanteil, Luminanz-Detail (wie patchMaterial luma)
        vec4 palT = texture2D(map, vMapUv);
        float palL = dot(palT.rgb, vec3(0.299, 0.587, 0.114));
        diffuseColor.rgb *= uPalC[palI] * mix(vec3(1.0), palP.w > 0.0 ? mix(vec3(1.0), vec3(palL * 2.2), palP.w) : palT.rgb, palP.z);`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = palP.x * mix(1.0, texture2D(roughnessMap, vRoughnessMapUv).g, palP.z);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = palP.y;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n normal = normalize(mix(nonPerturbedNormal, normal, palP.z));')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= uPalE[palI];');
  };
  return m;
}

/** Tarnflecken auf einem Lackmaterial: Grundton = Materialfarbe, darüber dunkle, helle und schwarze Flecken der Partei
 *  (TEAMS[..].pattern). scale = Fleckendichte je Meter (Fahrzeuge/Gebäude grob, Uniformen fein). Kanten per fwidth geglättet. */
function addCamo(m, T, scale) {
  if (!T.pattern) return;
  const base = m.color, lum = (c) => c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
  const k = lum(base) / Math.max(lum(new THREE.Color(T.olive)), 1e-3);   // OliveDark/Uniform: Flecken im gleichen Helligkeitsverhältnis
  // zweiter Fleckenton = Teamfarbe (mit etwas Parteiton gemischt): die Verbandsfarbe ist großflächig auf Lack und Uniform zu sehen
  const cols = T.pattern.map((h, i) => { const c = new THREE.Color(h); if (i === 1) c.lerp(new THREE.Color(T.color), 0.72); c.multiplyScalar(k); return new THREE.Vector3(c.r / Math.max(base.r, 1e-3), c.g / Math.max(base.g, 1e-3), c.b / Math.max(base.b, 1e-3)); });
  m.userData.camo = true;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
    sh.uniforms.uCamoA = { value: cols[0] }; sh.uniforms.uCamoB = { value: cols[1] }; sh.uniforms.uCamoC = { value: cols[2] };
    sh.uniforms.uCamoS = { value: scale };
    sh.vertexShader = 'attribute vec3 aCamo;\nvarying vec3 vCamo;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvCamo = aCamo;');
    sh.fragmentShader = `varying vec3 vCamo;
uniform vec3 uCamoA, uCamoB, uCamoC; uniform float uCamoS;
float camoH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float camoN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(camoH(i), camoH(i + vec3(1, 0, 0)), f.x), mix(camoH(i + vec3(0, 1, 0)), camoH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(camoH(i + vec3(0, 0, 1)), camoH(i + vec3(1, 0, 1)), f.x), mix(camoH(i + vec3(0, 1, 1)), camoH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float camoF(vec3 p) { return camoN(p) * 0.62 + camoN(p * 2.07 + 5.1) * 0.26 + camoN(p * 4.3 + 9.7) * 0.12; }
float camoM(float n, float t) { float e = fwidth(n) * 1.2 + 0.004; return smoothstep(t - e, t + e, n); }
` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  {
    vec3 cp = vCamo * uCamoS * vec3(1.0, 1.7, 1.0);   // Flecken eher waagerecht gestreckt
    float a = camoM(camoF(cp), 0.54), b = camoM(camoF(cp + vec3(17.3, 3.1, 8.7)), 0.52) * (1.0 - a), c = camoM(camoF(cp * 1.9 + vec3(31.0, 7.0, 2.0)), 0.66);
    vec3 cr = mix(mix(mix(vec3(1.0), uCamoA, a), uCamoB, b), uCamoC, c);
    cr *= 0.95 + 0.1 * camoN(vCamo * uCamoS * 9.0);   // leichte Abnutzung
    diffuseColor.rgb *= cr;
  }`);
  };
}

// ------------------------------------------------------------------ Materialbibliothek
const matCache = new Map();
export const BLINK = [];   // rote Warnleuchten: blitzen im Takt (game.js)
/** Nach setupTeams (neue Parteien): Materialien neu aufbauen lassen */
export function clearMaterials() { matCache.clear(); BLINK.length = 0; }
function texMat(set, opts) {
  const t = A.tex[set];
  const m = new THREE.MeshStandardMaterial({ map: t.diff, normalMap: t.nor, roughnessMap: t.arm, ...opts });
  return m;
}

export function getMaterial(name, team = 0) {
  const key = name + '|' + team;
  if (matCache.has(key)) return matCache.get(key);
  const T = TEAMS[team] || TEAMS[0];
  let m, luma = 0;
  switch (name) {
    case 'Paint': {
      const c = new THREE.Color(T.paint).lerp(new THREE.Color(T.color), 0.38);
      m = texMat('metal_plate', { color: c, metalness: 0.25, roughness: 1.0 }); m.normalScale.set(0.5, 0.5); luma = 0.75; break;
    }
    case 'Steel': m = texMat('metal_plate', { color: 0x6a6f74, metalness: 0.55, roughness: 0.85 }); break;
    case 'Concrete': m = texMat('concrete_wall_008', { color: 0xd8d4cc, roughness: 1, metalness: 0, aoMap: A.tex.concrete_wall_008.arm }); break;
    case 'Pad': m = texMat('concrete_floor_worn_001', { color: 0xbdbab3, roughness: 1, metalness: 0 }); break;
    case 'Roof': m = texMat('corrugated_iron', { color: 0x9aa0a4, metalness: 0.5, roughness: 1 }); break;
    case 'Gear': m = new THREE.MeshStandardMaterial({ color: T.gear ?? 0x4d5433, roughness: 0.9, metalness: 0.05 }); break;
    case 'Rubber': m = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95, metalness: 0 }); break;
    case 'Glass': m = new THREE.MeshStandardMaterial({ color: 0x0a1218, roughness: 0.05, metalness: 0.6, envMapIntensity: 2 }); break;
    case 'Light': m = new THREE.MeshStandardMaterial({ color: 0xffe2b0, emissive: 0xffd28a, emissiveIntensity: 6 }); break;
    case 'RedLight': m = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 6 }); BLINK.push(m); break;
    case 'Alloy': m = texMat('metal_plate', { color: 0xc4c9ce, metalness: 0.4, roughness: 0.55 }); luma = 0.55; break;   // helles Stahlblech (Teslaturm)
    case 'Coil': m = new THREE.MeshStandardMaterial({ color: 0x7a1408, metalness: 0.7, roughness: 0.35 }); break;   // Teslaspule (tools/blender_towers.py)
    case 'Plasma': m = new THREE.MeshStandardMaterial({ color: 0x9fc4ff, emissive: 0x6c9bff, emissiveIntensity: 4 }); break;
    case 'Crystal': m = new THREE.MeshPhysicalMaterial({ color: 0xd8f0ff, emissive: 0x6fb8ff, emissiveIntensity: 1.6, metalness: 0, roughness: 0.05, clearcoat: 1, envMapIntensity: 2, flatShading: true }); break;
    case 'Frame': m = texMat('metal_plate', { color: 0x3a3d40, metalness: 0.6, roughness: 0.6 }); luma = 0.5; break;   // Rohrrahmen/Waffenaufbau (Buggy)
    case 'TailLight': m = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff2010, emissiveIntensity: 2.5 }); break;   // Rücklicht, leuchtet ruhig
    case 'Team': m = new THREE.MeshStandardMaterial({ color: T.color, emissive: T.color, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.1 }); break;   // Verbandsfarbe: leuchtet leicht, damit sie auch im Schatten erkennbar bleibt
    case 'White': m = texMat('metal_plate', { color: 0xc8c8c4, metalness: 0.2, roughness: 0.8 }); luma = 0.5; break;
    case 'Hazard': m = texMat('metal_plate', { color: 0xd89a10, metalness: 0.2, roughness: 0.9 }); luma = 0.6; break;
    case 'Marking': m = texMat('concrete_floor_worn_001', { color: 0xf0f0e8, roughness: 1 }); luma = 0.7; break;
    case 'Ore': m = new THREE.MeshPhysicalMaterial({ color: 0x3f9dff, metalness: 0.1, roughness: 0.12, emissive: 0x0b4cff, emissiveIntensity: 0.55, clearcoat: 1, envMapIntensity: 1.6 }); break;
    case 'Mix': m = mixMaterial(team); break;   // Sammelmaterial der zusammengefassten Netze (optimizeModels)
    case 'Olive': m = texMat('metal_plate', { color: T.olive ?? 0x7f8f48, metalness: 0.2, roughness: 1.0, vertexColors: true }); m.normalScale.set(0.4, 0.4); luma = 0.7; break;   // Scheitelfarbe: OliveDark = 0.72
    case 'OliveDark': m = texMat('metal_plate', { color: new THREE.Color(T.olive ?? 0x7f8f48).multiplyScalar(0.72), metalness: 0.2, roughness: 1.0 }); m.normalScale.set(0.4, 0.4); luma = 0.7; break;   // Flanken/Unterbau
    case 'Uniform': m = texMat('concrete_wall_008', { color: new THREE.Color(T.uniform ?? 0x9aab62).lerp(new THREE.Color(T.color), 0.22), roughness: 1, metalness: 0 }); luma = 0.8; break;   // Soldaten
    case 'Skin': m = new THREE.MeshStandardMaterial({ color: 0xc98d68, roughness: 0.75, metalness: 0 }); break;
    case 'Canopy': m = new THREE.MeshStandardMaterial({ color: 0x2f6a8c, roughness: 0.12, metalness: 0.4, envMapIntensity: 1.6 }); break;   // getönte Scheiben
    case 'Nozzle': m = new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.4, metalness: 0.8 }); break;   // Triebwerksdüsen
    case 'Emblem': m = new THREE.MeshStandardMaterial({ color: 0xe6dfcc, roughness: 0.55, metalness: 0.1 }); break;   // Embleme (Hammer/Schlüssel, Zahnrad, Stern)
    case 'Glow': m = new THREE.MeshStandardMaterial({ color: 0xffa040, emissive: 0xff6a10, emissiveIntensity: 3 }); break;   // Ofenglut (Waffenfabrik)
    case 'Plant': m = new THREE.MeshStandardMaterial({ color: 0x4f7a2c, roughness: 0.95, metalness: 0 }); break;   // Sträucher (Abschussbasis)
    case 'Wood': m = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.9, metalness: 0 }); break;   // Paletten, Kanthölzer
    case 'Asphalt': m = texMat('concrete_floor_worn_001', { color: 0x4a4d50, roughness: 1, metalness: 0 }); luma = 0.5; break;   // Start-/Rollbahn
    case 'Rock': m = texMat('aerial_rocks_02', { color: 0x8a837a, roughness: 1, metalness: 0 }); break;
    case 'Cloth': m = texMat('concrete_wall_008', { color: T.cloth ?? 0xa89670, roughness: 1, metalness: 0 }); luma = 0.8; break;
    case 'Leaves': m = texMat('forest_leaves_02', { color: 0x5d8f34, roughness: 1, metalness: 0, vertexColors: true }); luma = 0.85; break;
    case 'Needles': m = texMat('forest_leaves_02', { color: 0x3a6030, roughness: 1, metalness: 0, vertexColors: true }); luma = 0.85; break;
    case 'Bush': m = texMat('forest_leaves_02', { color: 0x7d9440, roughness: 1, metalness: 0, vertexColors: true }); luma = 0.85; break;
    case 'Bark': m = texMat('aerial_ground_rock', { color: 0x6a5240, roughness: 1, metalness: 0, vertexColors: true }); luma = 0.6; break;
    default: m = new THREE.MeshStandardMaterial({ color: 0x888888 });
  }
  if (name === 'Olive' || name === 'OliveDark') addCamo(m, T, 0.95);   // Fahrzeuge, Gebäude: Flecken ~0,6–0,9 m
  else if (name === 'Uniform') addCamo(m, T, 6.5);                     // Soldaten: feines Fleckenmuster (~12 cm)
  m.userData.luma = luma;
  patchMaterial(m, { luma });
  matCache.set(key, m);
  return m;
}

const RELIEF = 0.9;
const reliefCache = new Map();
/** Normalenkarte aus der Helligkeit einer gezeichneten Vorlage: Fugen, Luken und Kanten werden unter dem Sonnenlicht plastisch.
 *  Einmal je Bild (Zwischenspeicher nach Materialname), max. 1024 px. */
function reliefMap(map, name) {
  if (reliefCache.has(name)) return reliefCache.get(name);
  const img = map.image, w = Math.min(1024, img.width), h = Math.min(1024, img.height);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.filter = 'blur(0.8px)';
  g.drawImage(img, 0, 0, w, h);
  g.filter = 'none';
  const src = g.getImageData(0, 0, w, h), d = src.data;
  const H = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) H[i] = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.55 + d[i * 4 + 2] * 0.15) / 255;
  const S = 2.2;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - 1) * w, y1 = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const dx = (H[y * w + Math.min(w - 1, x + 1)] - H[y * w + Math.max(0, x - 1)]) * S;
      const dy = (H[y1 + x] - H[y0 + x]) * S;
      const l = 1 / Math.hypot(dx, dy, 1), i = (y * w + x) * 4;
      d[i] = (0.5 - dx * l * 0.5) * 255; d[i + 1] = (0.5 - dy * l * 0.5) * 255; d[i + 2] = (0.5 + l * 0.5) * 255; d[i + 3] = 255;
    }
  }
  g.putImageData(src, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.anisotropy = 4; t.colorSpace = THREE.NoColorSpace;
  reliefCache.set(name, t);
  return t;
}

/** Bildprojektions-Material der 2D-Vorlagen: Orange-Akzente werden zur Teamfarbe */
export function getArtMaterial(src, team) {
  const key = 'art|' + src.name + '|' + team;
  if (matCache.has(key)) return matCache.get(key);
  const T = TEAMS[team] || TEAMS[0];
  if (src.map) { src.map.anisotropy = 8; src.map.colorSpace = THREE.SRGBColorSpace; }
  let map = src.map, rk = src.name;
  const alt = T.faction === 'allies' && A.emblems && A.emblems[src.name];   // Allianz: Stern statt Emblem
  if (alt && map) { alt.flipY = map.flipY; alt.wrapS = map.wrapS; alt.wrapT = map.wrapT; alt.anisotropy = 8; map = alt; rk = src.name + '|allies'; }
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.72, metalness: 0.12, name: src.name });
  if (map && !/^Art_(side_tread|prop_)/.test(src.name)) {   // Relief aus der Zeichnung (Kettenband ausgenommen: läuft per UV-Versatz)
    m.normalMap = reliefMap(map, rk);
    m.normalScale.set(RELIEF, RELIEF);
  }
  const camo = T.camo ? new THREE.Vector3(...T.camo) : null;
  patchMaterial(m, src.name.startsWith('Art_prop_') ? {} : { accent: new THREE.Color(T.color), camo });   // Requisiten behalten ihre Farben
  matCache.set(key, m);
  return m;
}

function prepareProps() {
  for (const g of Object.values(A.props)) {
    g.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => patchMaterial(m));
      }
    });
  }
}

// ------------------------------------------------------------------ Instanziierung
/** Klont ein Blender-Modell für ein Team und sammelt die animierbaren Knoten. */
export function instantiate(id, team) {
  if (id === 'soldier') return instSoldier(team);
  const src = A.models[id].scene;
  if (src.getObjectByName('Torso')) return instFigure(id, team);
  const root = src.clone(true);
  const nodes = { root, muzzles: [], fx: [] };
  root.traverse((o) => {
    if (o.isMesh) {
      const name = o.material.name || 'X';
      o.material = name.startsWith('Art_') ? getArtMaterial(o.material, team) : getMaterial(name.replace(/\.\d+$/, ''), team);
      o.castShadow = true; o.receiveShadow = true;
    }
    const n = o.name;
    if (n === 'Turret') nodes.turret ??= o;
    else if (n === 'Gun') nodes.gun ??= o;
    else if (n === 'Rotor') nodes.rotor ??= o;
    else if (n === 'TailRotor') nodes.tailRotor ??= o;
    else if (n === 'Drum') nodes.drum ??= o;
    else if (n === 'Load') nodes.load ??= o;
    else if (n === 'Dish') nodes.dish ??= o;
    else if (n === 'Crane') nodes.crane ??= o;
    else if (n === 'Rocket') nodes.rocket ??= o;   // Atomrakete der Abschussbasis
    else if (n === 'Antenna') nodes.antenna ??= o;
    else if (n === 'Gear') nodes.gear ??= o;
    else if (n.startsWith('Muzzle')) nodes.muzzles.push(o);
    else if (/^Wheel[FRT][LR]?\d*$/.test(n)) (nodes.wheels ??= []).push(o);   // Räder/Laufrollen: Ursprung = Nabe, Radius userData.r, WheelF* lenken
    else if (n.startsWith('FX_')) nodes.fx.push({ obj: o, kind: n.slice(3).replace(/[._]?\d+$/, '') });   // 'FX_steam.001' heißt nach dem Laden 'FX_steam001'
    else if (n.startsWith('Exit')) nodes.exit = o;
    else if (n.startsWith('Dock')) nodes.dock = o;
  });
  // Gebäude-Embleme: Vorlage (Hammer/Schlüssel, Zahnrad mit Klingen) = Achsenmacht, Stern = Allianz
  const embAxis = root.getObjectByName('EmblemAxis'), embAllies = root.getObjectByName('EmblemAllies');
  if (embAxis && embAllies) {
    const allies = (TEAMS[team] || TEAMS[0]).faction === 'allies';
    embAxis.visible = !allies; embAllies.visible = allies;
  }
  // Kettenband: je Seite eigenes Material + eigene Texturkopie (Laufanimation per UV-Versatz)
  nodes.treads = [];
  for (const name of ['TrackL', 'TrackR']) {
    const tn = root.getObjectByName(name);
    if (!tn) continue;
    let mat = null;
    tn.traverse((o) => {
      if (!o.isMesh || !(o.material.name || '').startsWith('Art_side_tread')) return;
      if (!mat) {
        const src = o.material;
        mat = src.clone();
        mat.map = src.map.clone();
        mat.onBeforeCompile = src.onBeforeCompile; mat.customProgramCacheKey = src.customProgramCacheKey;
      }
      o.material = mat;
    });
    if (mat) nodes.treads.push(mat.map);
  }
  return nodes;
}

/** Soldat aus Einzelteilen (tools/prep_models.py): Torso > Arms (Waffe in den Händen), LegL/LegR. Gang und Waffenhaltung
 *  prozedural, Schnittstelle wie beim Mixamo-Soldaten (actions idle/walk/run, mixer.update, pose(k): 0 getragen, 1 Anschlag). */
function instFigure(id, team) {
  const root = A.models[id].scene.clone(true);
  const nodes = { root, model: root, muzzles: [], fx: [], figure: true };
  root.traverse((o) => {
    if (o.isMesh) { o.material = getMaterial((o.material.name || 'X').replace(/\.\d+$/, ''), team); o.castShadow = true; o.receiveShadow = false; }
    if (o.name.startsWith('Muzzle')) nodes.muzzles.push(o);
  });
  const torso = root.getObjectByName('Torso'), arms = root.getObjectByName('Arms');
  const legs = [root.getObjectByName('LegL'), root.getObjectByName('LegR')];
  const y0 = torso.position.y;
  const st = { mode: 'idle', ph: Math.random() * 6, run: 0, t: Math.random() * 9 };
  nodes.phase = (ph, t) => { st.ph = ph; st.t = t; };   // Simulation setzt die Phase (Mehrspieler: Mündungslage muss auf allen Rechnern gleich sein)
  const mk = (name) => {
    const a = { paused: false, play() { st.mode = name; a.paused = false; return a; }, reset() { a.paused = false; return a; }, fadeIn() { st.mode = name; return a; }, fadeOut() { return a; } };
    return a;
  };
  nodes.actions = { idle: mk('idle'), walk: mk('walk'), run: mk('run') };
  nodes.mixer = {
    update(dt) {
      if (nodes.actions[st.mode].paused) return;   // tot: Haltung einfrieren
      st.run += ((st.mode === 'idle' ? 0 : 1) - st.run) * Math.min(1, dt * 8);
      st.ph += dt * (st.mode === 'walk' ? 7 : 11) * st.run; st.t += dt;
      const s = Math.sin(st.ph) * st.run;
      legs[0].rotation.z = s * 0.6; legs[1].rotation.z = -s * 0.6;          // Beine schwingen um die Hüfte
      torso.position.y = y0 + Math.abs(Math.cos(st.ph)) * 0.035 * st.run + Math.sin(st.t * 2) * 0.006 * (1 - st.run);
      torso.rotation.z = -0.1 * st.run;                                      // beim Laufen leicht vorgebeugt
      torso.rotation.y = Math.sin(st.ph) * 0.07 * st.run;
    },
  };
  const carry = id === 'bazooka' ? -0.22 : -0.55;   // getragen: Waffe gesenkt (Werfer bleibt auf der Schulter)
  nodes.pose = (k) => { arms.rotation.z = carry * (1 - k); };
  nodes.pose(0);
  return nodes;
}

function instSoldier(team) {
  const g = A.models.soldier;
  const model = SkeletonUtils.clone(g.scene);
  const T = TEAMS[team] || TEAMS[0];
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = false;
      o.frustumCulled = false;
      const key = 'soldier|' + o.material.name + '|' + team;
      if (!matCache.has(key)) {
        const m = o.material.clone();
        m.color = new THREE.Color(T.uniform ?? 0x9aab62).lerp(new THREE.Color(T.color), 0.22);   // Uniform in Parteifarbe
        patchMaterial(m);
        matCache.set(key, m);
      }
      o.material = matCache.get(key);
    }
  });
  const wrap = new THREE.Group();
  model.rotation.y = -Math.PI / 2; // Modell blickt nach -Z -> Spielkonvention +X
  wrap.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = (n) => mixer.clipAction(A.soldierClips.find((c) => c.name === n));
  return { root: wrap, model, mixer, actions: { idle: clip('Idle'), walk: clip('Walk'), run: clip('Run') }, muzzles: [], fx: [] };
}

const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _id = new THREE.Vector3(), _ie = new THREE.Vector3();
const _iq = new THREE.Quaternion(), _iq2 = new THREE.Quaternion(), _iq3 = new THREE.Quaternion();

/** Dreht einen Knochen so, dass sein Kind von childPos nach toPos zeigt (kleinste Drehung, Weltkoordinaten). */
function aimBone(bone, childPos, toPos) {
  bone.getWorldPosition(_id);
  _ie.copy(childPos).sub(_id).normalize();
  _ic.copy(toPos).sub(_id).normalize();
  _iq.setFromUnitVectors(_ie, _ic);
  bone.getWorldQuaternion(_iq2).premultiply(_iq);
  bone.parent.getWorldQuaternion(_iq3).invert();
  bone.quaternion.copy(_iq3.multiply(_iq2));
  bone.updateMatrixWorld(true);
}

/** Zweigelenk-Arm (Oberarm, Unterarm, Hand) so stellen, dass die Hand target erreicht; der Ellbogen weicht nach pole aus. */
function armIK(upper, lower, hand, target, pole) {
  upper.getWorldPosition(_ia); lower.getWorldPosition(_ib); hand.getWorldPosition(_ic);
  const l1 = _ia.distanceTo(_ib), l2 = _ib.distanceTo(_ic);
  const dir = _ie.copy(target).sub(_ia);
  const d = Math.min(Math.max(dir.length(), Math.abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4);
  dir.normalize();
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const p = _id.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  const elbow = new THREE.Vector3().copy(_ia).addScaledVector(dir, a).addScaledVector(p, h);
  const reach = new THREE.Vector3().copy(_ia).addScaledVector(dir, d);
  aimBone(upper, lower.getWorldPosition(new THREE.Vector3()), elbow);
  aimBone(lower, hand.getWorldPosition(new THREE.Vector3()), reach);
}

/** Waffe an den Soldaten hängen: Sie sitzt am Oberkörper (Trageweise bzw. Anschlag), beide Hände greifen per Arm-IK an die Griffe.
 *  nodes.pose(k) stellt Waffe und Arme: k = 0 getragen (Gewehr schräg vor der Brust, Werfer geschultert), k = 1 im Anschlag. */
export function attachInfantryWeapon(nodes, launcher, team) {
  const find = (re) => { let b = null; nodes.model.traverse((o) => { if (o.isBone && re.test(o.name)) b ??= o; }); return b; };
  const bone = find(/Spine2$/);
  const R = [find(/RightArm$/), find(/RightForeArm$/), find(/RightHand$/)], L = [find(/LeftArm$/), find(/LeftForeArm$/), find(/LeftHand$/)];
  if (!bone) return;
  nodes.root.updateMatrixWorld(true);
  const ws = new THREE.Vector3(); bone.getWorldScale(ws);
  const parentScale = new THREE.Vector3(); nodes.root.getWorldScale(parentScale);
  const k = parentScale.x / ws.x;
  const g = new THREE.Group();
  const steel = getMaterial('Steel', team), paint = getMaterial('Paint', team);
  const rubber = getMaterial('Rubber', team), gear = getMaterial('Gear', team), teamMat = getMaterial('Team', team);
  // Teile entlang der Laufachse (+Z): Zylinder (r0 hinten, r1 vorn) bzw. Quader
  const cyl = (r0, r1, len, z, y, m, seg = 10) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, seg), m); o.rotation.x = Math.PI / 2; o.position.set(0, y, z); g.add(o); return o; };
  const bx = (w, h, len, z, y, m, rx = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, len), m); o.position.set(0, y, z); o.rotation.x = rx; g.add(o); return o; };
  if (launcher) {
    const y = 0.12;
    cyl(0.07, 0.07, 0.95, 0.05, y, gear);             // Rohr
    cyl(0.073, 0.073, 0.07, 0.36, y, teamMat);        // Teamring
    cyl(0.1, 0.07, 0.16, -0.5, y, steel);             // Düse hinten
    cyl(0.085, 0.085, 0.08, 0.5, y, steel);           // Mündungsring
    cyl(0.062, 0.062, 0.14, 0.6, y, steel);           // Gefechtskopf
    cyl(0.062, 0.012, 0.2, 0.77, y, gear);            // Spitze
    bx(0.035, 0.13, 0.05, 0.12, y - 0.12, rubber, 0.2);   // Griff
    bx(0.035, 0.11, 0.05, 0.3, y - 0.11, rubber);         // Vordergriff
    bx(0.05, 0.07, 0.16, 0.18, y + 0.1, steel);           // Visier
    bx(0.07, 0.035, 0.12, -0.2, y - 0.075, rubber);       // Schulterstütze
  } else {
    bx(0.05, 0.085, 0.3, 0.1, 0, steel);                  // Gehäuse
    bx(0.045, 0.06, 0.26, 0.37, 0.004, rubber);           // Handschutz
    cyl(0.014, 0.014, 0.24, 0.6, 0.01, steel, 6);         // Lauf
    cyl(0.022, 0.022, 0.07, 0.72, 0.01, steel, 6);        // Mündungsfeuerdämpfer
    bx(0.04, 0.07, 0.24, -0.16, -0.015, rubber);          // Schulterstütze
    bx(0.045, 0.1, 0.03, -0.285, -0.03, rubber);          // Schaftkappe
    bx(0.035, 0.11, 0.045, 0.02, -0.085, rubber, 0.3);    // Pistolengriff
    bx(0.03, 0.17, 0.06, 0.15, -0.115, steel, -0.2);      // Magazin
    bx(0.03, 0.04, 0.12, 0.12, 0.065, steel);             // Visier
    cyl(0.02, 0.02, 0.1, 0.12, 0.095, rubber, 8);         // Optik
    bx(0.012, 0.035, 0.012, 0.47, 0.05, steel);           // Korn
  }
  // Rucksack (Panzerjäger: mit Reserverakete) am oberen Rücken
  const spine = bone;
  {
    const pk = new THREE.Group();
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; pk.add(o); return o; };
    add(new THREE.BoxGeometry(0.3, 0.36, 0.15), gear, 0, 0.02, -0.19);
    add(new THREE.BoxGeometry(0.22, 0.14, 0.07), gear, 0, -0.06, -0.29);
    add(new THREE.BoxGeometry(0.14, 0.05, 0.01), teamMat, 0, 0.1, -0.27);   // Teamabzeichen
    add(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), rubber, 0, 0.23, -0.19).rotation.z = Math.PI / 2;   // Schlafrolle
    if (launcher) add(new THREE.CylinderGeometry(0.045, 0.045, 0.55, 8), steel, 0.19, 0.05, -0.2);          // Reserverakete
    pk.scale.setScalar(k);
    spine.add(pk);
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.scale.setScalar(k);
  g.rotation.order = 'YXZ';
  bone.add(g);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, launcher ? 0.12 : 0, launcher ? 0.7 : 0.6); g.add(muzzle);
  nodes.muzzles.push(muzzle);
  // Haltungen im Raum des Oberkörpers (x = links, y = oben, z = vorn; Meter): [Position, Neigung x, Drehung y]
  const carry = launcher ? [[-0.21, 0.2, 0.02], -0.42, 0.0] : [[-0.1, -0.08, 0.25], 0.3, 0.6];
  const aim = launcher ? [[-0.21, 0.19, 0.1], -0.25, 0.0] : [[-0.14, 0.09, 0.22], -0.42, 0.05];   // gleicht die Vorneigung des Oberkörpers aus -> Lauf waagerecht
  const gripR = new THREE.Object3D(), gripL = new THREE.Object3D();
  gripR.position.set(0, launcher ? 0.0 : -0.1, launcher ? 0.12 : 0.02);
  gripL.position.set(0, launcher ? 0.01 : -0.04, launcher ? 0.3 : 0.38);
  g.add(gripR, gripL);
  const tR = new THREE.Vector3(), tL = new THREE.Vector3(), pR = new THREE.Vector3(), pL = new THREE.Vector3(), q = new THREE.Quaternion();
  nodes.pose = (a) => {
    const lerp = (x, y) => x + (y - x) * a;
    g.position.set(lerp(carry[0][0], aim[0][0]) * k, lerp(carry[0][1], aim[0][1]) * k, lerp(carry[0][2], aim[0][2]) * k);
    g.rotation.x = lerp(carry[1], aim[1]); g.rotation.y = lerp(carry[2], aim[2]);
    if (!R[0] || !L[0]) return;
    nodes.model.updateMatrixWorld(true);
    gripR.getWorldPosition(tR); gripL.getWorldPosition(tL);
    bone.getWorldQuaternion(q);
    pR.set(-0.7, -1, -0.25).applyQuaternion(q); pL.set(0.7, -1, -0.1).applyQuaternion(q);   // Ellbogen nach unten außen
    armIK(R[0], R[1], R[2], tR, pR);
    armIK(L[0], L[1], L[2], tL, pL);
  };
  nodes.pose(0);
}

/** Verschneite Fassung einer Ast-/Laubkarte: weiße Flecken und Schleier nur dort, wo die Karte deckt. */
function snowyMap(map) {
  const img = map.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = 'rgba(232,238,246,0.42)'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 420; i++) {
    const x = Math.random() * c.width, y = Math.random() * c.height, r = 8 + Math.random() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(250,252,255,0.85)'); gr.addColorStop(1, 'rgba(250,252,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = map.flipY; t.wrapS = map.wrapS; t.wrapT = map.wrapT; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** Stadthäuser (tools/blender_city.py): Fassaden-, Schnee- und Farbfeld-Texturen aus dem GLB. */
function cityMaterial(src) {
  const name = src.name.replace(/\.\d+$/, ''), key = 'city|' + name;
  if (matCache.has(key)) return matCache.get(key);
  if (src.map) { src.map.anisotropy = 8; src.map.colorSpace = THREE.SRGBColorSpace; }
  const snow = name === 'City_snow';
  const m = new THREE.MeshStandardMaterial({ map: src.map, roughness: snow ? 0.95 : 0.8, metalness: snow ? 0 : 0.05, name, side: THREE.DoubleSide });   // Flächen sind einzeln gebaut -> beidseitig zeichnen
  if (snow) m.color.set(0xd4dae2);          // etwas dämpfen, sonst überstrahlt der Dachschnee in der Sonne
  else if (name !== 'City_trim' && src.map) { m.normalMap = reliefMap(src.map, name); m.normalScale.set(0.7, 0.7); }
  patchMaterial(m);
  matCache.set(key, m);
  return m;
}

/** Bäume/Büsche (tools/blender_trees.py): Karten mit Alpha-Textur aus dem GLB, beidseitig, Scheitelfarben. */
function treeMaterial(src, snow = false) {
  const name = src.name.replace(/\.\d+$/, ''), key = 'tree|' + name + (snow ? '|s' : '');
  if (matCache.has(key)) return matCache.get(key);
  const bark = name === 'Tree_bark';
  if (src.map) { src.map.anisotropy = 4; src.map.colorSpace = THREE.SRGBColorSpace; }
  const m = new THREE.MeshStandardMaterial({ map: snow && !bark ? snowyMap(src.map) : src.map, roughness: 0.92, metalness: 0, vertexColors: true, name,
    alphaTest: bark ? 0 : 0.32, side: bark ? THREE.FrontSide : THREE.DoubleSide, shadowSide: THREE.DoubleSide });
  if (name === 'Tree_leaf' && !snow) m.color.set(0xb9c6a8);   // Laub etwas gedeckter
  if (snow && !bark) m.color.set(0xdfe6ee);
  patchMaterial(m);
  if (!bark) {   // Karten: beide Seiten mit der vorgegebenen Normale (oben/außen) beleuchten, Rückseiten nicht abdunkeln
    const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.fragmentShader = sh.fragmentShader.replace('#include <normal_fragment_begin>',
        THREE.ShaderChunk.normal_fragment_begin.replace('float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;', 'float faceDirection = 1.0;'));
    };
    m.customProgramCacheKey = () => 'treecard';
  }
  matCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ Instanzierte statische Objekte
/** Erstellt InstancedMeshes für alle Meshes einer Vorlage. Gibt Objekt mit setMatrix(i, m) zurück. */
export function makeInstanced(scene, count, { shadow = true, team = -1, colorVar = false } = {}) {
  const parts = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh) return;
    let mat = o.material;
    if ((mat.name || '').startsWith('Tree_')) mat = treeMaterial(mat, A.snow);
    else if ((mat.name || '').startsWith('City_')) mat = cityMaterial(mat);
    else if (team >= 0) mat = getMaterial((mat.name || 'X').replace(/\.\d+$/, ''), 0);
    const im = new THREE.InstancedMesh(o.geometry, mat, count);
    im.castShadow = shadow; im.receiveShadow = true;
    im.userData.local = o.matrixWorld.clone();
    im.count = 0;
    im.frustumCulled = false;
    parts.push(im);
  });
  const tmp = new THREE.Matrix4();
  return {
    parts,
    setMatrix(i, m) { for (const p of parts) { tmp.multiplyMatrices(m, p.userData.local); p.setMatrixAt(i, tmp); } },
    setColor(i, c) { for (const p of parts) p.setColorAt(i, c); },
    setCount(n) { for (const p of parts) { p.count = n; p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; } },
    update() { for (const p of parts) { p.instanceMatrix.needsUpdate = true; if (p.instanceColor) p.instanceColor.needsUpdate = true; } },
  };
}

export function bboxOf(obj) { return new THREE.Box3().setFromObject(obj); }

// ------------------------------------------------------------------ Vorschaubilder für die Seitenleiste
export function renderThumbs(r, list, team) {
  const W = 192, H = 128;
  const prevSize = r.getSize(new THREE.Vector2()), prevPR = r.getPixelRatio();
  r.setPixelRatio(1);
  r.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.environment = A.env;
  scene.environmentIntensity = 0.9;
  scene.background = new THREE.Color(0x1b242b);
  const sun = new THREE.DirectionalLight(0xfff4e6, 3.2); sun.position.set(5, 10, 7); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x3a3428, 0.8));
  const cam = new THREE.PerspectiveCamera(30, W / H, 0.1, 500);
  for (const { key, model, launcher } of list) {
    const nodes = instantiate(model, team);
    if (nodes.figure) nodes.pose(1);
    if (model === 'soldier') {
      nodes.root.scale.setScalar(1);
      attachInfantryWeapon(nodes, launcher, team);
      nodes.actions.idle.play(); nodes.mixer.update(0.5);
    }
    if (nodes.load) nodes.load.visible = false;
    scene.add(nodes.root);
    nodes.root.rotation.y = -0.6;
    nodes.root.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(nodes.root);
    const c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3()).length();
    cam.position.set(c.x + s * 0.75, c.y + s * 0.6, c.z + s * 0.95);
    cam.lookAt(c);
    r.render(scene, cam);
    A.thumbs[key] = r.domElement.toDataURL('image/png');
    scene.remove(nodes.root);
  }
  r.setPixelRatio(prevPR);
  r.setSize(prevSize.x, prevSize.y, false);
}
