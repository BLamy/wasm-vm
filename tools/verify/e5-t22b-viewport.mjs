#!/usr/bin/env node
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = path.join(repo, "web/dist");
const out = path.resolve(process.env.E5_T22B_EVIDENCE_DIR || path.join(repo, "evidence/e5-t22b"));
const sha = (data) => createHash("sha256").update(data).digest("hex");
const fixtureKernel = Buffer.from([0x13, 5, 0x10, 0, 0x6f, 0, 0, 0]);
const fixtureManifest = { artifacts: {
  kernel: { url: "data:application/octet-stream;base64," + fixtureKernel.toString("base64"), sha256: sha(fixtureKernel) },
  initramfs: { url: "data:application/octet-stream;base64,", sha256: sha(Buffer.alloc(0)) },
} };
const server = createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, "." + pathname);
  if (!file.startsWith(root + "/")) { response.writeHead(404).end(); return; }
  try {
    const data = await readFile(pathname === "/artifacts-alpine.json" ? path.join(repo, "web/artifacts-alpine.json") : file);
    const type = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
      ".wasm": "application/wasm", ".json": "application/json", ".css": "text/css" }[path.extname(file)];
    response.writeHead(200, { "Content-Type": type || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" });
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = "http://127.0.0.1:" + server.address().port;
const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
const launchArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const browser = await chromium.launch({ headless: true, args: launchArgs,
  executablePath: process.env.E5_T22B_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
await mkdir(out, { recursive: true });
const results = [], errors = [];
function capture(page) {
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url.endsWith("/favicon.ico")) errors.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) errors.push(response.status() + " " + response.url());
  });
}
async function settled(page) {
  await page.waitForFunction(() => {
    const state = viewportDemo.viewport.snapshot();
    return state.accepted?.sequence === state.desired?.sequence && !state.inFlight && !state.timerPending;
  }, null, { timeout: 15000 });
}
// Independent RGBA oracle: source has R=x, G=y, B=x XOR y, not the page's colored fixture formula.
async function checkPixels(page, { sourceWidth = 641, sourceHeight = 481, partial = false, coalesced = false, label }) {
  return page.evaluate(async ({ sourceWidth, sourceHeight, partial, coalesced, label }) => {
    const { presentation: p, viewport: v } = viewportDemo;
    const pixels = new Uint32Array(sourceWidth * sourceHeight);
    for (let y = 0; y < sourceHeight; y++) for (let x = 0; x < sourceWidth; x++) {
      pixels[y * sourceWidth + x] = (0xff000000 | ((x & 255) << 16) | ((y & 255) << 8) | ((x ^ y) & 255)) >>> 0;
    }
    const frame = { resourceWidth: sourceWidth, resourceHeight: sourceHeight, pixels,
      rect: partial ? { x: sourceWidth - 1, y: sourceHeight - 1, width: 1, height: 1 }
        : { x: 0, y: 0, width: sourceWidth, height: sourceHeight } };
    p.present(frame);
    if (coalesced) p.present(frame);
    await new Promise(requestAnimationFrame);
    const state = p.snapshot(), actual = p.readPixels();
    let digest = 2166136261;
    for (let y = 0; y < state.height; y++) for (let x = 0; x < state.width; x++) {
      const row = state.backend === "webgl2" ? state.height - 1 - y : y;
      const offset = (row * state.width + x) * 4;
      const inside = x < sourceWidth && y < sourceHeight;
      const expected = inside ? [x % 256, y % 256, (x ^ y) & 255, 255] : [0, 0, 0, 255];
      for (let channel = 0; channel < 4; channel++) {
        if (actual[offset + channel] !== expected[channel]) throw new Error(label + " mismatch at " + [x, y, channel] +
          ": " + actual[offset + channel] + " != " + expected[channel]);
        digest = Math.imul((digest ^ actual[offset + channel]) >>> 0, 16777619) >>> 0;
      }
    }
    return { label, sourceWidth, sourceHeight, partial, coalesced, state, viewport: v.snapshot(),
      checkedBytes: actual.length, rgbaFnv1a: digest.toString(16) };
  }, { sourceWidth, sourceHeight, partial, coalesced, label });
}
try {
  for (const backend of ["canvas2d", "webgl2"]) for (const dpr of [1, 1.5, 2]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: dpr, serviceWorkers: "block" });
    const page = await context.newPage(); capture(page);
    const checks = [], modeStates = [];
    await page.goto(base + "/display-resize.html?backend=" + backend);
    await page.waitForFunction(() => viewportDemo.ready || viewportDemo.error, null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => viewportDemo.error ?? null), null);
    await settled(page);
    const initialPresentation = await page.evaluate(() => viewportDemo.presentation.snapshot());
    assert.equal(initialPresentation.backend, backend, JSON.stringify(initialPresentation));
    checks.push(await checkPixels(page, { label: "initial-native" }));
    for (const [width, height] of [[803, 603], [321, 241], [645, 485]]) {
      await page.locator("#viewport").evaluate((el, size) => {
        el.style.width = size[0] + "px"; el.style.height = size[1] + "px";
      }, [width, height]);
      await page.waitForFunction(({ width, height, dpr }) => {
        const mode = viewportDemo.viewport.snapshot().desired;
        return mode.width === Math.round(width * dpr) && mode.height === Math.round(height * dpr);
      }, { width, height, dpr });
      await settled(page);
      checks.push(await checkPixels(page, { label: "resize-" + width, partial: true }));
      const gpu = await page.evaluate(() => viewportDemo.displayStats());
      assert.equal(gpu.advertisedWidth, Math.round(width * dpr));
      assert.equal(gpu.advertisedHeight, Math.round(height * dpr));
      assert.equal(gpu.scanoutResource, null, "synthetic presentation must not fabricate a GPU resource");
      modeStates.push({ width, height, dpr, advertisedWidth: gpu.advertisedWidth, advertisedHeight: gpu.advertisedHeight });
    }
    const box = await page.locator("#viewport").boundingBox();
    await page.mouse.move(box.x + 80, box.y + 50);
    await page.waitForFunction(() => viewportDemo.pointerFrames.length > 0);
    const pointer = await page.evaluate(() => viewportDemo.pointerFrames.at(-1));
    assert.equal(pointer.events.find((event) => event.code === 0 && event.eventType === 3).value, Math.round(80 * dpr / 641 * 32767));
    assert.equal(pointer.events.find((event) => event.code === 1 && event.eventType === 3).value, Math.round(50 * dpr / 481 * 32767));
    const mode = await page.evaluate(() => viewportDemo.viewport.snapshot().desired);
    checks.push(await checkPixels(page, { sourceWidth: mode.width, sourceHeight: mode.height, partial: true, label: "matching-partial-first-frame" }));
    assert.equal(checks.at(-1).state.sizeMismatch, false);
    checks.push(await checkPixels(page, { label: "old-resource-before-coalesced-match", partial: true }));
    checks.push(await checkPixels(page, { sourceWidth: mode.width, sourceHeight: mode.height,
      partial: true, coalesced: true, label: "two-matching-partial-frames-before-raf" }));
    assert.equal(checks.at(-1).state.sizeMismatch, false);
    const cdp = await context.newCDPSession(page);
    const dprChanges = [];
    for (const nextDpr of [dpr + 0.5, dpr]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1200, deviceScaleFactor: nextDpr, mobile: false });
      try {
        await page.waitForFunction((next) => viewportDemo.viewport.snapshot().desired.dpr === next, nextDpr, { timeout: 5000 });
      } catch (error) {
        console.error("DPR diagnostic", await page.evaluate(() => ({ dpr: devicePixelRatio,
          media: viewportDemo.viewport._media.media, matches: viewportDemo.viewport._media.matches,
          viewport: viewportDemo.viewport.snapshot(), rect: document.getElementById("viewport").getBoundingClientRect().toJSON() })));
        throw error;
      }
      await settled(page);
      const state = await page.evaluate(() => ({ viewport: viewportDemo.viewport.snapshot(),
        css: [viewportDemo.presentation.canvas.style.width, viewportDemo.presentation.canvas.style.height] }));
      assert.equal(state.viewport.desired.width, Math.round(645 * nextDpr));
      assert.equal(state.viewport.desired.height, Math.round(485 * nextDpr));
      dprChanges.push(state);
      checks.push(await checkPixels(page, { label: "live-dpr-" + nextDpr }));
    }
    let storm = null;
    if (backend === "canvas2d" && dpr === 1) {
      storm = await page.evaluate(async () => {
        const before = viewportDemo.viewport.snapshot().requests;
        const started = performance.now(), samples = [];
        for (let index = 0; index < 50; index++) {
          const el = document.getElementById("viewport");
          el.style.width = (650 + index) + "px"; el.style.height = (490 + index) + "px";
          samples.push({ elapsedMs: performance.now() - started, width: 650 + index, height: 490 + index });
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return { before, samples, elapsedMs: performance.now() - started };
      });
      await settled(page);
      storm.after = await page.evaluate(() => viewportDemo.viewport.snapshot());
      assert.ok(storm.after.requests - storm.before <= 3, "real resize storm must debounce");
      assert.equal(storm.after.accepted.width, 699); assert.equal(storm.after.accepted.height, 539);
      checks.push(await checkPixels(page, { label: "storm-final" }));
    }
    let contextLoss = null;
    if (backend === "webgl2") {
      await page.evaluate(() => {
        viewportDemo.oldCanvas = viewportDemo.presentation.canvas;
        viewportDemo.presentation.backend.gl.getExtension("WEBGL_lose_context").loseContext();
      });
      await page.waitForFunction(() => viewportDemo.presentation.backendName === "canvas2d");
      contextLoss = await page.evaluate(() => ({ replaced: !viewportDemo.oldCanvas.isConnected,
        style: [viewportDemo.presentation.canvas.style.width, viewportDemo.presentation.canvas.style.height],
        state: viewportDemo.presentation.snapshot() }));
      assert.equal(contextLoss.replaced, true);
      assert.equal(contextLoss.state.listenerCount, 2);
      checks.push(await checkPixels(page, { label: "context-loss-mismatch" }));
    }
    const screenshotName = backend + "-dpr-" + dpr + ".png";
    const screenshot = await page.screenshot({ path: path.join(out, screenshotName) });
    const beforeDispose = await page.evaluate(() => viewportDemo.viewport.snapshot());
    await page.locator("#dispose").click();
    await page.waitForFunction(() => document.getElementById("dispose").disabled);
    await page.locator("#viewport").evaluate((el) => { el.style.width = "901px"; el.style.height = "701px"; });
    await page.waitForTimeout(350);
    const afterDispose = await page.evaluate(() => viewportDemo.viewport.snapshot());
    assert.equal(afterDispose.requests, beforeDispose.requests);
    assert.equal(afterDispose.disposed, true); assert.equal(afterDispose.timerPending, false);
    results.push({ backend, dpr, checks, modeStates, pointer, dprChanges, storm, contextLoss,
      afterDispose, screenshotName, screenshotSha256: sha(screenshot) });
    await context.close();
  }
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, serviceWorkers: "block" });
  capture(page);
  await page.goto(base + "/app.html?noAutoBoot=1");
  await page.waitForFunction(() => document.getElementById("suite-run")?.disabled === false, null, { timeout: 60000 });
  await page.locator("#suite-run").evaluate((el) => el.click());
  await page.waitForFunction(() => document.getElementById("metric-done")?.textContent.trim() === "126", null, { timeout: 120000 });
  const metrics = await page.evaluate(() => ["metric-pass", "metric-fail", "metric-done"].map((id) => document.getElementById(id).textContent.trim()));
  assert.deepEqual(metrics, ["126", "0", "126"]);
  const appViewport = await page.evaluate(() => window.__presentation.viewport());
  assert.ok(appViewport.desired.width >= 320 && appViewport.desired.height >= 240);
  await page.locator("#rm-search").fill("E5-T22b");
  await page.locator(".rm-g-label").filter({ hasText: "E5-T22b" }).click();
  const detail = await page.locator("#rm-detail").innerText();
  const demoImage = await page.screenshot({ path: path.join(out, "demo-suite.png") });
  // Exercise the real main-app ownership path with the same explicitly paused
  // eight-byte guest fixture, not a Linux desktop or a mocked controller.
  await page.route("**/artifacts.json", (route) => route.fulfill({ json: fixtureManifest }));
  await page.goto(base + "/app.html?noAutoBoot=1&testHooks=1&startPaused=1&jit=0");
  await page.waitForFunction(() => typeof window.wvmDemo?.runBusybox === "function");
  const appBoot = await page.evaluate(() => wvmDemo.runBusybox());
  assert.equal(appBoot.ok, true);
  await page.waitForFunction(() => {
    const state = __presentation.viewport();
    return state.accepted?.sequence === state.desired?.sequence && !state.inFlight;
  });
  const appOwnership = await page.evaluate(async () => ({ viewport: __presentation.viewport(),
    gpu: await wvmDemo.displayStats(), paused: await __linuxCtl.isPaused() }));
  assert.equal(appOwnership.paused, true);
  assert.equal(appOwnership.gpu.advertisedWidth, appOwnership.viewport.desired.width);
  assert.equal(appOwnership.gpu.advertisedHeight, appOwnership.viewport.desired.height);
  assert.equal(appOwnership.gpu.scanoutResource, null);
  await page.evaluate(async () => {
    const { stopLinuxController } = await import("./linux-worker-host.js");
    await stopLinuxController(window.__linuxCtl);
  });
  assert.deepEqual(errors, []);
  const files = ["web/src/sink/viewport.js", "web/src/sink/presentation.js", "web/src/sink/canvas2d.js",
    "web/src/sink/webgl.js", "web/display-resize.js", "web/display-resize.html", "web/main.js", "web/ide.js",
    "web/src/input/pointer.js", "web/dist/pkg/wasm_vm_wasm_bg.wasm", "tools/verify/e5-t22b-viewport.mjs"];
  const digests = Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha(await readFile(path.join(repo, file)))])));
  await writeFile(path.join(out, "viewport-proof.json"), JSON.stringify({
    schemaVersion: 1, head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    browser: browser.version(), launchArgs, digests, results, metrics, detail, appViewport,
    appOwnership, fixtureManifest, errors, demoScreenshotSha256: sha(demoImage),
  }, null, 2) + "\n");
  console.log(JSON.stringify({ cases: results.length, pixelChecks: results.reduce((sum, result) => sum + result.checks.length, 0), metrics, errors }));
} finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
