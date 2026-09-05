#!/usr/bin/env node

// E5-T18a: local Chromium cold/warm desktop proof. The browser is the authority for the visible
// contract; the Node harness only provisions the exact T17 chunk store, captures browser errors,
// and binds the result to the read-only source image. WebKit, independent machines, and host rr
// are intentionally outside this task's boundary.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence/e5-t18a");
const evidencePath = path.join(evidenceDir, "desktop-cold-boot.json");
const transcriptPath = path.join(evidenceDir, "desktop-browser-console.log");
const screenshotPath = path.join(evidenceDir, "desktop-cold-boot.png");
const chunkDir = path.resolve(process.env.E5_T18A_DESKTOP_ASSET_DIR || "target/e5-t17c/chunks/desktop-b");
const chunkManifestPath = path.join(chunkDir, "manifest.json");
const imagePath = path.resolve(process.env.E5_T18A_IMAGE || "target/e5-t17c/repro-b/alpine-rootfs.ext4");
const expectedImageSha256 = "467306a5d842f95927c1f5823363271b55854517f6318576a6a137f5615a5c1e";
const expectedChunkManifestSha256 = "1be3c29945747184c3ed868f51add1829e97bfd3945f456d4676d5f035fb4827";
const expectedImageBytes = 1_073_741_824;
const expectedChunkSize = 128 * 1024;
const runCount = Number(process.env.E5_T18A_RUNS || 10);
const timeoutMs = Number(process.env.E5_T18A_TIMEOUT_MS || 900_000);
const requestedPort = Number(process.env.E5_T18A_PORT || 0);
const chromePath = process.env.E5_T18A_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

assert.ok(Number.isSafeInteger(runCount) && runCount >= 1 && runCount <= 25, "E5_T18A_RUNS must be 1..25");
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 30_000, "E5_T18A_TIMEOUT_MS is too small");

let server = null;
let port = requestedPort;
let browser = null;
let transcript = [];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function record(line) {
  transcript.push(line);
  void fs.appendFile(transcriptPath, line).catch(() => {});
}

