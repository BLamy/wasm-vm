#!/usr/bin/env node
// E5-T14c: complete local Chromium proof for pointer coordinates, capture, wheel, and recovery.
// The direct Playwright API is used because the repository's legacy collector deadlocks under the
// Node 24 environment used by the browser proofs.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence", "e5-t14c");
const evidencePath = path.join(evidenceDir, "pointer-wheel-browser-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "pointer-wheel-browser-2026-09-03.png");
const transcriptPath = path.join(repo, "evidence", "e5-t14c", "guest-evtest-2026-09-03.txt");
const requestedBase = process.env.E5_T14C_BASE_URL?.replace(/\/$/, "") || null;
let port = Number(process.env.E5_T14C_PORT || 0);
const bootTimeout = Number(process.env.E5_T14C_BOOT_TIMEOUT_MS || 180_000);
let server = null;
let context = null;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      const response = await fetch(`${base}/artifacts.json`, { cache: "no-store" });
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

async function staticAudit(transcript) {
  const read = async (relativePath) => fs.readFile(path.join(repo, relativePath));
  const parity = [];
  for (const relativePath of [
    "web/main.js",
    "web/ide.js",
    "web/loader.js",
    "web/linux-worker-protocol.js",
    "web/roadmap.js",
    "web/src/input/pointer.js",
    "web/src/input/pointer.ts",
  ]) {
    const distPath = relativePath.replace(/^web\//, "web/dist/");
    const [source, dist] = await Promise.all([read(relativePath), read(distPath)]);
    assert.deepEqual(dist, source, `${relativePath} and ${distPath} differ`);
    parity.push({ source: relativePath, dist: distPath, equal: true, sha256: sha256(source) });
  }
  assert.match(transcript, /EV_REL REL_HWHEEL 1/);
  assert.match(transcript, /EV_REL REL_WHEEL -1/);
  assert.match(transcript, /EV_KEY BTN_SIDE 0/);
  return { parity, guestTranscript: true, guestTranscriptSha256: sha256(transcript) };
}

const transcript = await fs.readFile(transcriptPath, "utf8");
const staticEvidence = await staticAudit(transcript);
const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
const chromePath = process.env.E5_T14C_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E5_T14C_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {}

let base = null;
let url = null;
const result = {
  task: "E5-T14c",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: "node tools/verify/e5-t14c-pointer-wheel-browser-proof.mjs",
  base: null,
  url: null,
  browser: {},
  staticAudit: staticEvidence,
  stages: {},
  errors: { console: [], page: [], requests: [] },
};

try {
  await startServer();
  base = requestedBase || `http://127.0.0.1:${port}`;
  url = `${base}/?guest=busybox&nosw=1&testHooks=1&noAutoBoot=1&jit=0#ide`;
  result.base = base;
  result.url = url;
  context = await chromium.launchPersistentContext(
    await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5t14c-")),
    { ...launchOptions, viewport: { width: 1600, height: 1000 } },
  );
  const page = context.pages()[0] || await context.newPage();
  result.browser = {
    name: context.browser()?.browserType().name() || "chromium",
    version: context.browser()?.version() || "unknown",
  };
  const favicon = new URL("/favicon.ico", `${base}/`).href;
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.includes("/favicon.ico")) {
      result.errors.console.push({ text: message.text(), location: message.location() });
    }
  });
  page.on("pageerror", (error) => result.errors.page.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url() !== favicon) {
      result.errors.requests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
    }
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.wvmDemo && window.__pointer && window.__keyboardCapture, null, { timeout: 120_000 });
  assert.equal(await page.locator("#ide-pointer-state").textContent(), "Pointer: absolute");
  assert.equal(await page.locator("#ide-pointer-toggle").isDisabled(), true);
  result.stages.initial = await page.evaluate(() => ({
    pointer: window.__pointer.state(),
    toggle: document.getElementById("ide-pointer-toggle")?.textContent || "",
  }));

  const bootStarted = Date.now();
  const boot = await page.evaluate(() => window.wvmDemo.runBusybox());
  assert.equal(boot?.ok, true, `busybox boot failed: ${JSON.stringify(boot)}`);
  await page.waitForFunction(() => window.__linuxBootStateForTest?.().guestReady === true,
    null, { timeout: bootTimeout, polling: 200 });
  await page.waitForFunction(() => document.querySelector("#term .xterm-rows")?.textContent?.includes("busybox userland up"),
    null, { timeout: bootTimeout, polling: 200 });
  assert.equal(await page.locator("#ide-pointer-toggle").isDisabled(), false);
  result.stages.boot = { ok: true, elapsedMs: Date.now() - bootStarted };

  const matrix = await page.evaluate(() => {
    const host = document.getElementById("term");
    const originalZoom = host.style.zoom;
    const originalDpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    const records = [];
    const dispatchMove = (clientX, clientY) => host.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      pointerId: 31,
      pointerType: "mouse",
    }));
    try {
      for (const dpr of [1, 1.5, 2]) {
        try { Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: dpr }); } catch {}
        for (const zoom of [0.8, 1.25]) {
          host.style.zoom = String(zoom);
          const rect = host.getBoundingClientRect();
          const start = window.__pointer.frames().length;
          const points = [
            [rect.left, rect.top],
            [rect.right, rect.top],
            [rect.left, rect.bottom],
            [rect.right, rect.bottom],
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
          ];
          for (const [x, y] of points) dispatchMove(x, y);
          records.push({
            dpr,
            zoom,
            rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            coordinates: window.__pointer.frames().slice(start).map((frame) => frame.coordinates),
          });
        }
      }
    } finally {
      host.style.zoom = originalZoom;
      if (originalDpr) Object.defineProperty(window, "devicePixelRatio", originalDpr);
      else delete window.devicePixelRatio;
    }
    return records;
  });
  for (const record of matrix) {
    assert.deepEqual(record.coordinates, [
      { x: 0, y: 0 },
      { x: 32767, y: 0 },
      { x: 0, y: 32767 },
      { x: 32767, y: 32767 },
      { x: 16384, y: 16384 },
    ]);
  }
  result.stages.coordinateMatrix = matrix;

  await page.locator("#term").scrollIntoViewIfNeeded();
  const box = await page.locator("#term").boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, "terminal pointer surface has no browser box");
  const dragStart = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(dragStart.x, dragStart.y);
  const dragFrameStart = await page.evaluate(() => window.__pointer.frames().length);
  await page.mouse.down();
  await page.mouse.move(Math.max(2, box.x - 60), Math.max(2, box.y - 60));
  await page.mouse.up();
  await sleep(100);
  const drag = await page.evaluate((start) => {
    const frames = window.__pointer.frames().slice(start);
    return {
      frames,
      held: window.__pointer.heldButtons(),
      buttonValues: frames
        .filter((frame) => frame.events.some((event) => event.eventType === 1))
        .map((frame) => frame.events[0].value),
    };
  }, dragFrameStart);
  assert.equal(drag.held.length, 0);
  assert.deepEqual(drag.buttonValues, [1, 0]);
  assert.equal(drag.frames.some((frame) => frame.source === "pointermove"), true);
  result.stages.dragOutside = drag;

  await page.mouse.move(dragStart.x, dragStart.y);
  const actualWheelStart = await page.evaluate(() => window.__pointer.frames().length);
  await page.mouse.wheel(0, 120);
  await sleep(100);
  const actualWheel = await page.evaluate((start) => window.__pointer.frames().slice(start), actualWheelStart);
  assert.equal(actualWheel.length, 1);
  assert.deepEqual(actualWheel[0].events.map((event) => [event.eventType, event.code, event.value]), [[2, 8, -1]]);
  const wheel = await page.evaluate(() => {
    const host = document.getElementById("term");
    const start = window.__pointer.frames().length;
    const emit = (deltaMode, deltaX, deltaY) => host.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaMode,
      deltaX,
      deltaY,
    }));
    // LINE: three lines = one signed vertical detent.
    emit(1, 0, 3);
    // PIXEL: 1000 small deltas = exactly 25 signed detents, with no remainder.
    for (let index = 0; index < 1000; index += 1) emit(0, 0, 3);
    return {
      frames: window.__pointer.frames().slice(start),
      remainder: window.__pointer.wheelRemainders(),
      debug: document.getElementById("ide-pointer-debug")?.textContent || "",
    };
  });
  assert.equal(wheel.frames.length, 26);
  assert.deepEqual(wheel.frames[0].events.map((event) => [event.eventType, event.code, event.value]), [[2, 8, -1]]);
  assert.equal(wheel.frames.slice(1).every((frame) => frame.events.length === 1 && frame.events[0].value === -1), true);
  assert.equal(wheel.frames.slice(1).reduce((total, frame) => total + frame.events[0].value, 0), -25);
  assert.deepEqual(wheel.remainder, { horizontal: 0, vertical: 0 });
  assert.match(wheel.debug, /wheel:/);
  result.stages.wheel = wheel;

  const transitions = await page.evaluate(async () => {
    const host = document.getElementById("term");
    const emitButton = (type, button, pointerId) => host.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button,
      pointerId,
      pointerType: "mouse",
    }));
    const states = [];
    const enterHeld = (button, pointerId) => {
      window.__pointer.setMode("relative", { requestLock: false, reason: "browser-proof-relative" });
      emitButton("pointerdown", button, pointerId);
    };
    enterHeld(0, 41);
    document.dispatchEvent(new Event("pointerlockchange"));
    states.push({ path: "pointerlockchange", state: window.__pointer.state() });
    enterHeld(4, 42);
    window.dispatchEvent(new Event("blur"));
    states.push({ path: "blur", state: window.__pointer.state() });
    enterHeld(1, 43);
    window.dispatchEvent(new CustomEvent("wvm:reserved-view-toggle"));
    states.push({ path: "view-toggle", state: window.__pointer.state() });
    enterHeld(3, 45);
    window.__pointer.exitRelative();
    states.push({ path: "escape-cancel", state: window.__pointer.state() });
    enterHeld(2, 44);
    emitButton("pointercancel", 2, 44);
    states.push({ path: "pointercancel", state: window.__pointer.state() });

    const originalRequestPointerLock = host.requestPointerLock;
    host.requestPointerLock = () => Promise.reject(new Error("browser-proof-denied"));
    window.__pointer.setMode("relative", { reason: "browser-proof-denial" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.requestPointerLock = originalRequestPointerLock;
    states.push({ path: "denied", state: window.__pointer.state() });
    return {
      states,
      diagnostics: window.__pointer.diagnostics().slice(-12),
      held: window.__pointer.heldButtons(),
      keyboardHeld: window.__keyboardCapture.heldCodes(),
      lockElementIsHost: document.pointerLockElement === host,
    };
  });
  for (const transition of transitions.states) {
    assert.equal(transition.state.mode, "absolute", `${transition.path} did not return to absolute`);
    assert.deepEqual(transition.state.heldButtons, [], `${transition.path} stranded a button`);
  }
  assert.deepEqual(transitions.held, []);
  assert.deepEqual(transitions.keyboardHeld, []);
  assert.equal(transitions.lockElementIsHost, false);
  assert.equal(transitions.diagnostics.some((entry) => entry.reason === "pointerlock-denied"), true);
  result.stages.recovery = transitions;

  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(result.errors.page, [], `unexpected page errors: ${result.errors.page.join("; ")}`);
  assert.deepEqual(result.errors.console, [], `unexpected console errors: ${result.errors.console.map((entry) => entry.text).join("; ")}`);
  assert.deepEqual(result.errors.requests, [], `unexpected failed requests: ${result.errors.requests.map((entry) => entry.url).join("; ")}`);
  result.final = await page.evaluate(() => ({
    pointer: window.__pointer.state(),
    keyboardHeld: window.__keyboardCapture.heldCodes(),
    stateText: document.getElementById("ide-pointer-state")?.textContent || "",
    debugText: document.getElementById("ide-pointer-debug")?.textContent || "",
  }));
  assert.equal(result.final.pointer.mode, "absolute");
  assert.deepEqual(result.final.pointer.heldButtons, []);
  assert.deepEqual(result.final.keyboardHeld, []);
  result.screenshot = {
    path: "evidence/e5-t14c/pointer-wheel-browser-2026-09-03.png",
    sha256: sha256(await fs.readFile(screenshotPath)),
  };
  result.guestEvtest = {
    path: "evidence/e5-t14c/guest-evtest-2026-09-03.txt",
    sha256: sha256(transcript),
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (context) await context.close().catch(() => {});
  await stopServer();
}

console.log(JSON.stringify(result, null, 2));
// Undici's readiness fetch can retain an idle socket on Node 24; this standalone evidence command
// must terminate after the complete result is written.
process.exit(0);
