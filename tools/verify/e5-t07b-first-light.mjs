#!/usr/bin/env node

// E5-T07b: Chromium-only first-light proof. The route cold-boots the checked-in T05 kernel and
// initramfs, copies guest FrameSink frames into the visible Canvas2D surface, and leaves the serial
// DRM/fbcon markers beside it. WebKit and independent-machine coverage are intentionally outside
// this task; the reload case uses a fresh navigation in the same Chromium context.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t07b");
const requestedBase = process.env.E5_T07B_BASE_URL?.replace(/\/$/u, "") || null;
const requestedPort = Number(process.env.E5_T07B_PORT || 0);
const outputPath = parseOutputPath(process.argv.slice(2));
const E4_BOOT_BUDGET_MS = 375_386;
const E4_BOOT_BUDGET_PLUS_20_MS = Math.ceil(E4_BOOT_BUDGET_MS * 1.2);
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
      const response = await fetch(`${base}/first-light.html`, { cache: "no-store" });
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

async function bundleIdentity() {
  const files = [
    "web/first-light.html",
    "web/first-light.js",
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

async function assertSourceDistParity() {
  for (const relative of ["first-light.html", "first-light.js", "roadmap.js"]) {
    const source = await fs.readFile(path.join(web, relative), "utf8");
    const dist = await fs.readFile(path.join(web, "dist", relative), "utf8");
    assert.equal(dist, source, `web/dist/${relative} is stale`);
  }
  return { equal: true, files: ["web/dist/first-light.html", "web/dist/first-light.js", "web/dist/roadmap.js"] };
}

function proofFromPage(page) {
  return page.evaluate(() => {
    const proof = globalThis.__firstLightProof?.();
    if (proof) return proof;
    const raw = document.documentElement.dataset.firstLightProof;
    return raw ? JSON.parse(raw) : null;
  });
}

function assertProof(proof, label, { expectFallback = false } = {}) {
  assert.ok(proof, `${label}: route did not publish a proof`);
  assert.equal(proof.selectedBackend, "canvas2d", `${label}: selected backend`);
  assert.ok(proof.frameCount > 0, `${label}: no FrameSink frame arrived`);
  assert.ok(proof.presentation.framesReceived > 0, `${label}: presentation received no frame`);
  assert.equal(proof.presentation.droppedFrames, 0, `${label}: dropped frame`);
  assert.equal(proof.presentation.listenerCount, 2, `${label}: listener count`);
  assert.ok(proof.canvas.width > 0 && proof.canvas.height > 0, `${label}: invalid canvas dimensions`);
  assert.ok(proof.nonBlackPixels >= 128, `${label}: canvas is blank (${proof.nonBlackPixels} non-black pixels)`);
  assert.equal(proof.markers.virtioGpu, true, `${label}: virtio_gpu marker missing`);
  assert.equal(proof.markers.drm, true, `${label}: DRM marker missing`);
  assert.equal(proof.markers.fbcon, true, `${label}: fbcon marker missing`);
  assert.ok(proof.serialMarkerLines.some((line) => line.includes("Initialized virtio_gpu")), `${label}: serial virtio-gpu line missing`);
  assert.ok(proof.serialMarkerLines.some((line) => line.includes("fb0: virtio_gpudrmfb")), `${label}: serial fb0 line missing`);
  assert.ok(proof.colorSample?.sample, `${label}: no framebuffer color sample`);
  assert.equal(proof.firstVisibleFrame?.format, 2, `${label}: expected Linux B8G8R8X8 framebuffer format`);
  assert.equal(proof.colorSample?.format, 2, `${label}: color sample lost its framebuffer format`);
  assert.equal(proof.colorChannelOrderHeld, true, `${label}: BGRA→RGBA readback mismatch`);
  assert.ok(/^[0-9a-f]{64}$/u.test(proof.canvasRgbaSha256), `${label}: canvas digest missing`);
  assert.ok(Number.isSafeInteger(proof.scheduler?.retiredInstructions) && proof.scheduler.retiredInstructions > 0, `${label}: guest did not retire instructions`);
  assert.ok(proof.bootElapsedMs <= E4_BOOT_BUDGET_PLUS_20_MS, `${label}: boot exceeded ${E4_BOOT_BUDGET_PLUS_20_MS}ms budget`);
  if (expectFallback) {
    assert.equal(proof.requestedBackend, "webgl2", `${label}: fallback did not request WebGL2`);
    assert.equal(proof.webgl2Disabled, true, `${label}: WebGL2 was not disabled`);
    assert.equal(proof.presentation.fallbacks, 1, `${label}: expected one WebGL2→Canvas2D fallback`);
  } else {
    assert.equal(proof.requestedBackend, "canvas2d", `${label}: default backend request changed`);
    assert.equal(proof.webgl2Disabled, false, `${label}: default unexpectedly disabled WebGL2`);
    assert.equal(proof.presentation.fallbacks, 0, `${label}: default Canvas2D unexpectedly fell back`);
  }
}

async function runBoot(browser, base, search, screenshotPath, label, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = { console: [], page: [], requests: [] };
  attachErrorCapture(page, errors);
  try {
    await page.goto(`${base}/first-light.html${search}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => document.documentElement.dataset.firstLightRequestedBackend, null, { timeout: 30_000 });
    if (options.reloadDuringBoot) {
      await page.waitForTimeout(250);
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
    }
    await page.waitForFunction(() => document.documentElement.dataset.firstLight === "ready", null, {
      timeout: E4_BOOT_BUDGET_PLUS_20_MS + 30_000,
    });
    const proof = await proofFromPage(page);
    assertProof(proof, label, { expectFallback: options.expectFallback });
    if (screenshotPath) {
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    assert.deepEqual(errors, { console: [], page: [], requests: [] },
      `${label}: browser errors occurred: ${JSON.stringify(errors)}`);
    return { label, proof, errors, screenshot: screenshotPath, url: page.url() };
  } finally {
    await context.close();
  }
}

const result = {
  task: "E5-T07b",
  schema: 1,
  command: "node tools/verify/e5-t07b-first-light.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  browser: null,
  sourceDistParity: null,
  artifacts: null,
  defaultCanvas2d: null,
  webgl2DisabledFallback: null,
  reload: null,
  errors: { console: [], page: [], requests: [] },
};

let browser = null;
try {
  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;
  result.sourceDistParity = await assertSourceDistParity();
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

  const requestedChrome = process.env.E5_T07B_CHROME_PATH || null;
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  const launchOptions = {
    headless: process.env.E5_T07B_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
  };
  if (requestedChrome) launchOptions.executablePath = requestedChrome;
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: "Chromium",
    version: browser.version(),
    executablePath: requestedChrome || "Playwright Chromium",
  };
  result.defaultCanvas2d = await runBoot(
    browser,
    result.base,
    "",
    path.join(evidenceDir, "first-light.png"),
    "normal Canvas2D default",
  );
  result.webgl2DisabledFallback = await runBoot(
    browser,
    result.base,
    "?backend=webgl2&disableWebGL2=1",
    path.join(evidenceDir, "first-light-webgl2-disabled.png"),
    "WebGL2-disabled fallback",
    { expectFallback: true },
  );
  result.reload = await runBoot(
    browser,
    result.base,
    "?reloadProbe=1",
    path.join(evidenceDir, "first-light-reload.png"),
    "reload during boot",
    { reloadDuringBoot: true },
  );
  result.errors = {
    console: [
      ...result.defaultCanvas2d.errors.console,
      ...result.webgl2DisabledFallback.errors.console,
      ...result.reload.errors.console,
    ],
    page: [
      ...result.defaultCanvas2d.errors.page,
      ...result.webgl2DisabledFallback.errors.page,
      ...result.reload.errors.page,
    ],
    requests: [
      ...result.defaultCanvas2d.errors.requests,
      ...result.webgl2DisabledFallback.errors.requests,
      ...result.reload.errors.requests,
    ],
  };
  assert.deepEqual(result.errors, { console: [], page: [], requests: [] });
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
