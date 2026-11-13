// Release für den Launcher bauen und optional veröffentlichen (öffentliches Repository Danyo1986/Atomic_Dawn).
//   node tools/release.mjs 1.0.0              -> dist/release/: AtomicDawn-Client-1.0.0-win-x64.zip, SHA256SUMS.txt, titelbild.jpg
//   node tools/release.mjs 1.0.0 --publish    -> zusätzlich Quelltext ins Repository (dist/repo), Tag v1.0.0, GitHub-Release mit den Dateien
// Voraussetzungen: Node 24 (baut AtomicDawn.exe als Single Executable Application), git, für --publish GitHub CLI (gh auth login).
// Paketinhalt: AtomicDawn.exe + nur die Dateien, die das Spiel zur Laufzeit lädt (versionierte Dateien, ohne Werkzeuge und Vorlagen).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const GAME = 'AtomicDawn';
const REPO = 'https://github.com/Danyo1986/Atomic_Dawn.git';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const version = process.argv[2];
const publish = process.argv.includes('--publish');
if (!/^\d+\.\d+\.\d+$/.test(version || '')) { console.error('Aufruf: node tools/release.mjs <x.y.z> [--publish]'); process.exit(1); }
// Nicht veröffentlichen: alter Mixamo-Soldat (Lizenz erlaubt keine Weitergabe als Datei, wird nicht mehr geladen)
const NEVER = [/^assets\/models\/soldier\.glb$/, /^assets\/raw\//, /^dist\//];

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const out = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

// Entwickelt wird im privaten Repository (Dinge). Das öffentliche Repository bekommt nur vollständige Updates,
// und zwar genau einen im privaten Repository committeten Stand – nie halbfertige Änderungen aus dem Arbeitsbaum.
let srcCommit = '';
if (publish) {
  const dirty = out('git', ['status', '--porcelain', '.'], { cwd: ROOT });
  if (dirty) {
    console.error('Abbruch: Im Spielordner gibt es nicht committete Änderungen. Erst im privaten Repository committen, dann veröffentlichen.\n' + dirty);
    process.exit(1);
  }
  srcCommit = out('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT });
  const tags = out('git', ['ls-remote', '--tags', REPO, `refs/tags/v${version}`], { cwd: ROOT });
  if (tags) { console.error(`Abbruch: v${version} ist schon veröffentlicht. Für ein Update eine höhere Version angeben.`); process.exit(1); }
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mb = (f) => (fs.statSync(f).size / 1048576).toFixed(1) + ' MB';

// ---------------------------------------------------------------- Dateilisten
/** Dateien des Spielordners laut git: versioniert oder neu, aber nicht ignoriert (Pfade relativ zu ROOT, mit /) */
function tracked() {
  return out('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '.'], { cwd: ROOT }).split('\0').filter(Boolean).filter((f) => fs.existsSync(path.join(ROOT, f)) && !NEVER.some((r) => r.test(f)));
}
/** Was das Spiel zur Laufzeit braucht (Texturordner aus TEX_SETS in js/assets.js) */
function runtimeFiles(all) {
  const src = fs.readFileSync(path.join(ROOT, 'js/assets.js'), 'utf8');
  const m = src.match(/const TEX_SETS = \[([\s\S]*?)\];/);
  if (!m) throw new Error('TEX_SETS nicht gefunden');
  const tex = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).concat(['emblems', 'water']));
  return all.filter((f) => {
    if (f === 'index.html' || /^(css|js|vendor)\//.test(f)) return true;
    if (/^assets\/(models|props|hdri)\//.test(f) || f === 'assets/title.webp' || f === 'favicon.ico') return true;
    const t = f.match(/^assets\/textures\/([^/]+)\//);
    return !!(t && tex.has(t[1]));
  });
}

// ---------------------------------------------------------------- AtomicDawn.exe
function buildExe(dir) {
  const [maj] = process.versions.node.split('.').map(Number);
  if (maj < 22) throw new Error('Node 22 oder neuer nötig (Single Executable Application)');
  const work = path.join(DIST, 'build');
  fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const main = path.join(work, 'launcher.js');
  fs.writeFileSync(main, fs.readFileSync(path.join(ROOT, 'launcher/launcher.js'), 'utf8').replace('__VERSION__', version));
  const blob = path.join(work, 'sea-prep.blob');
  fs.writeFileSync(path.join(work, 'sea-config.json'), JSON.stringify({ main, output: blob, disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
  run(process.execPath, ['--experimental-sea-config', path.join(work, 'sea-config.json')]);
  const exe = path.join(dir, GAME + '.exe');
  fs.copyFileSync(process.execPath, exe);
  // Programmsymbol + Versionsangaben einbetten (vor postject); Fehler sind nicht schlimm
  try {
    // rcedit@4 ist nur eine Bibliothek (kein npx-Programm): in den Arbeitsordner installieren und per Skript aufrufen
    run('npm', ['install', '--no-audit', '--no-fund', '--prefix', work, 'rcedit@4'], { shell: true });
    const rc = path.join(work, 'rcedit-run.mjs');
    fs.writeFileSync(rc, `import rcedit from 'rcedit';
await rcedit(${JSON.stringify(exe)}, { icon: ${JSON.stringify(path.join(ROOT, 'assets/icon.ico'))},
  'version-string': { ProductName: 'Atomic Dawn', FileDescription: 'Atomic Dawn', OriginalFilename: ${JSON.stringify(GAME + '.exe')} } });
`);
    run(process.execPath, [rc]);
  } catch (e) { console.warn('WARNUNG: Symbol konnte nicht eingebettet werden (rcedit): ' + e.message); }
  run('npx', ['--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { shell: true });
  setGuiSubsystem(exe);
  return exe;
}
/** PE-Kopf: Subsystem Konsole (3) -> Windows-Oberfläche (2), damit kein schwarzes Konsolenfenster aufgeht */
function setGuiSubsystem(exe) {
  const fd = fs.openSync(exe, 'r+');
  const b = Buffer.alloc(4);
  fs.readSync(fd, b, 0, 4, 0x3c);
  const pe = b.readUInt32LE(0);
  fs.readSync(fd, b, 0, 4, pe);
  if (b.toString('latin1') !== 'PE\0\0') throw new Error('kein PE-Programm');
  const sub = pe + 24 + 68;   // Optional Header + 68 = Subsystem (PE32 und PE32+)
  fs.readSync(fd, b, 0, 2, sub);
  if (b.readUInt16LE(0) !== 3 && b.readUInt16LE(0) !== 2) throw new Error('unerwartetes Subsystem ' + b.readUInt16LE(0));
  b.writeUInt16LE(2, 0);
  fs.writeSync(fd, b, 0, 2, sub);
  fs.closeSync(fd);
}

// ---------------------------------------------------------------- Paket
function copyList(list, dest) {
  for (const f of list) {
    const d = path.join(dest, f);
    fs.mkdirSync(path.dirname(d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), d);
  }
}

const all = tracked();
const rel = path.join(DIST, 'release');
const stage = path.join(DIST, 'stage');
fs.rmSync(rel, { recursive: true, force: true }); fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(rel, { recursive: true }); fs.mkdirSync(stage, { recursive: true });

const files = runtimeFiles(all);
copyList(files, stage);
buildExe(stage);
fs.writeFileSync(path.join(stage, 'version.txt'), version + '\n');
// Spielversion im Code (Mehrspieler: nur gleiche Versionen spielen zusammen)
const vf = path.join(stage, 'js/version.js');
fs.writeFileSync(vf, fs.readFileSync(vf, 'utf8').replace("VERSION = 'dev'", `VERSION = '${version}'`));
fs.copyFileSync(path.join(ROOT, 'vendor/three/LICENSE'), path.join(stage, 'vendor/three/LICENSE'));

const zipName = `${GAME}-Client-${version}-win-x64.zip`;
const zip = path.join(rel, zipName);
run(path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zip, '-C', stage, ...fs.readdirSync(stage)]);   // Windows-tar schreibt ZIP; AtomicDawn.exe liegt oben im ZIP
fs.copyFileSync(path.join(ROOT, 'titelbild.jpg'), path.join(rel, 'titelbild.jpg'));
const sums = [zipName, 'titelbild.jpg'].map((f) => `${sha256(path.join(rel, f))}  ${f}`).join('\n') + '\n';
fs.writeFileSync(path.join(rel, 'SHA256SUMS.txt'), sums);
console.log(`\nPaket: ${zip} (${mb(zip)}, ${files.length + 2} Dateien)\n${sums}`);

// ---------------------------------------------------------------- Veröffentlichen
if (publish) {
  const repo = path.join(DIST, 'repo');
  const gh = fs.existsSync('C:/Program Files/GitHub CLI/gh.exe') ? 'C:/Program Files/GitHub CLI/gh.exe' : 'gh';
  if (!fs.existsSync(path.join(repo, '.git'))) run('git', ['clone', REPO, repo]);
  // Anmeldung über die GitHub CLI – nur in diesem Klon (keine globale git-Einstellung)
  run('git', ['config', '--local', '--replace-all', 'credential.helper', ''], { cwd: repo });
  run('git', ['config', '--local', '--add', 'credential.helper', `!'${gh}' auth git-credential`], { cwd: repo });
  // Autor = angemeldetes GitHub-Konto mit noreply-Adresse – sonst nimmt git die globale
  // Identität (Firmenadresse), und GitHub ordnet den Commit einem anderen Konto zu.
  const [login, id] = out(gh, ['api', 'user', '--jq', '.login, .id']).split(/\s+/);
  if (!login || !/^\d+$/.test(id || '')) { console.error('Abbruch: GitHub-Konto nicht ermittelbar (gh auth status).'); process.exit(1); }
  run('git', ['config', '--local', 'user.name', login], { cwd: repo });
  run('git', ['config', '--local', 'user.email', `${id}+${login}@users.noreply.github.com`], { cwd: repo });
  run('git', ['fetch', 'origin'], { cwd: repo });
  if (out('git', ['branch', '-r'], { cwd: repo }).includes('origin/main')) run('git', ['merge', '--ff-only', 'origin/main'], { cwd: repo });
  // Quelltext spiegeln: versionierte Dateien rein, alles andere (außer .git) raus
  const want = new Set(all);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === '.git' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.relative(repo, path.join(d, e.name)).replace(/\\/g, '/')]));
  for (const f of walk(repo)) if (!want.has(f) && f !== '.gitignore') fs.rmSync(path.join(repo, f));
  copyList(all, repo);
  fs.writeFileSync(path.join(repo, '.gitignore'), 'assets/raw/\ndist/\nnode_modules/\n*.blend1\n');
  run('git', ['add', '-A'], { cwd: repo });
  if (out('git', ['status', '--porcelain'], { cwd: repo })) {
    run('git', ['commit', '-q', '-m', `Atomic Dawn ${version}\n\nStand des Entwicklungs-Repositorys: ${srcCommit}\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`], { cwd: repo });
  }
  run('git', ['tag', `v${version}`], { cwd: repo });
  run('git', ['push', '-u', 'origin', 'HEAD:main'], { cwd: repo });
  run('git', ['push', 'origin', `v${version}`], { cwd: repo });
  run(gh, ['release', 'create', `v${version}`, zip, path.join(rel, 'SHA256SUMS.txt'), path.join(rel, 'titelbild.jpg'),
    '--repo', 'Danyo1986/Atomic_Dawn', '--title', `Atomic Dawn ${version}`, '--notes', `Atomic Dawn ${version} – Windows-Paket für den Launcher (${zipName}).`, '--verify-tag']);
}
