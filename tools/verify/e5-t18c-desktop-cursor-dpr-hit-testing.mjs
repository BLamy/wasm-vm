#!/usr/bin/env node

// E5-T18c: local Chromium proof of CSS-to-guest cursor alignment and Weston window-control
// hit-testing at DPR 1 and 2. The T18b desktop image is reused unchanged; WebKit, independent
// machines, and host rr are intentionally outside this task's scope.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const cli = path.resolve(process.env.E5_T18C_CLI || path.join(repo, "target/release/wasm-vm"));
const evidenceDir = path.join(repo, "evidence/e5-t18c");
const evidencePath = path.join(evidenceDir, "desktop-cursor-dpr-hit-testing.json");
const transcriptPath = path.join(evidenceDir, "desktop-cursor-browser-console.log");
const imagePath = path.resolve(process.env.E5_T18C_IMAGE || "target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4");
const imageDir = path.dirname(imagePath);
const chunkDir = path.resolve(process.env.E5_T18C_DESKTOP_ASSET_DIR || "target/e5-t18b/chunks/desktop-v6");
const chunkManifestPath = path.join(chunkDir, "manifest.json");
const packageManifestPath = path.join(imageDir, "MANIFEST.txt");
const fileManifestPath = path.join(imageDir, "FILE-MANIFEST.txt");
const expectedImageSha256 = "08bb8227fe0180ed06e5a01188e4a0fe3b21565ba83dcc2c1df632ca413172be";
const expectedChunkManifestSha256 = "2e92778fe0e6c5bd0819034bda28d235307cf7ab8f031cd30e1854f96982a6c0";
const expectedPackageManifestSha256 = "ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908";
const expectedFileManifestSha256 = "0155d794fa136a4653e76ae76f9c01233d9175f0ef56a9e9eb2565074985e0ad";
const expectedTerminalDigest = "0b83d0269abcbae3208229681be17fd05630c4029882517c4c2f51946ffba9fe";
const expectedImageBytes = 1_073_741_824;
const expectedChunkSize = 128 * 1024;
const expectedChunkCount = expectedImageBytes / expectedChunkSize;
const timeoutMs = Number(process.env.E5_T18C_TIMEOUT_MS || 900_000);
const requestedPort = Number(process.env.E5_T18C_PORT || 0);
const chromePath = process.env.E5_T18C_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const execFile = promisify(execFileCallback);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const SHA256 = /^[0-9a-f]{64}$/u;

assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 30_000, "E5_T18C_TIMEOUT_MS is too small");

let server = null;
let browser = null;
let port = requestedPort;
const transcript = [];

