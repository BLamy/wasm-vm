#!/usr/bin/env node

// E5-T18b: local Chromium proof of the Weston desktop-shell Terminal launcher and the T12
// physical-code keyboard path. The browser run is the authority for the visible contract. The
// image/chunk audit binds that run to the exact launcher-enabled rootfs; WebKit, independent
// machines, and host rr are intentionally outside this task's scope.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const cli = path.join(repo, "target/release/wasm-vm");
const evidenceDir = path.join(repo, "evidence/e5-t18b");
const evidencePath = path.join(evidenceDir, "desktop-terminal-input.json");
const transcriptPath = path.join(evidenceDir, "desktop-terminal-browser-console.log");
const screenshotPath = path.join(evidenceDir, "desktop-terminal-input.png");
const imagePath = path.resolve(process.env.E5_T18B_IMAGE || "target/e5-t18b/desktop-image/alpine-rootfs.ext4");
const imageDir = path.dirname(imagePath);
const chunkDir = path.resolve(process.env.E5_T18B_DESKTOP_ASSET_DIR || "target/e5-t18b/chunks/desktop-v6");
const chunkManifestPath = path.join(chunkDir, "manifest.json");
const packageManifestPath = path.join(imageDir, "MANIFEST.txt");
const fileManifestPath = path.join(imageDir, "FILE-MANIFEST.txt");
const expectedImageSha256 = "08bb8227fe0180ed06e5a01188e4a0fe3b21565ba83dcc2c1df632ca413172be";
const expectedChunkManifestSha256 = "2e92778fe0e6c5bd0819034bda28d235307cf7ab8f031cd30e1854f96982a6c0";
const expectedPackageManifestSha256 = "ba86429d08e11360309b346e8fb757f44f318eccefed3e243dcaf425b91ad908";
const expectedFileManifestSha256 = "0155d794fa136a4653e76ae76f9c01233d9175f0ef56a9e9eb2565074985e0ad";
const expectedImageBytes = 1_073_741_824;
const expectedChunkSize = 128 * 1024;
const expectedChunkCount = expectedImageBytes / expectedChunkSize;
const expectedTerminalDigest = "0b83d0269abcbae3208229681be17fd05630c4029882517c4c2f51946ffba9fe";
const timeoutMs = Number(process.env.E5_T18B_TIMEOUT_MS || 900_000);
const requestedPort = Number(process.env.E5_T18B_PORT || 0);
const chromePath = process.env.E5_T18B_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const execFile = promisify(execFileCallback);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 30_000, "E5_T18B_TIMEOUT_MS is too small");
const SHA256 = /^[0-9a-f]{64}$/u;

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
  const fileManifest = fileManifestBytes.toString("utf8");
  assert.match(
    fileManifest,
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
      const page = await fetch(`${base}/desktop-terminal.html`, { cache: "no-store" });
      const manifest = await fetch(`${base}/e5t18b-desktop/manifest.json`, { cache: "no-store" });
      const forbidden = await fetch(`${base}/e5t18b-desktop/not-a-chunk.txt`, { cache: "no-store" });
      assert.equal(page.ok, true, "desktop terminal page did not load");
      assert.equal(manifest.ok, true, "T18b chunk manifest did not load");
      assert.equal(forbidden.status, 404, "closed T18b asset route exposed an arbitrary path");
      assert.match(manifest.headers.get("cache-control") || "", /immutable/u, "T18b assets are not immutable-cached");
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

function attachErrorCapture(page, errors) {
  page.on("console", (message) => {
    const location = message.location();
    record(`browser console.${message.type()}: ${message.text()} @ ${location.url}:${location.lineNumber ?? 0}`);
    if (message.type() === "error" && !location.url.includes("/favicon.ico")) {
      errors.console.push({ text: message.text(), url: location.url, line: location.lineNumber ?? 0 });
    }
  });
  page.on("pageerror", (error) => {
    record(`browser pageerror: ${error.message}`);
    errors.page.push(error.message);
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("/favicon.ico")) return;
    const failure = request.failure()?.errorText || "unknown";
    record(`browser requestfailed: ${request.url()} — ${failure}`);
    errors.requests.push({ url: request.url(), failure });
  });
}

