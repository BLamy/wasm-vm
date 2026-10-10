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
  assert.ok(["--output", "--mutation", "--smoke"].includes(process.argv[index]));
  assert.ok(process.argv[index + 1]); options[process.argv[index].slice(2)] = process.argv[index + 1];
}
assert.ok(options.output); assert.ok(!options.mutation || ["generic"].includes(options.mutation));
for (const flag of ["smoke"]) assert.ok(!options[flag] || options[flag] === "true");
const output = path.resolve(options.output); await fs.mkdir(output, { recursive: true });
const sourcePaths = [
  ...["resources", "decoder", "state", "cache", "constant-domain"].map(name => "renderer/virgl-command/" + name + ".mjs"),
  "renderer/virgl-command/tests/standard-constant-attributes.mjs", "renderer/virgl-shader/standard.mjs",
  "renderer/virgl-shader/index.mjs", "renderer/virgl-shader/build/wasm/virgl-shader.mjs",
  "renderer/virgl-shader/build/wasm/virgl-shader.wasm", "tools/virgl-command/standard-constant-oracle.mjs",
  "tools/verify-virgl-standard-constant.mjs", "tools/virgl-command/fixtures.mjs",
  "renderer/virgl-command/tests/standard-instanced-draws.mjs", "tools/virgl-command/standard-draw-oracle.mjs",
];
const report = { schema: 1, task: "E6-T11d7", status: "running", guestExecution: false, productionNegotiation: false,
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
    stageExport: typeof actual._bridge_translate_standard, pairExport: typeof actual._bridge_translate_standard_pair };
  assert.deepEqual(report.fixedMemory, { bytes: 16777216, stageExport: "function", pairExport: "function" });
  {
    if (options.mutation) {
      const name="renderer/virgl-command/state.mjs", before=sources.get(name).toString(),
        needle="gl.vertexAttrib4fv(attribute.location, constantAttributes.get(attribute.index).values);",
        replacement="gl.vertexAttrib4fv(attribute.location, new Float32Array([constantAttributes.get(attribute.index).values[0] + .5, ...constantAttributes.get(attribute.index).values.slice(1)]));";
      assert.equal(before.split(needle).length,2,"one actual native constant attribute site");
      const bytes=Buffer.from(before.replace(needle,replacement));sources.set(name,bytes);
      await fs.writeFile(path.join(output, "mutation-source.mjs"), bytes);
      report.mutation = { mode: options.mutation, path: name, originalSha256: sha256(Buffer.from(before)), servedSha256: sha256(bytes), needle, replacement };
    }
    const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>Standard constant guest attributes</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Standard constant guest attributes</h1><p>GPU storage reads · native generic attributes · owned batch lifetime · independent pixels</p><p id="status">Checking actual hardware bindings…</p><canvas id="gpu" width="16" height="16"></canvas><pre id="result"></pre>');
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
          const module = await import("/renderer/virgl-command/tests/standard-constant-attributes.mjs"), result = await module.runAcceptance(spec);
          document.querySelector("#status").textContent = "Passed standard constant attribute proof";
          document.querySelector("#result").textContent = JSON.stringify({ gpu: result.gpu, frames: result.frames.length, predictions: result.predictions.length }, null, 2);
          return { status: "passed", result };
        } catch (error) {
          document.querySelector("#status").textContent = "Failed: " + error.message;
          return { status: "failed", error: { message: error.message, stack: error.stack } };
        }
      }, { smoke: Boolean(options.smoke) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("standard constant hardware proof exceeded 240 seconds")), 240000); })]);
    } finally { clearTimeout(timer); }
    if (report.browserResult.status === "failed") report.partial = await page.evaluate(() => window.__standardConstantEvidence ?? null);
    const evidence = report.browserResult.result ?? report.partial;
    if(evidence)for(const blob of evidence.blobs){
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
  report.status = "passed"; console.log("Standard constant attribute hardware acceptance passed");
} catch (error) {
  report.status = "failed"; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack);
} finally {
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close().catch(() => {}); if (server) await new Promise(resolve => server.close(resolve));
}
