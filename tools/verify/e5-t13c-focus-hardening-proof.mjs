#!/usr/bin/env node
// E5-T13c: deterministic Chromium proof for browser focus recovery and guest keyboard neutrality.
// This is a direct Playwright API harness because the repository's legacy Playwright collector
// deadlocks under the Node 24 environment used for the other keyboard proofs.
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
const evidenceDir = path.join(repo, "evidence", "e5-t13c");
const evidencePath = path.join(evidenceDir, "focus-hardening-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "focus-hardening-2026-09-03.png");
const requestedBase = process.env.E5_T13C_BASE_URL?.replace(/\/$/, "") || null;
let port = Number(process.env.E5_T13C_PORT || 0);
const bootTimeout = Number(process.env.E5_T13C_BOOT_TIMEOUT_MS || 180_000);
let server = null;
let context = null;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mark = (message) => console.error(`[e5-t13c] ${message}`);
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
    stdio: ["ignore", "pipe", "inherit"],
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
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await sleep(300);
}

async function staticAudit() {
  const read = async (relativePath) => fs.readFile(path.join(repo, relativePath));
  const parity = [];
  for (const relativePath of [
    "web/main.js",
    "web/ide.js",
    "web/loader.js",
    "web/linux-worker-protocol.js",
  ]) {
    const distPath = relativePath.replace(/^web\//, "web/dist/");
    const [source, dist] = await Promise.all([read(relativePath), read(distPath)]);
    assert.deepEqual(dist, source, `${relativePath} and ${distPath} differ`);
    parity.push({ source: relativePath, dist: distPath, equal: true, sha256: sha256(source) });
  }
  for (const file of ["capture.js", "keyboard.js", "held-keys.js", "reconciliation.js"]) {
    const sourcePath = `web/src/input/${file}`;
    const distPath = `web/dist/src/input/${file}`;
    const [source, dist] = await Promise.all([read(sourcePath), read(distPath)]);
    assert.deepEqual(dist, source, `${sourcePath} and ${distPath} differ`);
    parity.push({ source: sourcePath, dist: distPath, equal: true, sha256: sha256(source) });
  }
  const docs = (await read("docs/input.md")).toString();
  for (const phrase of ["Focus and lock-state recovery", "Release keys", "getModifierState()", "CapsLock", "NumLock"]) {
    assert.match(docs, new RegExp(phrase.replace(/[()]/g, "\\$&")), `docs missing ${phrase}`);
  }
  return { parity, docsPolicy: true, deploySourceTree: true };
}

async function waitForText(page, selector, text, timeout) {
  await page.waitForFunction(({ selector: target, text: expected }) =>
    document.querySelector(target)?.textContent?.includes(expected) === true,
  { selector, text }, { timeout, polling: 200 });
}

async function waitForGuestReady(page) {
  await page.waitForFunction(() => window.__linuxBootStateForTest?.().guestReady === true,
    null, { timeout: bootTimeout, polling: 200 });
}

async function focusTerminal(page) {
  await page.evaluate(() => window.wvmDemo.focusTerminal());
}

async function keyboardState(page) {
  return page.evaluate(() => ({
    held: window.__keyboardCapture.heldCodes(),
    debug: document.getElementById("ide-keyboard-debug")?.textContent || "",
    lastReleaseReason: window.__keyboardCapture.lastReleaseReason(),
    stats: window.__keyboardCapture.stats(),
    frames: window.__keyboardCapture.frames().map(({ code, value }) => ({ code, value })),
  }));
}

async function fireVisibility(page, hidden) {
  await page.evaluate((nextHidden) => {
    const own = Object.getOwnPropertyDescriptor(document, "hidden");
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => nextHidden,
    });
    try {
      document.dispatchEvent(new Event("visibilitychange"));
    } finally {
      if (own) Object.defineProperty(document, "hidden", own);
      else delete document.hidden;
    }
  }, hidden);
}

async function eventSlice(page, start) {
  const state = await keyboardState(page);
  return state.frames.slice(start);
}