function record(line) {
  transcript.push(line.endsWith("\n") ? line : `${line}\n`);
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

async function validatePublication() {
  const [imageStat, imageSha256, manifestBytes, packageManifestBytes, fileManifestBytes] = await Promise.all([
    fs.stat(imagePath),
    sha256File(imagePath),
    fs.readFile(chunkManifestPath),
    fs.readFile(packageManifestPath),
    fs.readFile(fileManifestPath),
  ]);
  assert.equal(imageStat.size, expectedImageBytes, "desktop image size changed");
  assert.equal(imageSha256, expectedImageSha256, "desktop image digest changed");
  assert.equal(sha256(manifestBytes), expectedChunkManifestSha256, "desktop chunk manifest digest changed");
  assert.equal(sha256(packageManifestBytes), expectedPackageManifestSha256, "package manifest digest changed");
  assert.equal(sha256(fileManifestBytes), expectedFileManifestSha256, "file manifest digest changed");
  assert.match(
    fileManifestBytes.toString("utf8"),
    new RegExp(`${expectedTerminalDigest} 0755 /usr/bin/weston-terminal`, "u"),
    "launcher target is absent or not executable in the image file manifest",
  );
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.version, 1, "chunk manifest version");
  assert.equal(manifest.image_len, expectedImageBytes, "chunk manifest image length");
  assert.equal(manifest.chunk_size, expectedChunkSize, "chunk manifest chunk size");
  assert.equal(manifest.layout, "split", "chunk manifest layout");
  assert.equal(manifest.chunks.length, expectedChunkCount, "chunk manifest count");
  assert.ok(manifest.chunks.every((hash) => SHA256.test(hash)), "chunk manifest contains malformed hashes");
  const distinctChunks = new Set(manifest.chunks);
  assert.equal(distinctChunks.size, 823, "unexpected distinct chunk-object count");
  const chunkVerify = await execFile(cli, ["chunk-verify", chunkDir], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
  assert.match(chunkVerify.stdout, /chunk-verify: OK/u, "chunk-verify did not pass");
  return {
    image: { path: path.relative(repo, imagePath), sha256: imageSha256, size: imageStat.size },
    packageManifest: { path: path.relative(repo, packageManifestPath), sha256: sha256(packageManifestBytes) },
    fileManifest: { path: path.relative(repo, fileManifestPath), sha256: sha256(fileManifestBytes), terminalDigest: expectedTerminalDigest },
    chunkManifest: {
      path: path.relative(repo, chunkManifestPath),
      sha256: sha256(manifestBytes),
      imageLen: manifest.image_len,
      chunkSize: manifest.chunk_size,
      chunkCount: manifest.chunks.length,
      distinctChunks: distinctChunks.size,
      layout: manifest.layout,
      chunkVerify: chunkVerify.stdout.trim(),
    },
  };
}

async function startServer() {
  if (port === 0) port = await allocatePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    env: { ...process.env, E5_T18B_DESKTOP_ASSET_DIR: chunkDir },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout.on("data", (chunk) => record(`server stdout: ${chunk.toString()}`));
  server.stderr.on("data", (chunk) => record(`server stderr: ${chunk.toString()}`));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const page = await fetch(`${base}/desktop-cursor.html`, { cache: "no-store" });
      const manifest = await fetch(`${base}/e5t18b-desktop/manifest.json`, { cache: "no-store" });
      const forbidden = await fetch(`${base}/e5t18b-desktop/not-a-chunk.txt`, { cache: "no-store" });
      assert.equal(page.ok, true, "desktop cursor page did not load");
      assert.equal(manifest.ok, true, "T18b desktop asset manifest did not load");
      assert.equal(forbidden.status, 404, "closed desktop asset route exposed an arbitrary path");
      assert.match(manifest.headers.get("cache-control") || "", /immutable/u, "desktop assets are not immutable-cached");
      return base;
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
      errors.console.push({ text: message.text(), url: location.url, line: location.lineNumber ?? 0 });
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
    headless: process.env.E5_T18C_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--disable-gpu"],
  };
  if (process.env.E5_T18C_DEBUG_PORT) options.args.push(`--remote-debugging-port=${Number(process.env.E5_T18C_DEBUG_PORT)}`);
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

async function waitForPointerFrames(page, minimum) {
  await page.waitForFunction(
    (count) => window.__desktopTerminal?.state?.().pointerFrames >= count,
    minimum,
    { timeout: 30_000 },
  );
}

async function clickGuest(page, box, x, y) {
  await page.mouse.move(box.x + (x / 1280) * box.width, box.y + (y / 800) * box.height);
  await page.waitForTimeout(1_000);
  await page.mouse.down();
  await page.mouse.up();
}

async function openAndFocus(page, box, label) {
  console.log(label + ': opening terminal');
  await page.evaluate((value) => window.__desktopTerminal.beginLaunch(value), label + '-launch');
  await clickGuest(page, box, 24, 16);
  await page.waitForFunction(
    () => window.__desktopTerminal?.state?.().active?.launch?.terminalRendered === true,
    null, { timeout: 240_000 },
  );
  await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  await page.evaluate((value) => window.__desktopTerminal.beginFocus(value), label + '-focus');
  const pointerStart = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const focusHandle = await page.waitForFunction(
    () => window.__desktopCursor.focusGuestPoint(), null, { timeout: 30_000 },
  );
  const focusGuest = await focusHandle.jsonValue();
  await focusHandle.dispose();
  await clickGuest(page, box, focusGuest.x, focusGuest.y);
  await waitForPointerFrames(page, pointerStart + 3);
  await page.waitForTimeout(2_000);
  const focus = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  assert.equal(focus.focuses.at(-1).accepted, true, label + ': terminal focus was not established');
}

async function controlClientPoint(page, control) {
  return page.evaluate((value) => window.__desktopCursor.mappingForControl(value).client, control);
}

async function hoverControl(page, control, label) {
  await page.evaluate(({ control: value, label: name }) => window.__desktopCursor.startHover(value, name), { control, label });
  const pointerStart = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const client = await controlClientPoint(page, control);
  await page.mouse.move(client.x, client.y);
  await waitForPointerFrames(page, pointerStart + 1);
  await page.waitForFunction((control) => {
    const cursor = window.__desktopCursor.renderedCursor(control);
    return cursor?.x === control.x && cursor?.y === control.y && window.__desktopCursor.hoverHighlights()
      .filter((entry) => entry.highlighted).map((entry) => entry.name).join() === control.name;
  }, control, { timeout: 30_000 });
  const hover = await page.evaluate(() => window.__desktopCursor.finishHover());
  assert.equal(hover.hovers.at(-1).accepted, true, `${label}: hover was not aligned`);
  const capture = path.join(evidenceDir, `${label}.png`);
  await page.locator("#desktop-canvas").screenshot({ path: capture });
  hover.hovers.at(-1).screenshot = { path: path.relative(repo, capture), sha256: sha256(await fs.readFile(capture)) };
  return hover.hovers.at(-1);
}

async function boundaryMatrix(page, chrome, label) {
  const entries = [];
  for (const control of chrome.controls.filter((c) => c.name !== "minimize")) {
    const points = [
      { edge: "left-outside", x: control.left - 1, y: control.y },
      { edge: "left-inside", x: control.left, y: control.y },
      { edge: "right-inside", x: control.right - 1, y: control.y },
      { edge: "right-outside", x: control.right, y: control.y },
      { edge: "top-outside", x: control.x, y: control.top - 1 },
      { edge: "top-inside", x: control.x, y: control.top },
      { edge: "bottom-inside", x: control.x, y: control.bottom - 1 },
      { edge: "bottom-outside", x: control.x, y: control.bottom },
    ];
    for (const point of points) {
      if (point.x < 0 || point.x >= 1280 || point.y < 0 || point.y >= 800) {
        entries.push({ control: control.name, point, skipped: "outside guest viewport; no adjacent guest control" });
        continue;
      }
      const expected = chrome.controls.find((c) => point.x >= c.left && point.x < c.right && point.y >= c.top && point.y < c.bottom)?.name || null;
      record(`${label} boundary prediction: ${JSON.stringify({ control: control.name, point, expected })}`);
      const mapping = await page.evaluate((point) => window.__desktopCursor.mappingForControl(point), point);
      const before = await page.evaluate(() => window.__desktopTerminal.state());
      await page.mouse.move(mapping.client.x, mapping.client.y);
      await waitForPointerFrames(page, before.pointerFrames + 1);
      await page.waitForFunction((count) => window.__desktopTerminal.state().frameCount > count, before.frameCount, { timeout: 30_000 });
      await page.waitForTimeout(1_000);
      await page.waitForFunction(({ chrome, expected }) => {
        const active = window.__desktopCursor.hoverHighlights(chrome).filter((c) => c.highlighted).map((c) => c.name);
        return active.join() === (expected || "");
      }, { chrome, expected }, { timeout: 120_000, polling: 500 }).catch((error) => {
        error.message += `; ${label} ${control.name}/${point.edge} at (${point.x},${point.y}), expected ${expected}`;
        throw error;
      });
      const observed = await page.evaluate((chrome) => ({
        highlights: window.__desktopCursor.hoverHighlights(chrome),
        frame: [...window.__desktopTerminal.state().pointerFrameSample].reverse().find((f) => f.source === "pointermove"),
        window: window.__desktopCursor.detectWindowChrome()?.window,
      }), chrome);
      assert.deepEqual(observed.frame.coordinates, mapping.tablet, `${label}: ${control.name}/${point.edge} transport offset`);
      assert.deepEqual(observed.window, chrome.window, `${label}: boundary hover changed the window`);
      assert.deepEqual(observed.highlights.filter((c) => c.highlighted).map((c) => c.name), expected ? [expected] : [], `${label}: adjacent control hover`);
      entries.push({ control: control.name, point, expected, mapping, ...observed, accepted: true });
      record(`${label} boundary observed: ${JSON.stringify(entries.at(-1))}`);
    }
  }
  const outsidePresses = [];
  for (const control of chrome.controls.filter((c) => c.name !== "minimize")) {
    for (const y of [control.top - 1, control.bottom]) {
      const point = { ...control, y };
      const delivery = await pressControl(page, point, `${label}-outside-${control.name}-${y}`);
      const progress = await guestProgress(page, 20_000_000);
      const after = await page.evaluate(() => window.__desktopCursor.detectWindowChrome()?.window);
      assert.deepEqual(after, chrome.window, `${label}: outside-boundary press activated a window control`);
      outsidePresses.push({ control: control.name, point: { x: point.x, y }, delivery, ...progress, afterWindow: after, accepted: true });
    }
  }
  console.log(`${label}: ${entries.filter((e) => e.accepted).length} adjacent hover probes and 4 outside presses passed`);
  return { label, window: chrome.window, entries, outsidePresses };
}

async function guestProgress(page, minimum) {
  return waitForRetiredInstructions(() => page.evaluate(() => window.__desktopController.schedulerStats()), minimum);
}

async function waitForRetiredInstructions(read, minimum, { timeoutMs = 120_000, pollingMs = 500 } = {}) {
  // The pinned Playwright 1.49 treats a Promise returned by waitForFunction as truthy even
  // when it resolves false. Await each RPC in Node and compare actual counters explicitly.
  const before = (await read()).retiredInstructions;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const retired = (await read()).retiredInstructions - before;
    if (retired >= minimum) return { before, after: before + retired, retiredInstructions: retired };
    await sleep(pollingMs);
  }
  throw new Error(`guest did not retire ${minimum} instructions within ${timeoutMs}ms`);
}

