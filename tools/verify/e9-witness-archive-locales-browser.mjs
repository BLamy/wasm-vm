#!/usr/bin/env node
// Incremental archive-only proof over authenticated retained native evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium} from '../../web/node_modules/playwright/index.mjs';
import {checkWitnessArchiveLocales} from './e9-witness-archive-locales.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'), options = {};
for (let i = 2; i < process.argv.length; i++) {
  const key = process.argv[i]; assert(!Object.hasOwn(options, key));
  if (key === '--development') options[key] = true;
  else {assert(['--output', '--archive', '--source-report', '--web-root'].includes(key) && process.argv[i + 1]); options[key] = process.argv[++i];}
}
for (const key of ['--output', '--archive', '--source-report']) assert(options[key], key + ' required');
assert(['web', 'web/dist'].includes(options['--web-root'] ?? 'web/dist'));
const output = path.resolve(options['--output']), web = path.join(root, options['--web-root'] ?? 'web/dist');
await fs.mkdir(output, {recursive: false});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const archivePath = path.resolve(options['--archive']), sourceReportPath = path.resolve(options['--source-report']);
const archive = await fs.readFile(archivePath), sourceReportBytes = await fs.readFile(sourceReportPath), source = JSON.parse(sourceReportBytes);
const binding = source.raw.find(row => row.file === path.basename(archivePath));
assert.equal(source.status, 'passed'); assert.equal(source.dirty, ''); assert.equal(binding.bytes, archive.length); assert.equal(binding.sha256, sha(archive));
const report = {task: 'E9-T22i', status: 'running', head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain'),
  scope: 'Actual storage-only archive API regression; authenticated retained native execution is reused, not newly executed',
  development: !!options['--development'], started: new Date().toISOString(), originalNativeHead: source.head,
  input: {archive: {...binding, path: archivePath}, sourceReport: {path: sourceReportPath, sha256: sha(sourceReportBytes)}}, served: []};
if (!report.development) assert.equal(report.dirty, '', 'freeze before acceptance');
await fs.copyFile(fileURLToPath(import.meta.url), path.join(output, 'executed-browser.mjs'));
await fs.copyFile(new URL('./e9-witness-archive-locales.mjs', import.meta.url), path.join(output, 'executed-locales.mjs'));
const server = createServer(async (request, response) => {
  try {
    const name = decodeURIComponent(new URL(request.url, 'http://local').pathname);
    if (name === '/favicon.ico') {response.writeHead(204).end(); return;}
    if (name === '/') {response.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html><title>Archive locale regression</title>'); return;}
    if (name === '/__witness_archive__') {response.writeHead(200, {'Content-Type': 'application/octet-stream'}).end(archive); return;}
    const file = path.resolve(web, '.' + name); assert(file.startsWith(web + path.sep));
    const bytes = await fs.readFile(file), previous = report.served.find(row => row.path === name);
    if (previous) assert.equal(previous.sha256, sha(bytes), 'source changed while served');
    else report.served.push({path: name, bytes: bytes.length, sha256: sha(bytes)});
    response.writeHead(200, {'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', 'Cache-Control': 'no-store'}).end(bytes);
  } catch (error) {response.writeHead(500).end(String(error));}
});
let browser;
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
  report.browser = browser.version();
  report.result = await checkWitnessArchiveLocales(browser, 'http://127.0.0.1:' + server.address().port, output);
  for (const row of report.served) assert.equal(sha(await fs.readFile(path.resolve(web, '.' + row.path))), row.sha256);
  assert.equal(sha(await fs.readFile(archivePath)), binding.sha256, 'retained archive must stay immutable');
  assert.equal(git('rev-parse', 'HEAD'), report.head);
  report.status = 'passed';
} catch (error) {report.status = 'failed'; report.failure = String(error.stack ?? error); process.exitCode = 1;}
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  report.finished = new Date().toISOString(); await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({status: report.status, failure: report.failure, output}));
