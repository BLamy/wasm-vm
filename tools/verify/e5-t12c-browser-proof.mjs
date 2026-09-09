#!/usr/bin/env node
// E5-T12c: direct Chromium proof for the keyboard capture policy and the real guest getty.
// The repository's Playwright Test collector deadlocks before discovery on this host's Node 24
// because legacy opt-in specs execute subprocesses at module load time. This harness uses the
// same Playwright browser API while keeping the acceptance run to one page and one browser.
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
const evidenceDir = path.join(repo, "evidence", "e5-t12c");
const evidencePath = path.join(evidenceDir, "keyboard-capture-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "keyboard-capture-2026-09-03.png");
const requestedBase = process.env.E5_T12C_BASE_URL?.replace(/\/$/, "") || null;
let port = Number(process.env.E5_T12C_PORT || 0);
const bootTimeout = Number(process.env.E5_T12C_BOOT_TIMEOUT_MS || 180_000);
let server = null;
let context = null;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const mark = (message) => console.error(`[e5-t12c] ${message}`);
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
  for (const [sourceName, distName] of [["web/main.js", "web/dist/main.js"], ["web/ide.js", "web/dist/ide.js"]]) {
    const [source, dist] = await Promise.all([read(sourceName), read(distName)]);
    assert.deepEqual(dist, source, `${sourceName} and ${distName} differ`);
    parity.push({ source: sourceName, dist: distName, equal: true, sha256: sha256(source) });
  }
  for (const sourceName of ["web/src/input/capture.js", "web/src/input/capture.ts"]) {
    await fs.access(path.join(repo, sourceName));
  }
  return { parity, generatedSourcesPresent: true };
}

async function waitForText(page, selector, text, timeout) {
  await page.waitForFunction(({ selector: target, text: expected }) =>
    document.querySelector(target)?.textContent?.includes(expected) === true,
  { selector, text }, { timeout, polling: 200 });
}

async function waitForValue(page, predicate, arg, timeout) {
  return page.waitForFunction(predicate, arg, { timeout, polling: 100 });
}

async function probeDefaultAfterDispatch(page, code) {
  await page.evaluate(() => {
    window.__keyboardDefaultProbe = null;
    // The policy is registered first on #term in capture phase. Registering this probe on the same
    // host makes it observe the policy's decision after that listener; a document-capture probe
    // would run before #term and would observe the pre-policy value in Chromium.
    document.getElementById("term").addEventListener("keydown", (event) => {
      window.__keyboardDefaultProbe = {
        code: event.code,
        defaultPrevented: event.defaultPrevented,
      };
    }, { capture: true, once: true });
  });
  await page.keyboard.press(code);
  await waitForValue(page, ({ expected }) => window.__keyboardDefaultProbe?.code === expected,
    { expected: code }, 5_000);
  return page.evaluate(() => window.__keyboardDefaultProbe);
}

async function typeCommand(page, command) {
  await page.keyboard.type(command);
  await page.keyboard.press("Enter");
}

const staticEvidence = await staticAudit();
const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
const chromePath = process.env.E5_T12C_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E5_T12C_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {}

