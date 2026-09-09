#!/usr/bin/env node

// E5-T08: Chromium + Firefox proof for the host display/serial chrome. The route keeps one real
// guest alive while visibility-only tabs, the reserved keyboard chord, PNG readback, and bounded
// WebM recording are exercised. WebKit, independent machines, and host rr are outside this task.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t08");
const requestedBase = process.env.E5_T08_BASE_URL?.replace(/\/$/u, "") || null;
const requestedPort = Number(process.env.E5_T08_PORT || 0);
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
      const response = await fetch(`${base}/console-capture.html`, { cache: "no-store" });
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
  return createHash("sha256").update(await fs.readFile(path.join(repo, relative))).digest("hex");
}

async function sourceDistParity() {
  const files = [
    "console-capture.html",
    "console-capture.js",
    "src/host/console-capture.js",
    "roadmap.js",
  ];
  for (const relative of files) {
    assert.equal(
      await fs.readFile(path.join(web, relative), "utf8"),
      await fs.readFile(path.join(web, "dist", relative), "utf8"),
      `web/dist/${relative} is stale`,
    );
  }
  return { equal: true, files: files.map((file) => `web/dist/${file}`) };
}

async function bundleIdentity() {
  const files = [
    "web/console-capture.html",
    "web/console-capture.js",
    "web/src/host/console-capture.js",
    "web/loader.js",
    "web/terminal.js",
    "web/src/sink/presentation.js",
    "web/src/sink/canvas2d.js",
    "web/src/input/capture.js",
    "web/src/input/keyboard.js",
    "web/src/input/held-keys.js",
    "web/src/input/reconciliation.js",
    "web/pkg/wasm_vm_wasm_bg.wasm",
  ];
  const hash = createHash("sha256");
  for (const relative of files) hash.update(await fs.readFile(path.join(repo, relative)));
  return { sha256: hash.digest("hex"), files };
}

function proofFromPage(page) {
  return page.evaluate(() => {
    const proof = globalThis.__consoleCaptureProof?.();
    if (proof) return proof;
    const raw = document.documentElement.dataset.consoleCaptureProof;
    return raw ? JSON.parse(raw) : null;
  });
}

