// Startprogramm von Atomic Dawn (wird von tools/release.mjs zu AtomicDawn.exe gebaut: Node Single Executable Application)
// - startet den statischen Server nur auf 127.0.0.1 (nicht im Netzwerk erreichbar)
// - öffnet das Spiel in einem eigenen Edge-Fenster (App-Modus, eigenes Profil), sonst Chrome, sonst Standardbrowser
// - beendet sich, wenn das Spielfenster geschlossen wird (Abmeldung beim Schließen bzw. ausbleibender Herzschlag)
// Ohne Bau testen: node launcher/launcher.js [--no-open]
'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');

const VERSION = '__VERSION__';
let isSea = false;
try { isSea = require('node:sea').isSea(); } catch { /* ältere Node-Versionen */ }
const ROOT = isSea ? path.dirname(process.execPath) : path.join(__dirname, '..');
const DATA = path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'AtomicDawn');
const PORT = 47190;            // fest, damit ein zweiter Start das laufende Spiel findet
const HEARTBEAT_LOST = 180e3;  // ohne Herzschlag so lange warten (ausgeblendete Fenster drosseln Zeitgeber stark)
const BYE_GRACE = 4e3;         // nach dem Schließen: kurz warten, ob die Seite nur neu geladen wurde

fs.mkdirSync(DATA, { recursive: true });
const logFile = path.join(DATA, 'launcher.log');
try { if (fs.statSync(logFile).size > 512e3) fs.unlinkSync(logFile); } catch { /* noch keine Datei */ }
const log = (...a) => { try { fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${a.join(' ')}\n`); } catch { /* egal */ } if (!isSea) console.log(...a); };

/** Fehlermeldung als Fenster (das Programm hat keine Konsole) */
function fail(msg) {
  log('FEHLER', msg);
  const ps = `Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show(@'\n${msg}\n'@, 'Atomic Dawn', 'OK', 'Error') | Out-Null`;
  try { cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }); } catch { /* keine Anzeige möglich */ }
  process.exit(1);
}

if (!fs.existsSync(path.join(ROOT, 'index.html'))) fail(`Spieldateien nicht gefunden (index.html fehlt in ${ROOT}).\nBitte das Spiel neu installieren.`);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.ico': 'image/x-icon', '.svg': 'image/svg+xml',
};
// Herzschlag: die Seite meldet sich alle 5 s und beim Schließen ab
const HEART = `<script>(()=>{const p=()=>fetch('/__alive',{cache:'no-store'}).catch(()=>{});p();setInterval(p,5000);
addEventListener('pagehide',()=>navigator.sendBeacon('/__bye'));})();</script>`;

let lastBeat = 0, byeTimer = null;
const beat = () => { lastBeat = Date.now(); if (byeTimer) { clearTimeout(byeTimer); byeTimer = null; } };

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/__alive') { beat(); res.writeHead(204); return res.end(); }
  if (url === '/__bye') {
    res.writeHead(204); res.end();
    if (!byeTimer) byeTimer = setTimeout(() => { log('Spielfenster geschlossen – Ende'); process.exit(0); }, BYE_GRACE);
    return;
  }
  if (url === '/__atomicdawn') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok ' + VERSION); }
  let p;
  try { p = decodeURIComponent(url); } catch { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT + path.sep) || /[\\/](tools|raw|launcher|dist)[\\/]/i.test(f.slice(ROOT.length)) || f.toLowerCase().endsWith('.exe')) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    if (p === '/index.html') {   // Herzschlag einhängen
      return fs.readFile(f, 'utf8', (e, html) => {
        if (e) { res.writeHead(500); return res.end(); }
        const body = Buffer.from(html.replace('</body>', HEART + '</body>'));
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
        res.end(body);
      });
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
});

/** Edge (immer auf Windows 10/11), sonst Chrome */
function findBrowser() {
  const pf = [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean);
  const cand = [];
  for (const b of pf) cand.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
  for (const b of pf) cand.push(path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
  return cand.find((c) => fs.existsSync(c));
}

function openWindow(url) {
  if (process.argv.includes('--no-open')) return;
  const exe = findBrowser();
  if (exe) {
    const args = [`--app=${url}`, `--user-data-dir=${path.join(DATA, 'Browser')}`, '--no-first-run', '--no-default-browser-check',
      '--start-maximized', '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate'];
    log('Starte', exe);
    const ch = cp.spawn(exe, args, { detached: true, stdio: 'ignore' });
    ch.on('error', (e) => { log('Browserstart fehlgeschlagen:', e.message); cp.exec(`start "" "${url}"`, { windowsHide: true }); });
    ch.unref();
  } else {
    log('Kein Edge/Chrome gefunden – Standardbrowser');
    cp.exec(`start "" "${url}"`, { windowsHide: true });
  }
}

/** Läuft das Spiel schon? Dann nur ein weiteres Fenster öffnen. */
function probe(cb) {
  const rq = http.get({ host: '127.0.0.1', port: PORT, path: '/__atomicdawn', timeout: 1500 }, (r) => {
    let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => cb(d.startsWith('ok')));
  });
  rq.on('error', () => cb(false));
  rq.on('timeout', () => { rq.destroy(); cb(false); });
}

function start(port) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && port !== 0) {
      probe((ours) => {
        if (ours) { log('Läuft bereits – öffne Fenster'); openWindow(`http://127.0.0.1:${PORT}/`); setTimeout(() => process.exit(0), 1500); }
        else start(0);   // Port belegt von einem anderen Programm: freien Port nehmen
      });
    } else fail('Der Spielserver konnte nicht starten:\n' + e.message);
  });
  server.listen(port, '127.0.0.1', () => {
    const url = `http://127.0.0.1:${server.address().port}/`;
    log(`Atomic Dawn ${VERSION} läuft auf ${url} (Dateien: ${ROOT})`);
    openWindow(url);
    // ohne Herzschlag beenden: nie gemeldet (Fenster ging nicht auf) bzw. zu lange stumm
    const t0 = Date.now();
    setInterval(() => {
      const quiet = Date.now() - (lastBeat || t0);
      if (quiet > (lastBeat ? HEARTBEAT_LOST : 120e3) && !process.argv.includes('--no-open')) { log('Kein Herzschlag mehr – Ende'); process.exit(0); }
    }, 5e3).unref();
  });
}

process.on('uncaughtException', (e) => log('Ausnahme', e && e.stack || e));
start(PORT);
