#!/usr/bin/env node
// Shared evidence plumbing for isolated shader suites; pixel oracles remain in each suite.
// This does not boot a guest or claim emulator/compositor GPU acceleration.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function browserOptions(extra = []) {
  const options = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    const name = process.argv[i];
    assert.ok(["--output", "--chrome", ...extra].includes(name), `unknown argument ${name}`);
    assert.ok(process.argv[i + 1], `${name} requires a value`);
    options[name.slice(2)] = process.argv[i + 1];
  }
  assert.ok(options.output, `usage: node ${process.argv[1]} --output <directory> [--chrome <executable>]`);
  return options;
}

async function runVirglBrowser(suite) {
  const options = suite.options;
  const output = path.resolve(options.output);
  const chrome = options.chrome || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const rendererRoot = path.join(repo, "renderer/virgl-shader");
  const wrapper = path.resolve(process.argv[1]);
  const allowedFiles = (suite.servedFiles ?? []).map((file) => path.resolve(repo, file));
  const allowed = (file) => file.startsWith(`${rendererRoot}${path.sep}`) || allowedFiles.includes(file);
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
  const relative = (filename) => path.relative(repo, filename).split(path.sep).join("/");
  await fs.mkdir(output, { recursive: true });

  const report = {
    schema: 1, task: suite.task, boundary: suite.boundary, ...suite.reportFields,
    guestExecution: false, status: "running", command: [process.execPath, ...process.argv.slice(1)],
    startedAt: new Date().toISOString(),
    host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
    gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    trackedChanges: execFileSync("git", ["status", "--porcelain", "--", "renderer/virgl-shader", relative(wrapper), relative(fileURLToPath(import.meta.url)), ...allowedFiles.map(relative)],
      { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean),
    sources: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] },
  };
  const servedFiles = new Map();
  let browser;
  let page;
  let server;
  let coverageSession;

  async function withDeadline(milliseconds, operation) {
    let timer;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`browser acceptance exceeded ${milliseconds} ms`)), milliseconds);
      })]);
    } finally {
      clearTimeout(timer);
    }
  }

  async function sourceHashes(directory) {
    const files = [];
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name.startsWith(".") || ["node_modules", "__pycache__"].includes(entry.name)) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await sourceHashes(full));
      else if (entry.isFile() && /\.(?:c|h|mjs|js|json|sh|py|tgsi|md|txt|wasm)$/.test(entry.name)) {
        const bytes = await fs.readFile(full);
        files.push({ path: relative(full), size: bytes.length, sha256: hash(bytes) });
      }
    }
    return files;
  }

  const html = suite.html;

  async function serve(request, response) {
    try {
      const pathname = new URL(request.url, "http://localhost").pathname;
      if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
      if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html); return; }
      const filename = path.resolve(repo, `.${decodeURIComponent(pathname)}`);
      assert.ok(allowed(filename), "request outside shader module");
      const canonical = await fs.realpath(filename);
      assert.ok(allowed(canonical), "symlink outside shader module");
      const original = await fs.readFile(filename);
      const bytes = mutateServed(relative(filename), original, report);
      servedFiles.set(relative(filename), { path: relative(filename), size: bytes.length, sha256: hash(bytes) });
      const type = filename.endsWith(".wasm") ? "application/wasm" : /\.(?:mjs|js)$/.test(filename)
        ? "text/javascript" : filename.endsWith(".json") ? "application/json" : "text/plain";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(bytes);
    } catch (error) {
      response.writeHead(404, { "Content-Type": "text/plain" }).end(String(error));
    }
  }

  try {
    report.sources = await sourceHashes(rendererRoot);
    for (const filename of [fileURLToPath(import.meta.url), wrapper]) {
      const bytes = await fs.readFile(filename);
      report.sources.push({ path: relative(filename), size: bytes.length, sha256: hash(bytes) });
    }
    for (const pinned of suite.pinnedFiles ?? []) {
      const bytes = await fs.readFile(path.resolve(repo, pinned.path));
      assert.equal(hash(bytes), pinned.sha256, `pinned input changed: ${pinned.path}`);
      if (pinned.size !== undefined) assert.equal(bytes.length, pinned.size, `pinned input size: ${pinned.path}`);
      report.sources.push({ path: pinned.path, size: bytes.length, sha256: hash(bytes) });
    }
    const chromeBytes = await fs.readFile(chrome);
    const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href);
    server = createServer((request, response) => { void serve(request, response); });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const launch = { executablePath: chrome, headless: false, args: ["--enable-gpu"] };
    browser = await chromium.launch(launch);
    const session = await browser.newBrowserCDPSession();
    const system = await session.send("SystemInfo.getInfo");
    const version = await session.send("Browser.getVersion");
    const commandLine = await session.send("Browser.getBrowserCommandLine");
    report.browser = { executablePath: chrome, executableSha256: hash(chromeBytes), version: browser.version(),
      launch, actualCommandLine: commandLine.arguments, cdpVersion: version, gpu: system.gpu };
    assert.ok(!commandLine.arguments.some((argument) => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(argument)),
      "software rendering or disabled GPU flags are forbidden");
    // Current Chrome groups WebGL versions under `webgl`; the page separately requires
    // an actual WebGL2RenderingContext. Older versions may expose a distinct `webgl2` key.
    const webglFeature = Object.hasOwn(system.gpu.featureStatus, "webgl2") ? "webgl2" : "webgl";
    report.browser.webglFeature = webglFeature;
    assert.equal(system.gpu.featureStatus[webglFeature], "enabled", "Chrome must report hardware WebGL enabled");
    const context = await browser.newContext({ viewport: { width: 1120, height: 920 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    page.on("console", (message) => {
      if (message.type() === "error") report.browserErrors.console.push({ text: message.text(), location: message.location() });
    });
    page.on("pageerror", (error) => report.browserErrors.page.push(error.message));
    page.on("requestfailed", (request) => report.browserErrors.requests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.goto(base, { waitUntil: "load" });
    if (suite.coveragePaths?.length) {
      coverageSession = await context.newCDPSession(page);
      await coverageSession.send("Profiler.enable");
      await coverageSession.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    }
    report.acceptance = await withDeadline(180_000, page.evaluate(async ({ modulePath, arguments: options }) => {
      const { runAcceptance } = await import(modulePath);
      return await runAcceptance(options);
    }, { modulePath: suite.modulePath, arguments: suite.browserArguments ?? {} }));
    assert.equal(report.acceptance.status, "passed");
    assert.equal(report.acceptance.guestExecution, false);
    suite.validate(report.acceptance);
    assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] }, "browser emitted errors");
    report.servedFiles = [...servedFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
    assert.ok(report.servedFiles.some((file) => file.path.endsWith(".wasm") && file.size > 1000),
      "browser must consume the built WebAssembly converter module");
    for (const file of report.servedFiles) {
      assert.equal(hash(mutateServed(file.path, await fs.readFile(path.join(repo, file.path)), report)), file.sha256,
        `served input changed during proof: ${file.path}`);
    }
    for (const file of report.sources) {
      assert.equal(hash(await fs.readFile(path.join(repo, file.path))), file.sha256,
        `recorded source changed during proof: ${file.path}`);
    }
    await page.screenshot({ path: path.join(output, "browser.png"), fullPage: true });
    report.screenshot = { path: "browser.png", sha256: hash(await fs.readFile(path.join(output, "browser.png"))) };
    report.status = "passed";
    console.log(suite.successMessage(report.acceptance));
  } catch (error) {
    report.status = "failed";
    report.failure = { message: error.message, stack: error.stack };
    if (page) {
      report.acceptance = await withDeadline(3_000, page.evaluate((key) => window[key] ?? null, suite.windowReportKey)).catch(() => report.acceptance);
      await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true, timeout: 3_000 }).then(async () => {
        report.failureScreenshot = { path: "failure.png", sha256: hash(await fs.readFile(path.join(output, "failure.png"))) };
      }).catch(() => {});
    }
    console.error(error.stack ?? error);
    process.exitCode = 1;
  } finally {
    if (coverageSession) {
      try {
        const coverage = await coverageSession.send("Profiler.takePreciseCoverage");
        const scripts = suite.coveragePaths.map((filename) => {
          const source = report.sources.find((entry) => entry.path === filename);
          assert.ok(source, `coverage source must be hash-bound: ${filename}`);
          const matches = coverage.result.filter((script) => script.url.endsWith(`/${filename}`));
          assert.equal(matches.length, 1, `coverage must name the served runtime ${filename}`);
          return { source: filename, sha256: servedFiles.get(filename).sha256, originalSha256: source.sha256, coverage: matches[0] };
        });
        const bytes = Buffer.from(`${JSON.stringify({ schema: 1, scripts }, null, 2)}\n`);
        await fs.writeFile(path.join(output, "browser-coverage.json"), bytes);
        report.browserCoverage = { path: "browser-coverage.json", sha256: hash(bytes) };
        await coverageSession.send("Profiler.stopPreciseCoverage");
      } catch (error) {
        report.status = "failed";
        report.coverageFailure = { message: error.message, stack: error.stack };
        console.error(error.stack ?? error);
        process.exitCode = 1;
      }
    }
    report.servedFiles = [...servedFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(output, "report.json"), `${JSON.stringify(report)}\n`);
    await browser?.close().catch(() => {});
    if (server) await new Promise((resolve) => server.close(resolve));
  }
  return report;
}

