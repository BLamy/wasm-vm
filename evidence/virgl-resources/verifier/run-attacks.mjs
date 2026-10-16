import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';

const repo = process.cwd(), out = path.dirname(fileURLToPath(import.meta.url));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const sourceFiles = ['renderer/virgl-command/resources.mjs', 'renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/tests/resources-acceptance.mjs'];
const report = { task: 'E6-T12b', status: 'running', gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), sources: [], errors: { console: [], page: [], request: [] } };
let server, browser;
try {
  for (const name of sourceFiles) report.sources.push({ path: name, sha256: hash(await fs.readFile(path.join(repo, name))) });
  for (const name of ['predictions.md', 'attack-cases.mjs', 'run-attacks.mjs']) report.sources.push({ path: path.relative(repo, path.join(out, name)), sha256: hash(await fs.readFile(path.join(out, name))) });
  const { loadResourceFixtures } = await import(pathToFileURL(path.join(repo, 'tools/virgl-command/resource-fixtures.mjs')));
  const { fixtures } = await loadResourceFixtures();
  const { runNativeAcceptance } = await import(pathToFileURL(path.join(repo, 'renderer/virgl-command/tests/resources-acceptance.mjs')));
  report.native = runNativeAcceptance(fixtures, { seeds: [0xdeadbeef, 0xcafebabe, 0xa5a5a5a5, 0xabcdef01, 0x76543210], count: 8192 });
  assert.equal(report.native.status, 'passed');
  const source = await fs.readFile(path.join(repo, sourceFiles[0]), 'utf8');
  report.sabotages = [];
  for (const [name, before, after] of [
    ['wrong-default-row-stride', 'const rowStride = fields.stride || defaultStride;', 'const rowStride = fields.stride || rowBytes;'],
    ['revived-revoked-membership', 'member.active && member.resource.public', 'member.resource.public'],
  ]) {
    assert.equal(source.split(before).length, 2, 'unique sabotage anchor');
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'resource-verifier-sabotage-'));
    await fs.mkdir(path.join(temp, 'tests'));
    const changed = source.replace(before, after);
    await fs.writeFile(path.join(temp, 'resources.mjs'), changed);
    await fs.copyFile(path.join(repo, sourceFiles[1]), path.join(temp, 'decoder.mjs'));
    await fs.copyFile(path.join(repo, sourceFiles[2]), path.join(temp, 'tests/resources-acceptance.mjs'));
    let error;
    try { const mutated = await import(pathToFileURL(path.join(temp, 'tests/resources-acceptance.mjs'))); mutated.runNativeAcceptance(fixtures); }
    catch (caught) { error = caught.message; }
    assert.ok(error, `${name} was undetected`);
    const record = { name, originalSha256: hash(source), mutatedSha256: hash(changed), before, after, error, status: 'detected', temporaryCopy: temp };
    if (name === 'wrong-default-row-stride') assert.match(error, /independent layout rowStride/);
    else assert.match(error, /attachment invalidates prepared ticket rejected/);
    report.sabotages.push(record);
  }
  const endpoints = new Map([
    ['/', ['text/html', Buffer.from('<!doctype html><title>Independent GPU resource attacks</title><h1>Independent GPU resource attacks</h1><canvas id="gpu"></canvas><pre id="result">Running</pre>')]],
    ['/attack-cases.mjs', ['text/javascript', await fs.readFile(path.join(out, 'attack-cases.mjs'))]],
    ...await Promise.all(sourceFiles.map(async (name) => ['/' + name, ['text/javascript', await fs.readFile(path.join(repo, name))]])),
  ]);
  server = createServer((req, res) => { if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; } const data = endpoints.get(req.url); if (!data) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': data[0], 'Cache-Control': 'no-store' }).end(data[1]); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--enable-gpu'] });
  const browserSession = await browser.newBrowserCDPSession();
  const system = await browserSession.send('SystemInfo.getInfo');
  assert.equal(system.gpu.featureStatus.webgl2 ?? system.gpu.featureStatus.webgl, 'enabled');
  report.browser = { version: browser.version(), gpu: system.gpu, commandLine: await browserSession.send('Browser.getBrowserCommandLine') };
  assert.ok(!report.browser.commandLine.arguments.some((arg) => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(arg)));
  const page = await browser.newPage({ viewport: { width: 1050, height: 900 } });
  page.on('console', (m) => { if (m.type() === 'error') report.errors.console.push(m.text()); });
  page.on('pageerror', (e) => report.errors.page.push(e.message));
  page.on('requestfailed', (r) => report.errors.request.push(r.url()));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const session = await page.context().newCDPSession(page);
  await session.send('Profiler.enable'); await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  report.attack = await page.evaluate(async () => { const { runResourceAttack } = await import('/attack-cases.mjs'); const result = runResourceAttack(document.querySelector('#gpu').getContext('webgl2')); document.querySelector('#result').textContent = JSON.stringify({ ...result, records: result.records.length }, null, 2); return result; });
  const coverage = await session.send('Profiler.takePreciseCoverage');
  const runtime = coverage.result.find((script) => script.url.endsWith('/renderer/virgl-command/resources.mjs'));
  assert.ok(runtime); await fs.writeFile(path.join(out, 'attack-coverage.json'), JSON.stringify({ sourceSha256: hash(source), coverage: runtime }, null, 2) + '\n');
  report.coverageSha256 = hash(await fs.readFile(path.join(out, 'attack-coverage.json')));
  assert.equal(report.attack.status, 'passed'); assert.deepEqual(report.errors, { console: [], page: [], request: [] });
  await page.screenshot({ path: path.join(out, 'attack.png'), fullPage: true }); report.screenshotSha256 = hash(await fs.readFile(path.join(out, 'attack.png')));
  for (const entry of report.sources) assert.equal(hash(await fs.readFile(path.join(repo, entry.path))), entry.sha256, 'source drift ' + entry.path);
  report.status = 'passed';
} catch (e) { report.status = 'failed'; report.error = { message: e.message, stack: e.stack }; process.exitCode = 1; }
finally { report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, 'attacks.json'), JSON.stringify(report, null, 2) + '\n'); await browser?.close(); if (server) await new Promise((resolve) => server.close(resolve)); }
console.log(JSON.stringify({ status: report.status, nativeMutations: report.native?.mutations, gpuCases: report.attack?.records?.length, assertions: report.attack?.assertions, sabotages: report.sabotages, error: report.error }, null, 2));
