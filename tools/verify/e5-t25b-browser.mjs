#!/usr/bin/env node
// E5-T25b: headed, real-window drag measurement. The analyzer is pure and separately tested;
// this runner supplies the actual Foot window, Canvas2D presents, and scheduler counters.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  DRAG_MOVE_COUNT,
  aggregateDragRuns,
  assertNullSinkRejected,
  assertWindowMoved,
  buildDragPath,
  summarizeDragRun,
} from "../../web/bench/desktop-perf.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const out = path.resolve(process.env.E5_T25B_OUT || path.join(repo, "evidence/e5-t25b/browser"));
const assetRoot = path.resolve(process.env.E5_T25B_ASSET_DIR || path.join(repo, "target/e5-t22c/chunks/desktop-solid-v7"));
const imageInfoPath = path.resolve(process.env.E5_T25B_IMAGE_INFO || path.join(repo, "target/e5-t22c/desktop-image-solid-v7/desktop-info.json"));
const timeoutMs = Number(process.env.E5_T25B_TIMEOUT_MS || 900_000);
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 120_000, "timeout must be at least two minutes");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const port = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function waitFor(predicate, label, limit = timeoutMs) {
  const deadline = Date.now() + limit;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await sleep(250);
  }
  throw new Error(`bounded wait expired: ${label}`);
}

const manifest = JSON.parse(await readFile(path.join(assetRoot, "manifest.json"), "utf8"));
assert.equal(manifest.layout, "split");
assert.ok(Array.isArray(manifest.chunks) && manifest.chunks.length > 0, "desktop chunk manifest is empty");
const manifestBytes = await readFile(path.join(assetRoot, "manifest.json"));
const manifestSha256 = sha256(manifestBytes);
const imageInfo = JSON.parse(await readFile(imageInfoPath, "utf8"));
const imageSha256 = process.env.E5_T25B_IMAGE_SHA256 || imageInfo.image?.sha256;
assert.match(imageSha256, /^[0-9a-f]{64}$/);
const { stdout: headOutput } = await execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo });
const head = headOutput.trim();
assert.match(head, /^[0-9a-f]{40}$/, "runner must record an exact Git head");
if (process.env.E5_T25B_REQUIRE_HEAD) assert.equal(head, process.env.E5_T25B_REQUIRE_HEAD);

