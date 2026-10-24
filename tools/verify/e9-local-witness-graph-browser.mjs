#!/usr/bin/env node
// Continue the failed C publication in a copy of its original Chrome profile.
// This is a K boundary proof, not a shortened C qualification.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = {};
for (let at = 2; at < process.argv.length; at++) {
  const key = process.argv[at];
  if (key === '--development') {assert(!args.development); args.development = true; continue;}
  assert(['--desktop', '--candidate', '--output'].includes(key) && !args[key] && process.argv[at + 1]);
  args[key] = process.argv[++at];
}
assert(args['--desktop'] && args['--candidate'] && args['--output']);
const desktop = path.resolve(args['--desktop']), candidateFile = path.resolve(args['--candidate']);
const output = path.resolve(args['--output']), web = path.join(root, 'web/dist');
await fs.mkdir(output);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceReportBytes = await fs.readFile(path.join(desktop, 'report.json'));
const sourceReport = JSON.parse(sourceReportBytes);
assert.equal(sourceReport.status, 'failed');
assert.match(sourceReport.failure, /BundleBound: archive byte\/object bound/);
const origin = sourceReport.failure.match(/http:\/\/127\.0\.0\.1:[0-9]+/)[0];
const port = Number(new URL(origin).port);
const saved = JSON.parse(await fs.readFile(path.join(desktop, 'saved/storage.json')));
const session = saved.stores.sessions[0];
assert.equal(saved.stores.sessions.length, 1);
assert.equal(session.value.revision, '262');
const candidate = await fs.readFile(candidateFile), candidateManifest = JSON.parse(candidate);
assert.equal(candidateManifest.id, session.key);
assert.equal(candidateManifest.checkpoints.at(-1).id, 'cold-127');
assert.equal(candidateManifest.end.transition, '6400000000');
const profile = path.join(output, 'chrome-profile');
const sourceProfile = path.join(desktop, 'chrome-profile');
assert.equal(path.basename(sourceReport.browserContext.directory), 'chrome-profile');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim();
if (!args.development) assert.equal(dirty, '', 'freeze source before acceptance');
execFileSync('cp', ['-cR', sourceProfile, profile], {stdio: 'pipe'});
const report = {task: 'E9-T22k', scope: 'Original failed browser profile, exact cold-127 local publication/reopen/GC and portable refusal; not C completion',
  head, dirty, development: !!args.development, sourceReportSha256: sha(sourceReportBytes), candidateSha256: sha(candidate), origin,
  scriptSha256: sha(await fs.readFile(fileURLToPath(import.meta.url))),
  started: new Date().toISOString(), status: 'running', errors: [], httpErrors: [], external: [], served: []};