async function switchWindow(page) {
  // Weston uses Super+Tab. The DOM intentionally reserves Meta shortcuts for the browser, so
  // this independent hidden-window probe uses the public guest keyboard transport explicitly.
  const keys = [[125, 1], [15, 1], [15, 0], [125, 0]];
  await page.evaluate(async (keys) => {
    for (const [code, value] of keys) {
      await window.__desktopController.sendKeyboardEvent(1, code, value);
      await window.__desktopController.syncKeyboard();
    }
  }, keys);
  return keys;
}

async function minimizeNegativeControl(page, chrome, label) {
  const min = chrome.controls.find((c) => c.name === "minimize");
  const delivery = await pressControl(page, min, `${label}-minimize-negative-control`);
  await page.waitForFunction(() => window.__desktopCursor.detectWindowChrome() === null, null, { timeout: 30_000 });
  const keys = await switchWindow(page);
  const progress = await guestProgress(page, 100_000_000);
  const restored = await page.evaluate(() => window.__desktopCursor.detectWindowChrome()?.window);
  assert.deepEqual(restored, chrome.window, `${label}: minimized window did not restore through the switcher`);
  return { keys, delivery, ...progress, beforeWindow: chrome.window, restoredWindow: restored, windowRestored: true, accepted: true };
}

