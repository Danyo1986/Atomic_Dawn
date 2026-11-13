// Mehrspieler-Menü: Verbindung zum Server, offene Spiele, Lobby mit 4 Plätzen (Mensch/KI/offen/geschlossen,
// Partei, Verbandsfarbe, Team, KI-Stufe), Chat. Startet der Gastgeber, ruft der Server bei allen app.startNet(cfg, me) auf.
import { FACTIONS, DIFFICULTY } from './config.js';

// Standard-Serveradresse für veröffentlichte Fassungen (leer = zuletzt benutzte bzw. lokaler Testserver)
export const DEFAULT_SERVER = '';
const LOCAL_SERVER = 'ws://localhost:8091';

const MODE_NAMES = { ffa: 'Jeder gegen jeden', '2v2': '2 gegen 2', '2v1': '2 gegen 1', '3v1': '3 gegen 1', free: 'Eigene Teams' };
const $ = (id) => document.getElementById(id);
const store = { get(k, d) { try { return localStorage.getItem('ad.' + k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem('ad.' + k, v); } catch { /* egal */ } } };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Lobby {
  constructor(app, net) {
    this.app = app; this.net = net;
    $('netServer').value = store.get('server', DEFAULT_SERVER || LOCAL_SERVER);
    $('netName').value = store.get('name', 'Kommandant' + Math.floor(Math.random() * 90 + 10));
    $('tabSolo').onclick = () => this.tab(false);
    $('tabNet').onclick = () => this.tab(true);
    $('btnConnect').onclick = () => this.connect();
    $('netName').onkeydown = (e) => { if (e.key === 'Enter') this.connect(); };
    $('btnRefresh').onclick = () => net.send({ t: 'list' });
    $('btnCreate').onclick = () => net.send({ t: 'create', name: `Spiel von ${$('netName').value.trim()}` });
    $('btnJoin').onclick = () => { const c = $('netCode').value.trim(); if (c) net.send({ t: 'join', code: c }); };
    $('netCode').onkeydown = (e) => { if (e.key === 'Enter') $('btnJoin').click(); };
    $('btnDisconnect').onclick = () => { net.close(); this.show(); };
    $('btnLeaveRoom').onclick = () => net.send({ t: 'leave' });
    $('btnReady').onclick = () => this.readyOrStart();
    $('btnChat').onclick = () => this.sendChat();
    $('chatIn').onkeydown = (e) => { if (e.key === 'Enter') this.sendChat(); };
    for (const [id, key, conv] of [['rsMap', 'map', Number], ['rsCredits', 'credits', Number], ['rsFog', 'fog', (v) => v === '1'], ['rsMode', 'mode', String]]) {
      $(id).onchange = (e) => net.send({ t: 'settings', patch: { [key]: conv(e.target.value) } });
    }
    net.on('rooms', () => this.show()).on('room', () => this.show()).on('joined', () => { this.clearChat(); this.show(); })
      .on('left', () => this.show())
      .on('error', (m) => this.status(m.text, true))
      .on('chat', (m) => this.chat(m))
      .on('start', (m) => { this.popClose(); app.startNet(m.cfg, m.me); })
      .on('disconnect', () => { if (app.state !== 'game') { this.status('Verbindung zum Server getrennt.', true); this.show(); } });
    document.addEventListener('mousedown', (e) => { if (this.pop && !this.pop.contains(e.target)) this.popClose(); });
    this.show();
  }

  tab(netOn) {
    $('tabSolo').classList.toggle('on', !netOn); $('tabNet').classList.toggle('on', netOn);
    $('soloView').classList.toggle('hidden', netOn); $('netView').classList.toggle('hidden', !netOn);
  }

  status(text, err = false) { const s = $('netStatus'); s.textContent = text || ''; s.classList.toggle('err', !!err); }

  async connect() {
    let url = $('netServer').value.trim(), name = $('netName').value.trim();
    if (!name) { this.status('Bitte einen Namen eingeben.', true); return; }
    if (!url) { this.status('Bitte die Serveradresse eingeben.', true); return; }
    if (!/^wss?:\/\//i.test(url)) url = (/^(localhost|127\.|\[::1\])/i.test(url) ? 'ws://' : 'wss://') + url;
    $('netServer').value = url;
    store.set('server', url); store.set('name', name);
    this.status('Verbinde …');
    $('btnConnect').disabled = true;
    try {
      await this.net.loadVersion();
      await this.net.connect(url, name);
      this.status('Verbunden.');
    } catch (e) { this.status(e.message, true); }
    $('btnConnect').disabled = false;
    this.show();
  }

  /** Ansicht nach Verbindungszustand: Verbinden | Raumliste | Lobby */
  show() {
    const n = this.net, st = n.connected ? (n.room && n.state !== 'lobby' ? 'room' : 'lobby') : 'off';
    $('netConnect').classList.toggle('hidden', st !== 'off');
    $('netRooms').classList.toggle('hidden', st !== 'lobby');
    $('netRoom').classList.toggle('hidden', st !== 'room');
    if (st === 'lobby') this.renderRooms();
    if (st === 'room') this.renderRoom();
  }

  renderRooms() {
    const box = $('roomList'), list = this.net.rooms || [];
    box.innerHTML = list.length ? '' : '<div class="none">Keine offenen Spiele – erstelle eins oder tritt per Code bei.</div>';
    for (const r of list) {
      const d = document.createElement('div');
      d.className = 'room';
      d.innerHTML = `<span>${esc(r.name)}</span><small>${r.players} Spieler · ${r.free} frei · ${esc(MODE_NAMES[r.mode] || MODE_NAMES.ffa)} · ${esc(r.code)}</small>`;
      d.onclick = () => this.net.send({ t: 'join', code: r.code });
      box.appendChild(d);
    }
  }

  renderRoom() {
    const n = this.net, r = n.room, host = n.isHost();
    if ($('netStatus').classList.contains('err')) this.status('');   // alte Fehlermeldung (z. B. falsche Spielerzahl) verschwindet, sobald sich der Raum ändert
    $('roomTitle').textContent = r.name;
    $('roomCode').textContent = r.code;
    $('rsMap').value = String(r.settings.map); $('rsCredits').value = String(r.settings.credits); $('rsFog').value = r.settings.fog ? '1' : '0'; $('rsMode').value = r.settings.mode || 'ffa';
    for (const id of ['rsMap', 'rsCredits', 'rsFog', 'rsMode']) $(id).disabled = !host;
    const box = $('slotList');
    box.innerHTML = '';
    r.slots.forEach((s, i) => box.appendChild(this.slotRow(r, s, i, host)));
    const me = r.slots.find((s) => s.cid === n.id);
    const btn = $('btnReady');
    if (host) { btn.textContent = 'Spiel starten'; btn.disabled = false; }
    else { btn.textContent = me && me.ready ? 'Nicht bereit' : 'Bereit'; }
  }

  slotRow(r, s, i, host) {
    const n = this.net, own = s.cid === n.id, active = s.kind === 'human' || s.kind === 'ai';
    const canEdit = own || (host && s.kind === 'ai');
    const row = document.createElement('div');
    row.className = 'slot' + (own ? ' me' : '') + (active ? '' : ' empty');
    const patch = (p) => n.send({ t: 'slot', i, patch: p });
    const sel = (opts, val, on, dis) => {
      const e = document.createElement('select');
      for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; e.appendChild(o); }
      e.value = String(val); e.disabled = !!dis; e.onchange = () => on(e.value);
      return e;
    };
    const no = document.createElement('div'); no.className = 'no'; no.textContent = i + 1;
    // Platz: Mensch (Name) bzw. für den Gastgeber wählbar Offen/Geschlossen/KI
    let who;
    if (s.kind === 'human') {
      who = document.createElement('div'); who.className = 'nm';
      who.innerHTML = esc(s.name) + (own ? ' <small>(Du)</small>' : '') + (s.cid === r.host ? ' <small>★</small>' : '');
    } else if (host) {
      who = sel([['open', 'Offen'], ['closed', 'Geschlossen'], ['ai', 'Computer']], s.kind, (v) => patch({ kind: v }));
    } else { who = document.createElement('div'); who.className = 'nm'; who.textContent = { open: 'Offen', closed: 'Geschlossen', ai: 'Computer' }[s.kind]; }
    row.append(no, who);
    if (!active) { for (let k = 0; k < 5; k++) row.appendChild(document.createElement('span')); return row; }
    row.appendChild(sel(Object.entries(FACTIONS).map(([k, f]) => [k, f.name]), s.faction, (v) => patch({ faction: v }), !canEdit));
    // Verbandsfarbe: Feld öffnet Auswahl (belegte Farben derselben Partei gesperrt)
    const col = FACTIONS[s.faction].colors[s.color] || FACTIONS[s.faction].colors[0];
    const sw = document.createElement('div');
    sw.className = 'sw' + (canEdit ? '' : ' ro'); sw.style.background = col[1]; sw.title = col[3] + ' · ' + col[2];
    if (canEdit) sw.onclick = (e) => { e.stopPropagation(); this.colorPop(sw, r, s, i, patch); };
    row.appendChild(sw);
    const mode = r.settings.mode || 'ffa';
    if (mode === 'ffa') { const d = document.createElement('div'); d.className = 'nm'; d.style.textAlign = 'center'; d.textContent = '–'; d.title = 'Jeder gegen jeden'; row.appendChild(d); }
    else row.appendChild(sel([0, 1, 2, 3].slice(0, mode === 'free' ? 4 : 2).map((k) => [k, 'Team ' + (k + 1)]), s.ally, (v) => patch({ ally: Number(v) }), !canEdit));
    if (s.kind === 'ai') row.appendChild(sel(Object.entries(DIFFICULTY).map(([k, d]) => [k, d.name]), s.diff, (v) => patch({ diff: v }), !host));
    else row.appendChild(document.createElement('span'));
    const ok = document.createElement('div'); ok.className = 'ok' + (s.kind === 'ai' || s.ready || s.cid === r.host ? ' on' : '');
    ok.title = s.kind === 'ai' ? 'Computer' : s.ready || s.cid === r.host ? 'Bereit' : 'Noch nicht bereit';
    row.appendChild(ok);
    return row;
  }

  colorPop(anchor, r, s, i, patch) {
    this.popClose();
    const pop = document.createElement('div');
    pop.className = 'swPop';
    const taken = new Set(r.slots.filter((o, j) => j !== i && (o.kind === 'human' || o.kind === 'ai')).map((o) => o.color));
    FACTIONS[s.faction].colors.forEach(([, css, unit, name], k) => {
      const b = document.createElement('button');
      b.style.background = css; b.title = name + (taken.has(k) ? ' (vergeben)' : '');
      b.disabled = taken.has(k); b.classList.toggle('on', k === s.color);
      b.onclick = () => { patch({ color: k }); this.popClose(); };
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    const rc = anchor.getBoundingClientRect();
    pop.style.left = Math.min(window.innerWidth - 150, rc.left) + 'px'; pop.style.top = (rc.bottom + 6) + 'px';
    this.pop = pop;
  }
  popClose() { if (this.pop) { this.pop.remove(); this.pop = null; } }

  readyOrStart() {
    const n = this.net, r = n.room;
    if (!r) return;
    if (n.isHost()) { n.send({ t: 'start' }); return; }
    const me = r.slots.findIndex((s) => s.cid === n.id);
    if (me >= 0) n.send({ t: 'slot', i: me, patch: { ready: !r.slots[me].ready } });
  }

  sendChat() { const t = $('chatIn').value.trim(); if (t) { this.net.send({ t: 'chat', text: t }); $('chatIn').value = ''; } }
  clearChat() { $('chatLog').innerHTML = ''; }
  chat(m) {
    if (this.app.state === 'game') { this.app.netChat(m); return; }
    const log = $('chatLog'), d = document.createElement('div');
    if (m.sys) { d.className = 'sys'; d.textContent = m.text; }
    else { const b = document.createElement('b'); b.textContent = m.from + ': '; d.append(b, document.createTextNode(m.text)); }
    log.appendChild(d); log.scrollTop = log.scrollHeight;
  }
}
