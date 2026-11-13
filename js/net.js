import { VERSION } from './version.js';
// Mehrspieler-Client: Verbindung zum Vermittlungsserver (netserver/server.js), Lobby und Lockstep-Takt.
// Jeder Rechner rechnet das ganze Spiel selbst; ausgetauscht werden nur Befehle. Der Server schickt alle 100 ms einen Takt
// mit allen Befehlen; ein Takt = TPT Simulationsschritte zu TICK Sekunden. Wer zurückliegt, rechnet schneller nach.
export const TICK = 1 / 60;
export const TPT = 6;               // Schritte je Takt (6 × 1/60 s = 100 ms, passend zum Server)
const HASH_EVERY = 50;              // alle 5 s Prüfsumme an den Server (Erkennung „asynchron“)

export class Net {
  constructor() {
    this.ws = null; this.id = 0; this.state = 'off';   // off | connecting | lobby | room | game
    this.room = null; this.slot = -1; this.rooms = [];
    this.handlers = {};
    this.turns = []; this.cur = null; this.step = 0; this.acc = 0; this.done = -1;
    this.paused = false; this.go = false;
    this.ver = 'dev';
  }
  on(t, fn) { this.handlers[t] = fn; return this; }
  emit(t, m) { const h = this.handlers[t]; if (h) h(m); }

  /** Spielversion (js/version.js, im Paket von tools/release.mjs gesetzt) – nur gleiche Versionen spielen zusammen */
  async loadVersion() { this.ver = VERSION; return this.ver; }

  connect(url, name) {
    this.close();
    return new Promise((resolve, reject) => {
      let ws;
      try { ws = new WebSocket(url); } catch (e) { reject(new Error('Ungültige Serveradresse')); return; }
      this.ws = ws; this.state = 'connecting';
      const t = setTimeout(() => { reject(new Error('Server antwortet nicht')); ws.close(); }, 8000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', name, ver: this.ver }));
      ws.onerror = () => { clearTimeout(t); reject(new Error('Keine Verbindung zum Server')); };
      ws.onclose = () => {
        clearTimeout(t);
        const was = this.state;
        this.state = 'off'; this.ws = null;
        if (was !== 'off' && was !== 'connecting') this.emit('disconnect', { was });
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.t === 'welcome') { clearTimeout(t); this.id = m.id; this.rooms = m.rooms; this.state = 'lobby'; resolve(m); }
        this.handle(m);
      };
    });
  }
  close() { if (this.ws) { const w = this.ws; this.state = 'off'; this.ws = null; try { w.close(); } catch { /* egal */ } } this.reset(); }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  get connected() { return !!this.ws && this.ws.readyState === 1; }
  isHost() { return this.room && this.room.host === this.id; }

  reset() { this.turns = []; this.cur = null; this.step = 0; this.acc = 0; this.done = -1; this.paused = false; this.go = false; this.desync = false; }

  handle(m) {
    switch (m.t) {
      case 'rooms': this.rooms = m.rooms; break;
      case 'joined': this.slot = m.slot; this.state = 'room'; break;
      case 'room': this.room = m; if (this.state === 'lobby') this.state = 'room'; break;
      case 'left': this.room = null; this.slot = -1; this.state = 'lobby'; break;
      case 'start': this.reset(); this.state = 'game'; break;
      case 'go': this.go = true; break;
      case 'turn': this.turns.push(m); break;
      case 'paused': this.paused = m.on; break;
      case 'desync': this.desync = true; break;
    }
    this.emit(m.t, m);
  }

  // ---------------------------------------------------------------- Lockstep
  /** Befehl des lokalen Spielers: geht an den Server und wirkt im nächsten Takt auf allen Rechnern */
  cmd(c) { this.send({ t: 'cmd', c }); }

  /** Je Bild aufrufen: arbeitet eingegangene Takte im Echtzeittempo ab (zurückliegend: schneller).
   *  apply(list) führt die Befehle eines Takts aus, step() rechnet einen Simulationsschritt. Liefert die Zahl der Schritte. */
  pump(dt, apply, step, hash) {
    if (!this.go) return 0;   // bei Pause schickt der Server keine Takte mehr – schon eingegangene werden noch abgearbeitet
    const behind = this.turns.length;   // wartende Takte (0–1 normal, mehr = Rückstand)
    this.acc += dt * (behind > 3 ? 1 + Math.min(4, (behind - 3) * 0.5) : 1);
    let n = 0;
    while (this.acc >= TICK && n < 40) {
      if (!this.cur) {
        if (!this.turns.length) { this.acc = Math.min(this.acc, TICK * 2); break; }   // auf den nächsten Takt warten
        this.cur = this.turns.shift(); this.step = 0;
        apply(this.cur.c);
      }
      step(TICK);
      this.acc -= TICK; n++;
      if (++this.step >= TPT) {
        this.done = this.cur.n;
        if (this.onTurn) this.onTurn(this.done);   // Fehlersuche: Zustand je Takt mitschreiben
        if (this.done % HASH_EVERY === 0) this.send({ t: 'hash', n: this.done, h: hash() });
        this.cur = null;
      }
    }
    if (n >= 40) this.acc = Math.min(this.acc, TICK * TPT);
    return n;
  }
  /** Rückstand in Sekunden (für die Anzeige) */
  lag() { return (this.turns.length * TPT + (this.cur ? TPT - this.step : 0)) * TICK; }
}
