// Fresh verifier's bounded novel attack. No implementation source is modified.
// Run from repository root: node tools/virgl-contract/test-state-replay.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = process.cwd();
const out = path.resolve(process.env.VIRGL_CONTRACT_ATTACK_DIR || 'target/evidence/virgl-contract-state-replay');
await fs.mkdir(out, {recursive:true});
const probePath = 'renderer/virgl-contract/browser.mjs';
const probe = await fs.readFile(path.join(repo, probePath));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { chromium } = await import(pathToFileURL(path.join(repo, 'web/node_modules/playwright/index.mjs')).href);
const server = createServer((request, response) => {
  if (request.url === '/probe.mjs') response.writeHead(200, {'Content-Type': 'text/javascript'}).end(probe);
  else if (request.url === '/favicon.ico') response.writeHead(204).end();
  else response.writeHead(200, {'Content-Type': 'text/html'}).end('<!doctype html><title>Independent state poison attack</title><h1>Explicit GLSL mapping under poisoned prior state</h1><pre id="probes"></pre>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const report = { schema: 1, task: 'E6-T10c', status: 'running', startedAt: new Date().toISOString(),
  head: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  sources: {[probePath]: hash(probe), 'tools/virgl-contract/test-state-replay.mjs':hash(await fs.readFile(fileURLToPath(import.meta.url)))},
  prediction: 'Every drawn probe restores its explicit state after deliberately hostile prior draw state; all original independent pixel oracles hold.',
  scope: 'Handwritten API probes only, not guest context isolation or a VirGL renderer.',
  errors: [] };
try {
  browser = await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless:false, args:['--enable-gpu']});
  const browserSession = await browser.newBrowserCDPSession();
  report.gpu = (await browserSession.send('SystemInfo.getInfo')).gpu;
  report.commandLine = (await browserSession.send('Browser.getBrowserCommandLine')).arguments;
  report.browserVersion = browser.version();
  assert.equal(report.gpu.featureStatus.webgl, 'enabled');
  assert.ok(!report.commandLine.some(v => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(v)));
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => {if (message.type()==='error') report.errors.push(message.text());});
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.startPreciseCoverage', {callCount:true, detailed:true});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  report.observed = await page.evaluate(async () => {
    const old = WebGL2RenderingContext.prototype.drawArrays;
    const samplers = new WeakMap();
    const poisonEvents = [];
    WebGL2RenderingContext.prototype.drawArrays = function(...args) {
      old.apply(this, args);
      let sampler = samplers.get(this);
      if (!sampler) { sampler = this.createSampler(); samplers.set(this,sampler); }
      this.useProgram(null);
      this.bindVertexArray(null);
      this.bindFramebuffer(this.FRAMEBUFFER, null);
      this.viewport(0,0,0,0);
      this.activeTexture(this.TEXTURE7);
      this.bindTexture(this.TEXTURE_2D,null);
      this.bindSampler(0,sampler);
      for (const capability of [this.BLEND,this.DEPTH_TEST,this.STENCIL_TEST,this.CULL_FACE,this.SCISSOR_TEST,this.DITHER]) this.enable(capability);
      this.colorMask(false,false,false,false);
      this.scissor(0,0,0,0);
      poisonEvents.push({draw:poisonEvents.length+1, programIsNull:this.getParameter(this.CURRENT_PROGRAM)===null,
        activeTexture:this.getParameter(this.ACTIVE_TEXTURE),viewport:[...this.getParameter(this.VIEWPORT)],
        colorMask:[...this.getParameter(this.COLOR_WRITEMASK)],error:this.getError()});
    };
    try {
      const {runBackendProbes} = await import('/probe.mjs');
      return {probes:await runBackendProbes(),poisonEvents};
    } finally {WebGL2RenderingContext.prototype.drawArrays=old;}
  });
  assert.equal(report.observed.probes.status,'passed');
  assert.equal(report.observed.poisonEvents.length,7);
  assert.ok(report.observed.poisonEvents.every(e=>e.error===0 && e.programIsNull && e.viewport.every(x=>x===0) && e.colorMask.every(x=>x===false)));
  assert.deepEqual(report.errors,[]);
  const coverage = (await cdp.send('Profiler.takePreciseCoverage')).result.filter(entry=>entry.url.endsWith('/probe.mjs'));
  await fs.writeFile(path.join(out,'probe-coverage.json'),JSON.stringify({sourceSha256:hash(probe),coverage},null,2)+'\n');
  await page.screenshot({path:path.join(out,'state-poison.png'),fullPage:true});
  report.screenshotSha256=hash(await fs.readFile(path.join(out,'state-poison.png')));
  report.status='passed';
} catch(error) {report.status='failed';report.failure=error.stack;process.exitCode=1;}
finally {
  report.finishedAt=new Date().toISOString();
  await fs.writeFile(path.join(out,'state-poison.json'),JSON.stringify(report,null,2)+'\n');
  await browser?.close();await new Promise(resolve=>server.close(resolve));
}
console.log(JSON.stringify({status:report.status,draws:report.observed?.poisonEvents.length,failure:report.failure}));
