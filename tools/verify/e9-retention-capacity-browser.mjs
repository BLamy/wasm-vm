#!/usr/bin/env node
// Full physical production-store qualification above the saved 8 GiB prefix.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {checkRetentionCapacity} from './e9-retention-capacity.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argumentsByName = {};
for (let at = 2; at < process.argv.length; at++) {
  const key = process.argv[at];
  if (key === '--development') {argumentsByName.development = true; continue;}
  assert(['--desktop', '--output'].includes(key) && !argumentsByName[key] && process.argv[at + 1]);
  argumentsByName[key] = process.argv[++at];
}
assert(argumentsByName['--desktop'] && argumentsByName['--output']);
const desktop = path.resolve(argumentsByName['--desktop']);
const out = path.resolve(argumentsByName['--output']);
const saved = path.join(desktop, 'saved');
const web = path.join(root, 'web/dist');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fileSha = async file => {
  const hash = createHash('sha256');
  for await (const bytes of (await import('node:fs')).createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};
await fs.mkdir(out);
const head = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {cwd: root, encoding: 'utf8'}).trim();
if (!argumentsByName.development) assert.equal(dirty, '', 'freeze exact-head source');
const profileBytes = await fs.readFile(path.join(root, 'docs/design/session-workload-retention-v1.json'));
const profile = JSON.parse(profileBytes), pin = profile.failedPrefix;
assert.equal(profile.version, 1);
assert.equal(await fileSha(path.join(root, profile.previousQualification.path)), profile.previousQualification.sha256);
const report = {task: 'E9-T22m', scope: 'Actual physical 8-to-16 GiB production store proof; not the full original Omarchy workload',
  head, dirty, development: Boolean(argumentsByName.development), status: 'running',
  profileSha256: sha(profileBytes), started: new Date().toISOString(),
  consoleErrors: [], pageErrors: [], httpErrors: [], external: [], served: []};