function browserDocument({ title, heading, description }) {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:28px}h1{font-size:26px;margin-bottom:8px}
p{color:#b3c3d6}#draws{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1020px}
figure{margin:0;background:#1b2533;border:1px solid #435167;padding:14px;border-radius:8px}
img{width:100%;height:150px;object-fit:contain;image-rendering:pixelated;background:#243244}
figcaption{font-size:13px;margin-top:10px}#gpu{position:absolute;width:1px;height:1px;left:-100px}</style>
<h1>${heading}</h1><p>${description}</p>
<p id="status">Running hardware acceptance…</p><p id="renderer"></p><canvas id="gpu"></canvas><main id="draws"></main>`;
}

const options=browserOptions(['--mode']);
options.mode??='normal';assert.ok(['normal','decoder-bypass','decoder-and-guard-bypass'].includes(options.mode),'known domain proof mode');
function mutateServed(filename,original,report){
  const definitions=[];
  if(options.mode!=='normal'&&filename==='renderer/virgl-command/decoder.mjs')definitions.push({path:filename,before:'this.require(Number.isFinite(value), "invalid-value", "Non-finite float field.");',after:'this.require(this.opcode === 12 || Number.isFinite(value), "invalid-value", "Non-finite float field.");'});
  if(options.mode==='decoder-and-guard-bypass'&&filename==='renderer/virgl-command/constant-domain.mjs')definitions.push({path:filename,before:'return Number.isInteger(word) && word >= 0 && word <= 0xffffffff && (word & 0x7f800000) !== 0x7f800000;',after:'return Number.isInteger(word) && word >= 0 && word <= 0xffffffff;'});
  if(definitions.length===0)return original;
  let text=original.toString('utf8');for(const definition of definitions){assert.equal(text.split(definition.before).length,2,'one exact served-source mutation site');text=text.replace(definition.before,definition.after);const entry={...definition,matches:1,originalSha256:createHash('sha256').update(original).digest('hex'),servedSha256:createHash('sha256').update(text).digest('hex')};report.mutations??=[];if(!report.mutations.some(x=>x.path===filename))report.mutations.push(entry);else assert.deepEqual(report.mutations.find(x=>x.path===filename),entry);}
  return Buffer.from(text);
}
const {ORIGINAL_INPUTS}=await import('../renderer/virgl-shader/tests/components.mjs');
const runtime=['renderer/virgl-command/decoder.mjs','renderer/virgl-command/resources.mjs', 'renderer/virgl-command/float-images.mjs','renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/tests/constant-domains.mjs','renderer/virgl-command/tests/constant-domain-shaders.json', 'renderer/virgl-command/color-images.mjs'];
const runtimePins=await Promise.all(runtime.map(async filename=>{const bytes=await fs.readFile(path.join(repo,filename));return {path:filename,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}));
await runVirglBrowser({options,task:'E6-T12e6a',boundary:'trusted host conditional metadata; real decoded constant packets and shared sync/async draw consumer; compiler and guest transport unchanged',
  reportFields:{currentGuest3dAdvertisement:false,trustedHostMetadataWrapper:true,mode:options.mode,mutations:[]},modulePath:'/renderer/virgl-command/tests/constant-domains.mjs',windowReportKey:'__virglConstantDomainsReport',browserArguments:{mode:options.mode},
  servedFiles:[...ORIGINAL_INPUTS.map(x=>x.path),...runtime],pinnedFiles:[...ORIGINAL_INPUTS,...runtimePins],coveragePaths:['renderer/virgl-command/resources.mjs','renderer/virgl-command/state.mjs', 'renderer/virgl-command/cache.mjs','renderer/virgl-command/constant-domain.mjs','renderer/virgl-command/decoder.mjs','renderer/virgl-command/tests/constant-domains.mjs'],
  html:browserDocument({title:'E6-T12e6a constant domains',heading:'Conditional constant-bank consumer',description:'Trusted host contract harness · actual command renderer · immutable current words · raw signed zeros and subnormals · production graphics remains off'}),
  validate(a){assert.equal(a.schema,'wasm-vm-constant-domain-browser-v1');assert.equal(a.mode,options.mode);assert.equal(a.shaderFixtures.length,14);assert.equal(a.corpus.filter(x=>x.result.ok).length,12);assert.equal(a.invalidCases,120);assert.equal(a.rawWords,options.mode==='normal'?64:0);assert.equal(a.metadataRigs.length,options.mode==='normal'?28:0);for(const r of [...a.rigs,...a.metadataRigs]){assert.equal(r.glObjects.live,0);assert.ok(Object.values(r.finalBudgets).every(x=>x===0));assert.ok(Object.values(r.finalResourceBudgets).every(x=>x===0));}},
  successMessage:a=>`E6-T12e6a ${a.mode}: ${a.checkedPixels} whole-frame pixels; ${a.rawWords} exact raw words; ${a.invalidCases} invalid-bank cases; complete cleanup.`,
});