async function launchBrowser() {
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  const options = {
    headless: process.env.E5_T18B_HEADED !== "1",
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

function guestPoint(box, x, y) {
  return {
    x: box.x + (x / 1280) * box.width,
    y: box.y + (y / 800) * box.height,
  };
}

async function clickGuest(page, box, x, y) {
  const point = guestPoint(box, x, y);
  // The tablet owns coordinates while Weston/libinput consumes the button from the relative
  // mouse seat. Give the compositor one bounded repaint boundary between those frames so a
  // deterministic Playwright click matches a real user move-then-click sequence.
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(1_000);
  await page.mouse.down();
  await page.mouse.up();
}

async function launchTerminal(page, box, label) {
  await page.evaluate((value) => window.__desktopTerminal.beginLaunch(value), label);
  // Weston desktop-shell places its built-in terminal launcher in the upper-left panel.
  await clickGuest(page, box, 24, 16);
  await page.waitForFunction(
    () => window.__desktopTerminal?.state().active?.launch?.terminalRendered === true,
    null,
    { timeout: 240_000 },
  );
  const state = await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  assert.equal(state.launches.at(-1).accepted, true, `${label}: Terminal launcher did not open a window`);
}

async function focusTerminal(page, box, label) {
  await page.evaluate((value) => window.__desktopTerminal.beginFocus(value), label);
  const pointerStart = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  // The interactive proof image starts only Weston; clicking the new window's content area here
  // proves the desktop-shell launcher changed the guest surface before the focus click below.
  await clickGuest(page, box, 500, 420);
  // Pointer transport is serialized through the worker RPC boundary. Wait until the move and
  // both button frames have been observed before sampling the focus record.
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal?.state().pointerFrames >= minimum,
    pointerStart + 3,
    { timeout: 30_000 },
  );
  // The browser-to-guest pointer transport can finish before the interpreted compositor has
  // consumed the click and assigned keyboard focus. Give that guest transition one bounded
  // scheduling interval before sending the command burst.
  await page.waitForTimeout(30_000);
  await page.evaluate(() => window.__desktopTerminal.focus());
  const state = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  assert.equal(state.focuses.at(-1).accepted, true, `${label}: terminal focus was not recorded`);
}

async function typeCommand(page, command, marker) {
  await page.evaluate(({ command: value, marker: expected }) => {
    window.__desktopTerminal.beginCommand(value, expected);
  }, { command, marker });
  await page.evaluate(() => window.__desktopTerminal.focus());
  // Keep the burst deterministic but give the interpreted guest a scheduling edge between
  // physical transitions. A zero-delay Playwright burst can enqueue every frame before Weston has
  // consumed the first one; the same 10 ms bounded cadence is still rapid input and exercises the
  // production T12 bridge without making the result depend on an oversized pending queue.
  await page.keyboard.type(command, { delay: 10 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () => window.__desktopTerminal?.state().active?.command?.terminalMarkerSeen === true,
    null,
    { timeout: 240_000 },
  );
  // Let the guest scanout publish the shell echo and ls output before the route computes its
  // readback diff. This remains bounded and does not add another boot.
  await page.waitForTimeout(750);
  const state = await page.evaluate((expected) => window.__desktopTerminal.finishCommand(expected), marker);
  const commandRecord = state.commands.at(-1);
  assert.equal(commandRecord.accepted, true, `${marker}: command was not accepted`);
  assert.equal(commandRecord.terminalMarkerSeen, true, `${marker}: terminal marker was not observed`);
  assert.ok(commandRecord.keyboardFrames > 0, `${marker}: no T12 keyboard frames were recorded`);
  assert.ok(commandRecord.domEvents >= command.length, `${marker}: dropped DOM key events`);
  assert.ok(commandRecord.visualDiffPixels >= 2_000, `${marker}: no visible ls output change`);
}

async function closeTerminal(page, label) {
  await page.evaluate((value) => window.__desktopTerminal.beginClose(value), label);
  await page.keyboard.press("Control+d");
  await page.waitForFunction(
    () => window.__desktopTerminal?.state().active?.close?.visualChange === true,
    null,
    { timeout: 30_000 },
  );
  const state = await page.evaluate(() => window.__desktopTerminal.finishClose());
  assert.equal(state.closes.at(-1).accepted, true, `${label}: terminal close was not accepted`);
}

function assertBrowserProof(proof, image, label = "browser") {
  assert.ok(proof && typeof proof === "object", `${label}: proof is missing`);
  assert.equal(proof.schema, "wasm-vm.e5-t18b.desktop-terminal-input.v1", `${label}: proof schema`);
  assert.equal(proof.task, "E5-T18b", `${label}: proof task`);
  assert.equal(proof.route, "desktop-terminal", `${label}: proof route`);
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
  assert.equal(proof.image.expectedSha256, image.image.sha256, `${label}: image binding`);
  assert.equal(proof.image.manifestSha256, image.chunkManifest.sha256, `${label}: manifest binding`);
  assert.equal(proof.image.expectedManifestSha256, image.chunkManifest.sha256, `${label}: expected manifest binding`);
  assert.equal(proof.image.imageLen, expectedImageBytes, `${label}: image length`);
  assert.equal(proof.image.chunkSize, expectedChunkSize, `${label}: chunk size`);
  assert.equal(proof.image.chunkCount, expectedChunkCount, `${label}: chunk count`);
  assert.equal(proof.image.layout, "split", `${label}: chunk layout`);
  assert.ok(proof.fetchStats?.fetches > 0, `${label}: no published chunks fetched`);
  assert.ok(proof.fetchStats?.bytes > 0, `${label}: no published image bytes fetched`);
  assert.deepEqual(proof.presentation?.errors, [], `${label}: presentation errors`);
  assert.equal(proof.paused, true, `${label}: proof readback was not paused`);
  assert.equal(proof.error, null, `${label}: route reported a runtime error`);
  assert.equal(proof.interactions.launches.length, 2, `${label}: launch count`);
  assert.equal(proof.interactions.focuses.length, 2, `${label}: focus count`);
  assert.equal(proof.interactions.commands.length, 2, `${label}: command count`);
  assert.equal(proof.interactions.closes.length, 2, `${label}: close count`);
  assert.ok(proof.interactions.launches.every((entry) => entry.accepted && entry.visualChange && entry.terminalRendered && entry.pointerFrames >= 2), `${label}: launcher interaction`);
  assert.ok(proof.interactions.focuses.every((entry) => entry.accepted && entry.hostFocusedAfter && entry.pointerFrames >= 2), `${label}: focus interaction`);
  assert.ok(proof.interactions.commands.every((entry) => entry.accepted && entry.terminalMarkerSeen && entry.keyboardFrames > 0 && entry.keyboardFrames === entry.domEvents && entry.inputSequenceMatch === true && entry.visualDiffPixels >= 2_000), `${label}: command interaction`);
  assert.ok(proof.interactions.closes.every((entry) => entry.accepted && entry.visualDiffPixels >= 2_000), `${label}: close interaction`);
  assert.deepEqual(
    proof.interactions.commands.map((entry) => entry.marker),
    ["e5t18b-ls-1-ok", "e5t18b-ls-2-ok"],
    `${label}: command markers`,
  );
  assert.equal(proof.input.pointerFrameCount >= 8, true, `${label}: insufficient pointer frames`);
  assert.ok(proof.input.keyboardFrameCount >= 50, `${label}: insufficient keyboard frames`);
  assert.ok(proof.input.keyboardEventCount >= 50, `${label}: insufficient DOM keyboard events`);
  assert.deepEqual(proof.input.diagnostics, [], `${label}: input diagnostics`);
  return proof;
}

async function sourceDistParity() {
  const files = [
    "desktop-terminal.html",
    "desktop-terminal.js",
    "roadmap.js",
    "src/input/pointer.js",
    "src/input/keyboard.js",
    "src/input/capture.js",
    "src/input/reconciliation.js",
  ];
  const parity = [];
  for (const relative of files) {
    const sourcePath = path.join(web, relative);
    const distPath = path.join(web, "dist", relative);
    const [source, dist] = await Promise.all([fs.readFile(sourcePath), fs.readFile(distPath)]);
    assert.deepEqual(dist, source, `web/dist/${relative} is stale`);
    parity.push({ source: `web/${relative}`, dist: `web/dist/${relative}`, sha256: sha256(source), equal: true });
  }
  const deployedApp = await fs.readFile(path.join(web, "dist/app.html"), "utf8");
  assert.match(deployedApp, /desktop-terminal\.html/u, "deployed app does not link the terminal proof route");
  return { equal: true, files: parity, deployedAppLink: true };
}

async function staticAudit() {
  const [rootfsScript, routeScript, serverScript, wasmScript] = await Promise.all([
    fs.readFile(path.join(repo, "tools/rootfs-inner.sh"), "utf8"),
    fs.readFile(path.join(web, "desktop-terminal.js"), "utf8"),
    fs.readFile(path.join(repo, "tools/serve-dev.sh"), "utf8"),
    fs.readFile(path.join(repo, "crates/wasm/src/lib.rs"), "utf8"),
  ]);
  assert.match(rootfsScript, /\/usr\/bin\/weston-terminal/u, "rootfs script has no launcher target");
  assert.match(rootfsScript, /exec \/usr\/bin\/foot "\$@"/u, "launcher target does not exec foot");
  assert.match(rootfsScript, /\[launcher\][\s\S]*path=\/usr\/bin\/weston-terminal/u, "Weston config has no active terminal launcher");
  assert.match(rootfsScript, /\[keyboard\][\s\S]*keymap_rules=evdev[\s\S]*keymap_model=pc105[\s\S]*keymap_layout=us/u, "Weston config has no pinned PC-105 keyboard rules");
  assert.match(rootfsScript, /desktop-terminal-interactive/u, "desktop image has no interactive compositor bound");
  assert.match(rootfsScript, /desktop_timeout=30/u, "historical bounded desktop timeout is missing");
  assert.match(wasmScript, /INTERACTIVE_PENDING_EVENT_BUDGET/u, "browser assembly has no bounded keyboard burst budget");
  assert.match(routeScript, /createKeyboardBridge/u, "route does not install the T12 keyboard bridge");
  assert.match(routeScript, /createPointerBridge/u, "route does not install the tablet pointer bridge");
  assert.match(routeScript, /absoluteButtonDevice: "mouse"/u, "desktop route does not route launcher buttons through the Weston-compatible mouse seat");
  assert.match(routeScript, /serializeTransport: true/u, "desktop route does not serialize asynchronous pointer frames");
  assert.match(serverScript, /e5t18b-desktop/u, "dev server has no T18b asset route");
  return {
    rootfsLauncher: true,
    keyboardBridge: true,
    pointerBridge: true,
    assetRoute: true,
  };
}

async function runBrowser(base, image) {
  const errors = { console: [], page: [], requests: [] };
  const browserInfo = await launchBrowser();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  attachErrorCapture(page, errors);
  const imageSha = image.image.sha256;
  const manifestSha = image.chunkManifest.sha256;
  const url = `${base}/desktop-terminal.html?e5T18b=1&jit=1&quantum=500000&imageSha256=${imageSha}&manifestSha256=${manifestSha}`;
  const startedAt = Date.now();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForFunction(
      () => document.documentElement.dataset.desktopReady === "ready",
      null,
      { timeout: timeoutMs },
    );
    // The ready marker is published at the first stable desktop scanout. Allow the compositor
    // one bounded startup interval to finish wiring its launcher seat before the first input
    // frame; this matches the successful route diagnostic and avoids racing Weston startup.
    await page.waitForTimeout(2_000);
    const canvas = page.locator("#desktop-canvas");
    const box = await canvas.boundingBox();
    assert.ok(box && box.width >= 1_000 && box.height >= 600, "desktop canvas did not render at usable size");

    await launchTerminal(page, box, "terminal-1");
    await focusTerminal(page, box, "focus-1");
    await typeCommand(page, "ls -la /home/desktop; printf '\\033[42;30me5t18b-ls-1-ok\\033[0m\\n'", "e5t18b-ls-1-ok");
    await closeTerminal(page, "close-1");

    await launchTerminal(page, box, "terminal-2");
    await focusTerminal(page, box, "focus-2");
    await typeCommand(page, "ls -la /home/desktop; printf '\\033[42;30me5t18b-ls-2-ok\\033[0m\\n'", "e5t18b-ls-2-ok");
    await closeTerminal(page, "close-2");

    const proof = await page.evaluate(() => window.__desktopTerminal.finishProof());
    assertBrowserProof(proof, image);
    assert.deepEqual(errors, { console: [], page: [], requests: [] }, "browser emitted errors");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      browser: browserInfo,
      elapsedMs: Date.now() - startedAt,
      bootToDesktopMs: proof.bootToDesktopMs,
      proof,
      errors,
    };
  } catch (error) {
    let state = null;
    try {
      state = await page.evaluate(() => ({
        status: document.getElementById("desktop-status")?.textContent,
        ready: document.documentElement.dataset.desktopReady,
        proof: window.__desktopTerminalProof?.() ?? null,
        state: window.__desktopTerminal?.state?.() ?? null,
        presentation: window.__desktopTerminal?.presentation?.() ?? null,
        inspection: document.documentElement.dataset.desktopInspection || null,
      }));
    } catch {}
    record(`browser failure state: ${JSON.stringify(state)}`);
    await page.screenshot({ path: path.join(evidenceDir, "desktop-terminal-failure.png"), fullPage: true }).catch(() => {});
    error.message = `${error.message}; state=${JSON.stringify(state)}; errors=${JSON.stringify(errors)}`;
    throw error;
  } finally {
    await context.close().catch(() => {});
    await browser?.close().catch(() => {});
    browser = null;
  }
}

