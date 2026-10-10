#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { repo, sha256 } from "./virgl-command/fixtures.mjs";

const options = {};
for (let index = 2; index < process.argv.length; index += 2) {
  assert.ok(["--output", "--fault", "--smoke", "--node-only", "--seed", "--mode"].includes(process.argv[index]));
  assert.ok(process.argv[index + 1]); options[process.argv[index].slice(2)] = process.argv[index + 1];
}
assert.ok(options.output); assert.ok(!options.mode||["matrix","boundaries"].includes(options.mode)); assert.ok(!options.fault || ["storage-precision", "linear-filter", "implicit-alpha"].includes(options.fault));
for (const flag of ["smoke", "node-only"]) assert.ok(!options[flag] || options[flag] === "true");
const output = path.resolve(options.output); await fs.mkdir(output, { recursive: true });
const sourcePaths = [...new Set([
 ...execFileSync('git',['ls-files','renderer/virgl-command','renderer/virgl-shader','tools/virgl-command'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(n=>n.endsWith('.mjs')),
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
 'renderer/virgl-shader/UPSTREAM.json','renderer/virgl-shader/bridge.c','renderer/virgl-shader/build.sh',
 'tools/verify-virgl-standard-float-consumer.mjs',
 'renderer/virgl-command/constant-domain.mjs',
 'renderer/virgl-command/state.mjs',
 'tools/virgl-standard-texture/hardware-fixtures.mjs',
 'renderer/virgl-command/tests/standard-float-consumer-rig.mjs',
 'renderer/virgl-command/tests/standard-float-consumer.mjs',
 'renderer/virgl-command/tests/standard-float-consumer-boundaries.mjs',
 'tools/virgl-command/standard-float-consumer-fixtures.mjs',
 'tools/virgl-command/standard-float-consumer-pixels.py',
 'tools/virgl-command/standard-float-consumer-pixels.mjs',
])];
const report = { schema: 1, task: "E6-T11d26", status: "running", guestExecution: false, productionNegotiation: false,
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: [process.execPath, ...process.argv.slice(1)], host: { platform: process.platform, arch: process.arch,
    release: os.release(), node: process.version }, sources: [], inputs: [], servedFiles: [],
  browserErrors: { console: [], page: [], requests: [] }, startedAt: new Date().toISOString() };
const served = new Map(); let browser, server, page;
try {
  const sources = new Map();
  for (const name of sourcePaths) {
    const bytes = await fs.readFile(path.join(repo, name)); sources.set(name, bytes);
    report.sources.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
  }
  const { default: createModule } = await import(pathToFileURL(path.join(repo, "renderer/virgl-shader/build/wasm/virgl-shader.mjs")));
  const actual = await createModule(); report.fixedMemory = { bytes: actual.HEAPU8.byteLength,
    stageExport: typeof actual._bridge_translate_standard, pairExport: typeof actual._bridge_translate_standard_pair, typedPairExport: typeof actual._bridge_translate_standard_pair_typed, vertexFormatsExport: typeof actual._bridge_translate_standard_pair_vertex_formats, uniformExport: typeof actual._bridge_translate_standard_uniform, uniformPairExport: typeof actual._bridge_translate_standard_uniform_pair, textureExport: typeof actual._bridge_translate_standard_texture, texturePairExport: typeof actual._bridge_translate_standard_texture_pair };
  assert.deepEqual(report.fixedMemory, { bytes: 16777216, stageExport: "function", pairExport: "function", typedPairExport: "function", vertexFormatsExport: "function", uniformExport: "function", uniformPairExport: "function", textureExport: "function", texturePairExport: "function" });
  if (options["node-only"]) {
    const module=await import(pathToFileURL(path.join(repo,"renderer/virgl-command/tests/standard-float-consumer.mjs")));
    report.wire=await module.runWireAcceptance();assert.equal(report.wire.status,"passed");
  } else {
    report.fault=options.fault??null;
    const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>Original floating image consumer</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Original floating image consumer</h1><p>Original floating operations · retained image views · native mip queries</p><p id="status">Checking actual hardware bindings…</p><canvas id="gpu" width="8" height="8"></canvas><pre id="result"></pre>');
    const endpoints = new Map([["/", { bytes: html, type: "text/html" }],
      ...[...sources].filter(([name]) => name.endsWith(".mjs") || name.endsWith(".wasm")).map(([name, bytes]) =>
        ["/" + name, { bytes, type: name.endsWith(".wasm") ? "application/wasm" : "text/javascript" }])]);
    server = createServer((request, response) => {
      const name = new URL(request.url, "http://localhost").pathname;
      if (name === "/favicon.ico") { response.writeHead(204).end(); return; }
      const item = endpoints.get(name); if (!item) { response.writeHead(404).end("not found"); return; }
      served.set(name, { path: name, bytes: item.bytes.length, sha256: sha256(item.bytes) });
      response.writeHead(200, { "Content-Type": item.type, "Cache-Control": "no-store",
        "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" }).end(item.bytes);
    });
    await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
    browser = await chromium.launch({ executablePath: chrome, headless: false, args: ["--enable-gpu"] });
    const session = await browser.newBrowserCDPSession(), system = await session.send("SystemInfo.getInfo"),
      command = await session.send("Browser.getBrowserCommandLine");
    assert.equal(system.gpu.featureStatus.webgl2 ?? system.gpu.featureStatus.webgl, "enabled");
    assert.ok(!command.arguments.some(value => /swiftshader|llvmpipe|softpipe|lavapipe|--disable-gpu(?:$|=)/i.test(value)));
    report.browser = { executable: chrome, sha256: sha256(await fs.readFile(chrome)), version: browser.version(),
      headless: false, gpu: system.gpu, commandLine: command.arguments };
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
    page = await context.newPage();
    await page.exposeFunction("textureProgress", row => console.log("Original native texture progress:", row.cases, "cases,", row.frames, "full frames"));
    page.on("console", message => { if (message.type() === "error") report.browserErrors.console.push(message.text()); });
    page.on("pageerror", error => report.browserErrors.page.push(error.message));
    page.on("requestfailed", request => report.browserErrors.requests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.goto("http://127.0.0.1:" + server.address().port + "/", { waitUntil: "load" });
    const cdp = await context.newCDPSession(page); await cdp.send("Profiler.enable");
    await cdp.send("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
    let timer;
    try {
      report.browserResult = await Promise.race([page.evaluate(async spec => {
        try {
          const module = await import("/renderer/virgl-command/tests/standard-float-consumer.mjs"), result = await module.runAcceptance(spec);
          document.querySelector("#status").textContent = "Passed original floating-image-consumer proof";
          document.querySelector("#result").textContent = JSON.stringify({ gpu: result.gpu, runs: result.runs.length, frames: result.frames.length, predictions: result.predictions.length }, null, 2);
          return { status: "passed", result };
        } catch (error) {
          document.querySelector("#status").textContent = "Failed: " + error.message;
          return { status: "failed", error: { message: error.message, stack: error.stack } };
        }
      }, { smoke: Boolean(options.smoke), fault:options.fault, mode:options.mode, ...(options.seed ? {seed:Number(options.seed)} : {}) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("floating consumer hardware proof exceeded 600 seconds")), 600000); })]);
    } finally { clearTimeout(timer); }
    if (report.browserResult.status === "failed") report.partial = await page.evaluate(() => window.__standardFloatConsumerEvidence ?? null);
    const evidence = report.browserResult.result ?? report.partial;
    const blobKeys=new Set();
    if(evidence)for(const blob of evidence.blobs){
      assert.ok(!blobKeys.has(blob.key),"recorded native blob keys are unique");blobKeys.add(blob.key);
      assert.ok(/^blob-[0-9]+$/.test(blob.key));
      const bytes=Buffer.from(blob.gzipBase64,"base64");assert.equal(sha256(bytes),blob.gzipSha256);
      delete blob.gzipBase64;blob.path=blob.key+".bin.gz";await fs.writeFile(path.join(output,blob.path),bytes);
    }
    const coverage = await cdp.send("Profiler.takePreciseCoverage"), scripts = [];
    for (const name of sourcePaths.filter(name => name.endsWith(".mjs"))) {
      const matches = coverage.result.filter(script => script.url.endsWith("/" + name));
      if (matches.length) { assert.equal(matches.length, 1); scripts.push({ source: name, sha256: sha256(sources.get(name)), coverage: matches[0] }); }
    }
    await fs.writeFile(path.join(output, "browser-coverage.json"), JSON.stringify({ schema: 1, scripts }, null, 2) + "\n");
    report.browserCoverage = { path: "browser-coverage.json", sha256: sha256(await fs.readFile(path.join(output, "browser-coverage.json"))) };
    await cdp.send("Profiler.stopPreciseCoverage"); await page.screenshot({ path: path.join(output, "browser.png"), fullPage: true });
    report.screenshot = { path: "browser.png", sha256: sha256(await fs.readFile(path.join(output, "browser.png"))) };
    assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] });
    assert.equal(report.browserResult.status, "passed", report.browserResult.error?.message);
  }
  for (const source of report.sources) assert.equal(sha256(await fs.readFile(path.join(repo, source.path))), source.sha256, "source drift " + source.path);
  report.status = "passed"; console.log("Original floating consumer acceptance passed");
} catch (error) {
  report.status = "failed"; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack);
} finally {
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close().catch(() => {}); if (server) await new Promise(resolve => server.close(resolve));
}