function assertPointerPress(frames, tablet, label) {
  assert.equal(frames.length, 3, `${label}: missing move/make/break frames`);
  assert.equal(frames[0].device, "tablet", `${label}: move device`);
  assert.equal(frames[0].source, "pointermove", `${label}: move source`);
  assert.deepEqual(frames[0].coordinates, tablet, `${label}: pointer coordinate delivery`);
  for (const [index, value] of [[1, 1], [2, 0]]) {
    assert.equal(frames[index].device, "mouse", `${label}: button device`);
    assert.equal(frames[index].mode, "absolute", `${label}: button mode`);
    assert.deepEqual(frames[index].events, [{ eventType: 1, code: 272, value }], `${label}: mouse make/break delivery`);
  }
}

async function pressControl(page, control, label) {
  const pointerStart = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const mapping = await page.evaluate((control) => window.__desktopCursor.mappingForControl(control), control);
  await page.mouse.move(mapping.client.x, mapping.client.y);
  await waitForPointerFrames(page, pointerStart + 1);
  await page.waitForTimeout(1_000);
  await page.mouse.down();
  await page.mouse.up();
  await waitForPointerFrames(page, pointerStart + 3);
  const frames = await page.evaluate((start) => window.__desktopTerminal.state().pointerFrameSample.filter((f) => f.sequence > start), pointerStart);
  assertPointerPress(frames, mapping.tablet, label);
  assert.deepEqual(await page.evaluate(() => window.__desktopTerminal.pointerState().heldButtons), [], `${label}: stranded button`);
  return { mapping, frames, accepted: true };
}

