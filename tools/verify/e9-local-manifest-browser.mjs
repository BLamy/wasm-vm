#!/usr/bin/env node
// Continue the failed C publication in a copy of its original Chrome profile.
// This is an L metadata-boundary proof, not a shortened C qualification.
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
assert.match(sourceReport.result.error, /TooLarge\(\"session payload\"\)/);
const origin = sourceReport.result.error.match(/http:\/\/127\.0\.0\.1:[0-9]+/)[0];
const port = Number(new URL(origin).port);
const saved = JSON.parse(await fs.readFile(path.join(desktop, 'saved/storage.json')));
const session = saved.stores.sessions[0];
assert.equal(saved.stores.sessions.length, 1);
assert.equal(session.value.revision, '495');
const candidate = await fs.readFile(candidateFile), candidateManifest = JSON.parse(candidate);
const repro = JSON.parse(await fs.readFile(path.join(path.dirname(candidateFile), 'report.json')));
assert.equal(repro.candidate.manifestSha256, sha(candidate));
assert.equal(candidateManifest.id, session.key);
assert.equal(candidateManifest.checkpoints.at(-1).id, 'cold-257');
assert.equal(candidateManifest.end.transition, '12900000000');
const profile = path.join(output, 'chrome-profile');
const sourceProfile = path.join(desktop, 'chrome-profile');
assert.equal(path.basename(sourceReport.browserContext.directory), 'chrome-profile');
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'}).trim();
if (!args.development) assert.equal(dirty, '', 'freeze source before acceptance');
execFileSync('cp', ['-cR', sourceProfile, profile], {stdio: 'pipe'});
const report = {task: 'E9-T22l', scope: 'Original failed browser profile, exact cold-257 local publication/reopen/GC and portable refusal; not C completion',
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
  page.on('console', message => {
    if (message.type() === 'error') report.errors.push(message.text());
    else if (message.text().startsWith('E9-T22l ')) console.log(message.text());
  });
  page.on('pageerror', error => report.errors.push(String(error.stack ?? error)));
  page.on('request', request => {if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) report.external.push(request.url());});
  await page.goto(origin + '/');
  report.result = await page.evaluate(async id => {
    const need = (value, message) => {if (!value) throw Error(message);};
    const progress = stage => console.log('E9-T22l ' + stage);
    const {SessionStore} = await import('/session-store.js');
    const {exportSessionBundle} = await import('/session-bundles.js');
    const {exportSessionWitnessArchive} = await import('/session-witness-archives.js');
    const {inventoryWitnessGraph} = await import('/session-witness-graph.js');
    const bytes = new Uint8Array(await (await fetch('/__candidate__.json')).arrayBuffer());
    const store = await SessionStore.open(id.database);
    const before = await store.openSession(id.session);
    need(before?.revision === '495', 'original committed prefix');
    const native = await import('/session-pkg/wasm_vm_session.js');
    need(native.sessionValidateLocalManifest(bytes).every((value, index) => value === bytes[index]), 'local codec altered candidate');
    try {native.sessionValidateManifest(bytes); throw Error('portable metadata admitted');}
    catch (error) {need(String(error.message).includes('TooLarge(\"session payload\")'), 'portable metadata refusal ' + error.message);}
    const tooLargeBlob = JSON.parse(new TextDecoder().decode(bytes));
    tooLargeBlob.checkpoints[0].machine.length = String(4 * 1024 ** 3 + 1);
    try {native.sessionValidateLocalManifest(new TextEncoder().encode(JSON.stringify(tooLargeBlob)));
      throw Error('oversized local blob admitted');}
    catch (error) {need(String(error.message).includes('Invalid(\"blob length\")'),
      'local single-blob refusal ' + error.message);}
    const writer = await store.writer(id.session);
    let published;
    try {published = await writer.publish(bytes);} finally {await writer.release();}
    need(published.revision === '496', 'candidate published');
    progress('published saved candidate');
    const reopened = await store.openSession(id.session);
    need(reopened?.revision === '496', 'candidate reopened');
    progress('reopened saved candidate');
    need(reopened.manifest.length === bytes.length && reopened.manifest.every((value, index) => value === bytes[index]), 'candidate bytes changed');
    const graph = await inventoryWitnessGraph(store, reopened.manifest, {scope: 'local'});
    need(graph.refs.length === id.references, 'candidate closure changed');
    const logicalBytes = reopened.manifest.length + graph.refs.reduce((sum, ref) => sum + Number(ref.length), 0);
    need(logicalBytes === id.logicalBytes, 'candidate logical bytes changed');
    progress('authenticated witness graph');
    const refused = [];
    for (const options of [{}, {scope: 'local'}]) {
      try {await exportSessionWitnessArchive(store, id.session, options); throw Error('portable archive accepted');}
      catch (error) {need(error.code === 'BundleBound', 'archive refusal ' + error.message); refused.push(error.code);}
    }
    try {await exportSessionBundle(store, id.session); throw Error('portable playback bundle accepted');}
    catch (error) {need(error.code === 'BundleBound', 'playback bundle refusal ' + error.message); refused.push(error.code);}
    const oversized = JSON.parse(new TextDecoder().decode(bytes));
    for (let index = 0; index < 40; index++) oversized.checkpoints[index].machine.length = String(2 * 1024 ** 3);
    const invalid = new TextEncoder().encode(JSON.stringify(oversized));
    try {native.sessionValidateLocalManifest(invalid); throw Error('local payload over ceiling admitted');}
    catch (error) {need(String(error.message).includes('TooLarge(\"session payload\")'), 'local ceiling refusal ' + error.message);}
    const rejectWriter = await store.writer(id.session);
    try {await rejectWriter.publish(invalid); throw Error('over-ceiling publication accepted');}
    catch (error) {need(String(error.message).includes('TooLarge(\"session payload\")'), 'atomic rejection ' + error.message);}
    finally {await rejectWriter.release();}
    need((await store.openSession(id.session)).revision === '496', 'rejected publication advanced revision');
    // Reuse the failed C run's real frame and RAM-delta objects, but inflate
    // earlier metadata references to exercise the local-cap failure after a
    // keyframe has frozen the native RAM epoch. No synthetic bytes are stored.
    const {SessionGpuJournal} = await import('/session-gpu-journal.js');
    const {readCheckpointObject} = await import('/session-checkpoints.js');
    const {decodeKeyframeDescriptor} = await import('/session-keyframes.js');
    const {decodeGpuExactFrame} = await import('/session-gpu-replay-format.js');
    const staged = JSON.parse(new TextDecoder().decode(bytes));
    const last = staged.checkpoints.at(-1);
    const descriptor = decodeKeyframeDescriptor(await readCheckpointObject(store, last.machine, 1048576));
    const decoded = decodeGpuExactFrame(await readCheckpointObject(store, descriptor.frame, 640 * 1048576));
    const rendererBytes = await readCheckpointObject(store, last.gpu, 256 * 1048576);
    const ramChunks = await Promise.all(descriptor.chunks.map(ref => readCheckpointObject(store, ref, 4 * 1048576)));
    need(decoded.meta.position.transition === '12900000000' && ramChunks.length > 0, 'original failed frame');
    const inflated = JSON.parse(new TextDecoder().decode(before.manifest));
    const directBytes = manifest => manifest.events.reduce((sum, row) => sum + Number(row.content.length), 0)
      + manifest.checkpoints.reduce((sum, point) => sum + Number(point.machine.length)
        + Number(point.gpu?.length ?? 0), 0);
    const localLimit = 64 * 1024 ** 3;
    const nextDirectBytes = directBytes(staged) - directBytes(inflated);
    let needed = localLimit - nextDirectBytes + 1 - directBytes(inflated);
    for (const point of inflated.checkpoints.slice(0, -1)) {
      const current = Number(point.machine.length), increment = Math.min(needed, 4 * 1024 ** 3 - current);
      point.machine.length = String(current + increment); needed -= increment;
      if (needed === 0) break;
    }
    need(needed === 0 && directBytes(inflated) === localLimit - nextDirectBytes + 1,
      'synthetic local ceiling setup');
    native.sessionValidateLocalManifest(new TextEncoder().encode(JSON.stringify(inflated)));
    const acknowledgements = [];
    let captured = 0, attemptedPublication = 0;
    const hexBytes = hash => Uint8Array.from(hash.match(/../g), pair => Number.parseInt(pair, 16));
    const machine = {
      inputPosition: () => decoded.meta.position,
      exactGpuSessionEpoch: () => decoded.meta.rendererEpoch,
      captureExactGpuKeyframe: () => {captured++;
        return {...decoded.meta.position, native: decoded.native, pending: decoded.pending,
          output: decoded.output, digest: hexBytes(decoded.meta.stateSha256),
          ramDigest: hexBytes(decoded.meta.ramSha256)};},
      pendingSoftwareRamPages: () => descriptor.dirtyPages,
      nextSoftwareRamDeltaChunk: cursor => cursor < ramChunks.length
        ? {next: cursor + 1, bytes: ramChunks[cursor]} : null,
      finishSoftwareRamEpoch: committed => acknowledgements.push(committed),
    };
    const renderer = {saveCheckpoint: async () => ({bytes: rendererBytes,
      sha256: last.gpu.sha256, epoch: decoded.meta.rendererEpoch})};
    const syntheticWriter = {put: async () => {}, publish: async () => {attemptedPublication++;}};
    const journal = new SessionGpuJournal(store, syntheticWriter, inflated, {});
    let epochFailure;
    try {await journal.captureKeyframe(machine, renderer, 'local-overcap-rollback');}
    catch (error) {epochFailure = String(error.message);}
    need(epochFailure?.includes('TooLarge(\"session payload\")'),
      'frozen-epoch local bound did not reject: ' + epochFailure);
    need(captured === 1 && attemptedPublication === 0
      && acknowledgements.length === 1 && acknowledgements[0] === false,
    'failed keyframe acknowledged an uncommitted RAM epoch');
    need((await store.openSession(id.session)).revision === '496', 'failed keyframe advanced revision');
    progress('verified local ceiling and RAM-epoch rollback');
    const orphanBytes = new TextEncoder().encode('e9-t22l-unrequested-poison');
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
    progress('collected unrequested orphan');
    need(gc.removedObjects === 1 && gc.removedChunks === 1 && gc.reclaimedBytes === orphanBytes.length,
      'GC did not discard the corrupted unrequested physical chunk');
    const afterGc = await store.openSession(id.session);
    need(afterGc?.revision === '496', 'GC lost candidate');
    need(afterGc.manifest.length === bytes.length
      && afterGc.manifest.every((value, index) => value === bytes[index]),
    'GC changed authenticated candidate');
    // openSession reauthenticates every reference, so this second successful
    // open proves the graph survived GC without a redundant direct traversal.
    progress('reopened authenticated graph after GC');
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
    progress('checked local and immutable GPU readers');
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
      && library.preview.bytes === id.logicalBytes, 'library lost the large local preview');
    progress('checked session-library preview');
    const preview = {bytes: library.preview.bytes, witnesses: library.preview.witnessCount,
      storageOnly: library.preview.storageOnly};
    await store.close();
    document.querySelector('pre').textContent = JSON.stringify({published, logicalBytes, references: graph.refs.length, refused, gc, preview});
    return {before: before.revision, published, reopened: reopened.revision,
      afterGc: afterGc.revision, afterGcAuthenticated: true, logicalBytes,
      references: graph.refs.length, refused, gc, epoch: {failure: epochFailure,
        localLimit, nextDirectBytes, validPrefixDirectBytes: directBytes(inflated), captured,
        attemptedPublication, acknowledgements}, localReaderRefusal, archiveReaderRefusal, preview};
  }, {database: sourceReport.result.database, session: session.key, references: repro.candidate.references, logicalBytes: repro.candidate.logicalBytes});
  assert.equal(report.result.logicalBytes, repro.candidate.logicalBytes);
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
