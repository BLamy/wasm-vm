#!/usr/bin/env node

// E5-T15d: native cursorq and Chromium integration proof. The browser run composes the shipped
// cursor/presentation controllers and deliberately delays framebuffer callbacks while cursor MOVE
// events continue. Independent machines, WebKit, and host rr are outside this task's scope.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { inflateSync } from "node:zlib";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t15d");
const evidencePath = path.join(evidenceDir, "cursor-integration-2026-09-04.json");
const screenshotPath = path.join(evidenceDir, "cursor-integration-2026-09-04.png");
const requestedBase = process.env.E5_T15D_BASE_URL?.replace(/\/$/u, "") || null;
let port = Number(process.env.E5_T15D_PORT || 0);
let server = null;

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
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
      const response = await fetch(`${base}/cursor-integration.html`, { cache: "no-store" });
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

async function sourceDistParity() {
  const files = [
    "cursor-integration.html",
    "cursor-integration.js",
    "src/sink/cursor.js",
    "src/sink/cursor-controller.js",
    "src/sink/presentation.js",
    "src/sink/frame-scheduler.js",
  ];
  const hashes = [];
  for (const relative of files) {
    const source = await fs.readFile(path.join(web, relative));
    const dist = await fs.readFile(path.join(web, "dist", relative));
    assert.deepEqual(dist, source, `web/dist/${relative} is stale`);
    hashes.push({ source: `web/${relative}`, dist: `web/dist/${relative}`, sha256: sha256(source) });
  }
  return { equal: true, files: hashes };
}

function readU32Be(bytes, offset) {
  return bytes[offset] * 0x1_000_000
    + bytes[offset + 1] * 0x1_0000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

function crc32(bytes, start = 0, end = bytes.length) {
  let crc = 0xffff_ffff;
  for (let offset = start; offset < end; offset += 1) {
    crc ^= bytes[offset];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function decodeCursorPng(dataUrl) {
  assert.match(dataUrl, /^data:image\/png;base64,/);
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "cursor PNG signature",
  );
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  let ended = false;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, "cursor PNG chunk header is truncated");
    const length = readU32Be(bytes, offset);
    const typeStart = offset + 4;
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= bytes.length, "cursor PNG chunk is truncated");
    const type = bytes.toString("ascii", typeStart, dataStart);
    const expectedCrc = crc32(bytes, typeStart, dataEnd);
    assert.equal(readU32Be(bytes, dataEnd), expectedCrc, `${type} CRC`);
    if (type === "IHDR") {
      assert.equal(length, 13);
      width = readU32Be(bytes, dataStart);
      height = readU32Be(bytes, dataStart + 4);
      assert.equal(bytes[dataStart + 8], 8);
      assert.equal(bytes[dataStart + 9], 6);
      assert.equal(bytes[dataStart + 10], 0);
      assert.equal(bytes[dataStart + 11], 0);
      assert.equal(bytes[dataStart + 12], 0);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      assert.equal(length, 0);
      ended = true;
    }
    offset = dataEnd + 4;
    if (ended) break;
  }
  assert.equal(offset, bytes.length, "cursor PNG has trailing bytes");
  assert.equal(ended, true, "cursor PNG has no IEND");
  assert.ok(width > 0 && height > 0, "cursor PNG dimensions missing");
  const raw = inflateSync(Buffer.concat(idat));
  const rowBytes = width * 4;
  const filteredRowBytes = rowBytes + 1;
  assert.equal(raw.length, filteredRowBytes * height, "cursor PNG raw length");
  const rgba = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * filteredRowBytes;
    assert.equal(raw[rawOffset], 0, "cursor PNG uses filter None");
    rgba.set(raw.subarray(rawOffset + 1, rawOffset + filteredRowBytes), row * rowBytes);
  }
  return { bytes, width, height, rgba };
}

function expectedCursorRgba(width, height) {
  const output = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const checker = (x + y) % 2 === 0;
      const red = checker ? 0xe5 : 0x19;
      const green = checker ? 0x19 : 0xe5;
      const blue = x === 10 && y === 3 ? 0xff : 0x44;
      const alpha = ((x + y) % 4) === 0 ? 0 : ((x + y) % 4) === 1 ? 0x80 : 0xff;
      const offset = (y * width + x) * 4;
      output[offset] = red;
      output[offset + 1] = green;
      output[offset + 2] = blue;
      output[offset + 3] = alpha;
    }
  }
  return output;
}

function compareBytes(actual, expected) {
  assert.equal(actual.length, expected.length, "cursor RGBA lengths differ");
  let mismatchBytes = 0;
  let firstMismatch = -1;
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) {
      mismatchBytes += 1;
      if (firstMismatch < 0) firstMismatch = index;
    }
  }
  return { equal: mismatchBytes === 0, mismatchBytes, firstMismatch };
}

