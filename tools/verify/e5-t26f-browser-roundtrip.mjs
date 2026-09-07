#!/usr/bin/env node

// E5-T26f: Chromium-only browser proof for the composed desktop snapshot save/reload/restore
// boundary. WebKit and independent machines are intentionally outside this slice.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, stat, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const out = path.resolve(process.env.E5_T26F_OUT || path.join(repo, "evidence/e5-t26f"));
const assetRoot = path.resolve(
  process.env.E5_T26F_DESKTOP_ASSET_DIR || path.join(repo, "target/e5-t18b/chunks/desktop-v6"),
);
const imagePath = path.resolve(
  process.env.E5_T26F_IMAGE || path.join(repo, "target/e5-t18b/desktop-image-v6/alpine-rootfs.ext4"),
);
const imageInfoPath = path.resolve(
  process.env.E5_T26F_IMAGE_INFO || path.join(repo, "target/e5-t18b/desktop-image-v6/desktop-info.json"),
);
const timeoutMs = Number(process.env.E5_T26F_TIMEOUT_MS || 900_000);
const chromePath = process.env.E5_T26F_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const execFile = promisify(execFileCallback);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const SHA256 = /^[0-9a-f]{64}$/u;
const jsonReplacer = (_key, value) => typeof value === "bigint" ? `${value}n` : value;

assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 120_000, "timeout must be at least two minutes");

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

async function sha256File(file) {
  const { createReadStream } = await import("node:fs");
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

async function sourceDistParity() {
  const files = [
    "desktop-terminal.js",
    "desktop-agent-bridge.js",
    "desktop-restore.js",
    "main.js",
    "loader.js",
    "linux-worker-host.js",
    "linux-worker-protocol.js",
    "linux-worker.js",
    "roadmap.js",
  ];
  const result = [];
  for (const relative of files) {
    const source = await readFile(path.join(web, relative));
    const dist = await readFile(path.join(web, "dist", relative));
    assert.deepEqual(dist, source, `web/dist/${relative} is stale`);
    result.push({ relative, sha256: sha256(source), equal: true });
  }
  return result;
}

const manifestPath = path.join(assetRoot, "manifest.json");
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
assert.equal(manifest.layout, "split", "desktop image is not split/chunked");
assert.ok(Array.isArray(manifest.chunks) && manifest.chunks.length > 0, "desktop chunks are missing");
assert.ok(manifest.chunks.every((hash) => SHA256.test(hash)), "desktop chunk manifest has malformed hashes");
const manifestSha256 = sha256(manifestBytes);
const imageInfo = JSON.parse(await readFile(imageInfoPath, "utf8"));
const imageStat = await stat(imagePath);
const imageSha256 = await sha256File(imagePath);
assert.equal(imageSha256, process.env.E5_T26F_IMAGE_SHA256 || imageInfo.image?.sha256, "desktop image digest");
assert.equal(imageStat.size, imageInfo.image?.size, "desktop image size");

const { stdout: headOutput } = await execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo });
const head = headOutput.trim();
assert.match(head, /^[0-9a-f]{40}$/u, "runner must record an exact Git head");
if (process.env.E5_T26F_REQUIRE_HEAD) assert.equal(head, process.env.E5_T26F_REQUIRE_HEAD);

const serverEnv = { ...process.env, E5_T18B_DESKTOP_ASSET_DIR: assetRoot };
for (const key of Object.keys(serverEnv)) {
  if (key === "RUSTFLAGS" || key === "RUST_LOG" || key.startsWith("CARGO_")) delete serverEnv[key];
}

let server = null;
let browser = null;
let context = null;
let page = null;
let serverOutput = "";
const browserErrors = [];
const httpErrors = [];
const startedAt = Date.now();

function guestPoint(box, x, y) {
  return { x: box.x + (x / 1280) * box.width, y: box.y + (y / 800) * box.height };
}

