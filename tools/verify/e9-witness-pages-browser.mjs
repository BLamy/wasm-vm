#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {retainSessionStore} from './e9-retain-session-store.mjs';
import {attackWitnessPages} from './e9-witness-pages-attacks.mjs';
import {controlV1WitnessArchives} from './e9-witness-pages-v1-control.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), opts = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]; assert(!opts[key]);
  if (['--development', '--mutate-middle'].includes(key)) opts[key] = true;
  else {assert(['--output', '--witnesses', '--web-root'].includes(key) && process.argv[i + 1]); opts[key] = process.argv[++i];}
}
assert.equal(opts['--witnesses'] ?? '130', '130'); assert(['web', 'web/dist'].includes(opts['--web-root'] ?? 'web/dist'));
const web = path.join(root, opts['--web-root'] ?? 'web/dist');
const out = path.resolve(opts['--output'] ?? path.join(root, 'target/evidence/e9-t22i-browser-' + new Date().toISOString().replace(/[:.]/g, '-'))); await fs.mkdir(out);
const sha = bytes => createHash('sha256').update(bytes).digest('hex'), git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const report = {task: 'E9-T22i', status: 'running', head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'),
  development: !!opts['--development'], started: new Date().toISOString(), errors: [], missing: [], external: [], raw: [], served: []};
