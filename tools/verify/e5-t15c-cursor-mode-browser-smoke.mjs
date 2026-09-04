#!/usr/bin/env node
// E5-T15c: local Chromium smoke proof for the production cursor controller wiring.
// The real guest cursor workload and delayed-frame comparison are E5-T15d; this proof keeps the
// mode/lifecycle boundary deterministic by feeding the same typed callback shape the wasm sink uses.
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
const evidenceDir = path.join(repo, "evidence", "e5-t15c");
const evidencePath = path.join(evidenceDir, "cursor-mode-browser-2026-09-04.json");
const screenshotPath = path.join(evidenceDir, "cursor-mode-browser-2026-09-04.png");
const requestedBase = process.env.E5_T15C_BASE_URL?.replace(/\/$/, "") || null;
let port = Number(process.env.E5_T15C_PORT || 0);
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

const parityPaths = [
  "web/main.js",
  "web/loader.js",
  "web/linux-worker.js",
  "web/linux-worker-host.js",
  "web/linux-worker-protocol.js",
  "web/roadmap.js",
  "web/src/sink/cursor-controller.js",
  "web/src/sink/cursor-controller.ts",
];
const parity = [];
for (const sourcePath of parityPaths) {
  const distPath = sourcePath.replace(/^web\//, "web/dist/");
  const [source, dist] = await Promise.all([
    fs.readFile(path.join(repo, sourcePath)),
    fs.readFile(path.join(repo, distPath)),
  ]);
  assert.deepEqual(dist, source, `${sourcePath} and ${distPath} differ`);
  parity.push({ source: sourcePath, dist: distPath, sha256: sha256(source) });
}

const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright", "index.mjs")).href);
const chromePath = process.env.E5_T15C_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E5_T15C_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {}

let base = null;
let url = null;
const result = {
  task: "E5-T15c",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  command: "node tools/verify/e5-t15c-cursor-mode-browser-smoke.mjs",
  base: null,
  url: null,
  browser: {},
  parity,
  stages: {},
  errors: { console: [], page: [], requests: [] },
};

try {
  await startServer();
  base = requestedBase || `http://127.0.0.1:${port}`;
  url = `${base}/?noAutoBoot=1&nosw=1&testHooks=1&jit=0#ide`;
  result.base = base;
  result.url = url;
  context = await chromium.launchPersistentContext(
    await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5t15c-")),
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
  await page.waitForFunction(() => window.wvmDemo && window.__pointer && window.__cursor, null, {
    timeout: 120_000,
  });
  const initial = await page.evaluate(() => ({
    pointer: window.__pointer.state(),
    cursor: window.__cursor.state(),
    style: document.getElementById("term")?.style.cursor || "",
    overlays: document.querySelectorAll(".wvm-cursor-overlay").length,
  }));
  assert.equal(initial.pointer.mode, "absolute");
  assert.equal(initial.cursor.resourceId, 0);
  assert.equal(initial.style, "");
  assert.equal(initial.overlays, 0);
  result.stages.initial = initial;

  const actions = await page.evaluate(() => {
    const host = document.getElementById("term");
    const pixels = new Uint32Array(64 * 64);
    for (let index = 0; index < pixels.length; index += 1) {
      const alpha = index % 3 === 0 ? 0x40 : 0xff;
      pixels[index] = (alpha << 24) | 0x00102030;
    }
    const update = window.__cursor.handle({
      type: "cursor-update",
      state: { resourceId: 7, hotX: 10, hotY: 3, pos: { scanoutId: 0, x: 100, y: 50 } },
      format: 1,
      resourceWidth: 64,
      resourceHeight: 64,
      pixels,
    });
    const css = host.style.cursor;
    const sourceUrl = window.__cursor.descriptor().dataUrl;
    window.__pointer.setMode("relative", { requestLock: false, reason: "cursor-browser-proof" });
    const overlay = host.querySelector(".wvm-cursor-overlay");
    const beforeMoves = window.__cursor.state();
    for (let index = 0; index < 500; index += 1) {
      window.__cursor.handle({
        type: "cursor-move",
        state: { resourceId: 7, hotX: 10, hotY: 3, pos: { scanoutId: 0, x: 200 + index, y: 300 + index } },
        format: null,
        resourceWidth: 0,
        resourceHeight: 0,
        pixels: new Uint32Array(0),
      });
    }
    const moved = {
      updateKind: update.kind,
      cssChars: css.length,
      cssHasDataUrl: css.startsWith('url("data:image/png;base64,'),
      cssHotspot: css.endsWith(") 10 3, none"),
      sourceUrlChars: sourceUrl.length,
      relative: window.__cursor.state(),
      overlayAttached: Boolean(overlay?.isConnected),
      sameSource: overlay?.src === sourceUrl,
      transform: overlay?.style.transform || "",
      hostCursor: host.style.cursor,
      beforeMoves,
    };
    const hidden = window.__cursor.handle({
      type: "cursor-update",
      state: { resourceId: 0, hotX: 0, hotY: 0, pos: { scanoutId: 0, x: 0, y: 0 } },
      format: null,
      resourceWidth: 0,
      resourceHeight: 0,
      pixels: new Uint32Array(0),
    });
    return {
      moved,
      hidden: {
        kind: hidden.kind,
        state: window.__cursor.state(),
        hostCursor: host.style.cursor,
        overlays: host.querySelectorAll(".wvm-cursor-overlay").length,
      },
    };
  });
  assert.equal(actions.moved.updateKind, "css");
  assert.equal(actions.moved.cssHasDataUrl, true);
  assert.equal(actions.moved.cssHotspot, true);
  assert.ok(actions.moved.cssChars <= 350_006);
  assert.ok(actions.moved.sourceUrlChars <= 350_006);
  assert.equal(actions.moved.relative.mode, "relative");
  assert.equal(actions.moved.relative.moves, 500);
  assert.equal(actions.moved.overlayAttached, true);
  assert.equal(actions.moved.sameSource, true);
  assert.equal(actions.moved.transform, "translate3d(689px, 796px, 0px)");
  assert.equal(actions.moved.hostCursor, "");
  assert.equal(actions.hidden.kind, "hidden");
  assert.equal(actions.hidden.state.resourceId, 0);
  assert.equal(actions.hidden.hostCursor, "");
  assert.equal(actions.hidden.overlays, 0);
  result.stages.actions = actions;

  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(result.errors.page, [], `unexpected page errors: ${result.errors.page.join("; ")}`);
  assert.deepEqual(result.errors.console, [], `unexpected console errors: ${result.errors.console.map((entry) => entry.text).join("; ")}`);
  assert.deepEqual(result.errors.requests, [], `unexpected failed requests: ${result.errors.requests.map((entry) => entry.url).join("; ")}`);
  result.screenshot = {
    path: "evidence/e5-t15c/cursor-mode-browser-2026-09-04.png",
    sha256: sha256(await fs.readFile(screenshotPath)),
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
} finally {
  if (context) await context.close().catch(() => {});
  await stopServer();
}

console.log(JSON.stringify(result, null, 2));
process.exit(0);