async function clickGuest(box, x, y, settleMs = 1_000) {
  const point = guestPoint(box, x, y);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(settleMs);
  await page.mouse.down();
  await page.mouse.up();
}

async function desktopBox() {
  const box = await page.locator("#desktop-canvas").boundingBox();
  assert.ok(box?.width > 0 && box.height > 0, "desktop canvas has no layout");
  return box;
}

async function captureFailure(label) {
  await mkdir(out, { recursive: true });
  const diagnostic = {
    label,
    url: page?.url() || null,
    state: null,
    serial: null,
    serverOutput,
  };
  try {
    diagnostic.state = await page.evaluate(() => ({
      terminal: window.__desktopTerminal?.state?.() || null,
      presentation: window.__desktopTerminal?.presentation?.() || null,
      audio: window.__desktopTerminal?.audio?.() ? {
        policy: window.__desktopTerminal.audio().policy?.state || null,
        context: window.__desktopTerminal.audio().sink?.context?.state || null,
        renderedFrames: window.__desktopTerminal.audio().sink?.renderedFrames ?? null,
      } : null,
      ready: document.documentElement.dataset.desktopReady,
      restored: document.documentElement.dataset.desktopRestored,
    }));
    diagnostic.serial = await page.evaluate(() => window.__desktopTerminal?.serial?.() || null);
    await page.screenshot({ path: path.join(out, `${label}.png`), fullPage: true });
  } catch (error) {
    diagnostic.captureError = String(error?.message || error);
  }
  await writeFile(path.join(out, `${label}.json`), `${JSON.stringify(diagnostic, null, 2)}\n`);
  await writeFile(path.join(out, `${label}-server.log`), serverOutput);
}

async function launchTerminal(box, label) {
  await page.evaluate((value) => window.__desktopTerminal.beginLaunch(value), label);
  await clickGuest(box, 24, 16);
  await page.waitForFunction(
    () => window.__desktopTerminal.state().active.launch?.terminalRendered === true,
    null,
    { timeout: timeoutMs },
  );
  const state = await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  assert.equal(state.launches.at(-1).accepted, true, `${label}: terminal launcher failed`);
}

async function focusTopWindow(box, label) {
  await page.evaluate((value) => window.__desktopTerminal.beginFocus(value), label);
  const point = await page.evaluate(() => window.__desktopCursor?.focusGuestPoint?.());
  assert.ok(point, `${label}: no detected top-window focus point`);
  const before = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  // Match the proven T18b route: Weston must consume the tablet coordinate before the relative
  // mouse-seat button transition, or the click is recorded without assigning terminal focus.
  await clickGuest(box, point.x, point.y, 1_000);
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames >= minimum,
    before + 3,
    { timeout: 30_000 },
  );
  // The interpreted guest can finish the pointer RPC before Weston has consumed the click and
  // assigned keyboard focus. Match the already-proven T18b path: give the compositor one bounded
  // scheduling interval before the first physical key transition.
  await page.waitForTimeout(60_000);
  // A second content click removes a rare Weston seat-focus race seen after the first desktop
  // launch; it is harmless for foot and keeps the following physical key burst deterministic.
  const secondBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  await clickGuest(box, point.x, point.y, 1_000);
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames >= minimum,
    secondBefore + 3,
    { timeout: 30_000 },
  );
  await page.waitForTimeout(30_000);
  await page.evaluate(() => window.__desktopTerminal.focus());
  const state = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  const focus = state.focuses.at(-1);
  assert.equal(focus.accepted, true, `${label}: terminal focus was not recorded`);
  return { point, pointerFrames: focus.pointerFrames };
}

const shiftedPhysicalKey = new Map([
  ...Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), String.fromCharCode(97 + index)]),
  ["!", "1"], ["@", "2"], ["#", "3"], ["$", "4"], ["%", "5"], ["^", "6"],
  ["&", "7"], ["*", "8"], ["(", "9"], [")", "0"], ["_", "-"], ["+", "="],
  ["{", "["], ["}", "]"], ["|", "\\"], [":", ";"], ["\"", "'"], ["<", ","], [">", "."], ["?", "/"],
]);

