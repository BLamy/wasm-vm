import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
const repo = process.cwd(), out = path.dirname(fileURLToPath(import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const files = ['renderer/virgl-command/decoder.mjs', 'renderer/virgl-command/resources.mjs', 'renderer/virgl-command/state.mjs', 'renderer/virgl-shader/index.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.mjs', 'renderer/virgl-shader/build/wasm/virgl-shader.wasm'];
const report = { task: 'E6-T11b1', status: 'running', gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), started: new Date().toISOString(), sources: [], variants: [] };
let server, browser, variant = 'baseline';
try {
  const modules = new Map();
  for (const file of files) { const bytes = await fs.readFile(path.join(repo, file)); modules.set('/' + file, bytes); report.sources.push({ path: file, sha256: hash(bytes) }); }
  for (const file of ['attack-cases.mjs', 'run-attacks.mjs', 'gl-oracle.mjs', 'predictions.md', 'supplemental-predictions.md', 'defensive-predictions.md', 'reference-notes.md']) report.sources.push({ path: path.relative(repo, path.join(out, file)), sha256: hash(await fs.readFile(path.join(out, file))) });
  const { loadDrawFixtures } = await import(pathToFileURL(path.join(repo, 'tools/virgl-command/draw-fixtures.mjs'))); const loaded = await loadDrawFixtures(); report.inputs = loaded.sources;
  const fixtureBytes = Buffer.from(JSON.stringify(loaded.fixtures)); report.fixtureSha256 = hash(fixtureBytes);
  const original = modules.get('/renderer/virgl-command/resources.mjs').toString();
  const variants = new Map([['baseline', original]]);
  report.sabotages = [];
  for (const [name, before, after] of [
    ['skip-wait', 'const status = gl.clientWaitSync(entry.sync, 0, 0);', 'const status = gl.CONDITION_SATISFIED; /* verifier sabotage: no wait */'],
  ]) { assert.equal(original.split(before).length, 2); const modified = original.replace(before, after); variants.set(name, modified); report.sabotages.push({ name, before, after, sourceSha256: hash(modified) }); }
  modules.set('/gl-oracle.mjs', await fs.readFile(path.join(out, 'gl-oracle.mjs')));
  modules.set('/attack-cases.mjs', await fs.readFile(path.join(out, 'attack-cases.mjs')));
  modules.set('/fixtures.json', fixtureBytes); modules.set('/', Buffer.from('<!doctype html><title>Independent async attacks</title><h1>Independent VirGL async attacks</h1><canvas id="gpu"></canvas><pre id="result">Running</pre>'));
  server = createServer((req, res) => { if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; } const bytes = req.url === '/renderer/virgl-command/resources.mjs' ? Buffer.from(variants.get(variant)) : modules.get(req.url); if (!bytes) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': req.url.endsWith('.wasm') ? 'application/wasm' : req.url.endsWith('.mjs') ? 'text/javascript' : req.url.endsWith('.json') ? 'application/json' : 'text/html', 'Cache-Control': 'no-store', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }).end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')));
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--enable-gpu'] });
  const browserSession = await browser.newBrowserCDPSession(); report.browser = { version: browser.version(), system: await browserSession.send('SystemInfo.getInfo'), commandLine: await browserSession.send('Browser.getBrowserCommandLine') };
  assert.equal(report.browser.system.gpu.featureStatus.webgl2 ?? report.browser.system.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!report.browser.commandLine.arguments.some(arg => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(arg)));
  for (const name of variants.keys()) {
    variant = name; const errors = { console: [], page: [], request: [] }, context = await browser.newContext({ viewport: { width: 1050, height: 900 } }), page = await context.newPage();
    page.on('console', m => { if (m.type() === 'error') errors.console.push(m.text()); }); page.on('pageerror', e => errors.page.push(e.message)); page.on('requestfailed', r => errors.request.push(r.url()));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    const session = await context.newCDPSession(page); await session.send('Profiler.enable'); await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
    const result = await page.evaluate(async () => { try { const fixtures = await (await fetch('/fixtures.json')).json(), { runAttacks } = await import('/attack-cases.mjs'); const value = await runAttacks(fixtures); document.querySelector('#result').textContent = JSON.stringify({status:value.status, assertions:value.assertions, pixels:value.pixels, heartbeats:value.heartbeats, records:value.records.length, cases:value.records.filter(r=>r.name==='partial texture SG'||r.name==='actual context loss').map(r=>({name:r.name,seed:r.seed,result:r.result})), oracleStatistics:value.oracleStatistics.map(s=>({events:s.events,violations:s.violations,liveBuffers:s.liveBuffers,liveSyncs:s.liveSyncs}))},null,2); return value; } catch (e) { document.querySelector('#result').textContent = e.stack; return { status: 'failed', error: { message: e.message, stack: e.stack } }; } });
    const record = { variant, servedRuntimeSha256: hash(variants.get(variant)), errors, result }; report.variants.push(record);
    if (name === 'baseline') {
      const coverage = await session.send('Profiler.takePreciseCoverage'); const scripts = coverage.result.filter(s => ['/renderer/virgl-command/state.mjs', '/renderer/virgl-command/resources.mjs'].some(suffix => s.url.endsWith(suffix)));
      await fs.writeFile(path.join(out, 'attack-coverage.json'), JSON.stringify({ scripts }, null, 2) + '\n'); record.coverageSha256 = hash(await fs.readFile(path.join(out, 'attack-coverage.json')));
      await page.screenshot({ path: path.join(out, 'attack.png'), fullPage: true }); record.screenshotSha256 = hash(await fs.readFile(path.join(out, 'attack.png')));
      assert.equal(result.status, 'passed', result.error?.message); assert.deepEqual(errors, { console: [], page: [], request: [] });
    } else { assert.equal(result.status, 'failed', 'sabotage escaped'); assert.match(result.error.message, /CPU collection preceded matching staging fence signal/); }
    await context.close();
  }
  for (const s of report.sources) assert.equal(hash(await fs.readFile(path.join(repo, s.path))), s.sha256, 'source drift ' + s.path);
  report.status = 'passed';
} catch (e) { report.status = 'failed'; report.error = { message: e.message, stack: e.stack }; process.exitCode = 1; }
finally { report.finished = new Date().toISOString(); await fs.writeFile(path.join(out, 'attacks.json'), JSON.stringify(report, null, 2) + '\n'); await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); }
console.log(JSON.stringify({ status: report.status, variants: report.variants.map(v => ({ name: v.variant, status: v.result.status, assertions: v.result.assertions, records: v.result.records?.length, pixels: v.result.pixels, error: v.result.error?.message })), error: report.error }, null, 2));