async function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

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
  if (port === 0) port = await allocatePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    env: { ...process.env, E5_T18A_DESKTOP_ASSET_DIR: chunkDir },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => record(`server stdout: ${chunk.toString()}`));
  server.stderr.on("data", (chunk) => record(`server stderr: ${chunk.toString()}`));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/desktop.html`, { cache: "no-store" });
      const manifest = await fetch(`${base}/e5t18a-desktop/manifest.json`, { cache: "no-store" });
      if (response.ok && manifest.ok) return base;
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

function attachErrorCapture(page, errors, label) {
  page.on("console", (message) => {
    const location = message.location();
    record(`${label} console.${message.type()}: ${message.text()} @ ${location.url}:${location.lineNumber ?? 0}`);
    if (message.type() === "error" && !location.url.includes("/favicon.ico")) {
      errors.console.push({ text: message.text(), location });
    }
  });
  page.on("pageerror", (error) => {
    record(`${label} pageerror: ${error.message}`);
    errors.page.push(error.message);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/favicon.ico")) return;
    const failure = request.failure()?.errorText || "unknown";
    record(`${label} requestfailed: ${request.url()} — ${failure}`);
    errors.requests.push({ url: request.url(), failure });
  });
}

async function launchBrowser() {
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  const options = {
    headless: process.env.E5_T18A_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
  };
  try {
    await fs.access(chromePath);
    options.executablePath = chromePath;
  } catch {}
  browser = await chromium.launch(options);
  return {
    name: browser.browserType().name(),
    version: browser.version(),
    executablePath: options.executablePath || "Playwright Chromium",
  };
}

async function newContext(cacheDisabled) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled });
  return { context, page };
}

function assertBrowserProof(proof, label) {
  assert.ok(proof && typeof proof === "object", `${label}: desktop proof is missing`);
  assert.equal(proof.schema, "wasm-vm.e5-t18a.desktop-cold-boot.v1", `${label}: proof schema`);
  assert.equal(proof.task, "E5-T18a", `${label}: proof task`);
  assert.deepEqual(
    proof.readiness && {
      wallpaper: proof.readiness.wallpaper,
      panel: proof.readiness.panel?.ready,
      menu: proof.readiness.menu,
    },
    { wallpaper: true, panel: true, menu: true },
    `${label}: visual readiness markers`,
  );
  assert.deepEqual(proof.canvas, { width: 1280, height: 800 }, `${label}: canvas dimensions`);
  assert.equal(proof.selectedBackend, "canvas2d", `${label}: presentation backend`);
  assert.ok(proof.frameCount > 0, `${label}: no scanout frames presented`);
  assert.equal(proof.image.expectedSha256, expectedImageSha256, `${label}: image binding`);
  assert.equal(proof.image.manifestSha256, expectedChunkManifestSha256, `${label}: chunk manifest digest`);
  assert.equal(proof.image.imageLen, expectedImageBytes, `${label}: image length`);
  assert.equal(proof.image.chunkSize, expectedChunkSize, `${label}: chunk size`);
  assert.equal(proof.image.chunkCount, expectedImageBytes / expectedChunkSize, `${label}: chunk count`);
  assert.equal(proof.image.layout, "split", `${label}: chunk layout`);
  assert.ok(proof.fetchStats && proof.fetchStats.fetches > 0, `${label}: no published chunks were fetched`);
  assert.ok(proof.fetchStats.bytes > 0, `${label}: no published image bytes were fetched`);
  assert.deepEqual(proof.presentation?.errors, [], `${label}: presentation errors`);
  assert.equal(proof.paused, true, `${label}: readiness controller was not paused for proof readback`);
  assert.ok(Number.isSafeInteger(proof.bootToDesktopMs) && proof.bootToDesktopMs > 0, `${label}: timing`);
  return proof;
}

async function runPage(base, label, cacheDisabled, screenshot = false) {
  const errors = { console: [], page: [], requests: [] };
  const { context, page } = await newContext(cacheDisabled);
  attachErrorCapture(page, errors, label);
  const url = `${base}/desktop.html?e5T18a=1&jit=1&quantum=500000`;
  const startedAt = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => document.documentElement.dataset.desktopReady === "ready",
      null,
      { timeout: timeoutMs },
    );
    const proof = await page.evaluate(() => window.__desktopProof?.());
    assertBrowserProof(proof, label);
    assert.deepEqual(errors, { console: [], page: [], requests: [] }, `${label}: browser errors`);
    if (screenshot) await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      label,
      cacheDisabled,
      elapsedMs: Date.now() - startedAt,
      bootToDesktopMs: proof.bootToDesktopMs,
      fetchedChunks: proof.fetchStats.fetches,
      fetchedBytes: proof.fetchStats.bytes,
      stateDigest: proof.stateDigest,
      proof,
    };
  } catch (error) {
    let state = null;
    try {
      state = await page.evaluate(() => ({
        status: document.getElementById("desktop-status")?.textContent,
        ready: document.documentElement.dataset.desktopReady,
        inspection: window.__desktopLiveInspection?.() ?? null,
        proof: window.__desktopProof?.() ?? null,
      }));
    } catch {}
    await page.screenshot({ path: path.join(evidenceDir, `${label}-failure.png`), fullPage: true }).catch(() => {});
    error.message = `${label}: ${error.message}; state=${JSON.stringify(state)}; errors=${JSON.stringify(errors)}`;
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function runWarmPair(base) {
  const errors = { console: [], page: [], requests: [] };
  const { context, page } = await newContext(false);
  attachErrorCapture(page, errors, "warm");
  const run = async (label, reload) => {
    const startedAt = Date.now();
    if (reload) {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 60_000 });
    } else {
      await page.goto(`${base}/desktop.html?e5T18a=1&jit=1&quantum=500000`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await page.waitForFunction(
      () => document.documentElement.dataset.desktopReady === "ready",
      null,
      { timeout: timeoutMs },
    );
    const proof = await page.evaluate(() => window.__desktopProof?.());
    assertBrowserProof(proof, label);
    assert.deepEqual(errors, { console: [], page: [], requests: [] }, `${label}: browser errors`);
    return {
      label,
      cacheDisabled: false,
      elapsedMs: Date.now() - startedAt,
      bootToDesktopMs: proof.bootToDesktopMs,
      fetchedChunks: proof.fetchStats.fetches,
      fetchedBytes: proof.fetchStats.bytes,
      stateDigest: proof.stateDigest,
      proof,
    };
  };
  try {
    const prime = await run("warm-prime", false);
    const reload = await run("warm-reload", true);
    return { prime, reload };
  } finally {
    await context.close().catch(() => {});
  }
}

function summarizeTimings(runs) {
  const values = runs.map((run) => run.bootToDesktopMs);
  return {
    count: values.length,
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
    meanMs: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length),
    valuesMs: values,
  };
}

async function sourcePublication() {
  const [manifestBytes, imageStat] = await Promise.all([
    fs.readFile(chunkManifestPath),
    fs.stat(imagePath),
  ]);
  const manifestSha256 = sha256(manifestBytes);
  assert.equal(manifestSha256, expectedChunkManifestSha256, "T17 chunk manifest digest changed");
  assert.equal(imageStat.size, expectedImageBytes, "T17 desktop image size changed");
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, 1);
  assert.equal(manifest.layout, "split");
  assert.equal(manifest.image_len, expectedImageBytes);
  assert.equal(manifest.chunk_size, expectedChunkSize);
  assert.equal(manifest.chunks.length, expectedImageBytes / expectedChunkSize);
  return { manifest, manifestSha256, imageSize: imageStat.size };
}

async function sourceDistParity() {
  const files = ["desktop.html", "desktop.js"];
  const hashes = [];
  for (const relative of files) {
    const sourcePath = path.join(web, relative);
    const distPath = path.join(web, "dist", relative);
    const source = await fs.readFile(sourcePath);
    const dist = await fs.readFile(distPath);
    assert.deepEqual(dist, source, `web/dist/${relative} is stale`);
    hashes.push({ path: `web/${relative}`, sha256: sha256(source) });
  }
  return { equal: true, files: hashes };
}

async function main() {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.rm(transcriptPath, { force: true });
  assert.equal(await fs.stat(chunkManifestPath).then((value) => value.isFile()), true, "T17 chunk manifest missing");
  assert.equal(await fs.stat(imagePath).then((value) => value.isFile()), true, "T17 source image missing");
  const sourceBefore = await sha256File(imagePath);
  assert.equal(sourceBefore, expectedImageSha256, "T17 source image digest changed before browser boot");
  const publication = await sourcePublication();
  const base = await startServer();
  const browserInfo = await launchBrowser();
  const cold = [];
  let warm = null;
  try {
    for (let index = 0; index < runCount; index += 1) {
      const label = `cold-${String(index + 1).padStart(2, "0")}`;
      cold.push(await runPage(base, label, true, index === 0));
      console.log(`E5T18A_COLD_BOOT ${label} ${cold.at(-1).bootToDesktopMs}ms`);
    }
    // One cache-enabled reload pair records a real warm statistic without changing the required
    // ten fresh-context/cache-disabled acceptance loop. The second boot is the warm observation.
    const warmPair = await runWarmPair(base);
    warm = {
      prime: { bootToDesktopMs: warmPair.prime.bootToDesktopMs, fetchedBytes: warmPair.prime.fetchedBytes },
      reload: { bootToDesktopMs: warmPair.reload.bootToDesktopMs, fetchedBytes: warmPair.reload.fetchedBytes },
    };
  } finally {
    await browser?.close().catch(() => {});
    browser = null;
    await stopServer();
  }
  const sourceAfter = await sha256File(imagePath);
  assert.equal(sourceAfter, sourceBefore, "browser boot modified the read-only T17 source image");
  const dist = await sourceDistParity();
  const report = {
    schema: "wasm-vm.e5-t18a.desktop-cold-boot-evidence.v1",
    task: "E5-T18a",
    command: "make verify-E5-T18a",
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    image: {
      path: path.relative(repo, imagePath),
      sha256: sourceAfter,
      size: publication.imageSize,
      chunkManifest: path.relative(repo, chunkManifestPath),
      chunkManifestSha256: publication.manifestSha256,
      chunkSize: publication.manifest.chunk_size,
      chunkCount: publication.manifest.chunks.length,
    },
    browser: browserInfo,
    acceptance: { freshContexts: true, cacheDisabled: true, runCount, noSerialInput: true },
    timings: { cold: summarizeTimings(cold), warm },
    runs: cold.map(({ proof, ...run }) => run),
    screenshot: { path: path.relative(repo, screenshotPath), sha256: sha256(await fs.readFile(screenshotPath)) },
    sourceUnchanged: sourceAfter === sourceBefore,
    sourceDistParity: dist,
    transcript: { path: path.relative(repo, transcriptPath), sha256: sha256(Buffer.from(transcript.join(""))) },
    result: "passed",
  };
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(transcriptPath, transcript.join(""));
  await fs.writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv.includes("--self-test")) {
  const mutant = {
    schema: "wasm-vm.e5-t18a.desktop-cold-boot.v1",
    task: "E5-T18a",
    readiness: { wallpaper: true, panel: { ready: false }, menu: true },
    canvas: { width: 1280, height: 800 },
    selectedBackend: "canvas2d",
    frameCount: 1,
    image: {
      expectedSha256: expectedImageSha256,
      manifestSha256: expectedChunkManifestSha256,
      imageLen: expectedImageBytes,
      chunkSize: expectedChunkSize,
      chunkCount: expectedImageBytes / expectedChunkSize,
      layout: "split",
    },
    fetchStats: { fetches: 1, bytes: 1 },
    presentation: { errors: [] },
    paused: true,
    bootToDesktopMs: 1,
  };
  assert.throws(() => assertBrowserProof(mutant, "mutant"), /visual readiness markers/u);
  console.log("E5T18A_SELF_TEST=missing-panel-rejected");
} else {
  main().catch(async (error) => {
    await fs.mkdir(evidenceDir, { recursive: true });
    await fs.writeFile(transcriptPath, transcript.join(""));
    await browser?.close().catch(() => {});
    await stopServer().catch(() => {});
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}
