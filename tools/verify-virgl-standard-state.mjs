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
  assert.ok(["--output", "--node-only", "--mutation", "--smoke", "--inputs"].includes(process.argv[index]));
  assert.ok(process.argv[index + 1]); options[process.argv[index].slice(2)] = process.argv[index + 1];
}
assert.ok(options.output); assert.ok(!options.mutation || ["suffix", "metadata"].includes(options.mutation));
for (const flag of ["node-only", "smoke"]) assert.ok(!options[flag] || options[flag] === "true");
const output = path.resolve(options.output); await fs.mkdir(output, { recursive: true });
const sourcePaths = [
  ...["resources", "decoder", "state", "cache", "constant-domain"].map(name => "renderer/virgl-command/" + name + ".mjs"),
  "renderer/virgl-command/tests/standard-state-binding.mjs", "renderer/virgl-shader/standard.mjs",
  "renderer/virgl-shader/index.mjs", "renderer/virgl-shader/build/wasm/virgl-shader.mjs",
  "renderer/virgl-shader/build/wasm/virgl-shader.wasm", "tools/virgl-original-programs/oracle.mjs",
  "tools/verify-virgl-standard-state.mjs", "tools/virgl-command/fixtures.mjs",
];
const report = { schema: 1, task: "E6-T11d5", status: "running", guestExecution: false, productionNegotiation: false,
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
  const { runWireAcceptance, runMetadataAcceptance } = await import(pathToFileURL(path.join(repo, "renderer/virgl-command/tests/standard-state-binding.mjs")));
  const { createVirglStandardShaderBridge } = await import(pathToFileURL(path.join(repo, "renderer/virgl-shader/standard.mjs")));
  const { default: createModule } = await import(pathToFileURL(path.join(repo, "renderer/virgl-shader/build/wasm/virgl-shader.mjs")));
  const actual = await createModule(); report.fixedMemory = { bytes: actual.HEAPU8.byteLength,
    stageExport: typeof actual._bridge_translate_standard, pairExport: typeof actual._bridge_translate_standard_pair };
  assert.deepEqual(report.fixedMemory, { bytes: 16777216, stageExport: "function", pairExport: "function" });
  report.wire = runWireAcceptance(); report.metadata = await runMetadataAcceptance(await createVirglStandardShaderBridge());
  if (!options["node-only"]) {
    if (options.mutation) {
      const name = "renderer/virgl-command/state.mjs", before = sources.get(name).toString(),
        needle = options.mutation === "suffix" ? "const shader = uniform.stage === 0 ? program.vertex : program.fragment;" :
          "if (standard) for (let index = 0; index < gl.getProgramParameter(program.native, gl.ACTIVE_UNIFORMS); index++) {",
        replacement = options.mutation === "suffix" ? needle + "\n      if (standard && bank.length < count) return [];" :
          needle.replace("if (standard)", "if (false)");
      assert.equal(before.split(needle).length, 2, "real upload mutation has one site");
      const bytes = Buffer.from(before.replace(needle, replacement)); sources.set(name, bytes);
      await fs.writeFile(path.join(output, "mutation-source.mjs"), bytes);
      report.mutation = { mode: options.mutation, path: name, originalSha256: sha256(Buffer.from(before)), servedSha256: sha256(bytes), needle, replacement };
    }
    const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>Standard guest shader bindings</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Standard guest shader bindings</h1><p>Raw word banks · owned queued draws · both-stage textures · independent pixels</p><p id="status">Checking actual hardware bindings…</p><canvas id="gpu" width="16" height="16"></canvas><pre id="result"></pre>');
    const endpoints = new Map([["/", { bytes: html, type: "text/html" }],
      ...[...sources].filter(([name]) => name.endsWith(".mjs") || name.endsWith(".wasm")).map(([name, bytes]) =>
        ["/" + name, { bytes, type: name.endsWith(".wasm") ? "application/wasm" : "text/javascript" }])]);
    let originals = null;
    if (options.inputs) {
      for (const name of ["geometry.bin", "c580.bin"]) {
        const bytes = await fs.readFile(path.join(options.inputs, name)); endpoints.set("/inputs/" + name, { bytes, type: "application/octet-stream" });
        report.inputs.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
      }
      originals = {};
      const names = {
        v92: "7bf4d0d0f981a9feb958d6595302b15d564fc846e6d5ee71874f0921b31e613e",
        f92: "92cb866af48f952b719c54959a439c7330333c6d32897430bc3d4a0a2f63bfba",
        vc580: "403b0529c632d3d2ffe4584ede810f5745e8b76ca2ab4f575e1073d8f29fcf0c",
        fc580: "c5806d5f8fd74bf2d3ce5ccf32bdc255ec13ad9447eec5896a3c96a591a5c68f",
      };
      for (const [name, digest] of Object.entries(names)) {
        const file = "evidence/virgl-workload-inventory/captures/es2gears/shaders/" + digest + ".tgsi",
          bytes = await fs.readFile(path.join(repo, file)); assert.equal(sha256(bytes), digest);
        originals[name] = bytes.toString(); report.inputs.push({ path: file, bytes: bytes.length, sha256: digest });
      }
    }
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
          const module = await import("/renderer/virgl-command/tests/standard-state-binding.mjs"), result = await module.runAcceptance(spec);
          document.querySelector("#status").textContent = "Passed standard queued shader binding proof";
          document.querySelector("#result").textContent = JSON.stringify({ gpu: result.gpu, frames: result.frames.length, predictions: result.predictions.length }, null, 2);
          return { status: "passed", result };
        } catch (error) {
          document.querySelector("#status").textContent = "Failed: " + error.message;
          return { status: "failed", error: { message: error.message, stack: error.stack } };
        }
      }, { smoke: Boolean(options.smoke), ...(originals ? { originals, geometryPath: "/inputs/geometry.bin", banksPath: "/inputs/c580.bin" } : {}) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("standard binding hardware proof exceeded 240 seconds")), 240000); })]);
    } finally { clearTimeout(timer); }
    if (report.browserResult.status === "failed") report.partial = await page.evaluate(() => window.__standardStateEvidence ?? null);
    const evidence = report.browserResult.result ?? report.partial;
    if (evidence) for (const [index, frame] of evidence.frames.entries()) {
      const bytes = Buffer.from(frame.pixels.gzipBase64, "base64"); assert.equal(sha256(bytes), frame.pixels.gzipSha256);
      delete frame.pixels.gzipBase64; const name = "pixels-" + index.toString().padStart(3, "0") + ".bin.gz";
      await fs.writeFile(path.join(output, name), bytes); frame.pixels.path = name;
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
  report.status = "passed"; console.log("Standard shader binding acceptance passed (" + (options["node-only"] ? "wire/metadata" : "hardware") + ")");
} catch (error) {
  report.status = "failed"; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack);
} finally {
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close().catch(() => {}); if (server) await new Promise(resolve => server.close(resolve));
}
