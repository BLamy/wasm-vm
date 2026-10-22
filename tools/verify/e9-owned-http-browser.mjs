#!/usr/bin/env node
// Complete immutable Alpine image + exact owned I/O qualification, never a benchmark pass.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createWriteStream, createReadStream} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {verifyCapturedHttp} from './e9-owned-http-wire.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
assert(process.argv.length === 4 && process.argv[2] === '--output', 'usage: --output NEW_DIRECTORY');
const output = path.resolve(process.argv[3]), web = path.join(root, 'web/dist'); await fs.mkdir(output);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const contract = JSON.parse(await fs.readFile(path.join(root, 'docs/design/session-replay-contract.json'), 'utf8'));
const fixture = contract.fixtures.find(f => f.id === 'software-alpine-v1');
const fixtureManifest = await fs.readFile(path.join(root, fixture.manifest));
assert.equal(sha(fixtureManifest), fixture.manifest_sha256, 'original boot manifest identity');
assert.deepEqual(JSON.parse(fixtureManifest).artifacts, fixture.artifacts);
const imageBytes = await fs.readFile(path.join(web, 'session-alpine-image.json')), image = JSON.parse(imageBytes);
const firstChunk = new Map(); image.chunks.forEach((id, index) => {if (!firstChunk.has(id)) firstChunk.set(id, index);});
const disk = await fs.open(path.join(root, 'releases/rootfs/alpine-rootfs.ext4'), 'r');
assert.equal((await disk.stat()).size, image.image_len);
const imageHash = createHash('sha256');
for await (const bytes of createReadStream(path.join(root, fixture.artifacts.rootfs.url))) imageHash.update(bytes);
const rawImageSha256 = imageHash.digest('hex');
assert.equal(rawImageSha256, fixture.artifacts.rootfs.sha256, 'complete immutable rootfs identity');
const report = {task: 'E9-T22b', scope: 'real full Alpine HTTP OFF/ON and exact zero-live replay; provider seam only, not the full T22c/d workload or performance claim', status: 'running',
  head: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  dirty: execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim(),
  started: new Date().toISOString(), errors: [], missing: [], external: [], chunks: [], raw: [], inputs: {image: sha(imageBytes), rawImage: rawImageSha256, bootManifest: sha(fixtureManifest)}};