function assertSelfTestMutant() {
  const valid = {
    schema: "wasm-vm.e5-t18b.desktop-terminal-input.v1",
    task: "E5-T18b",
    route: "desktop-terminal",
    readiness: { wallpaper: true, panel: { ready: true }, menu: true },
    canvas: { width: 1280, height: 800 },
    selectedBackend: "canvas2d",
    frameCount: 1,
    image: {
      expectedSha256: expectedImageSha256,
      manifestSha256: expectedChunkManifestSha256,
      expectedManifestSha256: expectedChunkManifestSha256,
      imageLen: expectedImageBytes,
      chunkSize: expectedChunkSize,
      chunkCount: expectedChunkCount,
      layout: "split",
    },
    fetchStats: { fetches: 1, bytes: 1 },
    presentation: { errors: [] },
    paused: true,
    error: null,
    interactions: {
      launches: [{ accepted: true, visualChange: true, pointerFrames: 2 }],
      focuses: [{ accepted: true, hostFocusedAfter: true, pointerFrames: 2 }],
        commands: [{ accepted: false, terminalMarkerSeen: false, keyboardFrames: 1, visualDiffPixels: 2_000, marker: "e5t18b-ls-1-ok" }],
      closes: [{ accepted: true, visualDiffPixels: 2_000 }],
    },
    input: { pointerFrameCount: 8, keyboardFrameCount: 50, keyboardEventCount: 50, diagnostics: [] },
  };
  assert.throws(() => assertBrowserProof(valid, { image: { sha256: expectedImageSha256 }, chunkManifest: { sha256: expectedChunkManifestSha256 } }, "mutant"), /launch count/u);
  console.log("E5T18B_SELF_TEST=wrong-count-rejected");
}

