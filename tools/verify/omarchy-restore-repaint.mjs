#!/usr/bin/env node
// Real release-pair proof: the restored GPU must paint before any runChunk/guest execution.
// This isolated sink check is separate from the complete demo-page/input/resize proof.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const positional = [];
const options = {};
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith("--")) { positional.push(arg); continue; }
  const key = arg.slice(2).replaceAll("-", "");
  if (key === "checkonly") { options[key] = true; continue; }
  if (!["pairdirectory", "chunkmanifest", "chunkdir"].includes(key)) throw Error(`unknown repaint option: ${arg}`);
  const value = process.argv[++i];
  if (!value || value.startsWith("--")) throw Error(`missing value for ${arg}`);
  options[key] = value;
}
const out = path.resolve(positional[0] || "evidence/omarchy-profile/immediate-repaint");
const pairDirectory = path.resolve(options.pairdirectory || positional[1] || "releases/boot-snapshot");
const statFile = async (filename, label) => {
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isFile()) throw Error(`${label} is not a regular file: ${filename}`);
  return filename;
};
const statDir = async (filename, label) => {
  const info = await fs.stat(filename).catch(() => null);
  if (!info?.isDirectory()) throw Error(`${label} is not a directory: ${filename}`);
  return filename;
};
await statDir(pairDirectory, "candidate pair directory");
let chunkManifest = path.resolve(options.chunkmanifest || (options.chunkdir ? path.join(options.chunkdir, "manifest.json") : "target/omarchy-profile-chunks-r2-256k/manifest.json"));
const chunkManifestInfo = await fs.stat(chunkManifest).catch(() => null);
if (chunkManifestInfo?.isDirectory()) chunkManifest = path.join(chunkManifest, "manifest.json");
await statFile(chunkManifest, "candidate chunk manifest");
const chunkDir = path.resolve(options.chunkdir || path.dirname(chunkManifest));
await statDir(chunkDir, "candidate chunk directory");
const nestedChunkDir = path.join(chunkDir, "chunks");
const chunkFilesDir = (await fs.stat(nestedChunkDir).catch(() => null))?.isDirectory() ? nestedChunkDir : chunkDir;
const chunkManifestBytes = await fs.readFile(chunkManifest);
let chunkManifestObject;
try { chunkManifestObject = JSON.parse(chunkManifestBytes); } catch (error) { throw Error(`invalid candidate chunk manifest: ${error}`); }
if (!Array.isArray(chunkManifestObject.chunks) || !chunkManifestObject.chunks.length ||
    !chunkManifestObject.chunks.every((name) => typeof name === "string" && /^[0-9a-f]{64}$/u.test(name))) {
  throw Error("candidate chunk manifest has no valid content-hash chunks");
}
const chunkNames = new Set(await fs.readdir(chunkFilesDir));
const missingChunk = chunkManifestObject.chunks.find((name) => !chunkNames.has(`${name}.bin`));
if (missingChunk) throw Error(`candidate chunk is missing: ${path.join(chunkFilesDir, `${missingChunk}.bin`)}`);
const files = new Map([
  ["/candidate/kernel", path.join(repo, "releases/kernel/6.6.63/Image")],
  ["/candidate/manifest", chunkManifest],
  ["/candidate/snapshot", path.join(pairDirectory, "omarchy-ready.snap.gz")],
  ["/candidate/delta", path.join(pairDirectory, "omarchy-overlay-delta.bin.gz")],
]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inputs = {};
for (const [url, filename] of files) {
  const bytes = await fs.readFile(filename);
  inputs[url] = { filename, size: bytes.length, sha256: hash(bytes) };
}
inputs.wasm = { sha256: hash(await fs.readFile(path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm"))) };
if (options.checkonly) {
  console.log(JSON.stringify({ result: "candidate-source-check-pass", label: "LOCAL-ONLY candidate immediate repaint diagnostic (real bytes; not a release claim)", inputs }));
  process.exit(0);
}
await fs.mkdir(out, { recursive: false });
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  const headers = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
  if (url.pathname === "/") {
    response.writeHead(200, { ...headers, "Content-Type": "text/html" });
    response.end('<!doctype html><title>Actual Omarchy snapshot repaint proof</title><style>body{margin:0;background:black}canvas{display:block}</style><canvas id="scanout"></canvas>');
    return;
  }
  let filename = files.get(url.pathname);
  if (!filename && /^\/(?:pkg|src\/sink)\//u.test(url.pathname)) {
    const candidate = path.resolve(repo, "web/dist", `.${url.pathname}`);
    if (candidate.startsWith(path.join(repo, "web/dist") + path.sep)) filename = candidate;
  }
  if (!filename) { response.writeHead(404, headers).end(); return; }
  try {
    const bytes = await fs.readFile(filename);
    response.writeHead(200, { ...headers, "Content-Type": filename.endsWith(".js") ? "text/javascript"
      : filename.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" });
    response.end(bytes);
  } catch { response.writeHead(404, headers).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const report = {
  label: "LOCAL-ONLY candidate immediate repaint diagnostic (real bytes; not a release claim)",
  source: { pairDirectory, chunkManifest, chunkDir: chunkFilesDir },
  inputs: { ...inputs, chunkManifest: { filename: chunkManifest, size: chunkManifestBytes.length, sha256: hash(chunkManifestBytes) } },
  startedAt: new Date().toISOString(), errors: [],
};
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: "block" });
  page.on("pageerror", (error) => report.errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  report.repaint = await page.evaluate(async () => {
    const { default: init, WasmLinux } = await import("/pkg/wasm_vm_wasm.js");
    const { Canvas2DBackend } = await import("/src/sink/canvas2d.js");
    await init();
    const bytes = async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    };
    const unzip = async (data) => new Uint8Array(await new Response(new Blob([data]).stream()
      .pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
    const [kernel, manifestBytes, deltaGz, snapshotGz] = await Promise.all([
      bytes("/candidate/kernel"), bytes("/candidate/manifest"), bytes("/candidate/delta"), bytes("/candidate/snapshot"),
    ]);
    const [delta, snapshot] = await Promise.all([unzip(deltaGz), unzip(snapshotGz)]);
    const machine = WasmLinux.newChunkedDiskSeeded(1024, kernel, new TextDecoder().decode(manifestBytes),
      "/no-guest-execution-or-chunk-fetches/", 256, new Uint32Array(),
      "root=/dev/vda rw console=ttyS0 earlycon=sbi plymouth.enable=0", () => {}, false, delta);
    const canvas = document.getElementById("scanout");
    const sink = new Canvas2DBackend(canvas);
    const frames = [];
    const attached = machine.attachDisplay((frame) => {
      if (frame.type === "cursor-update" || frame.type === "cursor-move") return;
      sink.resize(frame.resourceWidth, frame.resourceHeight);
      sink.present(frame.rect, frame.pixels);
      frames.push({ rect: frame.rect, width: frame.resourceWidth, height: frame.resourceHeight });
    });
    const beforeLoad = frames.length;
    const decision = machine.restoreDecisionCode(snapshot, machine.overlayGeneration());
    if (decision !== "resume") throw new Error(`candidate restore refused: ${decision}`);
    const started = performance.now();
    machine.loadSnapshotBlob(snapshot);
    const restoreMs = performance.now() - started;
    // Deliberately no runChunk or scheduler creation anywhere in this harness.
    const afterLoad = frames.length;
    const pixels = sink.context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colors = new Set();
    let visible = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 12) visible++;
      colors.add((pixels[i] << 16) | (pixels[i + 1] << 8) | pixels[i + 2]);
    }
    machine.free();
    return { attached, beforeLoad, afterLoad, decision, frames, restoreMs, guestRunCalls: 0,
      visibleFraction: visible / (pixels.length / 4), colors: colors.size };
  });
  assert.equal(report.repaint.attached, true);
  assert.equal(report.repaint.beforeLoad, 0);
  assert.equal(report.repaint.afterLoad, 1, "restore must synchronously paint one full repair frame");
  assert.ok(report.repaint.visibleFraction > 0.25 && report.repaint.colors >= 8, "candidate framebuffer is blank or uniform");
  const frame = report.repaint.frames[0];
  assert.deepEqual(frame.rect, { x: 0, y: 0, width: frame.width, height: frame.height });
  await page.setViewportSize({ width: frame.width, height: frame.height });
  const png = await page.locator("#scanout").screenshot({ path: path.join(out, "restored-before-execution.png") });
  report.screenshotSha256 = hash(png);
  assert.deepEqual(report.errors, []);
  report.result = "actual-desktop-repaint-before-execution";
  console.log(`OMARCHY_IMMEDIATE_REPAINT_PASS ${JSON.stringify(report.repaint)}`);
} catch (error) {
  report.result = "failed"; report.error = String(error); process.exitCode = 1;
  console.error(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
  await browser.close(); server.close();
}
