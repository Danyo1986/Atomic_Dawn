// Minimaler statischer Server für Atomic Dawn (keine Abhängigkeiten)
// Aufruf: node server.js [port] [--no-open]
const http = require('http'), fs = require('fs'), path = require('path');
const port = parseInt(process.argv[2], 10) || 8090;
const root = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.jpg': 'image/jpeg', '.png': 'image/png', '.hdr': 'application/octet-stream', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.normalize(path.join(root, p));
  if (!f.startsWith(root) || f.includes(path.sep + 'tools' + path.sep) || f.includes(path.sep + 'raw' + path.sep) || f.includes(path.sep + 'dist' + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(f, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
}).listen(port, () => {
  const url = `http://localhost:${port}`;
  console.log(`Atomic Dawn läuft auf ${url}`);
  if (!process.argv.includes('--no-open')) require('child_process').exec((process.platform === 'win32' ? 'start ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + url);
});
