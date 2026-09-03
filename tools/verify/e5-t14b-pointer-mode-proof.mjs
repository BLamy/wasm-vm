#!/usr/bin/env node
// E5-T14b: one local Chromium pass over the live pointer mode/routing surface.
// This uses the direct Playwright API because the repository's legacy collector deadlocks under
// the Node 24 environment used by the browser proofs.
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
const evidenceDir = path.join(repo, "evidence", "e5-t14b");
const evidencePath = path.join(evidenceDir, "pointer-mode-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "pointer-mode-browser-2026-09-03.png");
const requestedBase = process.env.E5_T14B_BASE_URL?.replace(/\/$/, "") || null;
let port = Number(process.env.E5_T14B_PORT || 0);
const bootTimeout = Number(process.env.E5_T14B_BOOT_TIMEOUT_MS || 180_000);
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

const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
const chromePath = process.env.E5_T14B_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E5_T14B_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {}

let base = null;
let url = null;
const result = {
  task: "E5-T14b",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: "node tools/verify/e5-t14b-pointer-mode-proof.mjs",
  base: null,
  url: null,
  browser: {},
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
    await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5t14b-")),
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
  await page.waitForFunction(() => window.wvmDemo && window.__pointer, null, { timeout: 120_000 });
  assert.equal(await page.locator("#ide-pointer-state").textContent(), "Pointer: absolute");
  assert.equal(await page.locator("#ide-pointer-toggle").isDisabled(), true);
  result.stages.initial = await page.evaluate(() => ({
    mode: window.__pointer.mode(),
    state: window.__pointer.state(),
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

  const actions = await page.evaluate(async () => {
    const host = document.getElementById("term");
    const rect = host.getBoundingClientRect();
    const before = window.__pointer.frames().length;
    const emit = (type, init = {}) => host.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 17,
      pointerType: "mouse",
      ...init,
    }));
    const corners = [
      [rect.left, rect.top],
      [rect.right, rect.top],
      [rect.left, rect.bottom],
      [rect.right, rect.bottom],
      [rect.left + rect.width / 2, rect.top + rect.height / 2],
    ];
    for (const [clientX, clientY] of corners) emit("pointermove", { clientX, clientY });
    emit("pointerdown", { clientX: rect.left + 2, clientY: rect.top + 2, button: 3 });
    emit("pointerup", { clientX: rect.left + 2, clientY: rect.top + 2, button: 3 });
    window.__pointer.setMode("relative", { requestLock: false, reason: "browser-proof-relative" });
    emit("pointermove", { movementX: 11, movementY: -5 });
    const originalRequestPointerLock = host.requestPointerLock;
    host.requestPointerLock = () => Promise.reject(new Error("browser-proof-denied"));
    window.__pointer.setMode("relative", { reason: "browser-proof-denial" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    host.requestPointerLock = originalRequestPointerLock;
    await new Promise((resolve) => setTimeout(resolve, 300));
    return {
      rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      frames: window.__pointer.frames().slice(before),
      diagnostics: window.__pointer.diagnostics().slice(-8),
      state: window.__pointer.state(),
      ui: {
        state: document.getElementById("ide-pointer-state")?.textContent || "",
        debug: document.getElementById("ide-pointer-debug")?.textContent || "",
        toggle: document.getElementById("ide-pointer-toggle")?.textContent || "",
      },
      lockElementIsHost: document.pointerLockElement === host,
    };
  });

  assert.equal(actions.frames.length, 8, "five moves, one button pair, and one relative move expected");
  const absoluteFrames = actions.frames.slice(0, 5);
  const expected = [
    [0, 0],
    [32767, 0],
    [0, 32767],
    [32767, 32767],
    [16384, 16384],
  ];
  assert.deepEqual(absoluteFrames.map((frame) => frame.events.map((event) => event.value)), expected);
  assert.deepEqual(actions.frames.slice(5, 7).map((frame) => frame.events.map((event) => [event.code, event.value])), [
    [[0x113, 1]],
    [[0x113, 0]],
  ]);
  assert.deepEqual(actions.frames[7].events.map((event) => [event.eventType, event.code, event.value]), [
    [2, 0, 11],
    [2, 1, -5],
  ]);
  assert.equal(actions.state.mode, "absolute");
  assert.equal(actions.state.pointerLocked, false);
  assert.equal(actions.state.heldButtons.length, 0);
  assert.equal(actions.lockElementIsHost, false);
  assert.equal(actions.ui.state, "Pointer: absolute");
  assert.equal(actions.ui.toggle, "Pointer: absolute");
  assert.equal(actions.diagnostics.some((entry) => entry.reason === "pointerlock-denied"), true);
  result.stages.routing = actions;

  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(result.errors.page, [], `unexpected page errors: ${result.errors.page.join("; ")}`);
  assert.deepEqual(result.errors.console, [], `unexpected console errors: ${result.errors.console.map((entry) => entry.text).join("; ")}`);
  assert.deepEqual(result.errors.requests, [], `unexpected failed requests: ${result.errors.requests.map((entry) => entry.url).join("; ")}`);
  result.final = await page.evaluate(() => ({
    pointer: window.__pointer.state(),
    stateText: document.getElementById("ide-pointer-state")?.textContent || "",
    debugText: document.getElementById("ide-pointer-debug")?.textContent || "",
    terminalTail: document.querySelector("#term .xterm-rows")?.textContent?.slice(-1200) || "",
  }));
  assert.equal(result.final.pointer.mode, "absolute");
  assert.deepEqual(result.final.pointer.heldButtons, []);
  result.screenshot = {
    path: "evidence/e5-t14b/pointer-mode-browser-2026-09-03.png",
    sha256: sha256(await fs.readFile(screenshotPath)),
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (context) await context.close().catch(() => {});
  await stopServer();
}

console.log(JSON.stringify(result, null, 2));