async function main() {
  await fs.mkdir(evidenceDir, { recursive: true });
  const image = await validatePublication();
  const staticEvidence = await staticAudit();
  const sourceBefore = image.image.sha256;
  const base = await startServer();
  let run;
  try {
    run = await runBrowser(base, image);
  } finally {
    await stopServer();
  }
  const sourceAfter = await sha256File(imagePath);
  assert.equal(sourceAfter, sourceBefore, "browser boot modified the published desktop image");
  const dist = await sourceDistParity();
  const transcriptText = transcript.join("");
  await fs.writeFile(transcriptPath, transcriptText);
  const report = {
    schema: "wasm-vm.e5-t18b.desktop-terminal-input-evidence.v1",
    task: "E5-T18b",
    command: "make verify-E5-T18b",
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    static: staticEvidence,
    publication: image,
    browser: run.browser,
    acceptance: {
      coldCache: true,
      launcher: "Weston desktop-shell Terminal -> /usr/bin/weston-terminal -> foot",
      keyboardPath: "Chromium physical KeyboardEvent -> T12 evdev bridge -> guest foot",
      command: "ls -la /home/desktop; printf '\\033[42;30m<marker>\\033[0m\\n'",
      repeatCycles: 2,
      close: "Control-D",
      browserErrors: run.errors,
    },
    run: {
      elapsedMs: run.elapsedMs,
      bootToDesktopMs: run.bootToDesktopMs,
      proof: run.proof,
    },
    screenshot: { path: path.relative(repo, screenshotPath), sha256: sha256(await fs.readFile(screenshotPath)) },
    sourceUnchanged: sourceAfter === sourceBefore,
    sourceDistParity: dist,
    transcript: { path: path.relative(repo, transcriptPath), sha256: sha256(Buffer.from(transcriptText)) },
    result: "passed",
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv.includes("--self-test")) {
  assertSelfTestMutant();
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
