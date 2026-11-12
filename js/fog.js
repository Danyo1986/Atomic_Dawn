// Kriegsnebel: Sichtbarkeitsraster des menschlichen Spielers + Shader-Patch für alle Materialien
import * as THREE from 'three';
import { MAPN, CELL, WORLD } from './config.js';

const data = new Uint8Array(MAPN * MAPN).fill(255);
const tex = new THREE.DataTexture(data, MAPN, MAPN, THREE.RedFormat, THREE.UnsignedByteType);
tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
tex.needsUpdate = true;

export const FOG = {
  data, tex,
  uniforms: { uFogTex: { value: tex }, uWorld: { value: WORLD }, uFogOn: { value: 0 } },
  explored: new Uint8Array(MAPN * MAPN),
  visible: new Uint8Array(MAPN * MAPN),
  enabled: true,
};

export const FOG_VERT_HEAD = 'varying vec2 vFogW;\n';
export const FOG_VERT_BODY = `
  vec4 fogW4 = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    fogW4 = instanceMatrix * fogW4;
  #endif
  vFogW = (modelMatrix * fogW4).xz;
`;
export const FOG_FRAG_HEAD = 'uniform sampler2D uFogTex; uniform float uWorld; uniform float uFogOn; varying vec2 vFogW;\n';
export const FOG_FRAG_BODY = `
  {
    vec2 fuv = vFogW / uWorld;
    float fv = texture2D(uFogTex, clamp(fuv, vec2(0.006), vec2(0.994))).r;
    float outside = max(max(-fuv.x, fuv.x - 1.0), max(-fuv.y, fuv.y - 1.0));
    if (outside > 0.0) fv = min(fv, mix(0.5, 0.3, clamp(outside * 6.0, 0.0, 1.0)));
    float b = fv < 0.5 ? mix(0.03, 0.5, fv * 2.0) : mix(0.5, 1.0, (fv - 0.5) * 2.0);
    vec3 gray = vec3(dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114)));
    vec3 c = mix(gray, gl_FragColor.rgb, smoothstep(0.35, 0.9, b)) * b;
    gl_FragColor.rgb = mix(gl_FragColor.rgb, c, uFogOn);
  }
`;

/** Patcht ein Standardmaterial: Kriegsnebel + optional Luminanz-Detailtextur (für eingefärbte Lacke). */
export function patchMaterial(mat, { luma = 0, accent = null, camo = null } = {}) {
  if (mat.userData.fogPatched) return mat;
  mat.userData.fogPatched = true;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    if (prev && prev !== THREE.Material.prototype.onBeforeCompile) prev(sh, r);
    Object.assign(sh.uniforms, FOG.uniforms);
    sh.vertexShader = FOG_VERT_HEAD + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + FOG_VERT_BODY);
    sh.fragmentShader = FOG_FRAG_HEAD + sh.fragmentShader.replace('#include <dithering_fragment>', FOG_FRAG_BODY + '\n#include <dithering_fragment>');
    if (luma > 0) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sdc = texture2D(map, vMapUv);
          float lum = dot(sdc.rgb, vec3(0.299, 0.587, 0.114));
          diffuseColor.rgb *= mix(vec3(1.0), vec3(lum * 2.2), ${luma.toFixed(2)});
        #endif`);
    }
    if (accent) {
      sh.uniforms.uAccent = { value: accent };
      sh.uniforms.uCamo = { value: camo || new THREE.Vector3(0, 0, 0) };
      sh.fragmentShader = 'uniform vec3 uAccent; uniform vec3 uCamo;' + String.fromCharCode(10) + sh.fragmentShader.replace('#include <map_fragment>', `
        #ifdef USE_MAP
          vec4 sdc = texture2D(map, vMapUv);
          vec3 c = sdc.rgb;
          float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
          // Orange: Rot dominiert, Grün deutlich darunter, Blau minimal
          float orange = smoothstep(0.18, 0.35, c.r) * (1.0 - smoothstep(0.56, 0.66, c.g / max(c.r, 1e-3))) * (1.0 - smoothstep(0.08, 0.2, c.b / max(c.r, 1e-3))) * smoothstep(0.5, 0.7, (mx - mn) / max(mx, 1e-3));
          float l = dot(c, vec3(0.3, 0.55, 0.15));
          vec3 tc = uAccent * (0.35 + l * 2.6);
          diffuseColor.rgb *= mix(c, tc, orange);
          // Parteifarbe: gezeichnetes Oliv/Grün (Wannen, Planen, Dächer) bekommt den Tarnton der Partei, Helligkeit bleibt
          if (uCamo.x + uCamo.y + uCamo.z > 0.0) {
            float sat = (mx - mn) / max(mx, 1e-3);
            float olive = smoothstep(0.1, 0.28, sat) * smoothstep(1.08, 1.4, c.g / max(c.b, 1e-3)) * smoothstep(0.7, 0.86, c.g / max(c.r, 1e-3)) * (1.0 - orange);
            vec3 cam = uCamo / dot(uCamo, vec3(0.3, 0.55, 0.15)) * l * 1.05;
            diffuseColor.rgb = mix(diffuseColor.rgb, cam, olive);
          }
          totalEmissiveRadiance += uAccent * orange * smoothstep(0.35, 0.6, c.r) * 0.6;
        #endif`).replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>');
    }
  };
  mat.customProgramCacheKey = () => 'fog' + luma + (accent ? 'acc' : '') + (mat.userData.camo ? 'camo' : '') + (mat.userData.key || '');   // Tarnmuster (assets.js addCamo) braucht ein eigenes Programm
  return mat;
}

export function cellIndex(x, z) {
  const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
  if (cx < 0 || cz < 0 || cx >= MAPN || cz >= MAPN) return -1;
  return cz * MAPN + cx;
}
export function isVisible(x, z) { if (!FOG.enabled) return true; const i = cellIndex(x, z); return i >= 0 && FOG.visible[i] === 1; }
export function isExplored(x, z) { if (!FOG.enabled) return true; const i = cellIndex(x, z); return i >= 0 && FOG.explored[i] === 1; }

/** Neu berechnen aus Sichtquellen [{x,z,r}] */
export function updateFog(sources) {
  const vis = FOG.visible, exp = FOG.explored;
  vis.fill(0);
  for (const s of sources) {
    const r = s.r / CELL, cx = s.x / CELL, cz = s.z / CELL;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MAPN - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(MAPN - 1, Math.ceil(cz + r));
    const r2 = r * r;
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx, dz = z + 0.5 - cz;
      if (dx * dx + dz * dz <= r2) { vis[z * MAPN + x] = 1; exp[z * MAPN + x] = 1; }
    }
  }
  const d = FOG.data;
  for (let i = 0; i < d.length; i++) {
    const target = !FOG.enabled ? 255 : vis[i] ? 255 : exp[i] ? 128 : 0;
    // weiche Übergänge über die Zeit
    d[i] = d[i] + Math.sign(target - d[i]) * Math.min(Math.abs(target - d[i]), 64);
  }
  FOG.tex.needsUpdate = true;
}
