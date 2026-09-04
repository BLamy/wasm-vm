#!/usr/bin/env node
// E5-T06d: Chromium proof of runtime presentation selection and WebGL context-loss recovery.
// The page owns real Canvas2D/WebGL2 contexts; this harness owns the evidence envelope. WebKit and
// independent-machine runs are intentionally outside this task.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence", "e5-t06d");
const requestedBase = process.env.E5_T06D_BASE_URL?.replace(/\/$/, "") || null;
const requestedPort = Number(process.env.E5_T06D_PORT || 0);
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

async function runIntegration(browser, base, screenshotPath) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  const errors = { console: [], page: [], requests: [] };
  attachErrorCapture(page, errors);
  try {
    await page.goto(`${base}/bench/present-bench.html?integration=e5-t06d`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page.waitForFunction(() => window.presentBenchReady === true, null, { timeout: 30_000 });
    const observation = await page.evaluate(async () => {
      const { PresentationController } = await import("/src/sink/presentation.js");

      function fail(message) {
        throw new Error(`E5-T06d browser assertion: ${message}`);
      }

      function word(red, green, blue, alpha = 0xff) {
        return (((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0);
      }

      function makeFrame(width, height, seed) {
        const pixels = new Uint32Array(width * height);
        for (let index = 0; index < pixels.length; index += 1) {
          pixels[index] = word(
            (seed + index * 3) & 0xff,
            (seed * 5 + index * 7) & 0xff,
            (seed * 11 + index * 13) & 0xff,
          );
        }
        return {
          scanout: 0,
          rect: { x: 0, y: 0, width, height },
          resourceWidth: width,
          resourceHeight: height,
          pixels,
        };
      }

      function rgbaFor(words) {
        const rgba = new Uint8Array(words.length * 4);
        for (let index = 0; index < words.length; index += 1) {
          const value = words[index] >>> 0;
          const offset = index * 4;
          rgba[offset] = (value >>> 16) & 0xff;
          rgba[offset + 1] = (value >>> 8) & 0xff;
          rgba[offset + 2] = value & 0xff;
          rgba[offset + 3] = value >>> 24;
        }
        return rgba;
      }

      function assertPixels(actual, expected, label) {
        if (actual.length !== expected.length) fail(`${label} length ${actual.length} != ${expected.length}`);
        for (let index = 0; index < expected.length; index += 1) {
          if (actual[index] !== expected[index]) {
            fail(`${label} differs at byte ${index}: ${actual[index]} != ${expected[index]}`);
          }
        }
      }

      function makeCanvas(width, height) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.style.position = "fixed";
        canvas.style.left = "-10000px";
        canvas.style.top = "0";
        canvas.setAttribute("aria-hidden", "true");
        document.body.append(canvas);
        return canvas;
      }

      const defaultCanvas = makeCanvas(4, 3);
      const defaultController = new PresentationController(defaultCanvas);
      const defaultFrame = makeFrame(4, 3, 17);
      defaultController.present(defaultFrame);
      const defaultPartial = {
        ...defaultFrame,
        rect: { x: 1, y: 1, width: 2, height: 1 },
        pixels: new Uint32Array(defaultFrame.pixels),
      };
      defaultPartial.pixels[5] = word(0x11, 0x22, 0x33);
      defaultPartial.pixels[6] = word(0xaa, 0xbb, 0xcc);
      defaultController.present(defaultPartial);
      assertPixels(defaultController.readPixels(), rgbaFor(defaultPartial.pixels), "Canvas2D partial present");
      const defaultState = defaultController.snapshot();
      if (defaultState.backend !== "canvas2d") fail(`measured default was ${defaultState.backend}`);
      if (defaultState.successfulPresents !== 2) fail("Canvas2D did not accept full and partial presents");
      defaultController.dispose();
      defaultCanvas.remove();

      const unavailableCanvas = makeCanvas(2, 2);
      const nativeGetContext = unavailableCanvas.getContext.bind(unavailableCanvas);
      unavailableCanvas.getContext = (kind, attributes) => (
        kind === "webgl2" ? null : nativeGetContext(kind, attributes)
      );
      const unavailableController = new PresentationController(unavailableCanvas, {
        defaultBackend: "webgl2",
      });
      const unavailableFrame = makeFrame(2, 2, 31);
      unavailableController.present(unavailableFrame);
      assertPixels(
        unavailableController.readPixels(),
        rgbaFor(unavailableFrame.pixels),
        "feature-disabled Canvas2D fallback",
      );
      const unavailableState = unavailableController.snapshot();
      if (unavailableState.backend !== "canvas2d" || unavailableState.fallbacks !== 1) {
        fail(`feature-disabled fallback state was ${JSON.stringify(unavailableState)}`);
      }
      unavailableController.dispose();
      unavailableCanvas.remove();

      const lossCanvas = makeCanvas(4, 3);
      lossCanvas.style.position = "static";
      lossCanvas.style.left = "auto";
      lossCanvas.style.width = "320px";
      lossCanvas.style.height = "192px";
      lossCanvas.style.imageRendering = "pixelated";
      lossCanvas.removeAttribute("aria-hidden");
      const lossController = new PresentationController(lossCanvas, { defaultBackend: "webgl2" });
      if (lossController.backendName !== "webgl2") {
        fail(`Chromium could not create the WebGL2 proof backend (${lossController.backendName})`);
      }
      const loseContext = lossController.backend.gl.getExtension("WEBGL_lose_context");
      if (!loseContext) fail("WEBGL_lose_context extension is unavailable");
      const lossFrame = makeFrame(4, 3, 59);
      lossController.present(lossFrame);
      const latest = {
        ...lossFrame,
        rect: { x: 1, y: 1, width: 2, height: 1 },
        pixels: new Uint32Array(lossFrame.pixels),
      };
      latest.pixels[5] = word(0xde, 0xad, 0xbe);
      latest.pixels[6] = word(0xca, 0xfe, 0xba);
      lossController.present(latest);
      lossController.backend.gl.finish();
      const oldCanvas = lossController.canvas;
      loseContext.loseContext();
      for (let attempt = 0; attempt < 100 && lossController.backendName !== "canvas2d"; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const recoveredState = lossController.snapshot();
      if (lossController.backendName !== "canvas2d") fail("context loss did not select Canvas2D");
      if (lossController.canvas === oldCanvas) fail("context loss did not replace the WebGL canvas");
      if (recoveredState.contextLosses !== 1) fail(`expected one loss, got ${recoveredState.contextLosses}`);
      if (recoveredState.droppedFrames > 1) fail(`dropped ${recoveredState.droppedFrames} frames during recovery`);
      if (recoveredState.replayedFrames !== 1) fail(`expected one replay, got ${recoveredState.replayedFrames}`);
      assertPixels(lossController.readPixels(), rgbaFor(latest.pixels), "full replay after partial context loss");

      lossController.resize(5, 2);
      const resized = makeFrame(5, 2, 83);
      lossController.present(resized);
      assertPixels(lossController.readPixels(), rgbaFor(resized.pixels), "resize during recovered Canvas2D path");

      let lastRapid = null;
      for (let iteration = 0; iteration < 1_000; iteration += 1) {
        lastRapid = makeFrame(5, 2, iteration & 0xff);
        lossController.present(lastRapid);
      }
      const rapidState = lossController.snapshot();
      assertPixels(lossController.readPixels(), rgbaFor(lastRapid.pixels), "last rapid present");
      if (rapidState.framesReceived !== 1_003) fail(`expected 1003 frames, got ${rapidState.framesReceived}`);
      if (rapidState.droppedFrames > 1) fail(`rapid path dropped ${rapidState.droppedFrames} frames`);
      if (rapidState.listenerCount !== 2) fail(`listener count leaked during recovery: ${rapidState.listenerCount}`);
      const visibleCanvas = lossController.canvas;
      const visible = document.createElement("pre");
      visible.id = "e5-t06d-result";
      visible.textContent = JSON.stringify({
        default: defaultState,
        unavailable: unavailableState,
        recovered: recoveredState,
        rapid: rapidState,
      }, null, 2);
      document.body.append(visible);
      const result = {
        default: defaultState,
        unavailable: unavailableState,
        recovered: recoveredState,
        rapid: rapidState,
        visibleCanvas: { width: visibleCanvas.width, height: visibleCanvas.height },
      };
      lossController.dispose();
      if (lossController.snapshot().listenerCount !== 0) fail("dispose left context listeners attached");
      return result;
    });
    if (screenshotPath) {
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    assert.deepEqual(errors, { console: [], page: [], requests: [] },
      `browser errors occurred: ${JSON.stringify(errors)}`);
    return { observation, errors, screenshot: screenshotPath };
  } finally {
    await context.close();
  }
}

const result = {
  task: "E5-T06d",
  schema: 1,
  command: "node tools/verify/e5-t06d-present-integration.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  browser: null,
  sourceDistParity: null,
  integration: null,
  errors: { console: [], page: [], requests: [] },
};

for (const relative of [
  "src/sink/presentation.js",
  "src/sink/presentation.ts",
  "main.js",
  "loader.js",
  "linux-worker.js",
  "linux-worker-host.js",
  "linux-worker-protocol.js",
]) {
  const source = await fs.readFile(path.join(web, relative), "utf8");
  const dist = await fs.readFile(path.join(web, "dist", relative), "utf8");
  assert.equal(dist, source, `web/dist/${relative} is stale`);
}
result.sourceDistParity = { equal: true, files: [
  "web/src/sink/presentation.js",
  "web/src/sink/presentation.ts",
  "web/main.js",
  "web/loader.js",
  "web/linux-worker.js",
  "web/linux-worker-host.js",
  "web/linux-worker-protocol.js",
] };

const requestedChrome = process.env.E5_T06D_CHROME_PATH || null;
const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
const launchOptions = {
  headless: process.env.E5_T06D_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
};
if (requestedChrome) launchOptions.executablePath = requestedChrome;

let browser = null;
try {
  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: "Chromium",
    version: browser.version(),
    executablePath: requestedChrome || "Playwright Chromium",
  };
  const screenshotPath = outputPath ? path.join(evidenceDir, "presentation-integration.png") : null;
  const run = await runIntegration(browser, result.base, screenshotPath);
  result.integration = run.observation;
  result.errors = run.errors;
  result.screenshot = run.screenshot;
  assert.deepEqual(result.errors, { console: [], page: [], requests: [] },
    `browser errors occurred: ${JSON.stringify(result.errors)}`);
  const recovered = result.integration.recovered;
  const rapid = result.integration.rapid;
  assert.equal(recovered.backend, "canvas2d");
  assert.equal(recovered.contextLosses, 1);
  assert.ok(recovered.droppedFrames <= 1);
  assert.equal(recovered.replayedFrames, 1);
  assert.equal(rapid.framesReceived, 1_003);
  assert.ok(rapid.droppedFrames <= 1);
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
