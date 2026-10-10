#!/usr/bin/env node
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import {createServer} from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  assert.ok(['--output', '--inputs', '--fault'].includes(process.argv[i])); assert.ok(process.argv[i + 1]); options[process.argv[i].slice(2)] = process.argv[i + 1];
}
assert.ok(options.output && options.inputs); assert.ok(!options.fault || options.fault === 'precision');
const output = path.resolve(options.output); await fs.mkdir(output, {recursive: true});
const input = await fs.readFile(options.inputs), spec = JSON.parse(input);
const names = ['renderer/virgl-command/resources.mjs', 'renderer/virgl-command/float-images.mjs', 'renderer/virgl-command/packed-float-images.mjs', 'renderer/virgl-command/color-images.mjs',
  'renderer/virgl-command/tests/standard-float-image-adversarial.mjs', 'tools/verify-virgl-standard-float-images-adversarial.mjs', 'tools/virgl-command/standard-float-image-adversarial.py'];
const sources = new Map();
for (const name of names) sources.set(name, await fs.readFile(path.join(root, name)));
const productBefore = Object.fromEntries(names.slice(0, 3).map(name => [name, hash(sources.get(name))]));
const report = {schema: 'independent-float-image-capture-v1', gitHead: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
  fault: options.fault ?? null, originalInputSha256: hash(input), command: [process.execPath, ...process.argv.slice(1)],
  sources: names.map(name => ({path: name, bytes: sources.get(name).length, sha256: hash(sources.get(name))})),
  served: [], browserErrors: {console: [], page: [], requests: []}, status: 'running', productBefore};
let browser, server;
try {
  const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>Independent float range attack</title><h1>Independent original float range attack</h1><canvas width="8" height="8"></canvas><pre id="status"></pre>');
  const served = new Map();
  server = createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.slice(1);
    if (name === 'favicon.ico') { res.writeHead(204).end(); return; }
    const body = name === '' ? html : sources.get(name);
    if (!body) { res.writeHead(404).end(); return; }
    served.set(name, {path: name, bytes: body.length, sha256: hash(body)});
    res.writeHead(200, {'Content-Type': name ? 'text/javascript' : 'text/html', 'Cache-Control': 'no-store'}).end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {chromium} = await import(pathToFileURL(path.join(root, 'web/node_modules/playwright/index.mjs')));
  const executablePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  browser = await chromium.launch({executablePath, headless: false, args: ['--enable-gpu']});
  const session = await browser.newBrowserCDPSession(), system = await session.send('SystemInfo.getInfo'), command = await session.send('Browser.getBrowserCommandLine');
  assert.equal(system.gpu.featureStatus.webgl2 ?? system.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!command.arguments.some(x => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(x)));
  report.browser = {executablePath, executableSha256: hash(await fs.readFile(executablePath)), version: browser.version(), gpu: system.gpu, command: command.arguments, headless: false};
  const context = await browser.newContext({viewport: {width: 1000, height: 650}}), page = await context.newPage();
  page.on('console', event => { if (event.type() === 'error') report.browserErrors.console.push(event.text()); });
  page.on('pageerror', event => report.browserErrors.page.push(event.message));
  page.on('requestfailed', event => report.browserErrors.requests.push(event.url()));
  await page.goto('http://127.0.0.1:' + server.address().port, {waitUntil: 'load'});
  const cdp = await context.newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.startPreciseCoverage', {callCount: true, detailed: true});
  report.result = await page.evaluate(async ({specs, fault}) => {
    try {
      const {runAdversarial} = await import('/renderer/virgl-command/tests/standard-float-image-adversarial.mjs');
      const result = await runAdversarial({specs, fault}); document.querySelector('#status').textContent = JSON.stringify({status: result.status, gpu: result.gpu, runs: result.runs.length}); return result;
    } catch (error) {
      const report = window.__criticFloatImages; report.status = 'failed'; report.error = {message: error.message, stack: error.stack}; document.querySelector('#status').textContent = error.message; return report;
    }
  }, {specs: spec.specs, fault: Boolean(options.fault)});
  const coverage = await cdp.send('Profiler.takePreciseCoverage');
  report.coverage = {scripts: coverage.result.filter(row => names.some(name => row.url.endsWith('/' + name))).map(row => ({source: names.find(name => row.url.endsWith('/' + name)), sha256: hash(sources.get(names.find(name => row.url.endsWith('/' + name)))), coverage: row}))};
  await fs.writeFile(path.join(output, 'coverage.json'), JSON.stringify(report.coverage, null, 2) + '\n');
  report.coverageSha256 = hash(await fs.readFile(path.join(output, 'coverage.json'))); delete report.coverage;
  await cdp.send('Profiler.stopPreciseCoverage'); await page.screenshot({path: path.join(output, 'browser.png'), fullPage: true});
  report.screenshotSha256 = hash(await fs.readFile(path.join(output, 'browser.png'))); report.served = [...served.values()];
  assert.deepEqual(report.browserErrors, {console: [], page: [], requests: []}); assert.ok(report.result.gpu.includes('Metal') && report.result.gpu.includes('M4'));
  for (const [name, data] of sources) assert.equal(hash(await fs.readFile(path.join(root, name))), hash(data), 'source drift: ' + name);
  report.productAfter = Object.fromEntries(names.slice(0, 3).map(name => [name, hash(sources.get(name))]));
  if (options.fault) {
    assert.equal(report.result.status, 'failed'); assert.equal(report.result.control.fenceCompleted, true);
    assert.ok(report.result.error.message.includes('independent original-value oracle'));
    report.status = 'expected-control-refutation';
  } else { assert.equal(report.result.status, 'passed', report.result.error?.message); report.status = 'passed'; }
  console.log(JSON.stringify({status: report.status, runs: report.result.runs.length, fault: report.fault}));
} catch (error) { report.status = 'failed'; report.error = {message: error.message, stack: error.stack}; process.exitCode = 1; console.error(error.stack); }
finally {
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
}