if (!report.development) assert.equal(report.dirty, '', 'freeze source before acceptance');
await fs.copyFile(fileURLToPath(import.meta.url), path.join(out, 'executed-browser.mjs'));
await fs.copyFile(new URL('./e9-witness-pages-attacks.mjs', import.meta.url), path.join(out, 'executed-attacks.mjs'));
await fs.copyFile(new URL('./e9-witness-pages-v1-control.mjs', import.meta.url), path.join(out, 'executed-v1-control.mjs'));
let browser, context, page; const seen = new Map(), types = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.css': 'text/css'};
async function retainDatabase(database, directory) {
  const capture = await context.newPage();
  try {await capture.goto(report.origin + '/'); return await retainSessionStore(capture, database, directory);}
  finally {await capture.close();}
}
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://local').pathname);
    if (req.method === 'POST') {
      assert(/^\/__retain__\/(batch-\d{5}\.json|native-\d{5}\.(json|state)|witness-storage\.wvsession|attack-[-a-z0-9]+\.(json|bin)|legacy-v1\.wvsession)$/.test(name));
      const file = path.basename(name), hash = createHash('sha256'); let bytes = 0;
      const tap = new Transform({transform(part, encoding, done) {bytes += part.length; if (bytes > 64 * 1048576) return done(Error('raw transfer bound')); hash.update(part); done(null, part);}});
      await pipeline(req, tap, createWriteStream(path.join(out, file), {flags: 'wx'})); const ref = {file, bytes, sha256: hash.digest('hex')}; report.raw.push(ref);
      res.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(ref)); return;
    }
    if (name === '/favicon.ico') {res.writeHead(204).end(); return;}
    if (name === '/') {
      res.writeHead(200, {'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'})
        .end('<!doctype html><title>Paged native witness storage</title><h1>Native witness pages</h1><p>Storage and archive proof. Playback integration remains gated.</p><pre>Starting…</pre>'); return;
    }
    if (name.startsWith('/__legacy_metadata__/')) {
      const file = name.slice('/__legacy_metadata__/'.length); assert(['wasm_vm_session.js', 'wasm_vm_session_bg.wasm'].includes(file));
      const sourceGitRef = 'e52219ad5bbf70531f7237a0e72d187573e726a5', sourcePath = 'web/dist/session-pkg/' + file;
      const bytes = execFileSync('git', ['show', sourceGitRef + ':' + sourcePath], {cwd: root});
      if (file.endsWith('.wasm')) assert.equal(sha(bytes), 'b1a932a81ac46b74e03705a973274c7c50c8e01ab9c22060795f32e05d66377d');
      if (!seen.has(name)) {const ref = {path: name, bytes: bytes.length, sha256: sha(bytes), sourceGitRef, sourcePath}; seen.set(name, ref); report.served.push(ref);
        const copy = path.join(out, 'executed-web', name); await fs.mkdir(path.dirname(copy), {recursive: true}); await fs.writeFile(copy, bytes);}
      res.writeHead(200, {'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store'}).end(bytes); return;
    }
    if (name === '/__v1_manifest__') {
      const bytes = await fs.readFile(path.join(root, 'crates/storage/tests/session_manifest/fixtures/manifest-v1.json'));
      await fs.writeFile(path.join(out, 'v1-manifest-control.json'), bytes);
      res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}).end(bytes); return;
    }
    const file = path.resolve(web, '.' + name); assert(file.startsWith(web + path.sep)); const bytes = await fs.readFile(file), digest = sha(bytes);
    assert(!seen.has(name) || seen.get(name).sha256 === digest, 'served source changed');
    if (!seen.has(name)) {const ref = {path: name, bytes: bytes.length, sha256: digest}; seen.set(name, ref); report.served.push(ref);
      const copy = path.join(out, 'executed-web', name); await fs.mkdir(path.dirname(copy), {recursive: true}); await fs.writeFile(copy, bytes);}
    res.writeHead(200, {'Content-Type': types[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'}).end(bytes);
  } catch (error) {report.missing.push({url: req.url, error: String(error.stack ?? error)}); if (!res.headersSent) res.writeHead(500); res.end();}
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const origin = 'http://127.0.0.1:' + server.address().port; report.origin = origin;
  browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-gpu', '--use-gl=angle', '--use-angle=metal']}); report.browser = browser.version();
  const cdp = await browser.newBrowserCDPSession(); const hardware = await cdp.send('SystemInfo.getInfo'); report.hardware = {gpu: hardware.gpu, modelName: hardware.modelName, modelVersion: hardware.modelVersion, commandLine: hardware.commandLine};
  context = await browser.newContext({viewport: {width: 1100, height: 800}, serviceWorkers: 'block'}); await context.tracing.start({screenshots: true, snapshots: false, sources: true}); page = await context.newPage();
  page.on('console', message => {if (message.type() === 'error') report.errors.push(message.text());}); page.on('pageerror', error => report.errors.push(error.stack));
  page.on('request', request => {if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) report.external.push(request.url());}); page.on('websocket', socket => report.external.push(socket.url()));
  await page.exposeFunction('__witnessProgress', async row => {await fs.writeFile(path.join(out, 'progress.json'), JSON.stringify(row, null, 2) + '\n'); console.log(JSON.stringify(row));});
  await page.goto(origin + '/'); report.result = await page.evaluate(async () => {
    const {runWitnessPages} = await import('/witness-pages-probe.js');
    return runWitnessPages({database: 'wasm-vm-sessions-v1-e9-t22i-pages', id: 'witness-pages', notify: async row => {
      document.querySelector('pre').textContent = JSON.stringify(row, null, 2); await globalThis.__witnessProgress(row);
    }, retain: async (name, bytes) => {const response = await fetch('/__retain__/' + name, {method: 'POST', body: bytes}); if (!response.ok) throw Error('raw transfer'); return response.json();}});
  });
  assert.equal(report.result.status, 'passed', report.result.error); assert.equal(report.result.pages.count, 130); assert(report.result.checkpoints > 63);
  assert(report.result.tailRows >= 1 && report.result.tailRows < 16, 'recorded final tail must be partial');
  assert.equal(report.result.rawWitnesses.length, 130); assert(report.result.pages.maxPageRows <= 16 && report.result.pages.maxPageBytes <= 8192);
  assert.equal(report.result.maxResidentRows, 16); assert.equal(report.result.archive.witnesses, 130);
  if (opts['--mutate-middle']) {
    report.legacyV1 = await controlV1WitnessArchives(page, report.result);
    report.legacyV1.retained = await retainDatabase(report.legacyV1.database, path.join(out, 'legacy-v1'));
  }
  if (opts['--mutate-middle']) report.attacks = await attackWitnessPages(page, report.result);
  report.retained = await retainDatabase(report.result.database, path.join(out, 'saved'));
  report.imported = await retainDatabase(report.result.importedDatabase, path.join(out, 'imported'));
  await page.screenshot({path: path.join(out, 'witness-pages.png')});
  assert.deepEqual(report.errors, []); assert.deepEqual(report.external, []); assert.deepEqual(report.missing, []);
  for (const row of report.served) assert.equal(sha(row.sourceGitRef ? execFileSync('git', ['show', row.sourceGitRef + ':' + row.sourcePath], {cwd: root}) : await fs.readFile(path.join(web, '.' + row.path))), row.sha256, 'source changed after serve');
  assert.equal(git('rev-parse', 'HEAD'), report.head); report.status = 'passed';
} catch (error) {report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;}
finally {
  if (context) await context.tracing.stop({path: path.join(out, 'browser-trace.zip')}).catch(() => {}); await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({status: report.status, failure: report.failure, output: out}));