async function typeCommand(page, command) {
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

const staticEvidence = await staticAudit();
const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
const chromePath = process.env.E5_T13C_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E5_T13C_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {}

let base = null;
let url = null;
const result = {
  task: "E5-T13c",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: "node tools/verify/e5-t13c-focus-hardening-proof.mjs",
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
    await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5t13c-")),
    { ...launchOptions, viewport: { width: 1600, height: 1000 } },
  );
  const page = context.pages()[0] || await context.newPage();
  result.browser = { name: context.browser()?.browserType().name() || "chromium", version: context.browser()?.version() || "unknown" };
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
  await page.waitForFunction(() => window.wvmDemo && window.__keyboardCapture, null, { timeout: 120_000 });
  assert.equal(await page.locator("#ide-keyboard-debug").textContent(), "Held: none · repairs: 0");
  assert.equal(await page.locator("#ide-keyboard-release").textContent(), "Release keys");

  const bootStarted = Date.now();
  const boot = await page.evaluate(() => window.wvmDemo.runBusybox());
  assert.equal(boot?.ok, true, `busybox boot failed: ${JSON.stringify(boot)}`);
  await waitForText(page, "#term .xterm-rows", "busybox userland up", bootTimeout);
  let promptReady = false;
  for (let attempt = 0; attempt < 12 && !promptReady; attempt += 1) {
    await page.evaluate(() => window.__term.typeBytes(new Uint8Array([0x0d])));
    try {
      await waitForText(page, "#term .xterm-rows", "~ #", 5_000);
      promptReady = true;
    } catch {
      await sleep(500);
    }
  }
  assert.equal(promptReady, true, "busybox shell did not render a prompt after serial nudge");
  await focusTerminal(page);
  result.stages.boot = { ok: true, elapsedMs: Date.now() - bootStarted };
  mark(`busybox getty ready in ${result.stages.boot.elapsedMs}ms`);

  // Focus theft: Alt + F1 is genuinely held by the bridge, then the page receives a browser blur.
  let before = (await keyboardState(page)).frames.length;
  await page.keyboard.down("Alt");
  await page.keyboard.down("F1");
  assert.deepEqual((await keyboardState(page)).held, ["AltLeft", "F1"]);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  let state = await keyboardState(page);
  assert.deepEqual(state.held, []);
  assert.match(state.debug, /^Held: none/);
  assert.deepEqual(state.frames.slice(before).slice(-2), [
    { code: "F1", value: 0 },
    { code: "AltLeft", value: 0 },
  ]);
  await page.keyboard.up("F1");
  await page.keyboard.up("Alt");
  const afterAltUps = (await keyboardState(page)).frames.length;
  assert.equal(afterAltUps, state.frames.length, "late physical keyups must be no-ops");
  before = afterAltUps;
  await page.keyboard.press("a");
  const plainA = await eventSlice(page, before);
  assert.deepEqual(plainA, [
    { code: "KeyA", value: 1 },
    { code: "KeyA", value: 0 },
  ]);
  await page.keyboard.press("Backspace");
  result.stages.blur = { heldAfter: state.held, releaseFrames: state.frames.slice(-2), plainA };

  // Hidden visibility, true branch: Control remains physically down in Chromium and is repaired
  // before the first post-recovery dependent key.
  await focusTerminal(page);
  await page.keyboard.down("Control");
  await page.keyboard.down("F2");
  assert.deepEqual((await keyboardState(page)).held, ["ControlLeft", "F2"]);
  await fireVisibility(page, true);
  await fireVisibility(page, false);
  state = await keyboardState(page);
  assert.deepEqual(state.held, []);
  before = state.frames.length;
  await page.keyboard.down("F3");
  const ctrlTrueDown = await eventSlice(page, before);
  assert.deepEqual(ctrlTrueDown.slice(-2), [
    { code: "ControlLeft", value: 1 },
    { code: "F3", value: 1 },
  ]);
  await page.keyboard.up("F3");
  await page.keyboard.up("Control");
  assert.deepEqual((await keyboardState(page)).held, []);
  result.stages.visibilityControlTrue = {
    releaseFrames: state.frames.slice(-2),
    repairedFrames: ctrlTrueDown.slice(-2),
    stats: (await keyboardState(page)).stats,
  };

  // Hidden visibility, false branch: after the real Control keyup, a dependent key must not get
  // a synthetic Control make.
  await focusTerminal(page);
  await page.keyboard.down("Control");
  await page.keyboard.down("F4");
  await fireVisibility(page, true);
  await fireVisibility(page, false);
  await page.keyboard.up("Control");
  before = (await keyboardState(page)).frames.length;
  await page.keyboard.press("F5");
  const ctrlFalse = await eventSlice(page, before);
  assert.deepEqual(ctrlFalse, [
    { code: "F5", value: 1 },
    { code: "F5", value: 0 },
  ]);
  result.stages.visibilityControlFalse = { frames: ctrlFalse };

  // UI panic release: a real held Shift/F6 pair is released by the visible control; later physical
  // keyups and a repeated click do not produce extra guest frames or errors.
  await focusTerminal(page);
  await page.keyboard.down("Shift");
  await page.keyboard.down("F6");
  assert.deepEqual((await keyboardState(page)).held, ["ShiftLeft", "F6"]);
  const beforePanic = (await keyboardState(page)).frames.length;
  await page.locator("#ide-keyboard-release").click();
  state = await keyboardState(page);
  assert.deepEqual(state.held, []);
  assert.equal(state.lastReleaseReason, "panic-button");
  assert.match(state.debug, /^Held: none/);
  await page.keyboard.up("F6");
  await page.keyboard.up("Shift");
  assert.equal((await keyboardState(page)).frames.length, state.frames.length);
  await page.locator("#ide-keyboard-release").click();
  assert.deepEqual((await keyboardState(page)).held, []);
  result.stages.panic = {
    framesBefore: beforePanic,
    releaseFrames: state.frames.slice(-2),
    repeatedReleaseHeld: (await keyboardState(page)).held,
  };

  // Restart reset: retire the live whole-machine worker while keys are held, then prove that the
  // stale keyups cannot reach the new controller and that the fresh guest still accepts typing.
  await focusTerminal(page);
  await page.keyboard.down("Alt");
  await page.keyboard.down("F7");
  assert.deepEqual((await keyboardState(page)).held, ["AltLeft", "F7"]);
  const retired = await page.evaluate(() => window.__retireLinuxControllerForTest());
  assert.equal(retired, true);
  state = await keyboardState(page);
  assert.deepEqual(state.held, []);
  assert.equal(state.lastReleaseReason, "controller-retired");
  await page.keyboard.up("F7");
  await page.keyboard.up("Alt");
  const rebootStarted = Date.now();
  const reboot = await page.evaluate(() => window.__runConfiguredAutoBootForTest());
  assert.equal(reboot?.ok, true, `restart boot failed: ${JSON.stringify(reboot)}`);
  await waitForGuestReady(page);
  await focusTerminal(page);
  result.stages.restart = {
    retired,
    heldAfterRetire: state.held,
    rebootMs: Date.now() - rebootStarted,
  };

  // Deterministic bounded attack: 500 flaps interleaved with Alt/F8 chords. Every lifecycle edge
  // clears the ledger before the corresponding late keyups, so the final state must be neutral.
  const randomAttack = await page.evaluate(() => {
    const host = document.getElementById("term");
    let seed = 0x13c5eed;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed;
    };
    const dispatch = (type, code, altKey = false) => host.dispatchEvent(new KeyboardEvent(type, {
      bubbles: true,
      cancelable: true,
      code,
      key: code === "AltLeft" ? "Alt" : "F8",
      altKey,
    }));
    for (let i = 0; i < 500; i += 1) {
      dispatch("keydown", "AltLeft", true);
      dispatch("keydown", "F8", true);
      switch (next() % 3) {
        case 0: window.dispatchEvent(new Event("blur")); break;
        case 1: document.dispatchEvent(new Event("pointerlockchange")); break;
        default: window.dispatchEvent(new Event("wvm:reserved-view-toggle")); break;
      }
      dispatch("keyup", "F8", false);
      dispatch("keyup", "AltLeft", false);
    }
    return {
      iterations: 500,
      seed,
      held: window.__keyboardCapture.heldCodes(),
      frames: window.__keyboardCapture.frames().length,
      diagnostics: window.__keyboardCapture.diagnostics().slice(-8),
    };
  });
  assert.deepEqual(randomAttack.held, []);
  result.stages.randomizedFlaps = randomAttack;

  await focusTerminal(page);
  await typeCommand(page, "echo E5_T13C_RECOVER_$((6*7))");
  await waitForText(page, "#term .xterm-rows", "E5_T13C_RECOVER_42", 30_000);
  result.stages.postRecoveryTyping = {
    marker: "E5_T13C_RECOVER_42",
    debug: (await keyboardState(page)).debug,
    held: (await keyboardState(page)).held,
  };

  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(result.errors.page, [], `unexpected page errors: ${result.errors.page.join("; ")}`);
  assert.deepEqual(result.errors.console, [], `unexpected console errors: ${result.errors.console.map((entry) => entry.text).join("; ")}`);
  assert.deepEqual(result.errors.requests, [], `unexpected failed requests: ${result.errors.requests.map((entry) => entry.url).join("; ")}`);
  result.final = await page.evaluate(() => ({
    debug: document.getElementById("ide-keyboard-debug")?.textContent || "",
    held: window.__keyboardCapture.heldCodes(),
    stats: window.__keyboardCapture.stats(),
    terminalTail: document.querySelector("#term .xterm-rows")?.textContent?.slice(-1600) || "",
  }));
  assert.deepEqual(result.final.held, []);
  result.screenshot = {
    path: "evidence/e5-t13c/focus-hardening-2026-09-03.png",
    sha256: sha256(await fs.readFile(screenshotPath)),
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  mark(`evidence written to ${path.relative(repo, evidencePath)}`);
} finally {
  if (context) await context.close().catch(() => {});
  await stopServer();
}

console.log(JSON.stringify(result, null, 2));