let base = null;
let url = null;
const result = {
  task: "E5-T12c",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: "node tools/verify/e5-t12c-browser-proof.mjs",
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
    await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5t12c-")),
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
  assert.equal(await page.locator("#ide-keyboard-toggle").textContent(), "Capture: on");
  assert.equal(await page.locator("#ide-keyboard-state").textContent(), "Keyboard: captured");

  const bootStarted = Date.now();
  const boot = await page.evaluate(() => window.wvmDemo.runBusybox());
  assert.equal(boot?.ok, true, `busybox boot failed: ${JSON.stringify(boot)}`);
  await waitForText(page, "#term .xterm-rows", "busybox userland up", bootTimeout);
  // The shell is already live, but its first prompt is emitted only after ttyS0 receives input.
  // Nudge that initial prompt through the existing serial bridge; all acceptance commands below
  // use real browser keyboard events and the capture policy.
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
  await page.evaluate(() => window.wvmDemo.focusTerminal());
  result.stages.boot = { ok: true, elapsedMs: Date.now() - bootStarted };
  mark(`busybox getty ready in ${result.stages.boot.elapsedMs}ms`);

  await typeCommand(page, "touch x");
  await typeCommand(page, "ls -la | grep 'x' && echo \"hi~\"");
  await waitForText(page, "#term .xterm-rows", "hi~", 30_000);
  result.stages.shellTyping = {
    command: "ls -la | grep 'x' && echo \"hi~\"",
    result: "hi~",
  };

  await typeCommand(page, "cat");
  await page.waitForTimeout(250);
  await page.keyboard.press("Control+C");
  // Let ash consume the interrupt and redraw its prompt before the next browser-keyboard command.
  await page.waitForTimeout(1_000);
  await typeCommand(page, "echo E5_T12C_CTRL_C_$((6*7))");
  try {
    await waitForText(page, "#term .xterm-rows", "E5_T12C_CTRL_C_42", 30_000);
  } catch (error) {
    mark(`Ctrl+C terminal tail=${JSON.stringify((await page.locator("#term .xterm-rows").textContent()).slice(-1600))}`);
    mark(`Ctrl+C capture=${JSON.stringify(await page.evaluate(() => ({
      frames: window.__keyboardCapture.frames().slice(-20),
      diagnostics: window.__keyboardCapture.diagnostics().slice(-20),
      held: window.__keyboardCapture.heldCodes(),
      pending: window.__keyboardCapture.pendingModifierCodes(),
    })))}`);
    throw error;
  }
  result.stages.ctrlC = { ordering: "Control before C", result: "E5_T12C_CTRL_C_42" };

  await page.evaluate(() => window.__keyboardCapture.setCaptured(false));
  assert.equal(await page.locator("#ide-keyboard-toggle").textContent(), "Capture: off");
  assert.equal(await page.locator("#ide-keyboard-state").textContent(), "Keyboard: browser");
  const offProbe = await probeDefaultAfterDispatch(page, "F1");
  assert.deepEqual(offProbe, { code: "F1", defaultPrevented: false });

  await page.evaluate(() => window.__keyboardCapture.setCaptured(true));
  assert.equal(await page.locator("#ide-keyboard-toggle").textContent(), "Capture: on");
  await page.evaluate(() => window.wvmDemo.focusTerminal());
  const onProbe = await probeDefaultAfterDispatch(page, "F2");
  try {
    assert.deepEqual(onProbe, { code: "F2", defaultPrevented: true });
  } catch (error) {
    mark(`F2 focus=${JSON.stringify(await page.evaluate(() => ({
      captured: window.__keyboardCapture.isCaptured(),
      active: { tag: document.activeElement?.tagName, id: document.activeElement?.id, className: document.activeElement?.className },
      terminal: { id: document.querySelector("#term")?.id, textarea: document.querySelector("#term textarea")?.className },
    })))}`);
    throw error;
  }

  const framesBeforeReserved = await page.evaluate(() => window.__keyboardCapture.frames().length);
  await page.evaluate(() => { window.__keyboardReservedToggles = 0; });
  await page.keyboard.down("Control");
  await page.keyboard.down("Alt");
  await page.keyboard.press("Backquote");
  await page.keyboard.up("Alt");
  await page.keyboard.up("Control");
  assert.equal(await page.evaluate(() => window.__keyboardReservedToggles), 1);
  assert.equal(await page.evaluate(() => window.__keyboardCapture.frames().length), framesBeforeReserved);
  assert.deepEqual(await page.evaluate(() => window.__keyboardCapture.heldCodes()), []);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.keyboardCapture), "on");

  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(result.errors.page, [], `unexpected page errors: ${result.errors.page.join("; ")}`);
  assert.deepEqual(result.errors.console, [], `unexpected console errors: ${result.errors.console.map((entry) => entry.text).join("; ")}`);
  assert.deepEqual(result.errors.requests, [], `unexpected failed requests: ${result.errors.requests.map((entry) => entry.url).join("; ")}`);

  result.stages.capture = await page.evaluate(({ offProbe, onProbe }) => ({
    capture: window.__keyboardCapture.isCaptured(),
    indicator: document.getElementById("ide-keyboard-state")?.textContent || "",
    toggle: document.getElementById("ide-keyboard-toggle")?.textContent || "",
    offProbe,
    onProbe,
    reservedToggles: window.__keyboardReservedToggles,
    frameCount: window.__keyboardCapture.frames().length,
    frameSample: window.__keyboardCapture.frames().slice(-16),
    diagnostics: window.__keyboardCapture.diagnostics().slice(-16),
    terminalTail: document.querySelector("#term .xterm-rows")?.textContent?.slice(-1200) || "",
  }), { offProbe, onProbe });
  result.screenshot = {
    path: "evidence/e5-t12c/keyboard-capture-2026-09-03.png",
    sha256: sha256(await fs.readFile(screenshotPath)),
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  mark(`evidence written to ${path.relative(repo, evidencePath)}`);
} finally {
  if (context) await context.close().catch(() => {});
  await stopServer();
}

console.log(JSON.stringify(result, null, 2));
