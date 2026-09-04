#!/usr/bin/env node

// E5-T07c: Chromium-only proof for tty0 output and bounded fbcon damage rectangles.  The route
// cold-boots the checked-in initramfs, sends the exact serial command, and compares the visible
// Canvas2D surface with its independent reference buffer. WebKit, independent machines, and host
// rr are intentionally outside this task's acceptance boundary.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t07c");
const requestedBase = process.env.E5_T07C_BASE_URL?.replace(/\/$/u, "") || null;
const requestedPort = Number(process.env.E5_T07C_PORT || 0);
const outputPath = parseOutputPath(process.argv.slice(2));
let port = requestedPort;
let server = null;

function parseOutputPath(args) {
  const index = args.indexOf("--output");
  if (index >= 0) {
    if (!args[index + 1]) throw new Error("--output requires a path");
    return path.resolve(repo, args[index + 1]);
  }
  const equals = args.find((arg) => arg.startsWith("--output="));
  return equals ? path.resolve(repo, equals.slice("--output=".length)) : null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  if (requestedBase) return;
  if (port === 0) port = await allocatePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/tty0-damage.html`, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`dev server did not start at ${base}`);
}

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await sleep(300);
  child.unref();
}

function attachErrorCapture(page, errors) {
  page.on("console", (message) => {
    if (message.type() !== "error" || message.location().url.includes("/favicon.ico")) return;
    errors.console.push({ text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/favicon.ico")) return;
    errors.requests.push({
      url: request.url(),
      failure: request.failure()?.errorText || "unknown",
    });
  });
}

async function sha256File(relative) {
  const bytes = await fs.readFile(path.join(repo, relative));
  return createHash("sha256").update(bytes).digest("hex");
}

async function sourceDistParity() {
  const files = ["tty0-damage.html", "tty0-damage.js", "roadmap.js"];
  for (const relative of files) {
    const source = await fs.readFile(path.join(web, relative), "utf8");
    const dist = await fs.readFile(path.join(web, "dist", relative), "utf8");
    assert.equal(dist, source, `web/dist/${relative} is stale`);
  }
  return { equal: true, files: files.map((file) => `web/dist/${file}`) };
}

async function bundleIdentity() {
  const files = [
    "web/tty0-damage.html",
    "web/tty0-damage.js",
    "web/loader.js",
    "web/src/sink/presentation.js",
    "web/src/sink/canvas2d.js",
    "web/src/sink/present-backend.js",
    "web/pkg/wasm_vm_wasm_bg.wasm",
  ];
  const hash = createHash("sha256");
  for (const relative of files) hash.update(await fs.readFile(path.join(repo, relative)));
  return { sha256: hash.digest("hex"), files };
}

function proofFromPage(page) {
  return page.evaluate(() => {
    const proof = globalThis.__tty0DamageProof?.();
    if (proof) return proof;
    const raw = document.documentElement.dataset.tty0DamageProof;
    return raw ? JSON.parse(raw) : null;
  });
}

function assertProof(proof) {
  assert.ok(proof, "tty0 route did not publish a proof");
  assert.equal(proof.route, "tty0-damage");
  assert.equal(proof.backend, "canvas2d");
  assert.deepEqual(proof.canvas, { width: 1280, height: 800 });
  assert.deepEqual(proof.markers, { virtioGpu: true, drm: true, fbcon: true }, "Linux display markers");
  assert.equal(proof.targetCommand, "echo hello > /dev/tty0");
  assert.equal(proof.targetCommandObserved, true, "serial command echo missing");
  assert.equal(proof.promptAfterTarget, true, "shell prompt did not return after tty0 command");
  assert.deepEqual(proof.helloRect, { x: 0, y: 0, width: 40, height: 16 });
  assert.ok(proof.helloModel.nonBlackPixels > 0, "independent reference has no hello pixels");
  assert.ok(proof.helloActual.nonBlackPixels > 0, "canvas readback has no hello pixels");
  assert.ok(proof.helloModel.brightPixels > 0, "hello has no visible foreground color");
  assert.equal(proof.helloModel.opaquePixels, 40 * 16, "hello region lost opaque framebuffer alpha");
  assert.deepEqual(proof.helloActual, proof.helloModel, "hello readback differs from reference region");
  assert.equal(proof.referenceMatchesCanvas, true, "final canvas differs from independent reference");
  assert.equal(proof.mismatchBytes, 0, "reference/canvas byte mismatch");
  assert.equal(proof.modelRgbaSha256, proof.canvasRgbaSha256, "reference/canvas digest mismatch");
  assert.match(proof.modelRgbaSha256, /^[0-9a-f]{64}$/u);
  assert.ok(proof.frameCount > 0, "no FrameSink callback arrived");
  assert.ok(proof.fullFrameCount >= 1, "first frame did not establish the full surface");
  assert.ok(proof.partialFrameCount > 0, "no narrowed damage rectangle arrived");
  assert.ok(proof.postTargetFrameCount > 0, "target command produced no display frame");
  assert.ok(proof.postTargetPartialFrameCount > 0, "target/cursor path produced no partial frame");
  assert.ok(proof.largestPartialArea > 0 && proof.largestPartialArea < proof.fullArea, "partial rectangle is not smaller than the full resource");
  assert.equal(proof.outsideRectanglesPreserved, true, "a partial present changed pixels outside its rectangle");
  assert.equal(proof.frameSequenceContiguous, true, "duplicate or skipped callback sequence");
  assert.equal(proof.resourceDimensionsStable, true, "resource dimensions changed during the proof");
  assert.equal(proof.traceDropped, 0, "bounded frame trace overflowed");
  assert.equal(proof.duplicateCallbacks, false, "duplicate callback was observed");
  assert.equal(proof.frameTrace.length, proof.frameCount, "frame trace did not cover every callback");
  assert.ok(proof.frameTrace.every((entry) => entry.format === 2 && entry.reached), "frame metadata or presentation result failed");
  assert.ok(proof.frameTrace.every((entry) => entry.full || entry.area < proof.fullArea), "non-full frame carried a full-size rectangle");
  assert.equal(proof.presentation.framesReceived, proof.frameCount, "presentation callback count mismatch");
  assert.equal(proof.presentation.successfulPresents, proof.frameCount, "a callback did not reach Canvas2D");
  assert.equal(proof.presentation.droppedFrames, 0, "presentation dropped a frame");
  assert.equal(proof.presentation.listenerCount, 2, "presentation listener leak or replacement");
  assert.deepEqual(proof.presentation.errors, [], "presentation backend error");
  assert.equal(proof.input.schedulerBytes, proof.input.expectedBytes, "guest input byte accounting mismatch");
  assert.equal(proof.input.schedulerCalls, 2, "command sequence made duplicate input calls");
  assert.ok(Number.isSafeInteger(proof.queueLiveness.retiredInstructions) && proof.queueLiveness.retiredInstructions > 0, "guest queue did not retire instructions");
  assert.ok(Number.isSafeInteger(proof.queueLiveness.slices) && proof.queueLiveness.slices > 0, "scheduler made no progress slices");
  assert.ok(Number.isSafeInteger(proof.queueLiveness.mainThreadYields) && proof.queueLiveness.mainThreadYields > 0, "guest loop stalled the main thread");
  assert.equal(proof.paused, true, "proof did not finish at a paused deterministic boundary");
  assert.ok(Number.isFinite(proof.commandStartedAt) && Number.isFinite(proof.commandFinishedAt), "command timing missing");
}

const result = {
  task: "E5-T07c",
  schema: 1,
  command: "node tools/verify/e5-t07c-tty0-damage.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  browser: null,
  sourceDistParity: null,
  artifacts: null,
  proof: null,
  errors: { console: [], page: [], requests: [] },
};

let browser = null;
try {
  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;
  result.sourceDistParity = await sourceDistParity();
  const manifest = JSON.parse(await fs.readFile(path.join(web, "artifacts.json"), "utf8"));
  const kernel = manifest.artifacts.kernel;
  const initramfs = manifest.artifacts.initramfs;
  result.artifacts = {
    manifestSha256: await sha256File("web/artifacts.json"),
    kernel: { ...kernel, actualSha256: await sha256File("releases/kernel/6.6.63/Image") },
    initramfs: { ...initramfs, actualSha256: await sha256File("releases/initramfs/initramfs.cpio.gz") },
    webBundle: await bundleIdentity(),
  };
  assert.equal(result.artifacts.kernel.actualSha256, kernel.sha256, "kernel manifest digest is stale");
  assert.equal(result.artifacts.initramfs.actualSha256, initramfs.sha256, "initramfs manifest digest is stale");

  const requestedChrome = process.env.E5_T07C_CHROME_PATH || null;
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  const launchOptions = {
    headless: process.env.E5_T07C_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
  };
  if (requestedChrome) launchOptions.executablePath = requestedChrome;
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: "Chromium",
    version: browser.version(),
    executablePath: requestedChrome || "Playwright Chromium",
  };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = { console: [], page: [], requests: [] };
  attachErrorCapture(page, errors);
  try {
    await page.goto(`${result.base}/tty0-damage.html`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => document.documentElement.dataset.tty0DamageBackend === "canvas2d", null, { timeout: 30_000 });
    await page.waitForFunction(() => ["ready", "error"].includes(document.documentElement.dataset.tty0Damage), null, { timeout: 480_000 });
    result.proof = await proofFromPage(page);
    assertProof(result.proof);
    await fs.mkdir(evidenceDir, { recursive: true });
    const screenshot = path.join(evidenceDir, "tty0-damage.png");
    await page.screenshot({ path: screenshot, fullPage: true });
    result.screenshot = screenshot;
    result.errors = errors;
    assert.deepEqual(errors, { console: [], page: [], requests: [] }, `browser errors: ${JSON.stringify(errors)}`);
  } finally {
    await context.close();
  }
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${outputPath}`);
  } else {
    console.log(JSON.stringify(result));
  }
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
}
