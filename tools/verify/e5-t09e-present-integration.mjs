#!/usr/bin/env node

// E5-T09e: Chromium integration proof for tiled/full-frame A/B correctness, latest-wins frame
// pacing, visibility resume, and a forced-hidden Linux boot. Independent machines, WebKit, and
// host rr are outside the task boundary by repository policy and user scope.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t09e");
const requestedBase = process.env.E5_T09E_BASE_URL?.replace(/\/$/u, "") || null;
const requestedPort = Number(process.env.E5_T09E_PORT || 0);
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
      const response = await fetch(`${base}/present-integration.html`, { cache: "no-store" });
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(relative) {
  return sha256(await fs.readFile(path.join(repo, relative)));
}

async function sourceDistParity() {
  const files = ["present-integration.html", "present-integration.js"];
  for (const relative of files) {
    const source = await fs.readFile(path.join(web, relative), "utf8");
    const dist = await fs.readFile(path.join(web, "dist", relative), "utf8");
    assert.equal(dist, source, `web/dist/${relative} is stale`);
  }
  return { equal: true, files: files.map((file) => `web/dist/${file}`) };
}

async function bundleIdentity() {
  const files = [
    "web/present-integration.html",
    "web/present-integration.js",
    "web/loader.js",
    "web/src/sink/presentation.js",
    "web/src/sink/canvas2d.js",
    "web/src/sink/frame-scheduler.js",
    "web/src/sink/visibility-scheduler.js",
    "web/pkg/wasm_vm_wasm_bg.wasm",
  ];
  const hash = createHash("sha256");
  for (const relative of files) hash.update(await fs.readFile(path.join(repo, relative)));
  return { sha256: hash.digest("hex"), files };
}

function assertLoad(load, label) {
  assert.equal(load.label, label);
  assert.equal(load.requestedPlans, 240, `${label}: synthetic plan count`);
  assert.equal(load.plansPerSecond, 240, `${label}: requested rate`);
  assert.equal(load.presentsWithinRefreshPlusOne, true, `${label}: refresh budget`);
  assert.equal(load.scheduler.maxPending, 1, `${label}: max pending`);
  assert.equal(load.scheduler.pending, 0, `${label}: pending after drain`);
  assert.equal(load.pendingQueueBounded, true, `${label}: queue bound`);
  assert.equal(load.latestWins, true, `${label}: latest-wins accounting`);
  assert.equal(load.noLongTaskOver50Ms, true, `${label}: long task budget`);
  assert.equal(load.longTaskObserverSupported, true, `${label}: long-task observer unavailable`);
  assert.ok(load.maxLongTaskMs <= 50, `${label}: long task ${load.maxLongTaskMs}ms`);
  assert.equal(load.gpu.framesReceived, 240, `${label}: gpu frame receipt count`);
  assert.equal(load.gpu.pending, 0, `${label}: gpu pending count`);
  assert.equal(load.gpu.maxPending, 1, `${label}: gpu max pending count`);
  assert.equal(load.gpu.droppedFrames, 0, `${label}: gpu dropped frame count`);
}

function assertIntegration(proof) {
  assert.ok(proof, "integration route did not publish a proof");
  assert.equal(proof.schema, "wasm-vm.e5-t09e.present-integration.v1");
  assert.equal(proof.route, "present-integration");

  assert.equal(proof.cursor.belowOnePercent, true, "cursor bytes exceeded one percent of a full frame");
  assert.ok(proof.cursor.tiledUploadedBytes < proof.cursor.fullFrameBytes * 0.01, "cursor upload budget");
  assert.equal(proof.cursor.finalReadback.equal, true, "cursor A/B readback mismatch");
  assert.equal(proof.cursor.disabledCrc32, proof.cursor.tiledCrc32, "cursor A/B CRC mismatch");

  assert.equal(proof.scroll.finalPixelsMatch, true, "full-scroll final pixels differ");
  assert.equal(proof.scroll.tiledCoversFullFrame, true, "full-scroll tile plan dropped coverage");
  assert.equal(proof.scroll.finalCrc32.disabled, proof.scroll.finalCrc32.tiled, "full-scroll CRC mismatch");
  assert.equal(proof.scroll.mismatchBytes, 0, "full-scroll readback mismatch");

  assert.equal(proof.fuzz.seed, "0x5eedf00d");
  assert.equal(proof.fuzz.sequences, 10_000, "A/B fuzz sequence count");
  assert.equal(proof.fuzz.finalPixelsMatch, true, "seeded A/B fuzz mismatch");
  assert.equal(proof.fuzz.mismatchBytes, 0, "seeded A/B fuzz byte mismatch");
  assert.equal(proof.fuzz.referenceCrc32, proof.fuzz.tiledCrc32, "seeded A/B fuzz CRC mismatch");

  assert.deepEqual(proof.boundaries.boundaryCases[0].expected, [{ x: 64, y: 64, width: 64, height: 64 }]);
  assert.equal(proof.boundaries.resize.to.width, 65, "resize width");
  assert.equal(proof.boundaries.resize.to.height, 65, "resize height");
  assert.deepEqual(proof.boundaries.resize.snapshot.errors, [], "resize errors");

  assert.equal(proof.visibilityResume.cursorDeliveredAfterResume, true, "cursor was lost after resume");
  assert.equal(proof.visibilityResume.staleTimerIgnored, true, "stale hidden timer was not ignored");
  assert.equal(proof.visibilityResume.snapshot.maxPending, 1, "resume queue bound");
  assertLoad(proof.load, "visible-240-plans");
}