async function clickControl(page, control, name, label, restoreBudget = 100_000_000) {
  await page.evaluate(({ name, control }) => window.__desktopCursor.startButton(name, control), { name, control });
  const delivery = await pressControl(page, control, `${label}-${name}`);
  await page.waitForFunction((name) => {
    const chrome = window.__desktopCursor.detectWindowChrome();
    return name === 'close' ? chrome === null : chrome?.window.left === 0 &&
      chrome.window.top === 32 && chrome.window.right === 1280 && chrome.window.bottom === 800;
  }, name, { timeout: 30_000 });
  let closeProbe = null;
  if (name === "close") {
    const keys = await switchWindow(page);
    const progress = await guestProgress(page, restoreBudget);
    const restored = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
    assert.equal(restored, null, `${label}: close merely minimized a still-restorable window`);
    closeProbe = { keys, ...progress, requiredInstructions: restoreBudget, windowRestored: false };
  }
  const result = await page.evaluate((probe) => window.__desktopCursor.finishButton(probe), closeProbe);
  const entry = name === 'maximize' ? result.maximizes.at(-1) : result.closes.at(-1);
  entry.delivery = delivery;
  assert.equal(entry.accepted, true, label + ': ' + name + ' did not hit the intended window');
  console.log(label + ': ' + name + ' passed');
  return entry;
}

function assertProof(proof, dpr, image, label) {
  assert.ok(proof && typeof proof === "object", `${label}: proof is missing`);
  assert.equal(proof.schema, "wasm-vm.e5-t18c.desktop-cursor-dpr-hit-testing.v1", `${label}: proof schema`);
  assert.equal(proof.task, "E5-T18c", `${label}: proof task`);
  assert.equal(proof.route, "desktop-cursor", `${label}: proof route`);
  assert.deepEqual(proof.scope, { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false }, `${label}: scope`);
  assert.equal(proof.devicePixelRatio, dpr, `${label}: devicePixelRatio`);
  assert.deepEqual({ width: proof.canvas.width, height: proof.canvas.height }, { width: 1280, height: 800 }, `${label}: backing canvas`);
  assert.ok(proof.canvas.cssRect.width > 1_000 && proof.canvas.cssRect.height > 600, `${label}: CSS canvas size`);
  assert.ok(proof.fetchStats?.fetches > 0 && proof.fetchStats?.bytes > 0, `${label}: no published chunks fetched`);
  assert.equal(proof.paused, true, `${label}: final state was not paused`);
  assert.equal(proof.error, null, `${label}: route reported an error`);
  assert.equal(proof.pointer?.mode, "absolute", `${label}: pointer did not finish in absolute mode`);
  assert.deepEqual(proof.pointer?.heldButtons, [], `${label}: pointer stranded a button`);
  assert.equal(proof.hovers.length, 4, `${label}: hover count`);
  assert.equal(proof.maximizes.length, 2, `${label}: maximize count`);
  assert.equal(proof.closes.length, 2, `${label}: close count`);
  assert.ok(proof.hovers.every((entry) => entry.accepted && entry.mappingMatches && entry.guestPixelMatches && entry.highlightMatches && entry.cursorMatches &&
    entry.renderedCursor?.x === entry.control.x && entry.renderedCursor?.y === entry.control.y), `${label}: hover evidence`);
  assert.ok(proof.maximizes.every((entry) => entry.accepted && entry.mappingMatches && entry.guestPixelMatches && entry.windowMaximized), `${label}: maximize evidence`);
  assert.ok(proof.closes.every((entry) => entry.accepted && entry.mappingMatches && entry.guestPixelMatches && entry.windowClosed &&
    entry.closeProbe?.windowRestored === false && entry.closeProbe.retiredInstructions >= 100_000_000), `${label}: close evidence`);
  assert.deepEqual(proof.pointer?.diagnostics || [], [], `${label}: pointer diagnostics`);
  assert.equal(proof.maximizes[1].beforeChrome?.window?.left >= 0, true, `${label}: second maximize lacked an active window`);
  assert.equal(proof.closes[1].beforeChrome?.window?.left >= 0, true, `${label}: second close lacked an active window`);
  assert.equal(proof.maximizes[0].frameCoordinates?.x, proof.maximizes[0].mapping.tablet.x, `${label}: maximize x mapping`);
  assert.equal(proof.maximizes[0].frameCoordinates?.y, proof.maximizes[0].mapping.tablet.y, `${label}: maximize y mapping`);
  assert.equal(proof.image?.expectedSha256, image.image.sha256, `${label}: image binding`);
  assert.match(proof.stateDigest || "", SHA256, `${label}: guest state digest`);
  return proof;
}

