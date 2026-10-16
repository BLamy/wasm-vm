#!/usr/bin/env node
// E6-T10a: actual hardware-browser proof of the isolated TGSI translation boundary.
// This does not boot a guest or claim emulator/compositor GPU acceleration.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = process.argv[i];
  assert.ok(["--output", "--chrome"].includes(name), `unknown argument ${name}`);
  assert.ok(process.argv[i + 1], `${name} requires a value`);
  options[name.slice(2)] = process.argv[i + 1];
}
assert.ok(options.output, "usage: node tools/verify-virgl-shader.mjs --output <directory> [--chrome <executable>]");
const output = path.resolve(options.output);
const chrome = options.chrome || process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const rendererRoot = path.join(repo, "renderer/virgl-shader");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const relative = (filename) => path.relative(repo, filename).split(path.sep).join("/");
await fs.mkdir(output, { recursive: true });

const report = {
  schema: 1, task: "E6-T10a", boundary: "literal TGSI -> pinned upstream converter -> GLSL ES300 -> hardware WebGL2",
  guestExecution: false, status: "running", command: [process.execPath, ...process.argv.slice(1)],
  startedAt: new Date().toISOString(),
  host: { platform: process.platform, architecture: process.arch, release: os.release(), node: process.version },
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  trackedChanges: execFileSync("git", ["status", "--porcelain", "--", "renderer/virgl-shader", "tools/verify-virgl-shader.mjs"],
    { cwd: repo, encoding: "utf8" }).trim().split("\n").filter(Boolean),
  sources: [], servedFiles: [], browserErrors: { console: [], page: [], requests: [] },
};
const servedFiles = new Map();
let browser;
let page;
let server;

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

const html = `<!doctype html><meta charset="utf-8"><title>E6-T10a shader boundary proof</title>
<style>body{font:16px system-ui;background:#111720;color:#e7edf6;margin:28px}h1{font-size:26px;margin-bottom:8px}
p{color:#b3c3d6}#draws{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;max-width:1020px}
figure{margin:0;background:#1b2533;border:1px solid #435167;padding:14px;border-radius:8px}
img{width:100%;height:150px;object-fit:contain;image-rendering:pixelated;background:#243244}
figcaption{font-size:13px;margin-top:10px}#gpu{position:absolute;width:1px;height:1px;left:-100px}</style>
<h1>VirGL shader translation boundary</h1><p>No VM guest is running. Every tile is a real WebGL2 draw of translated literal TGSI.</p>
<p id="status">Running hardware acceptance…</p><p id="renderer"></p><canvas id="gpu"></canvas><main id="draws"></main>`;

async function serve(request, response) {
  try {
    const pathname = new URL(request.url, "http://localhost").pathname;
    if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (pathname === "/") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }).end(html); return; }
    const filename = path.resolve(repo, `.${decodeURIComponent(pathname)}`);
    assert.ok(filename.startsWith(`${rendererRoot}${path.sep}`), "request outside shader module");
    const canonical = await fs.realpath(filename);
    assert.ok(canonical.startsWith(`${rendererRoot}${path.sep}`), "symlink outside shader module");
    let bytes = await fs.readFile(filename);
    if (filename.endsWith("/tests/corpus.mjs")) { const original = "    name: \"mad-source-over-blue\", vertex: \"passthrough\", fragment: \"alpha\",\n    varying: [1, 0, 0, 1], uniforms: { fragment: [[0.5, 0, 0, 0]] },\n    clear: [0, 0, 1, 1], blend: true, expected: solid([128, 0, 128, 255]),"; assert.ok(bytes.toString().includes(original)); bytes = Buffer.from(bytes.toString().replace(original, "    name: \"verifier-cyan-alpha-over-red\", vertex: \"passthrough\", fragment: \"alpha\",\n    varying: [0, 0, 0, 1], uniforms: { fragment: [[0, 0.5, 1, 0]] },\n    clear: [1, 0, 0, 1], blend: true, expected: solid([128, 64, 128, 255]),")); }
    servedFiles.set(relative(filename), { path: relative(filename), size: bytes.length, sha256: hash(bytes) });
    const type = filename.endsWith(".wasm") ? "application/wasm" : /\.(?:mjs|js)$/.test(filename)
      ? "text/javascript" : filename.endsWith(".json") ? "application/json" : "text/plain";
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" }).end(bytes);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain" }).end(String(error));
  }
}

try {
  const harnessBytes = await fs.readFile(fileURLToPath(import.meta.url));
  report.sources = [...await sourceHashes(rendererRoot), { path: relative(fileURLToPath(import.meta.url)),
    size: harnessBytes.length, sha256: hash(harnessBytes) }];
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
  report.acceptance = await withDeadline(90_000, page.evaluate(async () => {
    const { runAcceptance } = await import("/renderer/virgl-shader/tests/browser.mjs");
    return await runAcceptance();
  }));
  assert.equal(report.acceptance.status, "passed");
  assert.equal(report.acceptance.guestExecution, false);
  assert.equal(report.acceptance.draws.length, 9);
  assert.ok(report.acceptance.checkedPixels > 3000, "bounded literal pixel corpus must actually execute");
  assert.deepEqual(report.browserErrors, { console: [], page: [], requests: [] }, "browser emitted errors");
  report.servedFiles = [...servedFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
  assert.ok(report.servedFiles.some((file) => file.path.endsWith(".wasm") && file.size > 1000),
    "browser must consume the built WebAssembly converter module");
  for (const file of report.servedFiles) {
    if (file.path.endsWith("/tests/corpus.mjs")) continue; // Deliberate recorded verifier variant, source original separately hashed.
    assert.equal(hash(await fs.readFile(path.join(repo, file.path))), file.sha256,
      `served input changed during proof: ${file.path}`);
  }
  for (const file of report.sources) {
    assert.equal(hash(await fs.readFile(path.join(repo, file.path))), file.sha256,
      `recorded source changed during proof: ${file.path}`);
  }
  await page.screenshot({ path: path.join(output, "browser.png"), fullPage: true });
  report.screenshot = { path: "browser.png", sha256: hash(await fs.readFile(path.join(output, "browser.png"))) };
  report.status = "passed";
  console.log(`E6-T10a: ${report.acceptance.draws.length} hardware WebGL2 draws, ${report.acceptance.checkedPixels} exact pixels; ${report.acceptance.errors.length} rejection cases and ${report.acceptance.recovery.successes} recoveries passed.`);
} catch (error) {
  report.status = "failed";
  report.failure = { message: error.message, stack: error.stack };
  if (page) {
    report.acceptance = await withDeadline(3_000, page.evaluate(() => window.__virglShaderReport ?? null)).catch(() => report.acceptance);
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true, timeout: 3_000 }).catch(() => {});
  }
  console.error(error.stack ?? error);
  process.exitCode = 1;
} finally {
  report.servedFiles = [...servedFiles.values()].sort((a, b) => a.path.localeCompare(b.path));
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
}
