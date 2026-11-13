// Atomic Dawn – Vermittlungsserver für Mehrspieler (Lobby + Lockstep-Takt). Keine Abhängigkeiten: node server.js [port]
// Umgebung: PORT (Port, Standard 8091), MAX_ROOMS (Standard 200). Läuft hinter jedem TLS-Proxy des Hosters (wss://).
//
// Ablauf: Spieler verbinden sich per WebSocket, erstellen oder betreten einen Raum (4 Plätze: Mensch/KI/offen/geschlossen,
// Partei, Farbe, Team). Der Gastgeber startet; alle laden die Karte, dann schickt der Server alle 100 ms einen „Takt“ mit den
// Befehlen, die seit dem letzten Takt eingingen. Jeder Rechner rechnet denselben Spielverlauf (Lockstep), der Server rechnet nicht mit.
'use strict';
const http = require('http'), crypto = require('crypto');

const PORT = parseInt(process.env.PORT || process.argv[2], 10) || 8091;
const MAX_ROOMS = parseInt(process.env.MAX_ROOMS, 10) || 200;
const TURN_MS = 100;            // ein Takt = 100 ms Spielzeit (6 Simulationsschritte zu 1/60 s)
const MAX_MSG = 64 * 1024;      // größte Nachricht eines Spielers
const FACTIONS = ['allies', 'axis'];
const DIFFS = ['easy', 'normal', 'hard'];
const MAPS = [1, 7, 23, 42, 0];
const CREDITS = [5000, 10000, 20000];

const log = (...a) => console.log(new Date().toISOString(), ...a);

// ------------------------------------------------------------------ WebSocket (RFC 6455, nur Text)
function wsAccept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + acc + '\r\n\r\n');
  socket.setNoDelay(true);
  const ws = { socket, open: true, onmessage: null, onclose: null, alive: true };
  let buf = Buffer.alloc(0), frag = [];
  ws.send = (obj) => {
    if (!ws.open) return;
    const data = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj));
    const n = data.length;
    const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const h = Buffer.alloc(10); h[0] = 0x81; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); return h; })();
    socket.write(Buffer.concat([head, data]));
  };
  const ctrl = (op, payload = Buffer.alloc(0)) => { if (ws.open) socket.write(Buffer.concat([Buffer.from([0x80 | op, payload.length]), payload])); };
  ws.ping = () => ctrl(0x9);
  ws.close = () => { if (!ws.open) return; ctrl(0x8); ws.open = false; socket.end(); };
  const done = () => { if (ws.dead) return; ws.dead = true; ws.open = false; if (ws.onclose) ws.onclose(); };
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) return;
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; const big = buf.readBigUInt64BE(2); if (big > BigInt(MAX_MSG)) { socket.destroy(); return; } len = Number(big); off = 10; }
      if (len > MAX_MSG || !masked) { socket.destroy(); return; }   // Clients müssen maskieren
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4), data = Buffer.from(buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      buf = buf.subarray(off + 4 + len);
      ws.alive = true;
      if (op === 0x8) { ws.close(); done(); return; }
      if (op === 0x9) { ctrl(0xA, data.subarray(0, 125)); continue; }
      if (op === 0xA) continue;
      if (op === 0x1 || op === 0x0) {
        frag.push(data);
        if (frag.reduce((s, b) => s + b.length, 0) > MAX_MSG) { socket.destroy(); return; }
        if (!fin) continue;
        const text = Buffer.concat(frag).toString('utf8'); frag = [];
        let msg; try { msg = JSON.parse(text); } catch { continue; }
        if (ws.onmessage && msg && typeof msg === 'object') { try { ws.onmessage(msg); } catch (e) { log('Fehler', e.stack); } }
      }
    }
  });
  socket.on('close', done);
  socket.on('error', done);
  return ws;
}

// ------------------------------------------------------------------ Räume
const rooms = new Map();        // code -> Raum
const clients = new Map();      // id -> Spieler
let nextId = 1;