async function typePhysicalText(text) {
  for (const character of text) {
    const baseKey = shiftedPhysicalKey.get(character);
    if (baseKey) {
      await page.keyboard.down("Shift");
      await page.keyboard.press(baseKey);
      await page.keyboard.up("Shift");
      await page.waitForTimeout(100);
    } else {
      await page.keyboard.type(character, { delay: 100 });
    }
  }
}

async function typeCommand(command, marker, timeout = 240_000) {
  await page.evaluate(({ value, expected }) => window.__desktopTerminal.beginCommand(value, expected), {
    value: command,
    expected: marker,
  });
  await page.evaluate(() => window.__desktopTerminal.focus());
  // The interpreted guest needs a bounded drain interval between physical transitions; a 10 ms
  // burst records every DOM frame but can leave the foot line editor visibly mid-command.
  await typePhysicalText(command);
  await page.keyboard.press("Enter");
  try {
    await page.waitForFunction(
      () => window.__desktopTerminal.state().active.command?.terminalMarkerSeen === true,
      null,
      { timeout },
    );
  } catch (error) {
    await captureFailure(`command-${marker}`);
    throw error;
  }
  const state = await page.evaluate((expected) => window.__desktopTerminal.finishCommand(expected), marker);
  const record = state.commands.at(-1);
  assert.equal(record.accepted, true, `${marker}: command was not accepted`);
  return record;
}

async function waitForReadyAndRestore() {
  await page.waitForFunction(() => document.documentElement.dataset.desktopReady === "ready", null, { timeout: timeoutMs });
  await page.waitForFunction(() => ["ready", "error", "none"].includes(
    document.documentElement.dataset.desktopRestored,
  ), null, { timeout: timeoutMs });
  const restoreState = await page.evaluate(() => ({
    restored: document.documentElement.dataset.desktopRestored || null,
    status: document.querySelector("[data-status]")?.textContent || null,
    terminal: window.__desktopTerminal?.state?.() || null,
    diagnostics: window.__desktopTerminal?.state?.().diagnostics || [],
  }));
  if (restoreState.restored !== "ready") {
    await captureFailure(`restore-${restoreState.restored || "missing"}`);
    throw new Error(`desktop restore did not become ready: ${JSON.stringify(restoreState)}`);
  }
  await page.waitForFunction(
    () => window.__desktopTerminal.restoreObservation?.().firstPresent !== null,
    null,
    { timeout: 60_000 },
  );
  return page.evaluate(() => {
    const result = window.__desktopTerminal.restoreResult();
    const observation = window.__desktopTerminal.restoreObservation();
    return {
      snapshotSha256: result?.snapshotSha256 || null,
      snapshotBytes: result?.snapshotBytes || 0,
      completedAt: result?.completedAt || null,
      report: result?.report || null,
      handshake: result?.handshake ? {
        generation: result.handshake.generation,
        version: result.handshake.version,
        capabilities: String(result.handshake.capabilities),
      } : null,
      observation,
      bootStates: window.__desktopTerminal.state().bootStates,
      presentation: window.__desktopTerminal.presentation(),
    };
  });
}

async function reloadWithAutoRestore(url) {
  await page.evaluate((nextUrl) => history.replaceState(null, "", nextUrl), url);
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  return waitForReadyAndRestore();
}