function runNativeProof() {
  const command = [
    "test", "-p", "wasm-vm-core", "--test", "virtio_gpu_machine",
    "gpu_cursor_plane_integration_preserves_pixels_and_transform_only_moves",
    "--", "--nocapture",
  ];
  const stdout = execFileSync("cargo", command, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  const marker = stdout.split("\n").find((line) => line.includes("E5T15D_NATIVE_PROOF"));
  assert.ok(marker, "native cursor proof marker missing");
  assert.match(marker, /updates=3/);
  assert.match(marker, /moves=500/);
  assert.match(marker, /oversized_pixels=65536/);
  assert.match(marker, /hidden_resource=0/);
  assert.match(marker, /used=503/);
  return {
    command: `cargo ${command.join(" ")}`,
    marker: marker.trim(),
    stdoutSha256: sha256(stdout),
  };
}

function assertBrowserProof(proof) {
  assert.equal(proof.schema, "wasm-vm.e5-t15d.cursor-integration.v1");
  assert.equal(proof.task, "E5-T15d");
  assert.equal(proof.route, "cursor-integration");
  assert.equal(proof.noTraffic.hostCursor, "");
  assert.equal(proof.noTraffic.overlays, 0);
  assert.equal(proof.asset.kind, "css");
  assert.deepEqual(
    [proof.asset.width, proof.asset.height, proof.asset.hotX, proof.asset.hotY],
    [64, 64, 10, 3],
  );
  assert.ok(proof.asset.dataUrlChars <= 350_006, "cursor CSS data URL exceeded bound");
  assert.equal(proof.movement.requested, 500);
  assert.equal(proof.movement.requestedHz, 500);
  assert.equal(proof.movement.layoutReads, 0);
  assert.equal(proof.movement.transformWrites, 500);
  assert.equal(proof.movement.finalTransform, "translate3d(609px, 576px, 0px)");
  assert.ok(proof.movement.movesDuringDelayedFrame > 0);
  assert.deepEqual(proof.movement.overlayBefore, proof.movement.overlayAfter);
  assert.equal(proof.delayedFrames.requested, 160);
  assert.equal(proof.delayedFrames.delivered, 160);
  assert.equal(proof.delayedFrames.maxPending > 0, true);
  assert.equal(proof.delayedFrames.delayedTimers, 0);
  assert.equal(proof.delayedFrames.presentation.scheduler.pending, 0);
  assert.equal(proof.delayedFrames.presentation.scheduler.scheduled, false);
  assert.equal(proof.delayedFrames.presentation.scheduler.maxPending, 1);
  assert.ok(proof.delayedFrames.presentation.scheduler.coalesced > 0);
  assert.ok(proof.delayedFrames.presentation.successfulPresents > 0);
  assert.equal(proof.oversized.kind, "overlay");
  assert.deepEqual(
    [proof.oversized.width, proof.oversized.height, proof.oversized.hotX, proof.oversized.hotY],
    [256, 256, 255, 255],
  );
  assert.ok(proof.oversized.dataUrlChars <= proof.oversized.maxDataUrlChars);
  assert.equal(proof.oversized.overlays, 1);
  assert.equal(proof.dpr2.transform, "translate3d(-175px, -195px, 0px)");
  assert.equal(proof.hidden.kind, "hidden");
  assert.equal(proof.hidden.resourceId, 0);
  assert.equal(proof.hidden.hostCursor, "");
  assert.equal(proof.hidden.overlays, 0);
  assert.equal(proof.diagnostics, 0);
}

const result = {
  schema: "wasm-vm.e5-t15d.cursor-integration-evidence.v1",
  task: "E5-T15d",
  command: "node tools/verify/e5-t15d-cursor-integration.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  browser: null,
  sourceDistParity: null,
  native: null,
  integration: null,
  independentReference: null,
  screenshot: null,
  errors: { console: [], page: [], requests: [] },
  scope: { independentMachines: false, webkit: false, hostRr: false },
};

let browser = null;
let context = null;
try {
  result.native = runNativeProof();
  result.sourceDistParity = await sourceDistParity();
  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;

  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright", "index.mjs")).href);
  const chromePath = process.env.E5_T15D_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const launchOptions = {
    headless: process.env.E5_T15D_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
  };
  try {
    await fs.access(chromePath);
    launchOptions.executablePath = chromePath;
  } catch {}
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: browser.browserType().name(),
    version: browser.version(),
    executablePath: launchOptions.executablePath || "Playwright Chromium",
  };
  context = await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  attachErrorCapture(page, result.errors);
  await page.goto(`${result.base}/cursor-integration.html?e5T15d=1`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForFunction(() => document.documentElement.dataset.e5T15dReady === "ready", null, {
    timeout: 30_000,
  });
  const proof = await page.evaluate(async () => await window.runE5T15dIntegration());
  assertBrowserProof(proof);

  const decoded = decodeCursorPng(proof.asset.assetDataUrl);
  const expected = expectedCursorRgba(64, 64);
  const reference = compareBytes(decoded.rgba, expected);
  assert.equal(reference.equal, true, `cursor PNG differs at byte ${reference.firstMismatch}`);
  result.independentReference = {
    dimensions: { width: decoded.width, height: decoded.height },
    hotspot: { x: 10, y: 3 },
    rgbaBytes: decoded.rgba.length,
    mismatchBytes: reference.mismatchBytes,
    pngBytes: decoded.bytes.length,
    pngSha256: sha256(decoded.bytes),
    dataUrlSha256: sha256(proof.asset.assetDataUrl),
    samples: {
      transparent: [...decoded.rgba.subarray(0, 4)],
      hotspot: [...decoded.rgba.subarray((3 * 64 + 10) * 4, (3 * 64 + 10) * 4 + 4)],
      final: [...decoded.rgba.subarray(decoded.rgba.length - 4)],
    },
  };
  const sanitized = JSON.parse(JSON.stringify(proof));
  delete sanitized.asset.assetDataUrl;
  result.integration = sanitized;
  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  result.screenshot = {
    path: "evidence/e5-t15d/cursor-integration-2026-09-04.png",
    sha256: sha256(await fs.readFile(screenshotPath)),
  };
  assert.deepEqual(result.errors, { console: [], page: [], requests: [] },
    `browser errors: ${JSON.stringify(result.errors)}`);
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopServer();
}