for (const file of ['tools/verify/e9-owned-http-browser.mjs', 'tools/verify/e9-owned-http-page.mjs', 'tools/verify/e9-owned-http-wire.mjs', 'web/owned-http-probe.js', 'docs/design/session-replay-contract.json', 'web/dist/pkg/wasm_vm_wasm_bg.wasm']) report.inputs[file] = sha(await fs.readFile(path.join(root, file)));
for (const name of ['tools/verify/e9-owned-http-browser.mjs', 'tools/verify/e9-owned-http-page.mjs', 'tools/verify/e9-owned-http-wire.mjs', 'web/owned-http-probe.js', 'docs/design/session-replay-contract.json']) {
  const file = path.join(output, 'executed-source', name); await fs.mkdir(path.dirname(file), {recursive: true});
  const bytes = await fs.readFile(path.join(root, name)); assert.equal(sha(bytes), report.inputs[name]); await fs.writeFile(file, bytes, {flag: 'wx'});
}
const types = {'.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm'};
let browser, context, page, origin;
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (request.method === 'POST') {
      assert(/^\/__proof__\/((initial|final|replay|failure)\.resume|(receipts|witnesses)\.json)$/.test(name));
      const file = path.basename(name), hash = createHash('sha256'); let length = 0;
      const tap = new Transform({transform(chunk, encoding, done) {length += chunk.length; if (length > 320 * 1048576) return done(Error('native bound')); hash.update(chunk); done(null, chunk);}});
      await pipeline(request, tap, createWriteStream(path.join(output, file), {flags: 'wx'}));
      const row = {file, bytes: length, sha256: hash.digest('hex')}; report.raw.push(row);
      response.writeHead(200, {'Content-Type': 'application/json'}).end(JSON.stringify(row)); return;
    }
    if (name === '/favicon.ico') {response.writeHead(204).end(); return;}
    let bytes, mime;
    if (name === '/') {bytes = Buffer.from('<!doctype html><meta charset="utf-8"><title>E9 full Alpine qualification</title><pre>Qualifying the full pinned Alpine guest. No performance claim.</pre>'); mime = 'text/html';}
    else if (/^\/chunks\/[0-9a-f]{64}\.bin$/.test(name)) {
      const id = path.basename(name, '.bin'), index = firstChunk.get(id); assert(index !== undefined, 'unknown base chunk');
      bytes = Buffer.alloc(image.chunk_size); const read = await disk.read(bytes, 0, bytes.length, index * image.chunk_size);
      assert.equal(read.bytesRead, bytes.length); assert.equal(sha(bytes), id, 'raw image chunk identity');
      report.chunks.push({sha256: id, index, bytes: bytes.length}); mime = 'application/octet-stream';
    } else {
      const base = name.startsWith('/releases/') || name.startsWith('/tools/verify/') ? root : web;
      const file = path.resolve(base, '.' + name); assert(file.startsWith(base + path.sep)); bytes = await fs.readFile(file); mime = types[path.extname(file)] ?? 'application/octet-stream';
    }
    response.writeHead(200, {'Content-Type': mime, 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'}).end(bytes);
  } catch (error) {report.missing.push({url: request.url, error: String(error)}); if (!response.headersSent) response.writeHead(404); response.end();}
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({headless: true, executablePath: process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  report.browser = browser.version(); context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1200, height: 900}});
  await context.tracing.start({screenshots: true, snapshots: true, sources: true}); page = await context.newPage();
  page.on('console', message => {if (message.type() === 'error') report.errors.push(message.text());});
  page.on('pageerror', error => report.errors.push(error.stack));
  page.on('request', request => {if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) report.external.push(request.url());});
  page.on('websocket', socket => report.external.push(socket.url()));
  await page.exposeFunction('qualificationProgress', async progress => {await fs.writeFile(path.join(output, 'progress.json'), JSON.stringify(progress, null, 2)); console.log(JSON.stringify(progress));});
  await page.goto(origin + '/');
  report.result = await page.evaluate(async contract => {const {qualifyOwnedHttp} = await import('/tools/verify/e9-owned-http-page.mjs'); return qualifyOwnedHttp(contract);}, contract);
  for(const mode of report.result.modes??[]) await fs.writeFile(path.join(output, 'guest-console-'+mode.mode+'.txt'), mode.console);
  await page.screenshot({path: path.join(output, 'qualification.png')});
  assert.equal(report.result.status, 'owned-http-full-alpine-off-on-replay', report.result.error);
  report.wire=verifyCapturedHttp(JSON.parse(await fs.readFile(path.join(output,'receipts.json'),'utf8')));
  for(const mode of report.result.modes) for(const body of mode.bodies) {
    assert.equal(body.hex,Buffer.alloc(1024,17+body.index).toString('hex'));
    assert.equal(body.sha256,sha(Buffer.alloc(1024,17+body.index)));
    assert.equal(body.sha256,report.wire.streams[body.index-1].bodySha256);
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.missing, []); assert.deepEqual(report.external, []);
  report.status = 'owned-http-full-alpine-off-on-replay';
} catch (error) {report.status = 'failed'; report.error = error.stack ?? String(error); process.exitCode = 1;}
finally {
  report.finished = new Date().toISOString(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  if (context) await context.tracing.stop({path: path.join(output, 'browser-trace.zip')}).catch(() => {});
  await browser?.close(); await new Promise(resolve => server.close(resolve)); await disk.close();
}
console.log(JSON.stringify({status: report.status, error: report.error, output}));
