#!/usr/bin/env node
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--output', '--seed'].includes(process.argv[i]) && process.argv[i + 1]);
  options[process.argv[i].slice(2)] = process.argv[i + 1];
}
assert.ok(options.output);
const root = process.cwd(), output = path.resolve(options.output), sha = bytes => createHash('sha256').update(bytes).digest('hex');
await fs.mkdir(output, {recursive: true});
const paths = [...new Set([...execFileSync('git', ['ls-files', 'renderer/virgl-command', 'renderer/virgl-shader', 'tools/virgl-command'], {encoding: 'utf8'}).trim().split('\n').filter(n => n.endsWith('.mjs')),
  'renderer/virgl-command/tests/standard-packed-unsigned-critic.mjs', 'tools/verify-virgl-standard-packed-unsigned-critic.mjs'])];
const report = {schema: 'packed-unsigned-fresh-critic-native-run-v1', task: 'E6-T11d37', status: 'running',
  verifier: true, gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
  command: [process.execPath, ...process.argv.slice(1)], sources: [], servedFiles: [],
  browserErrors: {console: [], page: [], requests: []}, startedAt: new Date().toISOString()};
let browser, server, page;
const sources = new Map(), served = new Map();
try {
  for (const name of paths) {
    const bytes = await fs.readFile(path.join(root, name)); sources.set(name, bytes);
    report.sources.push({path: name, bytes: bytes.length, sha256: sha(bytes)});
  }
  const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>Packed UINT independent critic</title><style>body{font:16px system-ui;background:#101825;color:#e9f0fb;margin:32px}pre{white-space:pre-wrap}</style><h1>Packed UINT independent critic</h1><p>Opposite alias · partial box · retained old generation · physical native sabotage</p><canvas id="gpu" width="16" height="16"></canvas><pre id="status">Running</pre>');
  server = createServer((request, response) => {
    const name = new URL(request.url, 'http://localhost').pathname;
    if (name === '/favicon.ico') return response.writeHead(204).end();
    const bytes = name === '/' ? html : sources.get(name.slice(1));
    if (!bytes) return response.writeHead(404).end('not found');
    served.set(name, {path: name, bytes: bytes.length, sha256: sha(bytes)});
    response.writeHead(200, {'Content-Type': name === '/' ? 'text/html' : 'text/javascript', 'Cache-Control': 'no-store'}).end(bytes);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const {chromium} = await import(pathToFileURL(path.join(root, 'web/node_modules/playwright/index.mjs')));
  browser = await chromium.launch({executablePath: chrome, headless: false, args: ['--enable-gpu']});
  const session = await browser.newBrowserCDPSession(), info = await session.send('SystemInfo.getInfo'), command = await session.send('Browser.getBrowserCommandLine');
  assert.equal(info.gpu.featureStatus.webgl2 ?? info.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!command.arguments.some(a => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu/i.test(a)));
  report.browser = {executable: chrome, sha256: sha(await fs.readFile(chrome)), version: browser.version(), headless: false, gpu: info.gpu, commandLine: command.arguments};
  const context = await browser.newContext({viewport: {width: 1100, height: 850}}); page = await context.newPage();
  page.on('console', message => {if (message.type() === 'error') report.browserErrors.console.push(message.text());});
  page.on('pageerror', error => report.browserErrors.page.push(error.message));
  page.on('requestfailed', request => report.browserErrors.requests.push({url: request.url(), error: request.failure()?.errorText}));
  await page.goto('http://127.0.0.1:' + server.address().port + '/', {waitUntil: 'load'});
  const cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  report.browserResult = await page.evaluate(async seed => {
    try {
      const {runCritic} = await import('/renderer/virgl-command/tests/standard-packed-unsigned-critic.mjs');
      const result = await runCritic({seed});
      document.querySelector('#status').textContent = JSON.stringify({status: result.status, gpu: result.gpu, originalAliases: result.runs.map(r => r.format), predictions: result.predictions.length, physicalNativeMutations: result.runs.length}, null, 2);
      return {status: 'passed', result};
    } catch (error) {return {status: 'failed', error: {message: error.message, stack: error.stack}};}
  }, Number(options.seed ?? 0x62e31a97));
  if (report.browserResult.status === 'failed') report.partial = await page.evaluate(() => window.__packedUnsignedCritic);
  const result = report.browserResult.result ?? report.partial;
  if (result) for (const b of result.blobs) {
    const bytes = Buffer.from(b.gzipBase64, 'base64'); assert.equal(sha(bytes), b.gzipSha256);
    b.path = b.key + '.bin.gz'; delete b.gzipBase64; await fs.writeFile(path.join(output, b.path), bytes);
  }
  const coverage = await cdp.send('Profiler.takePreciseCoverage');
  const scripts = [];
  for (const [source, bytes] of sources) {
    const matches = coverage.result.filter(s => s.url.endsWith('/' + source));
    if (matches.length) {assert.equal(matches.length, 1); scripts.push({source, sha256: sha(bytes), coverage: matches[0]});}
  }
  const coverageBytes = Buffer.from(JSON.stringify({schema: 1, scripts}, null, 2) + '\n');
  await fs.writeFile(path.join(output, 'browser-coverage.json'), coverageBytes);
  report.browserCoverage = {path: 'browser-coverage.json', sha256: sha(coverageBytes)};
  await cdp.send('Profiler.stopPreciseCoverage'); await page.screenshot({path: path.join(output, 'browser.png'), fullPage: true});
  report.screenshot = {path: 'browser.png', sha256: sha(await fs.readFile(path.join(output, 'browser.png')))};
  assert.deepEqual(report.browserErrors, {console: [], page: [], requests: []});
  assert.equal(report.browserResult.status, 'passed', report.browserResult.error?.message);
  for (const name of ['Apple', 'M4', 'Metal']) assert.ok(result.gpu.includes(name));
  assert.equal(result.runs.length, 2);
  for (const row of report.sources) assert.equal(sha(await fs.readFile(path.join(root, row.path))), row.sha256, 'critic source drift');
  report.status = 'passed'; console.log('Independent packed UINT native attack recorded.');
} catch (error) {report.status = 'failed'; report.failure = {message: error.message, stack: error.stack}; process.exitCode = 1; console.error(error.stack);}
finally {
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
}