function assertHiddenBoot(proof) {
  assert.ok(proof, "hidden boot route did not publish a proof");
  assert.equal(proof.schema, "wasm-vm.e5-t09e.hidden-boot.v1");
  assert.equal(proof.forcedHidden, true);
  assert.equal(proof.timerMs, 250, "hidden fallback timer bound");
  assert.equal(proof.serialMarker, "E5T09E_SERIAL_OK");
  assert.equal(proof.serialOutputLive, true, "serial output stopped in hidden mode");
  assert.ok(proof.serialBytesAfterCommand > 0, "hidden boot produced no serial bytes after input");
  assert.equal(proof.presentation.scheduler.mode, "timer", "forced-hidden boot did not use timer mode");
  assert.equal(proof.presentation.scheduler.pending <= 1, true, "hidden boot pending queue grew");
  assert.ok(proof.presentation.scheduler.presented > 0, "hidden boot never drained a frame");
  assert.equal(proof.presentation.errors.length, 0, "hidden boot presentation error");
  assert.equal(proof.gpu.width, 1280);
  assert.equal(proof.gpu.height, 800);
  for (const [name, value] of Object.entries(proof.gpu)) {
    assert.equal(typeof value, "number", `hidden gpu metric ${name} is not scalar`);
    assert.equal(Number.isFinite(value), true, `hidden gpu metric ${name} is not finite`);
  }
  assert.ok(proof.guest.retiredInstructions > 0, "hidden boot guest did not retire instructions");
  assert.ok(proof.guest.outputBytes > 0, "hidden boot guest emitted no output");
}

const result = {
  schema: "wasm-vm.e5-t09e.present-integration-evidence.v1",
  task: "E5-T09e",
  command: "node tools/verify/e5-t09e-present-integration.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  browser: null,
  sourceDistParity: null,
  artifacts: null,
  integration: null,
  throttled: null,
  hiddenBoot: null,
  errors: { integration: { console: [], page: [], requests: [] }, throttled: { console: [], page: [], requests: [] }, hiddenBoot: { console: [], page: [], requests: [] } },
  scope: { independentMachines: false, webkit: false, hostRr: false },
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

  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  browser = await chromium.launch({
    headless: process.env.E5_T09E_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
    ...(process.env.E5_T09E_CHROME_PATH ? { executablePath: process.env.E5_T09E_CHROME_PATH } : {}),
  });
  result.browser = { name: "Chromium", version: browser.version(), executablePath: process.env.E5_T09E_CHROME_PATH || "Playwright Chromium" };

  const integrationContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const integrationPage = await integrationContext.newPage();
  attachErrorCapture(integrationPage, result.errors.integration);
  try {
    await integrationPage.goto(`${result.base}/present-integration.html?mode=integration`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await integrationPage.waitForFunction(() => document.documentElement.dataset.e5T09eReady === "ready", null, { timeout: 30_000 });
    result.integration = await integrationPage.evaluate(() => window.runE5T09eIntegration());
    assertIntegration(result.integration);
    await fs.mkdir(evidenceDir, { recursive: true });
    await integrationPage.screenshot({ path: path.join(evidenceDir, "present-integration.png"), fullPage: true });
  } finally {
    await integrationContext.close();
  }

  const throttledContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const throttledPage = await throttledContext.newPage();
  attachErrorCapture(throttledPage, result.errors.throttled);
  try {
    const cdp = await throttledContext.newCDPSession(throttledPage);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await throttledPage.goto(`${result.base}/present-integration.html?mode=integration`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await throttledPage.waitForFunction(() => document.documentElement.dataset.e5T09eReady === "ready", null, { timeout: 30_000 });
    result.throttled = await throttledPage.evaluate(() => window.runE5T09eLoad({ label: "cpu-4x-240-plans", durationMs: 1_000, plansPerSecond: 240 }));
    assertLoad(result.throttled, "cpu-4x-240-plans");
  } finally {
    await throttledContext.close();
  }

  const hiddenContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const hiddenPage = await hiddenContext.newPage();
  attachErrorCapture(hiddenPage, result.errors.hiddenBoot);
  try {
    await hiddenPage.goto(`${result.base}/present-integration.html?mode=hidden-boot`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await hiddenPage.waitForFunction(() => ["ready", "error"].includes(document.documentElement.dataset.e5T09eHiddenBoot), null, { timeout: 900_000 });
    result.hiddenBoot = await hiddenPage.evaluate(() => globalThis.__e5T09eHiddenProof?.() || null);
    assertHiddenBoot(result.hiddenBoot);
    await fs.mkdir(evidenceDir, { recursive: true });
    await hiddenPage.screenshot({ path: path.join(evidenceDir, "hidden-boot.png"), fullPage: true });
  } finally {
    await hiddenContext.close();
  }

  assert.deepEqual(result.errors, {
    integration: { console: [], page: [], requests: [] },
    throttled: { console: [], page: [], requests: [] },
    hiddenBoot: { console: [], page: [], requests: [] },
  }, `browser errors: ${JSON.stringify(result.errors)}`);

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