const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);
const pick = (v, list, d) => (list.includes(v) ? v : d);

function newCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) { let c = ''; for (let i = 0; i < 5; i++) c += A[crypto.randomInt(A.length)]; if (!rooms.has(c)) return c; }
}
function emptySlot(i) { return { kind: i < 2 ? 'open' : 'closed', cid: 0, name: '', faction: i % 2 ? 'axis' : 'allies', color: -1, ally: i % 2, diff: 'normal', ready: false }; }

// Spielmodi: Sollgröße der Teams (nur Team 0/1) bzw. null = ohne Vorgabe
const MODES = ['ffa', '2v2', '2v1', '3v1', 'free'];
const MODE_SIZES = { '2v2': [2, 2], '2v1': [2, 1], '3v1': [3, 1] };
const isActive = (s) => s.kind === 'human' || s.kind === 'ai';
/** Team für einen neu aktiven Platz: dasjenige, dem noch die meisten Spieler fehlen */
function assignTeam(r, i) {
  const want = MODE_SIZES[r.settings.mode]; if (!want) return;
  const n = [0, 0];
  r.slots.forEach((s, j) => { if (j !== i && isActive(s) && s.ally < 2) n[s.ally]++; });
  r.slots[i].ally = want[0] - n[0] >= want[1] - n[1] ? 0 : 1;
}
/** alle aktiven Plätze der Reihe nach neu auf die Teams verteilen (Moduswechsel) */
function rebalance(r) {
  const want = MODE_SIZES[r.settings.mode]; if (!want) return;
  const n = [0, 0];
  r.slots.forEach((s, i) => { if (!isActive(s)) return; const t = want[0] - n[0] >= want[1] - n[1] ? 0 : 1; s.ally = t; n[t]++; });
}

function roomView(r) {
  return { t: 'room', code: r.code, host: r.host, name: r.name, state: r.state, settings: r.settings,
    slots: r.slots.map((s) => ({ kind: s.kind, cid: s.cid, name: s.name, faction: s.faction, color: s.color, ally: s.ally, diff: s.diff, ready: s.ready })) };
}
function broadcast(r, msg) { const s = JSON.stringify(msg); for (const c of r.members) if (c.ws.open) c.ws.send(s); }
function sendRoom(r) { broadcast(r, roomView(r)); }
function listFor(ver) {
  return [...rooms.values()].filter((r) => r.ver === ver && r.state === 'lobby' && !r.priv)
    .map((r) => ({ code: r.code, name: r.name, mode: r.settings.mode, players: r.slots.filter((s) => s.kind === 'human').length, free: r.slots.filter((s) => s.kind === 'open').length }));
}
function err(c, text) { c.ws.send({ t: 'error', text }); }

/** freie Farbe (Index 0–7 in COLORS), von keinem anderen Platz belegt – Farben sind für alle Parteien dieselben */
function freeColor(r, faction, except) {
  const used = new Set(r.slots.filter((s, i) => i !== except && (s.kind === 'human' || s.kind === 'ai')).map((s) => s.color));
  for (let k = 0; k < 8; k++) if (!used.has(k)) return k;
  return 0;
}

function join(c, r) {
  if (r.state !== 'lobby') return err(c, 'Das Spiel läuft bereits.');
  const i = r.slots.findIndex((s) => s.kind === 'open');
  if (i < 0) return err(c, 'Der Raum ist voll.');
  leave(c);
  const s = r.slots[i];
  Object.assign(s, { kind: 'human', cid: c.id, name: c.name, ready: false });
  s.color = freeColor(r, s.faction, i);
  assignTeam(r, i);
  r.members.add(c); c.room = r; c.slot = i;
  c.ws.send({ t: 'joined', code: r.code, slot: i, you: c.id });
  sendRoom(r);
  broadcast(r, { t: 'chat', sys: true, text: `${c.name} ist beigetreten.` });
}