function assertProof(proof, browserName) {
  assert.ok(proof, `${browserName}: route did not publish a proof`);
  assert.equal(proof.route, "console-capture");
  assert.equal(proof.backend, "canvas2d");
  assert.deepEqual(proof.canvas, { width: 1280, height: 800 });

  assert.equal(proof.view.bootBefore.view, "display");
  assert.equal(proof.view.bootAfter.view, "serial");
  assert.ok(proof.view.framesDuringHiddenWindow > 0, `${browserName}: no frame while display hidden`);
  assert.ok(proof.view.framesWhileSerialHidden > 0, `${browserName}: hidden-display flush counter did not advance`);
  assert.ok(proof.view.serialBytesDuringHiddenWindow > 0, `${browserName}: serial stream stalled while hidden`);
  assert.equal(proof.view.hiddenFlushMarkerObserved, true, `${browserName}: hidden flush marker missing`);
  assert.equal(proof.view.activeAtEnd, "display");

  assert.equal(proof.reservedHotkey.reservedToggleCount, 1, `${browserName}: reserved chord count`);
  assert.equal(proof.reservedHotkey.priorView, "display");
  assert.equal(proof.reservedHotkey.afterView, "serial");
  assert.deepEqual(proof.reservedHotkey.forwardedCodes, [], `${browserName}: reserved chord reached guest`);
  assert.deepEqual(proof.reservedHotkey.reservedCodesAfter, []);

  assert.ok(proof.screenshot.blobSize > 0, `${browserName}: empty PNG`);
  assert.ok(Number.isSafeInteger(proof.screenshot.generation) && proof.screenshot.generation > 0);
  assert.equal(proof.screenshot.mismatchBytes, 0, `${browserName}: PNG/readback byte mismatch`);
  assert.equal(proof.screenshot.pixelIdentical, true, `${browserName}: screenshot not pixel-identical`);
  assert.equal(proof.screenshot.readbackSha256, proof.screenshot.decodedPngSha256);

  assert.ok(proof.recording, `${browserName}: recording result missing`);
  assert.ok(proof.recording.blobSize > 0, `${browserName}: empty WebM`);
  assert.match(proof.recording.mimeType, /^video\/webm/u);
  assert.ok(proof.recording.durationMs >= 9_000, `${browserName}: recording shorter than the 10 s cap`);
  assert.equal(proof.recording.stopReason, "duration-cap");
  assert.equal(proof.recording.startedInView, "serial");
  assert.ok(proof.recording.framesDuringRecording > 0, `${browserName}: recording saw no display frames`);
  assert.equal(proof.recording.playback.playable, true, `${browserName}: WebM did not decode`);
  assert.equal(proof.recording.playback.width, 1280);
  assert.equal(proof.recording.playback.height, 800);

  assert.equal(proof.serial.scrollMarkerObserved, true, `${browserName}: scroll marker missing`);
  assert.equal(proof.serial.promptObserved, true, `${browserName}: prompt missing`);
  assert.ok(proof.serial.bytes > 0);

  assert.equal(proof.rapidToggles.requested, 50);
  assert.equal(proof.rapidToggles.transitionsAdded, 50, `${browserName}: rapid toggle count`);
  assert.equal(proof.rapidToggles.listenerCountBefore, 2);
  assert.equal(proof.rapidToggles.listenerCountAfter, 2, `${browserName}: view listener leak`);
  assert.equal(proof.rapidToggles.displayHiddenAtEnd, false);
  assert.equal(proof.rapidToggles.serialHiddenAtEnd, true);

  assert.equal(proof.presentation.framesReceived, proof.presentation.successfulPresents);
  assert.equal(proof.presentation.droppedFrames, 0, `${browserName}: dropped presentation frame`);
  assert.equal(proof.presentation.listenerCount, 2);
  assert.deepEqual(proof.presentation.errors, []);
  assert.ok(Number.isSafeInteger(proof.scheduler.retiredInstructions) && proof.scheduler.retiredInstructions > 0);
  assert.equal(proof.paused, false);
}

async function runBrowser(browserType, browserName, base) {
  const launchOptions = { headless: process.env.E5_T08_HEADED !== "1" };
  if (browserName === "Chromium") launchOptions.args = ["--disable-dev-shm-usage", "--use-angle=swiftshader"];
  const browser = await browserType.launch(launchOptions);
  const result = { name: browserName, version: browser.version(), proof: null, screenshot: null, errors: null };
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = { console: [], page: [], requests: [] };
  attachErrorCapture(page, errors);
  try {
    await page.goto(`${base}/console-capture.html?proof=1&nosw=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => ["ready", "error"].includes(document.documentElement.dataset.consoleCapture),
      null,
      { timeout: 600_000 },
    );
    result.proof = await proofFromPage(page);
    assertProof(result.proof, browserName);
    await fs.mkdir(evidenceDir, { recursive: true });
    const screenshot = path.join(evidenceDir, `console-capture-${browserName.toLowerCase()}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    result.screenshot = screenshot;
    result.errors = errors;
    assert.deepEqual(errors, { console: [], page: [], requests: [] }, `${browserName}: browser errors`);
  } finally {
    await context.close();
    await browser.close();
  }
  return result;
}

const result = {
  task: "E5-T08",
  schema: 1,
  command: "node tools/verify/e5-t08-console-capture.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  sourceDistParity: null,
  bundle: null,
  browsers: [],
};

try {
  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;
  result.sourceDistParity = await sourceDistParity();
  result.bundle = await bundleIdentity();
  const { chromium, firefox } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  result.browsers.push(await runBrowser(chromium, "Chromium", result.base));
  result.browsers.push(await runBrowser(firefox, "Firefox", result.base));
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${outputPath}`);
  } else {
    console.log(JSON.stringify(result));
  }
} finally {
  await stopServer();
}
