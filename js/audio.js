// Prozeduraler Sound (WebAudio) + Sprachansagen (speechSynthesis, deutsch)
let ctx = null, master = null, noiseBuf = null, comp = null;
export const AUDIO = { enabled: true, volume: 0.7, listener: { x: 0, z: 0, zoom: 80 }, speech: true, sfx: 1 };   // speech/sfx: Menü-Gefecht im Hintergrund leise und ohne Ansagen

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16; comp.ratio.value = 6;
  master = ctx.createGain(); master.gain.value = AUDIO.volume;
  master.connect(comp); comp.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  ambient();
}
export function setVolume(v) { AUDIO.volume = v; if (master) master.gain.value = v; }

function noise(dur, t0) {
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  return s;
}
function env(g, t0, a, peak, dec) {
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + a + dec);
}
function attenuation(x, z) {
  if (x === undefined) return 1;
  const L = AUDIO.listener;
  const d = Math.hypot(x - L.x, z - L.z);
  return Math.max(0, 1 - d / (90 + L.zoom)) * (1.2 - Math.min(0.7, L.zoom / 300));
}

const last = {};
export function play(kind, x, z) {
  if (!ctx || !AUDIO.enabled) return;
  const now = ctx.currentTime;
  if (last[kind] && now - last[kind] < 0.045) return; // Drosselung
  last[kind] = now;
  const vol = attenuation(x, z) * AUDIO.sfx;
  if (vol < 0.03) return;
  const out = ctx.createGain(); out.gain.value = vol;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan && x !== undefined) { pan.pan.value = Math.max(-1, Math.min(1, (x - AUDIO.listener.x) / 60)); out.connect(pan); pan.connect(master); } else out.connect(master);
  const t = now;
  const nz = (dur, type, f, q, a, peak, dec) => {
    const s = noise(dur, t); const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = ctx.createGain(); env(g, t, a, peak, dec); s.connect(fl); fl.connect(g); g.connect(out); return fl;
  };
  const tone = (type, f0, f1, dur, peak) => {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain(); env(g, t, 0.005, peak, dur); o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.05);
  };
  switch (kind) {
    case 'rifle': nz(0.12, 'bandpass', 2200, 0.8, 0.002, 0.5, 0.09); tone('square', 180, 60, 0.05, 0.15); break;
    case 'mg': nz(0.09, 'bandpass', 1900, 0.7, 0.002, 0.6, 0.06); tone('square', 160, 60, 0.04, 0.16); break;
    case 'autocannon': nz(0.2, 'lowpass', 1400, 0.7, 0.002, 0.8, 0.16); tone('sine', 140, 45, 0.15, 0.5); break;
    case 'cannon': nz(0.9, 'lowpass', 900, 0.6, 0.004, 1.2, 0.8); tone('sine', 90, 30, 0.6, 0.9); nz(0.08, 'highpass', 3000, 0.5, 0.001, 0.4, 0.06); break;
    case 'rocket': { const f = nz(0.9, 'bandpass', 900, 1.5, 0.05, 0.5, 0.8); f.frequency.exponentialRampToValueAtTime(2600, t + 0.8); break; }
    case 'mlrs': { const f = nz(1.2, 'bandpass', 600, 1.2, 0.03, 0.7, 1.1); f.frequency.exponentialRampToValueAtTime(2200, t + 1.1); tone('sine', 70, 40, 0.3, 0.4); break; }
    case 'zap': nz(0.5, 'highpass', 2500, 0.8, 0.002, 0.9, 0.45); tone('sawtooth', 95, 60, 0.4, 0.35); tone('square', 1900, 600, 0.12, 0.08); break;
    case 'beam': tone('sine', 1500, 2600, 0.35, 0.3); tone('triangle', 3100, 1800, 0.25, 0.12); nz(0.3, 'bandpass', 3500, 2, 0.01, 0.5, 0.25); break;
    case 'explosion': nz(1.8, 'lowpass', 700, 0.5, 0.005, 1.5, 1.6); tone('sine', 70, 25, 1.0, 1.0); break;
    case 'bigexplosion': nz(3, 'lowpass', 500, 0.5, 0.01, 2, 2.8); tone('sine', 55, 20, 1.6, 1.4); nz(0.4, 'bandpass', 1800, 0.6, 0.002, 0.6, 0.35); break;
    case 'hit': nz(0.25, 'bandpass', 1600, 1.2, 0.002, 0.5, 0.2); tone('triangle', 900, 300, 0.12, 0.15); break;
    case 'click': tone('sine', 1300, 900, 0.05, 0.25); break;
    case 'select': tone('sine', 700, 1050, 0.08, 0.2); break;
    case 'order': tone('sine', 520, 780, 0.07, 0.2); setTimeout(() => play('click'), 60); break;
    case 'deny': tone('square', 220, 160, 0.18, 0.12); break;
    case 'build': tone('triangle', 400, 800, 0.15, 0.25); break;
    case 'place': nz(0.6, 'lowpass', 400, 0.6, 0.01, 0.9, 0.5); tone('sine', 120, 60, 0.4, 0.5); break;
    case 'ready': tone('sine', 660, 660, 0.12, 0.2); setTimeout(() => { if (ctx) play('click'); }, 120); break;
    case 'cash': tone('sine', 1800, 1700, 0.04, 0.06); break;
  }
}

function ambient() {
  // leiser Wind
  const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
  const g = ctx.createGain(); g.gain.value = 0.05;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.03;
  lfo.connect(lg); lg.connect(g.gain); lfo.start();
  s.connect(f); f.connect(g); g.connect(master); s.start();
}

// ------------------------------------------------------------------ Sprachansagen
let voice = null, lastSay = {}, speaking = 0;
function pickVoice() {
  const vs = speechSynthesis.getVoices();
  voice = vs.find((v) => /de(-|_)DE/i.test(v.lang) && /male|Stefan|Conrad|Markus|Hedda|Katja/i.test(v.name)) || vs.find((v) => /^de/i.test(v.lang)) || null;
}
if (typeof speechSynthesis !== 'undefined') { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }

export function say(text, cooldown = 4) {
  if (!AUDIO.enabled || !AUDIO.speech || typeof speechSynthesis === 'undefined') return;
  const now = performance.now() / 1000;
  if (lastSay[text] && now - lastSay[text] < cooldown) return;
  if (now - speaking < 0.9) return;
  lastSay[text] = now; speaking = now;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'de-DE'; if (voice) u.voice = voice;
  u.rate = 1.05; u.pitch = 0.8; u.volume = Math.min(1, AUDIO.volume + 0.2);
  speechSynthesis.speak(u);
}