try {
  const port = await freePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on("data", (chunk) => { serverOutput += chunk.toString(); });
  }
  const base = `http://127.0.0.1:${port}`;
  await waitFor(async () => {
    try {
      const response = await fetch(`${base}/desktop-cursor.html`);
      const manifestResponse = await fetch(`${base}/e5t18b-desktop/manifest.json`);
      return response.ok && manifestResponse.ok;
    } catch {
      return false;
    }
  }, "desktop server and asset route", 30_000);

  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules/playwright/index.mjs")).href);
  const launchOptions = {
    headless: process.env.E5_T26F_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--disable-background-timer-throttling", "--disable-renderer-backgrounding"],
  };
  try { await access(chromePath); launchOptions.executablePath = chromePath; } catch { /* bundled Chromium */ }
  browser = await chromium.launch(launchOptions);
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  page = await context.newPage();
  page.on("pageerror", (error) => browserErrors.push({ type: "pageerror", text: String(error) }));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.location().url?.endsWith("/favicon.ico")) {
      browserErrors.push({ type: "console", text: message.text() });
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().endsWith("/favicon.ico")) {
      httpErrors.push({ url: response.url(), status: response.status() });
    }
  });

  const query = new URLSearchParams({
    testHooks: "1",
    jit: "1",
    quantum: "500000",
    imageManifestUrl: "./e5t18b-desktop/manifest.json",
    baseUrl: "./e5t18b-desktop/",
    imageSha256,
    manifestSha256,
  });
  const coldUrl = `${base}/desktop-cursor.html?${query}`;
  const restoreUrl = `${coldUrl}&autoRestore=1`;
  await page.goto(coldUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => document.documentElement.dataset.desktopReady === "ready", null, { timeout: timeoutMs });
  await page.waitForTimeout(2_000);
  const box = await desktopBox();

  await launchTerminal(box, "e5-t26f-terminal-1");
  await focusTopWindow(box, "terminal-1");
  const shellProbe = await typeCommand(
    "true; printf '\\033[42;30me5t26f-shell-ok\\033[0m\\n'",
    "e5t26f-shell-ok",
  );
  assert.equal(shellProbe.redMarkerSeen, false, "guest shell probe reported failure");
  const agentProbe = await page.waitForFunction(
    () => window.__desktopTerminal.state().agent?.state === "ready",
    null,
    { timeout: 60_000 },
  ).then(() => page.evaluate(() => window.__desktopTerminal.state().agent));
  assert.equal(agentProbe.state, "ready", "agent channel did not complete HELLO");
  // Keep the physical-key burst below the guest input queue's 256-event budget: this 98-character
  // command produces 202 key/SYN events after the two shifted characters. aplay uses the
  // advertised S16_LE/stereo/48 kHz profile for a bounded one-second raw stream, and the green
  // marker is emitted only on success.
  const aplayCommand = "if timeout 10 aplay -f S16_LE -t raw -d1 -r48000 -c2 /dev/zero;then printf '\\033[42mok\\033[0m\\n';fi";
  const firstCommand = await typeCommand(aplayCommand, "e5t26f-aplay-ok");
  await launchTerminal(box, "e5-t26f-terminal-2");
  await focusTopWindow(box, "terminal-2");

  const cursorPoint = { x: 720, y: 430 };
  const cursorClient = guestPoint(box, cursorPoint.x, cursorPoint.y);
  await page.mouse.move(cursorClient.x, cursorClient.y);
  await page.waitForFunction((point) => {
    const state = window.__desktopTerminal.state();
    const frame = [...state.pointerFrameSample].reverse().find(
      (entry) => entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates,
    );
    if (!frame) return false;
    const rendered = window.__desktopCursor?.renderedCursor?.(point);
    return rendered ? { frame, rendered } : false;
  }, cursorPoint, { timeout: 120_000, polling: 500 });
  const cursorProof = await page.evaluate((point) => {
    const state = window.__desktopTerminal.state();
    const frame = [...state.pointerFrameSample].reverse().find(
      (entry) => entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates,
    );
    const rendered = frame ? window.__desktopCursor?.renderedCursor?.(point) : null;
    return { frame, rendered };
  }, cursorPoint);
  assert.ok(cursorProof.frame, "custom cursor proof saw no tablet move");
  assert.ok(cursorProof.rendered, "custom cursor was not visible in the front buffer");

  const preSnapshotCrc = await page.evaluate(() => window.__desktopTerminal.frontBufferCrc());
  const preSnapshotPresents = await page.evaluate(() => window.__desktopTerminal.presentation().successfulPresents);
  const normalSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: true }));
  assert.equal(normalSnapshot.schema, "wasm-vm.e5-t26f.desktop-snapshot.v1");
  assert.match(normalSnapshot.sha256, SHA256);
  assert.ok(normalSnapshot.byteLength > 0, "normal desktop snapshot is empty");

  const firstRestore = await reloadWithAutoRestore(restoreUrl);
  assert.equal(firstRestore.snapshotSha256, normalSnapshot.sha256, "reload restored a different snapshot");
  assert.equal(firstRestore.observation.firstPresent.crc32, preSnapshotCrc, "first restore frame CRC changed");
  assert.equal(firstRestore.report?.fullRepairFrame, true, "restore did not publish a full repair frame");
  assert.equal(firstRestore.report?.agentRehandshake, true, "restore did not re-handshake the agent");
  assert.equal(firstRestore.handshake?.version, 1, "agent protocol version");

  const postRestoreStart = await page.evaluate(() => performance.now());
  const postBox = await desktopBox();
  const focusBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const topPoint = await page.evaluate(() => window.__desktopCursor?.focusGuestPoint?.());
  assert.ok(topPoint, "post-restore focus point is missing");
  const focusClient = guestPoint(postBox, topPoint.x, topPoint.y);
  await page.mouse.move(focusClient.x, focusClient.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames > minimum,
    focusBefore,
    { timeout: 2_000 },
  );
  await page.evaluate(() => window.__desktopTerminal.focus());
  const keyboardBefore = await page.evaluate(() => window.__desktopTerminal.state().keyboardFrames);
  await page.keyboard.type("e5t26f-post-restore", { delay: 0 });
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().keyboardFrames >= minimum,
    keyboardBefore + "e5t26f-post-restore".length * 2,
    { timeout: 2_000 },
  );
  const audioBefore = await page.evaluate(() => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
  }));
  await page.mouse.click(postBox.x + postBox.width * 0.7, postBox.y + postBox.height * 0.55);
  await page.waitForFunction(
    () => window.__desktopTerminal.audio()?.policy?.state === "unlocked",
    null,
    { timeout: 2_000 },
  );
  const postRestoreEnd = await page.evaluate(() => performance.now());
  const postRestoreInteraction = await page.evaluate(() => ({
    elapsedMs: performance.now() - (window.__desktopTerminal.restoreResult()?.completedAt || performance.now()),
    pointerFrames: window.__desktopTerminal.state().pointerFrames,
    keyboardFrames: window.__desktopTerminal.state().keyboardFrames,
    heldButtons: window.__desktopTerminal.pointerState()?.heldButtons || [],
    audio: {
      policy: window.__desktopTerminal.audio()?.policy?.state || null,
      context: window.__desktopTerminal.audio()?.sink?.context?.state || null,
      renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    },
  }));
  try {
    assert.ok(postRestoreInteraction.pointerFrames > focusBefore, "post-restore cursor/focus did not move");
    assert.equal(postRestoreInteraction.heldButtons.length, 0, "post-restore focus left a stuck button");
    assert.equal(postRestoreInteraction.audio.policy, "unlocked", "user gesture did not unlock audio");
    assert.ok(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds");
  } catch (error) {
    await captureFailure("post-restore");
    throw error;
  }

  const dragChrome = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
  assert.ok(dragChrome?.titlebar, "drag snapshot has no detected titlebar");
  const dragY = (dragChrome.titlebar.top + dragChrome.titlebar.bottom) / 2;
  const dragStart = guestPoint(postBox, dragChrome.titlebar.left + 100, dragY);
  const dragEnd = guestPoint(postBox, dragChrome.titlebar.left + 180, dragY);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.move(dragEnd.x, dragEnd.y);
  const dragCrc = await page.evaluate(() => window.__desktopTerminal.frontBufferCrc());
  const dragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: true }));
  await page.mouse.up();
  assert.match(dragSnapshot.sha256, SHA256);
  assert.ok(dragSnapshot.byteLength > 0, "drag desktop snapshot is empty");

  const secondRestore = await reloadWithAutoRestore(restoreUrl);
  assert.equal(secondRestore.snapshotSha256, dragSnapshot.sha256, "drag snapshot was not restored");
  assert.equal(secondRestore.report?.fullRepairFrame, true, "drag restore did not publish a repair frame");
  const afterDragState = await page.evaluate(() => ({
    pointer: window.__desktopTerminal.pointerState(),
    observation: window.__desktopTerminal.restoreObservation(),
    presentation: window.__desktopTerminal.presentation(),
  }));
  assert.deepEqual(afterDragState.pointer.heldButtons, [], "drag restore retained a pressed button");
  assert.ok(afterDragState.observation.firstPresent, "drag restore has no first-present observation");
  assert.ok(afterDragState.presentation.successfulPresents > 0, "drag restore has no presented frame");

  await mkdir(out, { recursive: true });
  await page.screenshot({ path: path.join(out, "desktop-roundtrip.png"), fullPage: true });
  assert.deepEqual(browserErrors, [], "unexpected browser console/page errors");
  assert.deepEqual(httpErrors, [], "unexpected browser HTTP errors");
  const finalState = await page.evaluate(() => ({
    terminal: window.__desktopTerminal.state(),
    presentation: window.__desktopTerminal.presentation(),
    cursor: window.__desktopCursor.state(),
    restore: window.__desktopTerminal.restoreResult(),
  }));
  const result = {
    schema: "wasm-vm.e5-t26f.browser-roundtrip.v1",
    task: "E5-T26f",
    head,
    scope: { browser: "local Chromium", webkit: false, independentMachines: false, hostRr: false },
    browser: { name: browser.browserType().name(), version: browser.version(), headless: launchOptions.headless },
    image: {
      imagePath: path.relative(repo, imagePath),
      imageSha256,
      imageBytes: imageStat.size,
      manifestPath: path.relative(repo, manifestPath),
      manifestSha256,
      chunkCount: manifest.chunks.length,
      chunkSize: manifest.chunk_size,
    },
    snapshots: {
      normal: { sha256: normalSnapshot.sha256, byteLength: normalSnapshot.byteLength, preFrontBufferCrc: preSnapshotCrc, preSuccessfulPresents: preSnapshotPresents },
      duringDrag: { sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength, preFrontBufferCrc: dragCrc },
    },
    restores: {
      normal: firstRestore,
      duringDrag: secondRestore,
    },
    interactions: {
      shellProbe,
      agentProbe,
      firstCommand,
      cursor: cursorProof,
      postRestore: postRestoreInteraction,
      postRestoreAudioBefore: audioBefore,
      postRestoreElapsedMeasuredMs: postRestoreEnd - postRestoreStart,
      dragButtonReleased: afterDragState.pointer.heldButtons.length === 0,
    },
    final: finalState,
    errors: { browser: browserErrors, http: httpErrors },
    elapsedMs: Date.now() - startedAt,
  };
  await writeFile(path.join(out, "desktop-roundtrip.json"), `${JSON.stringify(result, jsonReplacer, 2)}\n`);
  await writeFile(path.join(out, "desktop-roundtrip-server.log"), serverOutput);
  console.log(JSON.stringify(result, jsonReplacer, 2));
} finally {
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server) {
    try { process.kill(-server.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    await sleep(300);
    server.unref();
  }
}
