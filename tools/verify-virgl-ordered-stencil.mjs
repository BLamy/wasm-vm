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
assert.ok(options.output); assert.ok(!options.mode||["matrix","functions","segments","boundaries","failures","limits","absent","retained-common","retained-assembly","critic-ordered"].includes(options.mode)); assert.ok(!options.fault || ["order", "operation", "value-mask", "completed-output", "completed-stencil"].includes(options.fault));
for (const flag of ["smoke", "node-only"]) assert.ok(!options[flag] || options[flag] === "true");
const output = path.resolve(options.output); await fs.mkdir(output, { recursive: true });
const sourcePaths = [...new Set([
 'renderer/virgl-command/tests/standard-ordered-stencil.mjs','renderer/virgl-command/tests/standard-ordered-stencil-rig.mjs','tools/virgl-ordered-stencil/fixtures.mjs','tools/virgl-ordered-stencil/oracle.mjs','tools/virgl-ordered-stencil/boundaries.mjs','tools/verify-virgl-ordered-stencil.mjs',
 'renderer/virgl-command/tests/standard-stencil.mjs','renderer/virgl-command/tests/standard-stencil-wire.mjs','renderer/virgl-command/tests/standard-stencil-rig.mjs','renderer/virgl-command/tests/standard-stencil-critic.mjs','renderer/virgl-command/tests/standard-stencil-switch-critic.mjs','tools/virgl-stencil/fixtures.mjs',
 'renderer/virgl-command/tests/standard-packed-depth-consumer.mjs','renderer/virgl-command/tests/standard-packed-depth-consumer-rig.mjs','tools/virgl-packed-depth-consumer/fixtures.mjs',
 ...execFileSync('git',['ls-files','renderer/virgl-command','renderer/virgl-shader','tools/virgl-command'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(n=>/\.(?:mjs|h|json|yaml)$/.test(n)),
 'renderer/virgl-command/packed-unsigned-images.mjs',
 ...execFileSync('git',['ls-files','tools/virgl-packed-unsigned-consumer','tools/virgl-shared-exponent-consumer','tools/virgl-integer-image-consumer','tools/virgl-integer-image-shader','tools/virgl-packed-normalized-consumer'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(n=>n.endsWith('.mjs')),
 'renderer/virgl-command/tests/standard-unorm-depth-rig.mjs','renderer/virgl-command/unorm-depth-images.mjs',
 'renderer/virgl-command/tests/standard-unorm-depth.mjs','renderer/virgl-command/tests/standard-unorm-depth-transfers.mjs',
 'tools/virgl-unorm-depth/fixtures.mjs','tools/virgl-floating-depth-consumer/fixtures.mjs','tools/virgl-packed-unsigned-consumer/fixtures.mjs',
 'tools/virgl-packed-unsigned-consumer/samples.mjs',
 'tools/virgl-multiple-color/fixtures.mjs',
 'renderer/virgl-shader/build/wasm/virgl-shader.mjs','renderer/virgl-shader/build/wasm/virgl-shader.wasm',
 'renderer/virgl-shader/UPSTREAM.json','renderer/virgl-shader/bridge.c','renderer/virgl-shader/build.sh',
 'tools/virgl-command/standard-packed-unsigned-fixtures.mjs',
 'tools/virgl-command/standard-packed-unsigned-formats.json',
 'tools/virgl-command/standard-packed-unsigned-mesa-formats.yaml',
 'tools/verify-virgl-standard-stencil.mjs',
])];
const report = { schema: 1, task: "E6-T11d45", status: "running", guestExecution: false, productionNegotiation: false,
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: [process.execPath, ...process.argv.slice(1)], host: { platform: process.platform, arch: process.arch,
    release: os.release(), node: process.version }, sources: [], inputs: [], servedFiles: [],
  browserErrors: { console: [], page: [], requests: [] }, startedAt: new Date().toISOString() };
const served = new Map(),blobKeys=new Set(); let browser, server, page;
async function recordBlob(blob){assert.ok(!blobKeys.has(blob.key));assert.ok(/^blob-[0-9]+$/.test(blob.key));const bytes=Buffer.from(blob.gzipBase64,'base64');assert.equal(sha256(bytes),blob.gzipSha256);const name=blob.key+'.bin.gz';await fs.writeFile(path.join(output,name),bytes);blobKeys.add(blob.key);return name;}
async function recordRun(index,body){assert.ok(Number.isInteger(index)&&index>=0);const bytes=Buffer.from(body),name='run-'+String(index).padStart(4,'0')+'.json';await fs.writeFile(path.join(output,name),bytes);return {path:name,bytes:bytes.length,sha256:sha256(bytes)};}

try {
  const sources = new Map();
  for (const name of sourcePaths) {
    const bytes = await fs.readFile(path.join(repo, name)); sources.set(name, bytes);
    report.sources.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) });
    await fs.mkdir(path.join(output,"source",path.dirname(name)),{recursive:true});await fs.writeFile(path.join(output,"source",name),bytes);
  }
  if (options["node-only"]) {
    const module=await import(pathToFileURL(path.join(repo,"renderer/virgl-command/tests/standard-stencil.mjs")));
    report.wire=module.runWireAcceptance();assert.equal(report.wire.status,"passed");
  } else {
    report.fault=options.fault??null;
    if(options.fault==='order'){
      const name='renderer/virgl-command/state.mjs',original=sources.get(name),needle='for (let i = 0; i < nativeCount; i += 3) for (let face = 0; face < 2; face++) {',replacement='for (let face = 0; face < 2; face++) for (let i = 0; i < nativeCount; i += 3) {';
      assert.equal(original.toString().split(needle).length,2,'one original ordered native loop');const delivered=Buffer.from(original.toString().replace(needle,replacement));sources.set(name,delivered);report.mutation={path:name,kind:'actual-served-whole-face-grouping',original:{bytes:original.length,sha256:sha256(original)},delivered:{bytes:delivered.length,sha256:sha256(delivered)}};await fs.mkdir(path.join(output,'served',path.dirname(name)),{recursive:true});await fs.writeFile(path.join(output,'served',name),delivered);
    }
    const html = Buffer.from('<!doctype html><meta charset="utf-8"><title>Original ordered native S8 stencil consumers</title><style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:32px}pre{white-space:pre-wrap}canvas{width:256px;height:256px;image-rendering:pixelated}</style><h1>Original ordered native S8 stencil consumers</h1><p>Original DSA and CLEAR words · native S8 planes · restored masks</p><p id="status">Checking actual hardware bindings…</p><canvas id="gpu" width="8" height="8"></canvas><pre id="result"></pre>');
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
    await page.exposeFunction("__recordPackedConsumerBlob",recordBlob);
    await page.exposeFunction("__recordPackedConsumerRun",recordRun);
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
          const historical={'retained-assembly':'standard-primitive-assembly','retained-common':'standard-stencil','critic-ordered':'standard-stencil-critic','critic-switch':'standard-stencil-switch-critic','retained-packed-surfaces':'standard-packed-depth-consumer',historical:'standard-multiple-color', 'historical-integer':'standard-integer-image-consumer','historical-float':'standard-integer-image-consumer','historical-normalized':'standard-packed-normalized-consumer','retained-floating-samples':'standard-floating-depth-consumer','retained-floating-surfaces':'standard-floating-depth-consumer','retained-floating-boundaries':'standard-floating-depth-consumer'}, selected=historical[spec.mode]??'standard-ordered-stencil';
          const module = await import('/renderer/virgl-command/tests/'+selected+'.mjs');if(module.runWireAcceptance&&selected.startsWith('standard-stencil'))module.runWireAcceptance();const result = await module.runAcceptance(spec.mode==='retained-assembly'?{smoke:true}:spec.mode==='retained-common'?{...spec,mode:'operations',smoke:true}:spec.mode==='retained-packed-surfaces'?{...spec,mode:'surfaces',smoke:true}:spec.mode?.startsWith('retained-floating-')?{...spec,mode:spec.mode.slice('retained-floating-'.length),smoke:true}:historical[spec.mode]&&!spec.mode.startsWith('critic-')?{...spec,mode:spec.mode==='historical-float'?'float':'matrix',smoke:spec.mode!=='historical-float'}:spec);
          document.querySelector("#status").textContent = "Passed original ordered native S8 stencil proof";
          document.querySelector("#result").textContent = JSON.stringify({ gpu: result.gpu, runs: result.runs?.length??0, planes: (result.runs??[]).reduce((sum,row)=>sum+(row.planes?.length??0),0), predictions: result.predictions?.length??result.assertions?.length??0 }, null, 2);
          return { status: "passed", result };
        } catch (error) {
          document.querySelector("#status").textContent = "Failed: " + error.message;
          return { status: "failed", error: { message: error.message, stack: error.stack } };
        }
      }, { smoke: Boolean(options.smoke), fault:options.fault, mode:options.mode, ...(options.seed ? {seed:Number(options.seed)} : {}) }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("original S8 stencil hardware proof exceeded 420 seconds")), 420000); })]);
    } finally { clearTimeout(timer); }
    if (report.browserResult.status === "failed") report.partial = await page.evaluate(() => window.__standardOrderedStencilEvidence ?? window.__standardStencilEvidence ?? window.__standardPackedDepthConsumerEvidence ?? window.__standardMultipleColorEvidence ?? window.__standardIntegerImageConsumerEvidence ?? window.__standardPackedNormalizedConsumerEvidence ?? null);
    const evidence = report.browserResult.result ?? report.partial;
    if(evidence)for(const blob of evidence.blobs??[]){
      if(blob.gzipBase64){blob.path=await recordBlob(blob);delete blob.gzipBase64;}
      else {assert.ok(blobKeys.has(blob.key));assert.equal(blob.path,blob.key+'.bin.gz');assert.equal(sha256(await fs.readFile(path.join(output,blob.path))),blob.gzipSha256);}
    }
    const coverage = await cdp.send("Profiler.takePreciseCoverage"), scripts = [];
    for (const name of sourcePaths.filter(name => name.endsWith(".mjs"))) {
      const matches = coverage.result.filter(script => script.url.endsWith("/" + name));
      if (matches.length) { assert.equal(matches.length, 1); scripts.push({ source: name, sha256: sha256(sources.get(name)), sourceBody: sources.get(name).toString("utf8"), coverage: matches[0] }); }
    }
    await fs.writeFile(path.join(output, "browser-coverage.json"), JSON.stringify({ schema: 1, scripts }, null, 2) + "\n");
    report.browserCoverage = { path: "browser-coverage.json", sha256: sha256(await fs.readFile(path.join(output, "browser-coverage.json"))) };
    await cdp.send("Profiler.stopPreciseCoverage"); await page.screenshot({ path: path.join(output, "browser.png"), fullPage: true });
    report.screenshot = { path: "browser.png", sha256: sha256(await fs.readFile(path.join(output, "browser.png"))) };
    assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] });
    assert.equal(report.browserResult.status, "passed", report.browserResult.error?.message);
  }
  for (const source of report.sources) assert.equal(sha256(await fs.readFile(path.join(repo, source.path))), source.sha256, "source drift " + source.path);
  report.status = "passed"; console.log("Original ordered native S8 stencil acceptance passed");
} catch (error) {
  report.status = "failed"; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; console.error(error.stack);
} finally {
  report.servedFiles = [...served.values()]; report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser?.close().catch(() => {}); if (server) await new Promise(resolve => server.close(resolve));
}