let server, context, page, tracingPath = 'browser-trace.zip';
try {
  const failureFile = path.join(desktop, 'report.json');
  const failureBytes = await fs.readFile(failureFile);
  const storageFile = path.join(saved, 'storage.json');
  const storageBytes = await fs.readFile(storageFile);
  const closureFile = path.join(desktop, 'retained-closure/report.json');
  const closureBytes = await fs.readFile(closureFile);
  assert.equal(sha(failureBytes), pin.reportSha256);
  assert.equal(sha(storageBytes), pin.storageSha256);
  assert.equal(sha(closureBytes), pin.closureReportSha256);
  const failure = JSON.parse(failureBytes), storage = JSON.parse(storageBytes), closure = JSON.parse(closureBytes);
  assert.equal(failure.head, pin.head);
  assert.equal(failure.status, 'failed');
  assert.match(failure.result.error, /RetentionLimit: saved data byte budget/);
  assert.equal(storage.stores.chunks.length, pin.chunks);
  assert.equal(storage.stores.objects.length, pin.objects);
  const metadata = Object.fromEntries(storage.stores.metadata.map(row => [row.key, row.value]));
  assert.equal(metadata.payloadBytes, pin.physicalBytes);
  assert.equal(metadata.limits.maxBytes, pin.oldMaxBytes);
  const indexedBytes = storage.stores.chunks.reduce((sum, row) => sum + row.bytes, 0);
  assert.equal(indexedBytes, pin.physicalBytes);
  const originalParts = new Map(storage.stores.chunks.map(row => [row.key, row.bytes]));
  for (const row of storage.stores.objects) {
    const value = row.value;
    assert.equal(row.key, value.sha256);
    assert.equal(value.parts.reduce((sum, part) => {
      assert.equal(originalParts.get(part.sha256), Number(part.length));
      return sum + Number(part.length);
    }, 0), Number(value.length));
  }
  // The original independently run closure oracle established reachability;
  // this separate exact-head pass reads and hashes every physical byte again.
  let checked = 0;
  for (const row of storage.stores.chunks) {
    const file = path.join(saved, 'chunks', row.key + '.bin');
    assert.equal((await fs.stat(file)).size, row.bytes);
    assert.equal(await fileSha(file), row.key);
    if (++checked % 1024 === 0) console.log(`E9-T22m authenticated ${checked}/${pin.chunks} retained chunks`);
  }
  report.prefix = {reportSha256: sha(failureBytes), storageSha256: sha(storageBytes),
    closureSha256: sha(closureBytes), physicalBytes: indexedBytes,
    belowEightGiB: pin.oldMaxBytes - indexedBytes, chunks: checked,
    objects: storage.stores.objects.length, closureStatus: closure.status};
  assert.equal(report.prefix.belowEightGiB, 857593);
  assert.equal(closure.status, 'retained-closure-passed');
  assert.equal(closure.objects, pin.objects);
  assert.equal(closure.references, pin.objects);
  const manifest = new Uint8Array(storage.stores.sessions[0].value.manifest);
  const config = {database: 'wasm-vm-sessions-v1-t22m-capacity',
    prefixBytes: pin.physicalBytes, maxBytes: profile.retention.maxBytes,
    manifestSha256: sha(manifest), reserveBytes: profile.preflight.reserveBytes};
  const seen = new Map();
  const types = {'.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm',
    '.json': 'application/json', '.css': 'text/css', '.html': 'text/html'};
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      assert.equal(request.method, 'GET');
      if (url.pathname === '/favicon.ico') {response.writeHead(204).end(); return;}
      let bytes, file, type = 'application/octet-stream';
      if (url.pathname === '/') {bytes = Buffer.from('<!doctype html><title>E9-T22m</title>'); type = 'text/html';}
      else if (url.pathname === '/__index__.json') {bytes = storageBytes; type = 'application/json';}
      else if (url.pathname === '/__capacity_page__.mjs') {
        bytes = await fs.readFile(new URL('./e9-retention-capacity-page.mjs', import.meta.url));
        type = 'text/javascript';
      }
      else if (url.pathname === '/__capacity_policy__.mjs') {
        bytes = await fs.readFile(new URL('./e9-retention-capacity.mjs', import.meta.url));
        type = 'text/javascript';
      }
      else if (url.pathname === '/__host_free__.json') {
        const stat = await fs.statfs(out);
        bytes = Buffer.from(JSON.stringify({bytes: Number(BigInt(stat.bavail) * BigInt(stat.bsize))}));
        type = 'application/json';
      }
      else if (/^\/__chunk__\/[a-f0-9]{64}\.bin$/.test(url.pathname)) {
        const hash = path.basename(url.pathname, '.bin');
        assert(originalParts.has(hash)); file = path.join(saved, 'chunks', hash + '.bin');
      } else {
        file = path.resolve(web, '.' + url.pathname);
        assert(file.startsWith(web + path.sep)); type = types[path.extname(file)] ?? type;
      }
      if (file) bytes = await fs.readFile(file);
      if (!url.pathname.startsWith('/__chunk__/') && url.pathname !== '/__host_free__.json') {
        const digest = sha(bytes);
        assert(!seen.has(url.pathname) || seen.get(url.pathname) === digest);
        if (!seen.has(url.pathname)) {
          seen.set(url.pathname, digest);
          report.served.push({path: url.pathname, sha256: digest, bytes: bytes.length});
        }
      }
      response.writeHead(200, {'Content-Type': type, 'Cache-Control': 'no-store',
        'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp'});
      response.end(bytes);
    } catch (error) {
      report.httpErrors.push({path: request.url, error: String(error)});
      if (!response.headersSent) response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const origin = 'http://127.0.0.1:' + server.address().port;
  const profileDir = path.join(out, 'chrome-profile');
  context = await chromium.launchPersistentContext(profileDir, {headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    serviceWorkers: 'block'});
  await context.tracing.start({screenshots: true, snapshots: false, sources: true});
  page = await context.newPage();
  page.on('console', message => {
    if (message.type() === 'error') report.consoleErrors.push(message.text());
    else if (message.text().startsWith('E9-T22m ')) console.log(message.text());
  });
  page.on('pageerror', error => report.pageErrors.push(String(error.stack ?? error)));
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) report.external.push(request.url());
  });
  await page.goto(origin + '/');
  const browser = await page.evaluate(async () => {
    const persistedBefore = await navigator.storage.persisted();
    const requested = await navigator.storage.persist();
    const estimate = await navigator.storage.estimate();
    return {quota: estimate.quota, usage: estimate.usage,
      persistedBefore, persistRequested: requested,
      persistedAfter: await navigator.storage.persisted()};
  });
  const stat = await fs.statfs(out);
  const hostFreeBytes = Number(BigInt(stat.bavail) * BigInt(stat.bsize));
  report.preflight = {browser, hostFreeBytes,
    admitted: checkRetentionCapacity({quota: browser.quota, usage: browser.usage,
      hostFreeBytes, localBytes: 8 * 1024 ** 3,
      hostLocalBytes: profile.retention.maxBytes,
      reserveBytes: profile.preflight.reserveBytes})};
  report.result = await page.evaluate(async input => {
    const {provePhysicalCapacity} = await import('/__capacity_page__.mjs');
    return provePhysicalCapacity(input);
  }, config);
  assert.equal(report.result.atLimit.payloadBytes, profile.retention.maxBytes);
  assert.equal(report.result.after.payloadBytes, profile.retention.maxBytes);
  assert.equal(report.result.refused, 'RetentionLimit');
  await context.tracing.stop({path: path.join(out, tracingPath)});
  await context.close(); context = null; page = null;
  context = await chromium.launchPersistentContext(profileDir, {headless: true,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    serviceWorkers: 'block'});
  tracingPath = 'reopen-trace.zip';
  await context.tracing.start({screenshots: true, snapshots: false, sources: true});
  page = await context.newPage();
  page.on('console', message => {if (message.type() === 'error') report.consoleErrors.push(message.text());});
  page.on('pageerror', error => report.pageErrors.push(String(error.stack ?? error)));
  await page.goto(origin + '/');
  report.reopen = await page.evaluate(async config => {
    const {SessionStore} = await import('/session-store.js');
    const store = await SessionStore.open(config.database);
    try {
      const stats = await store.statistics();
      const session = await store.openSession('full-original-omarchy');
      const sha = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
        byte => byte.toString(16).padStart(2, '0')).join('');
      return {stats, revision: session?.revision,
        manifestSha256: session ? await sha(session.manifest) : null,
        persisted: await navigator.storage.persisted()};
    } finally {await store.close();}
  }, config);
  assert.equal(report.reopen.stats.payloadBytes, pin.physicalBytes);
  assert.equal(report.reopen.stats.limits.maxBytes, profile.retention.maxBytes);
  assert.equal(report.reopen.revision, '637');
  assert.equal(report.reopen.manifestSha256, config.manifestSha256);
  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.httpErrors, []);
  assert.deepEqual(report.external, []);
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(), head);
  assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all'],
    {cwd: root, encoding: 'utf8'}).trim(), dirty);
  assert.equal(sha(await fs.readFile(path.join(root, 'docs/design/session-workload-retention-v1.json'))), report.profileSha256);
  for (const row of report.served) {
    if (row.path === '/' || row.path === '/__index__.json'
      || row.path === '/__capacity_page__.mjs' || row.path === '/__capacity_policy__.mjs') continue;
    assert.equal(sha(await fs.readFile(path.join(web, '.' + row.path))), row.sha256,
      'served production source changed ' + row.path);
  }
  report.status = 'physical-capacity-passed';
} catch (error) {
  report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;
} finally {
  try {if (context) await context.tracing.stop({path: path.join(out, tracingPath)});}
  catch (error) {report.traceError = String(error); process.exitCode = 1;}
  try {await context?.close();} catch (error) {report.contextError = String(error); process.exitCode = 1;}
  try {if (server) {server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}}
  catch (error) {report.serverError = String(error); process.exitCode = 1;}
  report.finished = new Date().toISOString();
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({status: report.status, failure: report.failure, output: out}));
}