const cleanEnv = { ...process.env, E5_T18B_DESKTOP_ASSET_DIR: assetRoot };
for (const key of Object.keys(cleanEnv)) {
  if (key === "RUSTFLAGS" || key === "RUST_LOG" || key.startsWith("CARGO_")) delete cleanEnv[key];
}
const port = await freePort();
const server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
  cwd: repo, env: cleanEnv, stdio: ["ignore", "pipe", "pipe"], detached: true,
});
let serverOutput = "";
for (const stream of [server.stdout, server.stderr]) stream.on("data", (data) => { serverOutput += data.toString(); });
const base = `http://127.0.0.1:${port}`;
let browser;
let context;
let page;
const errors = [];
const httpErrors = [];
try {
  await waitFor(async () => {
    try { return (await fetch(`${base}/desktop-cursor.html`)).ok; } catch { return false; }
  }, "desktop dev server", 30_000);
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({
    executablePath: process.env.E5_T25B_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: process.env.E5_T25B_HEADLESS === "1",
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: Number(process.env.E5_T25B_DPR || 1),
    serviceWorkers: "block",
  });
  page = await context.newPage();
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      httpErrors.push({ url: response.url(), status: response.status() });
    }
  });
  const query = new URLSearchParams({
    testHooks: "1", perfHooks: "1", jit: "1", quantum: "500000",
    imageSha256, manifestSha256,
  });
  await page.goto(`${base}/desktop-cursor.html?${query}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => document.documentElement.dataset.desktopReady === "ready", null, { timeout: timeoutMs });
  await page.waitForFunction(() => window.__desktopPerf?.ready?.() === true, null, { timeout: 60_000 });

  await page.evaluate(() => window.__desktopTerminal.beginLaunch("e5-t25b-drag"));
  const canvas = page.locator("#desktop-canvas");
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox?.width > 0 && canvasBox.height > 0, "desktop canvas has no layout");
  const guestPoint = (point) => ({
    x: canvasBox.x + (point.x * canvasBox.width / 1280),
    y: canvasBox.y + (point.y * canvasBox.height / 800),
  });
  const launcherPoint = guestPoint({ x: 24, y: 16 });
  await page.mouse.move(launcherPoint.x, launcherPoint.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(() => window.__desktopTerminal.state().active.launch?.terminalRendered === true, null, { timeout: timeoutMs });
  await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  await page.waitForFunction(() => window.__desktopCursor?.detectWindowChrome?.() !== null, null, { timeout: timeoutMs });
  await page.waitForTimeout(250);

  const runs = [];
  let firstRunRecords = null;
  let direction = 1;
  for (let index = 0; index < 5; index += 1) {
    const chrome = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
    assert.ok(chrome?.titlebar?.right - chrome?.titlebar?.left >= 420, "Foot titlebar is too narrow for the 300px path");
    const y = Math.round((chrome.titlebar.top + chrome.titlebar.bottom) / 2);
    const startX = direction > 0 ? chrome.titlebar.left + 55 : chrome.titlebar.right - 355;
    const endX = startX + (direction * 300);
    const pathPoints = buildDragPath({ x: startX, y }, { x: endX, y }, DRAG_MOVE_COUNT);
    const startClient = guestPoint(pathPoints[0]);
    await page.mouse.move(startClient.x, startClient.y);
    await page.waitForTimeout(80);
    const before = await page.evaluate(async () => {
      window.__desktopPerf.clear();
      return {
        startedAt: window.__desktopPerf.now(),
        scheduler: await window.__desktopPerf.scheduler(),
        pointerFrames: window.__desktopTerminal.state().pointerFrames,
      };
    });
    await page.mouse.down();
    for (const point of pathPoints) {
      const client = guestPoint(point);
      await page.mouse.move(client.x, client.y);
    }
    await page.mouse.up();
    await page.waitForFunction((minimum) => window.__desktopTerminal.state().pointerFrames >= minimum,
      before.pointerFrames + DRAG_MOVE_COUNT, { timeout: 120_000 });
    await page.waitForTimeout(150);
    const after = await page.evaluate(async () => ({
      endedAt: window.__desktopPerf.now(),
      scheduler: await window.__desktopPerf.scheduler(),
      records: window.__desktopPerf.presents(),
      presentDurationsMs: window.__desktopPerf.presentDurations(),
      pointerFrames: window.__desktopTerminal.state().pointerFrames,
    }));
    const pointerFramesDelta = after.pointerFrames - before.pointerFrames;
    assert.ok(pointerFramesDelta >= DRAG_MOVE_COUNT, `${index + 1}: fewer than 300 processed pointer moves`);
    const chromeAfter = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
    assert.ok(chromeAfter?.titlebar, `${index + 1}: Foot window chrome disappeared during drag`);
    const displacement = assertWindowMoved(chrome.titlebar, chromeAfter.titlebar, { direction });
    if (firstRunRecords === null) firstRunRecords = after.records;
    const run = summarizeDragRun({
      runId: `drag-${String(index + 1).padStart(2, "0")}`,
      records: after.records,
      startedAt: before.startedAt,
      endedAt: after.endedAt,
      schedulerBefore: before.scheduler,
      schedulerAfter: after.scheduler,
      presentDurationsMs: after.presentDurationsMs,
      browser: browser.version(),
      deviceScaleFactor: Number(await page.evaluate(() => devicePixelRatio)),
      viewport: { width: 1440, height: 1050 },
    });
    runs.push({
      ...run,
      pointerFramesBefore: before.pointerFrames,
      pointerFrames: after.pointerFrames,
      pointerFramesDelta,
      requestedMoves: pathPoints.length,
      windowBefore: chrome.titlebar,
      windowAfter: chromeAfter.titlebar,
      windowDisplacementX: displacement.deltaX,
      windowDisplacementPx: displacement.displacementPx,
      schedulerBefore: before.scheduler,
      schedulerAfter: after.scheduler,
      presentDurationsMs: after.presentDurationsMs,
      records: after.records,
    });
    direction *= -1;
  }
  const aggregate = aggregateDragRuns(runs);
  assert.equal(aggregate.repeatabilityHeld, true, `drag FPS coefficient of variation exceeded 15%: ${aggregate.coefficientOfVariationPercent}`);
  const nullSinkAttack = assertNullSinkRejected(firstRunRecords.map((record) => ({ ...record, drawn: false })));
  assert.deepEqual(errors, [], "browser console errors");
  assert.deepEqual(httpErrors, [], "browser HTTP errors");
  await mkdir(out, { recursive: true });
  const screenshot = await page.screenshot({ path: path.join(out, "drag-fps.png") });
  const result = {
    schema: "wasm-vm.e5-t25b-browser-v1",
    task: "E5-T25b",
    head,
    browser: browser.version(),
    headed: process.env.E5_T25B_HEADLESS !== "1",
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: Number(await page.evaluate(() => devicePixelRatio)),
    image: { imageSha256, manifestSha256, assetRoot },
    aggregate,
    runs,
    nullSinkAttack,
    errors,
    httpErrors,
    screenshotSha256: sha256(screenshot),
  };
  await writeFile(path.join(out, "drag-fps.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ aggregate, nullSinkAttack, errors, httpErrors }));
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server.exitCode === null) {
    const stopGroup = (signal) => {
      try { process.kill(-server.pid, signal); } catch { server.kill(signal); }
    };
    stopGroup("SIGTERM");
    const exited = await Promise.race([
      new Promise((resolve) => server.once("exit", () => resolve(true))),
      sleep(5_000).then(() => false),
    ]);
    if (!exited && server.exitCode === null) stopGroup("SIGKILL");
  }
  if (serverOutput && process.env.E5_T25B_VERBOSE === "1") process.stderr.write(serverOutput);
}