function leave(c) {
  const r = c.room;
  if (!r) return;
  r.members.delete(c);
  const i = c.slot;
  c.room = null; c.slot = -1;
  if (r.state === 'lobby') {
    if (i >= 0) Object.assign(r.slots[i], { kind: 'open', cid: 0, name: '', ready: false });
  } else if (c.pid >= 0) {
    // im Spiel: Platz übernimmt ab dem nächsten Takt die KI (auf allen Rechnern gleichzeitig)
    r.pending.push({ p: c.pid, c: { op: '_drop' } });
    c.pid = -1;
  }
  if (!r.members.size) { closeRoom(r); return; }
  if (r.host === c.id) r.host = [...r.members][0].id;
  if (r.state === 'loading' && [...r.members].every((x) => r.loaded.has(x.id))) beginTurns(r);
  if (r.state === 'lobby') broadcast(r, { t: 'chat', sys: true, text: `${c.name} hat den Raum verlassen.` });   // im Spiel meldet das der Takt ('_drop')
  sendRoom(r);
}

function closeRoom(r) { if (r.timer) clearInterval(r.timer); rooms.delete(r.code); log('Raum zu', r.code); }

function startGame(c, r) {
  if (r.host !== c.id || r.state !== 'lobby') return;
  const act = r.slots.filter((s) => s.kind === 'human' || s.kind === 'ai');
  if (act.length < 2) return err(c, 'Mindestens zwei Spieler oder KI-Gegner nötig.');
  const mode = r.settings.mode, want = MODE_SIZES[mode];
  if (want) {
    const need = want[0] + want[1], name = { '2v2': '2 gegen 2', '2v1': '2 gegen 1', '3v1': '3 gegen 1' }[mode];
    if (act.length !== need) return err(c, `Im Modus „${name}“ werden genau ${need} Spieler gebraucht (aktuell ${act.length}).`);
    const n = [act.filter((s) => s.ally === 0).length, act.filter((s) => s.ally === 1).length];
    if (n[0] !== want[0] || n[1] !== want[1]) return err(c, `Teamgrößen passen nicht: „${name}“ braucht ${want[0]} in Team 1 und ${want[1]} in Team 2 (aktuell ${n[0]} und ${n[1]}).`);
  } else if (mode === 'free' && new Set(act.map((s) => s.ally)).size < 2) return err(c, 'Alle sind im selben Team – mindestens zwei Teams nötig.');
  if (r.slots.some((s) => s.kind === 'human' && s.cid !== r.host && !s.ready)) return err(c, 'Noch nicht alle Mitspieler sind bereit.');
  // Plätze verdichten: nur belegte Plätze spielen mit (Startpositionen 0..n-1)
  const players = [];
  r.slots.forEach((s, i) => { if (s.kind === 'human' || s.kind === 'ai') players.push({ slot: i, ...s }); });
  if (mode === 'ffa') players.forEach((p, k) => { p.ally = k; });   // jeder gegen jeden: eigenes Team
  let order = players;
  if (want) {   // Verbündete benachbart aufstellen: Teams nach Größe absteigend, dann reihum (A1, B1, A2, B2 …)
    const teams = [0, 1].map((t) => players.filter((p) => p.ally === t)).sort((a, b) => b.length - a.length);
    order = [];
    for (let k = 0; k < Math.max(teams[0].length, teams[1].length); k++) for (const t of teams) if (t[k]) order.push(t[k]);
  }
  players.splice(0, players.length, ...order);
  r.map = players;
  for (const m of r.members) m.pid = players.findIndex((p) => p.cid === m.id);
  r.slotOf = new Map(players.map((p, k) => [p.slot, k]));
  r.state = 'loading'; r.turn = 0; r.pending = []; r.loaded = new Set(); r.hashes = new Map(); r.paused = false;
  const cfg = { seed: crypto.randomInt(1, 2 ** 31), map: r.settings.map || 1 + crypto.randomInt(99999), credits: r.settings.credits, fog: r.settings.fog,
    players: players.map((p) => ({ human: p.kind === 'human', name: p.kind === 'human' ? p.name : '', faction: p.faction, color: p.color, ally: p.ally, diff: p.diff })) };
  for (const m of r.members) m.ws.send({ t: 'start', cfg, me: m.pid });
  log('Start', r.code, players.length, 'Spieler');
  r.loadTimer = setTimeout(() => beginTurns(r), 60000);   // wer nach 60 s nicht geladen hat, muss aufholen
  sendRoom(r);
}