async function runDpr(base, image, dpr, browserInfo, repetition) {
  const label = `DPR-${dpr}-run-${repetition}`;
  const errors = { console: [], page: [], requests: [] };
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: dpr,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  attachErrorCapture(page, errors, label);
  const startedAt = Date.now();
  const screenshotPath = path.join(evidenceDir, `desktop-cursor-dpr-${dpr}-run-${repetition}.png`);
  try {
    const url = `${base}/desktop-cursor.html?e5t18c=1&jit=1&quantum=500000&imageSha256=${image.image.sha256}&manifestSha256=${image.chunkManifest.sha256}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    console.log(`${label}: booting guest`);
    await page.waitForFunction(() => document.documentElement.dataset.desktopReady === "ready", null, { timeout: timeoutMs });
    await page.waitForTimeout(2_000);
    await page.evaluate(() => { document.getElementById("desktop-canvas").style.transform = "translate(0.25px, 0.5px)"; });
    const canvas = page.locator("#desktop-canvas");
    const box = await canvas.boundingBox();
    assert.ok(box && box.width >= 1_000 && box.height >= 600, `${label}: canvas did not render at usable size`);
    assert.equal(await page.evaluate(() => window.devicePixelRatio), dpr, `${label}: browser DPR mismatch`);

    const cycleProofs = [];
    for (let cycle = 1; cycle <= 2; cycle += 1) {
      await openAndFocus(page, box, `${label}-cycle-${cycle}`);
      const initialChrome = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
      assert.ok(initialChrome?.controls?.length === 3, `${label}-cycle-${cycle}: Weston controls not detected`);
      const maximize = initialChrome.controls.find((control) => control.name === "maximize");
      const close = initialChrome.controls.find((control) => control.name === "close");
      assert.ok(maximize && close, `${label}-cycle-${cycle}: required controls missing`);
      const minimizeProbe = await minimizeNegativeControl(page, initialChrome, `${label}-cycle-${cycle}`);
      const initialBoundary = await boundaryMatrix(page, initialChrome, `${label}-cycle-${cycle}-initial`);
      const maximizeHover = await hoverControl(page, maximize, `${label}-cycle-${cycle}-maximize-hover`);
      const maximizeCorner = { ...maximize, x: cycle === 1 ? maximize.left : maximize.right - 1,
        y: cycle === 1 ? maximize.top : maximize.bottom - 1 };
      const maximized = await clickControl(page, maximizeCorner, "maximize", `${label}-cycle-${cycle}`);
      const afterMaxChrome = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
      assert.ok(afterMaxChrome?.controls?.length === 3, `${label}-cycle-${cycle}: maximized controls not detected`);
      const maxClose = afterMaxChrome.controls.find((control) => control.name === "close");
      assert.ok(maxClose, `${label}-cycle-${cycle}: maximized close control missing`);
      const maximizedBoundary = await boundaryMatrix(page, afterMaxChrome, `${label}-cycle-${cycle}-maximized`);
      const closeHover = await hoverControl(page, maxClose, `${label}-cycle-${cycle}-close-hover`);
      const closeCorner = { ...maxClose, x: cycle === 1 ? maxClose.right - 1 : maxClose.left,
        y: cycle === 1 ? maxClose.top : maxClose.bottom - 1 };
      const closed = await clickControl(page, closeCorner, "close", `${label}-cycle-${cycle}`, minimizeProbe.retiredInstructions);
      assert.ok(closed.closeProbe.retiredInstructions >= minimizeProbe.retiredInstructions, `${label}: close restore budget was shorter than positive control`);
      cycleProofs.push({ initialChrome, minimizeProbe, initialBoundary, maximizeHover, maximized, afterMaxChrome, maximizedBoundary, closeHover, closed });
    }

    const proof = await page.evaluate(() => window.__desktopCursor.finishProof());
    proof.image = {
      expectedSha256: image.image.sha256,
      manifestSha256: image.chunkManifest.sha256,
    };
    assertProof(proof, dpr, image, label);
    assert.deepEqual(errors, { console: [], page: [], requests: [] }, `${label}: browser errors`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      dpr,
      repetition,
      browser: browserInfo,
      elapsedMs: Date.now() - startedAt,
      screenshot: { path: path.relative(repo, screenshotPath), sha256: sha256(await fs.readFile(screenshotPath)) },
      cycles: cycleProofs,
      proof,
      errors,
    };
  } catch (error) {
    let state = null;
    try {
      state = await page.evaluate(() => ({
        status: document.getElementById("desktop-status")?.textContent,
        desktopReady: document.documentElement.dataset.desktopReady,
        cursorReady: document.documentElement.dataset.desktopCursorReady,
        cursor: window.__desktopCursor?.state?.() || null,
        terminal: window.__desktopTerminal?.state?.() || null,
      }));
    } catch {}
    record(`${label} failure state: ${JSON.stringify(state)}`);
    await page.screenshot({ path: path.join(evidenceDir, `desktop-cursor-dpr-${dpr}-failure.png`), fullPage: true }).catch(() => {});
    const failureStatePath = path.join(evidenceDir, `desktop-cursor-dpr-${dpr}-failure.json`);
    await fs.writeFile(failureStatePath, `${JSON.stringify({ state, errors }, null, 2)}\n`);
    error.message = `${error.message}; details=${path.relative(repo, failureStatePath)}`;
    if (process.env.E5_T18C_DEBUG_PORT) {
      console.error(`${label}: diagnostic browser retained for five minutes on port ${process.env.E5_T18C_DEBUG_PORT}: ${error.message}`);
      await page.waitForTimeout(300_000);
    }
    throw error;
  } finally {
    await context.close().catch(() => {});
  }
}

async function assertSelfTestMutant() {
  const base = {
    schema: "wasm-vm.e5-t18c.desktop-cursor-dpr-hit-testing.v1",
    task: "E5-T18c",
    route: "desktop-cursor",
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    devicePixelRatio: 2,
    canvas: { width: 1280, height: 800, cssRect: { left: 1, top: 2, width: 1280, height: 800 } },
    fetchStats: { fetches: 1, bytes: 1 },
    paused: true,
    error: null,
    pointer: { mode: "absolute", heldButtons: [], diagnostics: [] },
    hovers: Array.from({ length: 4 }, () => ({ accepted: true, mappingMatches: true, guestPixelMatches: true, highlightMatches: true,
      cursorMatches: true, control: { x: 1, y: 2 }, renderedCursor: { x: 1, y: 2 } })),
    maximizes: Array.from({ length: 2 }, () => ({ accepted: true, mappingMatches: true, guestPixelMatches: true, windowMaximized: true, beforeChrome: { window: { left: 1 } }, frameCoordinates: { x: 1, y: 1 }, mapping: { tablet: { x: 1, y: 1 } } })),
    closes: Array.from({ length: 2 }, () => ({ accepted: true, mappingMatches: true, guestPixelMatches: true, windowClosed: true,
      closeProbe: { windowRestored: false, retiredInstructions: 100_000_000 }, beforeChrome: { window: { left: 1 } } })),
    image: { expectedSha256: expectedImageSha256 },
    stateDigest: "a".repeat(64),
  };
  assertProof(base, 2, { image: { sha256: expectedImageSha256 } }, "valid fixture");
  const mutantMaximizes = base.maximizes.map((entry, index) => index === 0 ? { ...entry, mappingMatches: false } : entry);
  assert.throws(() => assertProof({ ...base, maximizes: mutantMaximizes }, 2, { image: { sha256: expectedImageSha256 } }, "mutant"), /maximize evidence/u);
  for (const [key, field] of [["hovers", "highlightMatches"], ["hovers", "cursorMatches"], ["maximizes", "windowMaximized"]]) {
    const changed = structuredClone(base);
    changed[key][0][field] = false;
    assert.throws(() => assertProof(changed, 2, { image: { sha256: expectedImageSha256 } }, "mutant"), /evidence/u);
  }
  const counters = [100, 101, 109, 110];
  assert.deepEqual(await waitForRetiredInstructions(async () => ({ retiredInstructions: counters.shift() }), 10, { pollingMs: 0 }),
    { before: 100, after: 110, retiredInstructions: 10 });
  assert.equal(counters.length, 0, "async false progress must not satisfy the gate");
  await assert.rejects(waitForRetiredInstructions(async () => ({ retiredInstructions: 10 }), 1, { timeoutMs: 1, pollingMs: 2 }), /did not retire/);
  assert.throws(() => assertPointerPress([], { x: 1, y: 2 }, "no-input mutant"), /missing move\/make\/break/);
  const frames = [{ device: "tablet", source: "pointermove", coordinates: { x: 1, y: 2 } },
    ...[1, 0].map((value) => ({ device: "mouse", mode: "absolute", events: [{ eventType: 1, code: 272, value }] }))];
  assertPointerPress(frames, { x: 1, y: 2 }, "valid press");
  assert.throws(() => assertPointerPress([frames[0], frames[1], frames[1]], { x: 1, y: 2 }, "stranded-button mutant"), /make\/break/);
  console.log("E5T18C_SELF_TEST=valid-fixture-accepted;mapping-hover-maximize-mutants-rejected");
}

async function main() {
  await fs.mkdir(evidenceDir, { recursive: true });
  const gitHead = (await execFile("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
  const image = await validatePublication();
  const base = await startServer();
  const browserInfo = await launchBrowser();
  const runs = [];
  try {
    const dprs = (process.env.E5_T18C_DPRS || "1,2")
      .split(",")
      .map((value) => Number(value.trim()))
      .filter((value, index, values) => (value === 1 || value === 2) && values.indexOf(value) === index);
    assert.ok(dprs.length > 0, "E5_T18C_DPRS must select DPR 1 and/or 2");
    // Two fresh cache-disabled contexts per DPR; no persistent guest overlay is shared.
    const results = await Promise.allSettled(dprs.flatMap((dpr) => [1, 2].map((repetition) =>
      runDpr(base, image, dpr, browserInfo, repetition))));
    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length) throw new AggregateError(failures.map((r) => r.reason), "DPR context matrix failed");
    runs.push(...results.map((r) => r.value));
    for (const dpr of dprs) {
      const repeated = runs.filter((r) => r.dpr === dpr);
      const geometry = (r) => r.cycles.map((c) => ({ initial: c.initialChrome.window, maximized: c.afterMaxChrome.window, closed: c.closed.windowClosed }));
      assert.deepEqual(geometry(repeated[0]), geometry(repeated[1]), `DPR-${dpr}: repeated context geometry diverged`);
    }
  } finally {
    await browser?.close().catch(() => {});
    browser = null;
    await stopServer();
  }
  const sourceDistFiles = [
    "desktop-cursor.html",
    "desktop-cursor.js",
    "desktop-terminal.html",
    "desktop-terminal.js",
    "src/input/desktop-geometry.js",
    "src/input/desktop-cursor-template.js",
    "src/input/pointer.js",
  ];
  const parity = [];
  for (const relative of sourceDistFiles) {
    const [source, dist] = await Promise.all([
      fs.readFile(path.join(web, relative)),
      fs.readFile(path.join(web, "dist", relative)),
    ]);
    assert.deepEqual(dist, source, `web/dist/${relative} is stale`);
    parity.push({ source: `web/${relative}`, dist: `web/dist/${relative}`, sha256: sha256(source), equal: true });
  }
  const report = {
    schema: "wasm-vm.e5-t18c.desktop-cursor-dpr-hit-testing-evidence.v1",
    task: "E5-T18c",
    command: "make verify-E5-T18c",
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    gitHead,
    publication: image,
    cursorReference: { path: "evidence/e5-t18c/cursor-reference.json", sha256: sha256(await fs.readFile(path.join(evidenceDir, "cursor-reference.json"))) },
    runs,
    sourceDistParity: { equal: true, files: parity },
    result: runs.length === 4 ? "passed" : "diagnostic-passed",
  };
  assert.equal((await execFile("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim(), gitHead, "git HEAD changed during the recorded run");
  const transcriptText = transcript.join("");
  await fs.writeFile(transcriptPath, transcriptText);
  report.transcript = { path: path.relative(repo, transcriptPath), sha256: sha256(Buffer.from(transcriptText)) };
  const output = report.result === "passed" ? evidencePath : evidencePath.replace(/\.json$/u, "-diagnostic.json");
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

export { assertProof, boundaryMatrix, clickControl, hoverControl, openAndFocus };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
if (process.argv.includes("--self-test")) {
  await assertSelfTestMutant();
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
}
