#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.cwd(), here = path.join(root, 'evidence/virgl-constants/verifier');
const mode = process.argv[2] ?? 'normal'; assert.ok(['normal', 'alias-sabotage'].includes(mode));
const output = path.join(here, mode), sha = b => createHash('sha256').update(b).digest('hex');
await fs.mkdir(output, { recursive: true });
const report = { schema: 1, mode, status: 'running', head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), served: [], browserErrors: [] };
const served = new Map(), exports = '\nexport { makeRig, createResources, createContext, setupBytes, constants, link, bind, CLEAR, DRAW, join, packet, readPixels, currentSub, poison };\n';
let browser, page, session;
const server = createServer(async (req, res) => {
  try {
    const name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (name === '/') { res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Independent constant attacks</title><h1>Independent constant attacks</h1><div id="status"></div><div id="renderer"></div><canvas id="gpu"></canvas><div id="draws"></div>'); return; }
    if (name === '/favicon.ico') { res.writeHead(204).end(); return; }
    const filename = path.resolve(root, `.${name}`); assert.ok(filename.startsWith(root + path.sep));
    const original = await fs.readFile(filename); let bytes = original;
    if (name === '/renderer/virgl-command/tests/constants.mjs') bytes = Buffer.from(original.toString() + exports);
    if (name === '/renderer/virgl-command/state.mjs' && mode === 'alias-sabotage') {
      const before = 'gl.uniform4uiv(uniform.location, words);', after = 'if (uniform.stage === 1 && words.length === 184) words.set(words.subarray(20, 24), 180); gl.uniform4uiv(uniform.location, words);';
      assert.equal(original.toString().split(before).length, 2); bytes = Buffer.from(original.toString().replace(before, after));
      report.sabotage = { before, after, originalSha256: sha(original), servedSha256: sha(bytes), expected: { frame: 'initial A/A', pixel: [4, 12], color: [96, 128, 159, 159], sabotaged: [191, 223, 255, 159] } };
    }
    served.set(name.slice(1), { path: name.slice(1), originalSha256: sha(original), servedSha256: sha(bytes), bytes: bytes.length });
    res.writeHead(200, { 'Content-Type': name.endsWith('.wasm') ? 'application/wasm' : name.endsWith('.json') ? 'application/json' : 'text/javascript', 'Cache-Control': 'no-store' }).end(bytes);
  } catch (e) { res.writeHead(404).end(String(e)); }
});
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { chromium } = await import(pathToFileURL(path.join(root, 'web/node_modules/playwright/index.mjs')).href);
  browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: false, args: ['--enable-gpu'] });
  const cdp = await browser.newBrowserCDPSession(); report.gpu = await cdp.send('SystemInfo.getInfo'); report.commandLine = await cdp.send('Browser.getBrowserCommandLine'); report.browser = browser.version();
  assert.equal(report.gpu.gpu.featureStatus.webgl, 'enabled'); assert.ok(!report.commandLine.arguments.some(x => /swiftshader|llvmpipe|disable-gpu(?:$|=)/i.test(x)));
  const context = await browser.newContext(); page = await context.newPage();
  page.on('pageerror', e => report.browserErrors.push(String(e))); page.on('console', e => { if (e.type() === 'error') report.browserErrors.push(e.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  session = await context.newCDPSession(page); await session.send('Profiler.enable'); await session.send('Profiler.startPreciseCoverage', { callCount: true, detailed: true });
  try { report.acceptance = await page.evaluate(async () => (await import('/evidence/virgl-constants/verifier/attack-browser.mjs')).run()); }
  catch (error) { report.error = { message: error.message, stack: error.stack }; report.acceptance = await page.evaluate(() => window.criticReport); }
  if (mode === 'normal') assert.equal(report.acceptance.status, 'passed', report.error?.message);
  else {
    assert.equal(report.acceptance.status, 'failed'); const frame = report.acceptance.rigs[0].criticFrames[0];
    assert.deepEqual(frame.failure, { x: 4, y: 12, expected: [96, 128, 159, 159], actual: [191, 223, 255, 159] });
    const events = report.acceptance.rigs[0].glEvents;
    assert.ok(events.some(e => e.call === 'linkProgram' && e.status)); assert.ok(events.some(e => e.call === 'drawElements'));
    assert.equal(report.acceptance.rigs[0].glObjects.live, 0);
  }
  assert.deepEqual(report.browserErrors, []); report.status = 'passed';
} catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
finally {
  if (session) { const coverage = await session.send('Profiler.takePreciseCoverage'); await fs.writeFile(path.join(output, 'coverage.json'), JSON.stringify(coverage, null, 2) + '\n'); report.coverageSha256 = sha(await fs.readFile(path.join(output, 'coverage.json'))); }
  if (page) { await page.screenshot({ path: path.join(output, 'browser.png') }); report.screenshotSha256 = sha(await fs.readFile(path.join(output, 'browser.png'))); }
  report.served = [...served.values()]; await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ status: report.status, mode, assertions: report.acceptance?.assertions, pixels: report.acceptance?.checkedPixels, failure: report.failure?.message }));