function beginTurns(r) {
  if (r.state !== 'loading') return;
  clearTimeout(r.loadTimer);
  r.state = 'game';
  broadcast(r, { t: 'go' });
  r.timer = setInterval(() => {
    if (r.paused) return;
    const c = r.pending; r.pending = [];
    broadcast(r, { t: 'turn', n: r.turn++, c });
  }, TURN_MS);
  sendRoom(r);
}

function onMessage(c, m) {
  const r = c.room;
  switch (m.t) {
    case 'hello':
      c.name = str(m.name, 20) || 'Spieler' + c.id; c.ver = str(m.ver, 40) || '?';
      c.ws.send({ t: 'welcome', id: c.id, rooms: listFor(c.ver) });
      return;
    case 'list': c.ws.send({ t: 'rooms', rooms: listFor(c.ver) }); return;
    case 'create': {
      if (!c.ver) return;
      if (rooms.size >= MAX_ROOMS) return err(c, 'Server ausgelastet – bitte später erneut versuchen.');
      const code = newCode();
      const room = { code, ver: c.ver, name: str(m.name, 32) || `Spiel von ${c.name}`, priv: !!m.priv, host: c.id, state: 'lobby', members: new Set(),
        settings: { map: 1, credits: 10000, fog: true, mode: 'ffa' }, slots: [0, 1, 2, 3].map(emptySlot), pending: [] };
      rooms.set(code, room);
      log('Raum', code, c.name);
      join(c, room);
      return;
    }
    case 'join': {
      const room = rooms.get(str(m.code, 8).toUpperCase());
      if (!room) return err(c, 'Raum nicht gefunden.');
      if (room.ver !== c.ver) return err(c, 'Der Raum nutzt eine andere Spielversion.');
      join(c, room);
      return;
    }
    case 'leave': leave(c); c.ws.send({ t: 'left' }); return;
    case 'chat': if (r && m.text) broadcast(r, { t: 'chat', from: c.name, slot: c.slot, text: str(m.text, 200) }); return;
  }
  if (!r) return;
  if (r.state === 'lobby') {
    if (m.t === 'slot') {
      const i = m.i | 0, s = r.slots[i];
      if (!s) return;
      const host = r.host === c.id, own = s.cid === c.id;
      if (!host && !own) return;
      const p = m.patch || {};
      if (host && p.kind && !own && ['open', 'closed', 'ai'].includes(p.kind)) {
        if (s.kind === 'human') return;   // Mitspieler nicht hinauswerfen
        s.kind = p.kind; s.name = ''; s.ready = false;
        if (p.kind === 'ai') { s.color = freeColor(r, s.faction, i); assignTeam(r, i); }
      }
      if (s.kind === 'human' && !own) { /* fremde Menschen: nur sie selbst ändern ihre Partei/Farbe */ }
      else {
        if (p.faction) s.faction = pick(p.faction, FACTIONS, s.faction);   // Farbe bleibt: Farben gelten für alle Parteien
        if (p.color !== undefined) { const k = p.color | 0; if (k >= 0 && k < 8 && !r.slots.some((o, j) => j !== i && (o.kind === 'human' || o.kind === 'ai') && o.color === k)) s.color = k; }
        if (p.ally !== undefined) s.ally = Math.max(0, Math.min(MODE_SIZES[r.settings.mode] ? 1 : 3, p.ally | 0));
        if (p.diff) s.diff = pick(p.diff, DIFFS, s.diff);
        if (own && p.ready !== undefined) s.ready = !!p.ready;
      }
      if (!own) s.ready = s.kind === 'human' ? s.ready : false;
      for (const o of r.slots) if (o.kind === 'human' && o.cid !== c.id && (p.faction || p.ally !== undefined || p.kind)) o.ready = false;   // Aufstellung geändert: Bereitschaft neu bestätigen
      sendRoom(r);
    } else if (m.t === 'settings' && r.host === c.id) {
      const p = m.patch || {};
      if (p.map !== undefined) r.settings.map = pick(p.map | 0, MAPS, r.settings.map);
      if (p.credits !== undefined) r.settings.credits = pick(p.credits | 0, CREDITS, r.settings.credits);
      if (p.fog !== undefined) r.settings.fog = !!p.fog;
      if (p.mode !== undefined && MODES.includes(p.mode) && p.mode !== r.settings.mode) { r.settings.mode = p.mode; rebalance(r); }
      for (const o of r.slots) if (o.kind === 'human' && o.cid !== c.id) o.ready = false;
      sendRoom(r);
    } else if (m.t === 'start') startGame(c, r);
    return;
  }
  // ---- im Spiel
  if (m.t === 'loaded' && r.state === 'loading') {
    r.loaded.add(c.id);
    if ([...r.members].every((x) => r.loaded.has(x.id))) beginTurns(r);
  } else if (m.t === 'cmd' && r.state === 'game' && c.pid >= 0 && m.c && typeof m.c.op === 'string' && m.c.op[0] !== '_') {
    c.rate = (c.rate || 0) + 1;
    if (c.rate > 40) return;   // höchstens 40 Befehle je Sekunde (Zähler wird jede Sekunde geleert)
    r.pending.push({ p: c.pid, c: m.c });
  } else if (m.t === 'hash' && r.state === 'game') {
    const n = m.n | 0;
    if (!r.hashes.has(n)) r.hashes.set(n, new Map());
    const h = r.hashes.get(n); h.set(c.id, m.h);
    if (h.size === r.members.size) {
      if (new Set(h.values()).size > 1 && !r.desync) { r.desync = n; broadcast(r, { t: 'desync', n }); log('Asynchron', r.code, 'Takt', n); }
      r.hashes.delete(n);
    }
    for (const k of r.hashes.keys()) if (k < n - 600) r.hashes.delete(k);
  } else if (m.t === 'pause' && r.state === 'game') {
    r.paused = !!m.on;
    broadcast(r, { t: 'paused', on: r.paused, by: c.name });
  }
}

// ------------------------------------------------------------------ HTTP + Upgrade
const server = http.createServer((req, res) => {
  const body = JSON.stringify({ name: 'Atomic Dawn Server', rooms: rooms.size, players: clients.size });
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
});
server.on('upgrade', (req, socket) => {
  const ws = wsAccept(req, socket);
  if (!ws) return;
  const c = { id: nextId++, ws, name: '', ver: '', room: null, slot: -1, pid: -1, rate: 0 };
  clients.set(c.id, c);
  ws.onmessage = (m) => onMessage(c, m);
  ws.onclose = () => { leave(c); clients.delete(c.id); };
});
// Verbindungen prüfen (tote Sockets nach 45 s entfernen), Befehlszähler leeren
setInterval(() => { for (const c of clients.values()) c.rate = 0; }, 1000);
setInterval(() => {
  for (const c of clients.values()) {
    if (!c.ws.alive) { c.ws.socket.destroy(); continue; }
    c.ws.alive = false; c.ws.ping();
  }
}, 20000);
server.listen(PORT, () => log(`Atomic Dawn Server auf Port ${PORT}`));