const seen = new Map();
const types = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
  '.json': 'application/json', '.html': 'text/html', '.css': 'text/css'};
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, origin).pathname);
    if (name === '/favicon.ico') {response.writeHead(204).end(); return;}
    let bytes, type = 'application/octet-stream';
    if (name === '/') {bytes = Buffer.from('<!doctype html><title>Local witness graph proof</title><pre>Running</pre>'); type = 'text/html';}
    else if (name === '/__candidate__.json') {bytes = candidate; type = 'application/json';}
    else {
      const file = path.resolve(web, '.' + name);
      assert(file.startsWith(web + path.sep));
      bytes = await fs.readFile(file); type = types[path.extname(file)] ?? type;
      const digest = sha(bytes);
      assert(!seen.has(name) || seen.get(name) === digest, 'served source changed');
      if (!seen.has(name)) {seen.set(name, digest); report.served.push({name, sha256: digest, bytes: bytes.length});}
    }
    response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store',
      'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'}).end(bytes);
  } catch (error) {
    report.httpErrors.push({url: request.url, error: String(error)});
    if (!response.headersSent) response.writeHead(404);
    response.end();
  }
});
let context, page;
try {
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(port, '127.0.0.1', resolve);});
  context = await chromium.launchPersistentContext(profile, {headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--enable-gpu', '--use-gl=angle', '--use-angle=metal'], serviceWorkers: 'block'});
  await context.tracing.start({screenshots: true, snapshots: false, sources: true});
  page = await context.newPage();
  page.on('console', message => {if (message.type() === 'error') report.errors.push(message.text());});
  page.on('pageerror', error => report.errors.push(String(error.stack ?? error)));
  page.on('request', request => {if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) report.external.push(request.url());});
  await page.goto(origin + '/');
  report.result = await page.evaluate(async id => {
    const need = (value, message) => {if (!value) throw Error(message);};
    const {SessionStore} = await import('/session-store.js');
    const {exportSessionBundle} = await import('/session-bundles.js');
    const {exportSessionWitnessArchive} = await import('/session-witness-archives.js');
    const {inventoryWitnessGraph} = await import('/session-witness-graph.js');
    const bytes = new Uint8Array(await (await fetch('/__candidate__.json')).arrayBuffer());
    const store = await SessionStore.open(id.database);
    const before = await store.openSession(id.session);
    need(before?.revision === '262', 'original committed prefix');
    const writer = await store.writer(id.session);
    let published;
    try {published = await writer.publish(bytes);} finally {await writer.release();}
    need(published.revision === '263', 'candidate published');
    const reopened = await store.openSession(id.session);
    need(reopened?.revision === '263', 'candidate reopened');
    need(reopened.manifest.length === bytes.length && reopened.manifest.every((value, index) => value === bytes[index]), 'candidate bytes changed');
    const graph = await inventoryWitnessGraph(store, reopened.manifest, {scope: 'local'});
    need(graph.refs.length === 1172, 'candidate closure changed');
    const logicalBytes = reopened.manifest.length + graph.refs.reduce((sum, ref) => sum + Number(ref.length), 0);
    need(logicalBytes === 4311983484, 'candidate logical bytes changed');
    const refused = [];
    for (const options of [{}, {scope: 'local'}]) {
      try {await exportSessionWitnessArchive(store, id.session, options); throw Error('portable archive accepted');}
      catch (error) {need(error.code === 'BundleBound', 'archive refusal ' + error.message); refused.push(error.code);}
    }
    try {await exportSessionBundle(store, id.session); throw Error('portable playback bundle accepted');}
    catch (error) {need(error.code === 'BundleBound', 'playback bundle refusal ' + error.message); refused.push(error.code);}
    const orphanBytes = new TextEncoder().encode('e9-t22k-unrequested-poison');
    const orphanHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', orphanBytes))]
      .map(value => value.toString(16).padStart(2, '0')).join('');
    const orphanWriter = await store.writer(id.session);
    try {await orphanWriter.put({sha256: orphanHash, length: String(orphanBytes.length)},
      (async function* () {yield orphanBytes;})());} finally {await orphanWriter.release();}
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(store.databaseName);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise((resolve, reject) => {
      const tx = database.transaction('chunks', 'readwrite', {durability: 'strict'});
      tx.objectStore('chunks').put(new Blob([new Uint8Array(orphanBytes.length).fill(0xa5)]), orphanHash);
      tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
    }); database.close();
    const gc = await store.collectGarbage();
    need(gc.removedObjects === 1 && gc.removedChunks === 1 && gc.reclaimedBytes === orphanBytes.length,
      'GC did not discard the corrupted unrequested physical chunk');
    const afterGc = await store.openSession(id.session);
    need(afterGc?.revision === '263', 'GC lost candidate');
    const afterGraph = await inventoryWitnessGraph(store, afterGc.manifest, {scope: 'local'});
    need(afterGraph.refs.length === 1172, 'GC changed authenticated closure');
    const {SessionGpuHistoryReader} = await import('/session-gpu-history-reader.js');
    let localReaderRefusal, archiveReaderRefusal;
    try {await SessionGpuHistoryReader.withOpen(store, id.session, {}, async () => null);}
    catch (error) {localReaderRefusal = String(error.message);}
    need(localReaderRefusal?.includes('finish the paged commitment') && !localReaderRefusal.includes('BundleBound'),
      'local reader did not authenticate above-4-GiB unfinished history');
    const immutable = {stream: ref => store.stream(ref), objectReference: hash => store.objectReference(hash)};
    try {await SessionGpuHistoryReader.withImmutableArchive(immutable, id.session, bytes, {}, async () => null);}
    catch (error) {archiveReaderRefusal = String(error.message);}
    need(archiveReaderRefusal?.includes('BundleBound'), 'immutable reader accepted oversized archive');
    const html = new DOMParser().parseFromString(await (await fetch('/app.html')).text(), 'text/html');
    const panel = html.querySelector('#session-library');
    need(panel, 'real library panel unavailable'); document.body.append(document.importNode(panel, true));
    const {mountSessionLibrary} = await import('/session-library.js');
    const originalOpen = SessionStore.open; let library;
    try {SessionStore.open = async () => store;
      library = await mountSessionLibrary(document.querySelector('#session-library'), {current: () => null});
      await library.select(id.session);
    } finally {SessionStore.open = originalOpen;}
    need(library.preview?.storageOnly && library.preview.witnessCount > 0
      && library.preview.bytes === 4311983484, 'library lost the large local preview');
    const preview = {bytes: library.preview.bytes, witnesses: library.preview.witnessCount,
      storageOnly: library.preview.storageOnly};
    await store.close();
    document.querySelector('pre').textContent = JSON.stringify({published, logicalBytes, references: graph.refs.length, refused, gc, preview});
    return {before: before.revision, published, reopened: reopened.revision,
      afterGc: afterGc.revision, afterGcReferences: afterGraph.refs.length, logicalBytes,
      references: graph.refs.length, refused, gc, localReaderRefusal, archiveReaderRefusal, preview};
  }, {database: sourceReport.result.database, session: session.key});
  assert.equal(report.result.logicalBytes, 4311983484);
  assert.deepEqual(report.result.refused, ['BundleBound', 'BundleBound', 'BundleBound']);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.httpErrors, []);
  assert.deepEqual(report.external, []);
  for (const entry of report.served) assert.equal(sha(await fs.readFile(path.resolve(web, '.' + entry.name))), entry.sha256);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), report.head);
  await page.screenshot({path: path.join(output, 'browser.png')});
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;
  await page?.screenshot({path: path.join(output, 'failure.png')}).catch(() => {});
} finally {
  if (context) await context.tracing.stop({path: path.join(output, 'browser-trace.zip')}).catch(() => {});
  await context?.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status: report.status, result: report.result, failure: report.failure}));
}
