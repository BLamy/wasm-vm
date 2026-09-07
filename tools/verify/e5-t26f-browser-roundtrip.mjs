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
const milestones = {};

let lastPhase = null;
let lastProgressSample = null;
let progressTimer = null;
let progressProbe = null;

function phaseProgress(phase, event = "start") {
  lastPhase = { phase, event, timestamp: new Date().toISOString(), elapsedMs: Date.now() - startedAt };
  console.error(`[e5-t26f] ${JSON.stringify(lastPhase)}`);
}

async function sampleProgress() {
  if (!progressTimer || !page) return;
  if (progressProbe) {
    console.error(`[e5-t26f] ${JSON.stringify({
      timestamp: new Date().toISOString(), phase: lastPhase?.phase, event: "probe-pending",
      probePhase: progressProbe.phase, pendingMs: Date.now() - progressProbe.startedAt,
    })}`);
    return;
  }
  const probe = { phase: lastPhase?.phase, startedAt: Date.now() };
  progressProbe = probe;
  try {
    // Only read the public page state. No worker RPC or guest control call; never serialize pixels.
    const sample = await page.evaluate(() => {
      const terminal = window.__desktopTerminal;
      const state = terminal?.state?.();
      const presentation = terminal?.presentation?.();
      const scheduler = presentation?.scheduler;
      const audio = terminal?.audio?.();
      const interaction = (record) => record ? {
        label: record.label ?? null,
        marker: record.marker ?? null,
        accepted: record.accepted ?? null,
        terminalRendered: record.terminalRendered ?? null,
        terminalMarkerSeen: record.terminalMarkerSeen ?? null,
        visualDiffPixels: record.visualDiffPixels ?? null,
        guestVisible: record.guestVisible ?? null,
        pointerFrames: record.pointerFrames ?? null,
        keyboardFrames: record.keyboardFrames ?? null,
      } : null;
      return {
        ready: document.documentElement.dataset.desktopReady || null,
        restored: document.documentElement.dataset.desktopRestored || null,
        status: (document.querySelector("#desktop-status")?.textContent || "").slice(-160),
        serialTail: (terminal?.serial?.() || "").slice(-240),
        frameCount: state?.frameCount ?? null,
        pointerFrames: state?.pointerFrames ?? null,
        keyboardFrames: state?.keyboardFrames ?? null,
        launch: interaction(state?.active?.launch),
        command: interaction(state?.active?.command),
        focus: interaction(state?.focuses?.at(-1)),
        agent: state?.agent ? {
          state: state.agent.state,
          transportGeneration: state.agent.transportGeneration,
          bytesReceived: state.agent.bytesReceived,
          bytesSent: state.agent.bytesSent,
          pendingBytes: state.agent.pendingBytes,
        } : null,
        presentation: {
          successfulPresents: presentation?.successfulPresents ?? null,
          scheduler: scheduler ? {
            pending: scheduler.pending, scheduled: scheduler.scheduled,
            paused: scheduler.paused, presented: scheduler.presented,
          } : null,
        },
        audio: {
          policy: audio?.policy?.state ?? null, context: audio?.sink?.context?.state ?? null,
          renderedFrames: audio?.sink?.renderedFrames ?? null,
        },
      };
    });
    if (!progressTimer) return;
    lastProgressSample = {
      timestamp: new Date().toISOString(), phase: probe.phase, event: "sample",
      probeMs: Date.now() - probe.startedAt, ...sample,
    };
    console.error(`[e5-t26f] ${JSON.stringify(lastProgressSample)}`);
  } catch (error) {
    if (progressTimer) console.error(`[e5-t26f] ${JSON.stringify({
      timestamp: new Date().toISOString(), phase: probe.phase, event: "probe-error",
      error: String(error?.message || error).slice(0, 240),
    })}`);
  } finally {
    // Keep the slot until evaluate really settles, including across a reload or a stuck probe.
    // A timeout race that releases it early would let unresolved requests accumulate.
    progressProbe = null;
  }
}

function startProgressSampling() {
  if (progressTimer) return;
  progressTimer = setInterval(() => { void sampleProgress(); }, 30_000);
  progressTimer.unref?.();
}

function stopProgressSampling() {
  if (progressTimer) clearInterval(progressTimer);
  progressTimer = null;
}

function remainingInteractionMs(boundary, now) {
  const remaining = 2_000 - (now - boundary);
  assert.ok(Number.isFinite(boundary) && Number.isFinite(now) && now >= boundary && remaining > 0,
    "post-restore interaction exhausted its original 2-second budget before cursor rendering");
  return remaining;
}

async function waitForRestoredCursor(point, boundary) {
  phaseProgress("post-restore:cursor-render");
  const remainingMs = remainingInteractionMs(boundary, await page.evaluate(() => performance.now()));
  const handle = await page.waitForFunction(({ point: expected, boundary: restoredAt }) => {
    const state = window.__desktopTerminal.state();
    const frame = [...state.pointerFrameSample].reverse().find(
      (entry) => entry.device === "tablet" && entry.source === "pointermove" && entry.coordinates,
    );
    const rendered = window.__desktopCursor?.renderedCursor?.(expected);
    const observedAt = performance.now();
    if (!frame || !rendered || rendered.x !== expected.x || rendered.y !== expected.y ||
        observedAt - restoredAt > 2_000) return false;
    return { frame, rendered, observedAt, elapsedMs: observedAt - restoredAt };
  }, { point, boundary }, { timeout: remainingMs });
  try {
    const sample = await handle.jsonValue();
    phaseProgress("post-restore:cursor-render", "done");
    return sample;
  } finally {
    await handle.dispose();
  }
}

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

async function captureFailure(label, error = null) {
  stopProgressSampling();
  await mkdir(out, { recursive: true });
  const diagnostic = {
    label,
    timestamp: new Date().toISOString(),
    head,
    image: { imageSha256, manifestSha256 },
    lastPhase,
    lastProgressSample,
    milestones,
    error: error ? {
      name: error.name || "Error",
      message: String(error.message || error),
      code: error.code || null,
      stack: String(error.stack || "").slice(0, 8_000),
    } : null,
    progressProbe: progressProbe ? { ...progressProbe, pendingMs: Date.now() - progressProbe.startedAt } : null,
    url: page?.url() || null,
    state: null,
    serial: null,
    serverOutput,
  };
  // Preserve the phase even if the subsequent browser capture itself stalls.
  await writeFile(path.join(out, `${label}.json`), `${JSON.stringify(diagnostic, jsonReplacer, 2)}\n`);
  try {
    if (progressProbe) throw new Error("progress probe still pending; retaining the last completed sample");
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
  await writeFile(path.join(out, `${label}.json`), `${JSON.stringify(diagnostic, jsonReplacer, 2)}\n`);
  await writeFile(path.join(out, `${label}-server.log`), serverOutput);
}

async function launchTerminal(box, label) {
  phaseProgress(`launch:${label}`);
  await page.evaluate((value) => window.__desktopTerminal.beginLaunch(value), label);
  await clickGuest(box, 24, 16);
  await page.waitForFunction(
    () => window.__desktopTerminal.state().active.launch?.terminalRendered === true,
    null,
    { timeout: timeoutMs },
  );
  const state = await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  assert.equal(state.launches.at(-1).accepted, true, `${label}: terminal launcher failed`);
  phaseProgress(`launch:${label}`, "done");
}

async function focusTopWindow(box, label) {
  phaseProgress(`focus:${label}`);
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
  phaseProgress(`focus:${label}:first-settle`);
  await page.waitForTimeout(60_000);
  phaseProgress(`focus:${label}:first-settle`, "done");
  // A second content click removes a rare Weston seat-focus race seen after the first desktop
  // launch; it is harmless for foot and keeps the following physical key burst deterministic.
  const secondBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  await clickGuest(box, point.x, point.y, 1_000);
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames >= minimum,
    secondBefore + 3,
    { timeout: 30_000 },
  );
  phaseProgress(`focus:${label}:second-settle`);
  await page.waitForTimeout(30_000);
  phaseProgress(`focus:${label}:second-settle`, "done");
  await page.evaluate(() => window.__desktopTerminal.focus());
  const state = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  const focus = state.focuses.at(-1);
  assert.equal(focus.accepted, true, `${label}: terminal focus was not recorded`);
  phaseProgress(`focus:${label}`, "done");
  return { point, pointerFrames: focus.pointerFrames };
}

const shiftedPhysicalKey = new Map([
  ...Array.from({ length: 26 }, (_, index) => [String.fromCharCode(65 + index), String.fromCharCode(97 + index)]),
  ["!", "1"], ["@", "2"], ["#", "3"], ["$", "4"], ["%", "5"], ["^", "6"],
  ["&", "7"], ["*", "8"], ["(", "9"], [")", "0"], ["_", "-"], ["+", "="],
  ["{", "["], ["}", "]"], ["|", "\\"], [":", ";"], ["\"", "'"], ["<", ","], [">", "."], ["?", "/"],
]);

async function typePhysicalText(text, keyDelay = 100) {
  for (const character of text) {
    const baseKey = shiftedPhysicalKey.get(character);
    if (baseKey) {
      await page.keyboard.down("Shift");
      await page.keyboard.press(baseKey);
      await page.keyboard.up("Shift");
      if (keyDelay > 0) await page.waitForTimeout(keyDelay);
    } else {
      await page.keyboard.type(character, { delay: keyDelay });
    }
  }
}

async function typeCommand(command, marker, timeout = 240_000, keyDelay = 100) {
  phaseProgress(`command:${marker}:typing`);
  await page.evaluate(({ value, expected }) => window.__desktopTerminal.beginCommand(value, expected), {
    value: command,
    expected: marker,
  });
  await page.evaluate(() => window.__desktopTerminal.focus());
  // The interpreted guest needs a bounded drain interval between physical transitions; a 10 ms
  // burst records every DOM frame but can leave the foot line editor visibly mid-command.
  await typePhysicalText(command, keyDelay);
  await page.keyboard.press("Enter");
  phaseProgress(`command:${marker}:typing`, "done");
  phaseProgress(`command:${marker}:completion`);
  try {
    await page.waitForFunction(
      () => window.__desktopTerminal.state().active.command?.terminalMarkerSeen === true,
      null,
      { timeout },
    );
  } catch (error) {
    await captureFailure(`command-${marker}`, error);
    throw error;
  }
  const state = await page.evaluate((expected) => window.__desktopTerminal.finishCommand(expected), marker);
  const record = state.commands.at(-1);
  assert.equal(record.accepted, true, `${marker}: command was not accepted`);
  phaseProgress(`command:${marker}:completion`, "done");
  return record;
}

async function waitForDesktopReady(label = "desktop ready") {
  phaseProgress(`readiness:${label}`);
  let lastSample = null;
  await waitFor(async () => {
    const sample = await page.evaluate(() => ({
      ready: document.documentElement.dataset.desktopReady || null,
      restored: document.documentElement.dataset.desktopRestored || null,
      status: document.querySelector("[data-status]")?.textContent || null,
      bootStates: window.__desktopTerminal?.state?.().bootStates || [],
      readiness: window.__desktopTerminal?.state?.().readiness || null,
      diagnostics: window.__desktopTerminal?.state?.().diagnostics || [],
      serialTail: (window.__desktopTerminal?.serial?.() || "").slice(-160),
    }));
    lastSample = sample;
    return sample.ready === "ready";
  }, label, timeoutMs).catch((error) => {
    throw new Error(`${error.message}; last sample=${JSON.stringify(lastSample)}`, { cause: error });
  });
  phaseProgress(`readiness:${label}`, "done");
}

async function waitForAgentReady(label = "agent channel ready") {
  phaseProgress(`agent:${label}`);
  try {
    await page.waitForFunction(
      () => window.__desktopTerminal.state().agent?.state === "ready",
      null,
      { timeout: 60_000 },
    );
  } catch (error) {
    await captureFailure("agent-ready", error);
    const state = await page.evaluate(() => window.__desktopTerminal.state());
    throw new Error(`${label}: ${error.message}; state=${JSON.stringify({
      agent: state.agent,
      readiness: state.readiness,
      diagnostics: state.diagnostics,
    })}`, { cause: error });
  }
  const state = await page.evaluate(() => window.__desktopTerminal.state().agent);
  phaseProgress(`agent:${label}`, "done");
  return state;
}

async function waitForReadyAndRestore(label) {
  await waitForDesktopReady(`${label}:desktop ready`);
  phaseProgress(`restore:${label}:completion`);
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
  phaseProgress(`restore:${label}:completion`, "done");
  phaseProgress(`restore:${label}:first-present`);
  await page.waitForFunction(
    () => window.__desktopTerminal.restoreObservation?.().firstPresent !== null,
    null,
    { timeout: 60_000 },
  );
  // Keep this read synchronous: snapshotDecision reassembles the persisted whole-machine blob.
  // Its audit belongs after the interaction measured from the original restore completedAt.
  const result = await page.evaluate(() => {
    const result = window.__desktopTerminal.restoreResult();
    const observation = window.__desktopTerminal.restoreObservation();
    const controller = window.__desktopController;
    const state = window.__desktopTerminal.state();
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
      bootStates: state.bootStates,
      diagnostics: state.diagnostics,
      machineResume: result?.machineResume || null,
      preFrontBufferCrc: result?.preFrontBufferCrc || null,
      resume: {
        restored: Boolean(controller?.restoredFromBootSnapshot?.()),
        snapshotDecision: null,
        overlayGeneration: null,
      },
      coherenceAudit: { status: "deferred" },
      presentation: window.__desktopTerminal.presentation(),
    };
  });
  phaseProgress(`restore:${label}:first-present`, "done");
  return result;
}

async function auditRestoreCoherence(result, snapshot, label) {
  phaseProgress(`restore:${label}:coherence-audit`);
  const audit = result.coherenceAudit;
  audit.status = "running";
  audit.startedAt = new Date().toISOString();
  try {
    // Read the actual controller values before another save can replace the blob being audited.
    result.resume.snapshotDecision = await page.evaluate(async () =>
      await window.__desktopController?.snapshotDecision?.() ?? null);
    result.resume.overlayGeneration = await page.evaluate(async () =>
      await window.__desktopController?.snapshotGeneration?.() ?? null);
    assert.equal(result.resume.restored, true, `${label} reload did not restore the whole-machine snapshot`);
    assert.equal(result.resume.snapshotDecision, "resume", `${label} whole-machine snapshot was not coherent`);
    assert.ok(Number.isSafeInteger(result.resume.overlayGeneration), `${label} actual overlay generation is missing`);
    assert.equal(result.resume.overlayGeneration, snapshot.machineResume?.overlayGeneration,
      `${label} actual overlay generation differs from the saved snapshot`);
    audit.status = "passed";
    phaseProgress(`restore:${label}:coherence-audit`, "done");
  } catch (error) {
    audit.status = "failed";
    audit.error = String(error?.message || error);
    throw error;
  } finally {
    audit.completedAt = new Date().toISOString();
  }
}

async function reloadWithAutoRestore(url, label) {
  phaseProgress(`reload:${label}`);
  await page.evaluate((nextUrl) => history.replaceState(null, "", nextUrl), url);
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  phaseProgress(`reload:${label}`, "done");
  return waitForReadyAndRestore(label);
}

try {
  phaseProgress("server:startup");
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
  phaseProgress("server:startup", "done");

  phaseProgress("browser:launch");
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
  startProgressSampling();
  phaseProgress("browser:launch", "done");
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
  phaseProgress("browser:initial-load");
  await page.goto(coldUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  phaseProgress("browser:initial-load", "done");
  await waitForDesktopReady("initial desktop ready");
  milestones.initialReadiness = { completedAt: new Date().toISOString() };
  await page.waitForTimeout(2_000);
  const box = await desktopBox();

  await launchTerminal(box, "e5-t26f-terminal-1");
  await focusTopWindow(box, "terminal-1");
  const shellProbe = await typeCommand(
    "true; printf '\\033[42;30me5t26f-shell-ok\\033[0m\\n'",
    "e5t26f-shell-ok",
  );
  assert.equal(shellProbe.redMarkerSeen, false, "guest shell probe reported failure");
  milestones.shellProbe = shellProbe;
  const agentProbe = await waitForAgentReady();
  assert.equal(agentProbe.state, "ready", "agent channel did not complete HELLO");
  milestones.agentProbe = agentProbe;
  // Keep the setup-and-run burst below the guest input queue's 256-event budget. The command
  // builds a deterministic 20 ms S16 stereo fixture (3840 bytes at 48 kHz), then writes a short
  // replay script whose marker is emitted only after finite aplay completion. The post-restore
  // command is only `sh /tmp/a`, so it cannot spend the 2-second interaction budget in a full
  // one-second /dev/urandom stream.
  const aplayCommand = "yes \"$(printf '\\001\\000\\377\\177')\"|head -c3840 >/tmp/p;printf 'aplay -f S16_LE -t raw -r48000 -c2 /tmp/p&&printf \"\\033[42me5t26f-aplay\\033[0m\\n\"' >/tmp/a;sh /tmp/a";
  const firstCommand = await typeCommand(aplayCommand, "e5t26f-aplay-ok");
  assert.equal(firstCommand.terminalMarkerSeen, true, "initial aplay was not guest-visibly completed");
  assert.ok(firstCommand.visualDiffPixels >= 2_000, "initial aplay marker did not change guest pixels");
  milestones.initialAplay = firstCommand;
  const focusProof = await page.evaluate(() => window.__desktopTerminal.confirmGuestFocus("e5t26f-shell-ok"));
  assert.equal(focusProof.focuses.at(-1).guestVisible, true, "terminal focus was not guest-visibly used");
  await launchTerminal(box, "e5-t26f-terminal-2");
  await focusTopWindow(box, "terminal-2");
  milestones.twoWindows = { completedAt: new Date().toISOString() };

  phaseProgress("cursor:initial-render");
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
  milestones.initialCursor = cursorProof;
  phaseProgress("cursor:initial-render", "done");

  phaseProgress("snapshot:normal");
  const preSnapshotPresents = await page.evaluate(() => window.__desktopTerminal.presentation().successfulPresents);
  const normalSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: true }));
  assert.equal(normalSnapshot.schema, "wasm-vm.e5-t26f.desktop-snapshot.v1");
  assert.match(normalSnapshot.sha256, SHA256);
  assert.ok(normalSnapshot.byteLength > 0, "normal desktop snapshot is empty");
  assert.match(normalSnapshot.preFrontBufferCrc, /^[0-9a-f]{8}$/u, "normal snapshot lacks a frozen front-buffer CRC");
  milestones.normalSnapshot = {
    sha256: normalSnapshot.sha256, byteLength: normalSnapshot.byteLength,
    preFrontBufferCrc: normalSnapshot.preFrontBufferCrc, machineResume: normalSnapshot.machineResume,
  };
  phaseProgress("snapshot:normal", "done");

  const firstRestore = await reloadWithAutoRestore(restoreUrl, "normal");
  milestones.normalRestore = { result: firstRestore, displayChecksPassed: false, checksPassed: false };
  phaseProgress("restore:normal:display-checks");
  assert.equal(firstRestore.snapshotSha256, normalSnapshot.sha256, "reload restored a different snapshot");
  assert.equal(firstRestore.observation.firstPresent.crc32, normalSnapshot.preFrontBufferCrc, "first restore frame CRC changed");
  assert.equal(firstRestore.report?.fullRepairFrame, true, "restore did not publish a full repair frame");
  assert.equal(firstRestore.report?.agentRehandshake, true, "restore did not re-handshake the agent");
  assert.equal(firstRestore.handshake?.version, 1, "agent protocol version");
  assert.equal(normalSnapshot.machineResume?.persisted, true, "normal snapshot lacks a whole-machine resume");
  assert.deepEqual(firstRestore.machineResume, normalSnapshot.machineResume, "resume metadata was not preserved through reload");
  assert.equal(firstRestore.preFrontBufferCrc, normalSnapshot.preFrontBufferCrc, "restore lost the frozen CRC metadata");
  assert.equal(firstRestore.resume.restored, true, "reload did not restore the whole-machine snapshot");
  assert.equal(firstRestore.bootStates.some(({ state }) => state === "booting"), false,
    "whole-machine resume unexpectedly entered the cold guest boot state");
  milestones.normalRestore.displayChecksPassed = true;
  phaseProgress("restore:normal:display-checks", "done");

  phaseProgress("post-restore:focus-and-gesture");
  const postRestoreStart = firstRestore.completedAt;
  assert.ok(Number.isFinite(postRestoreStart), "restore did not expose a timing boundary");
  const postBox = await desktopBox();
  const focusBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const topPoint = await page.evaluate(() => window.__desktopCursor?.focusGuestPoint?.());
  assert.ok(topPoint, "post-restore focus point is missing");
  await page.evaluate(() => window.__desktopTerminal.beginFocus("post-restore-focus"));
  const focusClient = guestPoint(postBox, topPoint.x, topPoint.y);
  const audioBefore = await page.evaluate(() => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
  }));
  assert.equal(audioBefore.policy, "locked", "audio was already unlocked before the delayed gesture");
  await page.waitForTimeout(350);
  await page.mouse.move(focusClient.x, focusClient.y);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForFunction(
    (minimum) => window.__desktopTerminal.state().pointerFrames > minimum,
    focusBefore,
    { timeout: 2_000 },
  );
  await page.evaluate(() => window.__desktopTerminal.focus());
  phaseProgress("post-restore:focus-and-gesture", "done");
  const postRestoreCursor = await waitForRestoredCursor(topPoint, postRestoreStart);
  assert.ok(postRestoreCursor.frame, "post-restore pointer did not reach the guest");
  assert.ok(postRestoreCursor.rendered, "post-restore cursor was not guest-visibly rendered");
  assert.equal(postRestoreCursor.rendered.x, topPoint.x, "post-restore cursor x is stale");
  assert.equal(postRestoreCursor.rendered.y, topPoint.y, "post-restore cursor y is stale");
  milestones.postRestoreCursor = postRestoreCursor;
  phaseProgress("post-restore:audio-unlock");
  const focusState = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  assert.equal(focusState.focuses.at(-1).accepted, true, "post-restore host focus was not accepted");
  await page.waitForFunction(
    () => window.__desktopTerminal.audio()?.policy?.state === "unlocked",
    null,
    { timeout: 2_000 },
  );
  const postAudioBefore = await page.evaluate(() => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    writeIndex: window.__desktopTerminal.audio()?.pcm?.().writeIndex ?? null,
  }));
  milestones.postRestoreAudioBefore = postAudioBefore;
  phaseProgress("post-restore:audio-unlock", "done");
  const postAudioCommand = await typeCommand(
    "sh /tmp/a",
    "e5t26f-post-aplay",
    120_000,
    0,
  );
  const postFocusState = await page.evaluate(() => window.__desktopTerminal.confirmGuestFocus("e5t26f-post-aplay"));
  assert.equal(postFocusState.focuses.at(-1).guestVisible, true, "post-restore typing was not guest-visible");
  milestones.postRestoreAplay = postAudioCommand;
  phaseProgress("post-restore:audio-pcm-and-render");
  // Capture PCM at the completion boundary. A later digital-silence write can wrap the ring and
  // erase a short fixture before a second diagnostic read, so the proof is the immediate
  // before/after delta rather than a delayed scan after the render clock catches up.
  const postPcmAtCompletion = await page.evaluate((writeIndex) => ({
    observedAt: performance.now(),
    pcm: window.__desktopTerminal.audio()?.pcm?.(writeIndex) || null,
  }), postAudioBefore.writeIndex);
  assert.ok(postPcmAtCompletion.pcm?.writtenFrames > 0, "post-restore aplay wrote no guest PCM at completion");
  assert.ok(postPcmAtCompletion.pcm?.nonSilentFrames > 0 && postPcmAtCompletion.pcm?.maxAbs > 0,
    "post-restore audio PCM was silent at completion");
  await page.waitForFunction(
    ({ minimum }) => {
      const frames = window.__desktopTerminal.audio()?.sink?.renderedFrames;
      return Number.isSafeInteger(frames) && frames > minimum;
    },
    { minimum: postAudioBefore.renderedFrames },
    { timeout: 2_000 },
  );
  const postAudioAfter = await page.evaluate(async ({ completion, writeIndex }) => ({
    policy: window.__desktopTerminal.audio()?.policy?.state || null,
    context: window.__desktopTerminal.audio()?.sink?.context?.state || null,
    renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    pcm: completion.pcm,
    pcmObservedAt: completion.observedAt,
    writeIndex,
    guestAttached: await window.__desktopController?.audioOutputReady?.() ?? false,
  }), { completion: postPcmAtCompletion, writeIndex: postAudioBefore.writeIndex });
  assert.ok(postAudioAfter.renderedFrames > postAudioBefore.renderedFrames,
    "post-restore aplay did not advance rendered audio frames");
  assert.equal(postAudioAfter.guestAttached, true, "guest audio output was not attached");
  assert.ok(postAudioAfter.pcm?.writtenFrames > 0, "post-restore aplay wrote no guest PCM");
  assert.ok(postAudioAfter.pcm?.nonSilentFrames > 0 && postAudioAfter.pcm?.maxAbs > 0,
    "post-restore audio PCM was silent");
  milestones.postRestoreAudioAfter = postAudioAfter;
  phaseProgress("post-restore:audio-pcm-and-render", "done");
  phaseProgress("post-restore:interaction-checks");
  const postRestoreEnd = await page.evaluate(() => performance.now());
  const postRestoreInteraction = await page.evaluate((boundary) => ({
    elapsedMs: performance.now() - boundary,
    pointerFrames: window.__desktopTerminal.state().pointerFrames,
    keyboardFrames: window.__desktopTerminal.state().keyboardFrames,
    heldButtons: window.__desktopTerminal.pointerState()?.heldButtons || [],
    audio: {
      policy: window.__desktopTerminal.audio()?.policy?.state || null,
      context: window.__desktopTerminal.audio()?.sink?.context?.state || null,
      renderedFrames: window.__desktopTerminal.audio()?.sink?.renderedFrames ?? null,
    },
  }), postRestoreStart);
  try {
    assert.ok(postRestoreInteraction.pointerFrames > focusBefore, "post-restore cursor/focus did not move");
    assert.equal(postRestoreInteraction.heldButtons.length, 0, "post-restore focus left a stuck button");
    assert.equal(postRestoreInteraction.audio.policy, "unlocked", "user gesture did not unlock audio");
    assert.ok(postAudioCommand.terminalMarkerSeen && postAudioCommand.visualDiffPixels >= 2_000,
      "post-restore aplay did not produce guest-visible terminal output");
    assert.ok(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds");
  } catch (error) {
    await captureFailure("post-restore", error);
    throw error;
  }
  milestones.postRestoreInteraction = postRestoreInteraction;
  phaseProgress("post-restore:interaction-checks", "done");

  await auditRestoreCoherence(firstRestore, normalSnapshot, "normal");
  milestones.normalRestore.checksPassed = true;

  phaseProgress("drag:prepare");
  const dragChrome = await page.evaluate(() => window.__desktopCursor.detectWindowChrome());
  assert.ok(dragChrome?.titlebar, "drag snapshot has no detected titlebar");
  const dragY = (dragChrome.titlebar.top + dragChrome.titlebar.bottom) / 2;
  const dragStart = guestPoint(postBox, dragChrome.titlebar.left + 100, dragY);
  const dragEnd = guestPoint(postBox, dragChrome.titlebar.left + 180, dragY);
  await page.mouse.move(dragStart.x, dragStart.y);
  await page.waitForTimeout(100);
  phaseProgress("drag:prepare", "done");
  phaseProgress("snapshot:drag-before");
  const beforeDragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: false }));
  assert.match(beforeDragSnapshot.sha256, SHA256);
  milestones.dragBeforeSnapshot = { sha256: beforeDragSnapshot.sha256, byteLength: beforeDragSnapshot.byteLength };
  phaseProgress("snapshot:drag-before", "done");
  phaseProgress("snapshot:drag-held");
  await page.mouse.down();
  await page.waitForTimeout(100);
  const heldDragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: false }));
  assert.match(heldDragSnapshot.sha256, SHA256);
  milestones.dragHeldSnapshot = { sha256: heldDragSnapshot.sha256, byteLength: heldDragSnapshot.byteLength };
  phaseProgress("snapshot:drag-held", "done");
  phaseProgress("snapshot:drag-moving");
  await page.mouse.move(dragEnd.x, dragEnd.y);
  await page.waitForTimeout(100);
  const dragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: true }));
  milestones.dragSnapshot = {
    sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength,
    preFrontBufferCrc: dragSnapshot.preFrontBufferCrc, machineResume: dragSnapshot.machineResume,
  };
  phaseProgress("snapshot:drag-moving", "done");
  phaseProgress("snapshot:drag-released");
  await page.mouse.up();
  await page.waitForTimeout(100);
  const releasedDragSnapshot = await page.evaluate(() => window.__desktopTerminal.saveDesktopSnapshot({ persist: false }));
  assert.match(releasedDragSnapshot.sha256, SHA256);
  assert.match(dragSnapshot.sha256, SHA256);
  assert.ok(dragSnapshot.byteLength > 0, "drag desktop snapshot is empty");
  milestones.dragReleasedSnapshot = { sha256: releasedDragSnapshot.sha256, byteLength: releasedDragSnapshot.byteLength };
  phaseProgress("snapshot:drag-released", "done");

  const secondRestore = await reloadWithAutoRestore(restoreUrl, "drag");
  milestones.dragRestore = { result: secondRestore, displayChecksPassed: false, checksPassed: false };
  phaseProgress("restore:drag:display-and-button-checks");
  assert.equal(secondRestore.snapshotSha256, dragSnapshot.sha256, "drag snapshot was not restored");
  assert.equal(secondRestore.report?.fullRepairFrame, true, "drag restore did not publish a repair frame");
  assert.equal(secondRestore.observation.firstPresent.crc32, dragSnapshot.preFrontBufferCrc, "drag restore frame CRC changed");
  assert.equal(dragSnapshot.machineResume?.persisted, true, "drag snapshot lacks a whole-machine resume");
  assert.deepEqual(secondRestore.machineResume, dragSnapshot.machineResume, "drag resume metadata was not preserved through reload");
  assert.equal(secondRestore.resume.restored, true, "drag reload did not restore the whole-machine snapshot");
  assert.equal(secondRestore.bootStates.some(({ state }) => state === "booting"), false,
    "drag whole-machine resume unexpectedly entered the cold guest boot state");
  const afterDragState = await page.evaluate(() => ({
    pointer: window.__desktopTerminal.pointerState(),
    observation: window.__desktopTerminal.restoreObservation(),
    presentation: window.__desktopTerminal.presentation(),
  }));
  assert.deepEqual(afterDragState.pointer.heldButtons, [], "drag restore retained a pressed button");
  assert.ok(afterDragState.observation.firstPresent, "drag restore has no first-present observation");
  assert.ok(afterDragState.presentation.successfulPresents > 0, "drag restore has no presented frame");
  milestones.dragRestore.displayChecksPassed = true;
  phaseProgress("restore:drag:display-and-button-checks", "done");
  await auditRestoreCoherence(secondRestore, dragSnapshot, "drag");
  milestones.dragRestore.checksPassed = true;

  phaseProgress("evidence:write");
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
      normal: { sha256: normalSnapshot.sha256, byteLength: normalSnapshot.byteLength, machineResume: normalSnapshot.machineResume, preFrontBufferCrc: normalSnapshot.preFrontBufferCrc, preSuccessfulPresents: preSnapshotPresents },
      dragPhases: {
        before: { sha256: beforeDragSnapshot.sha256, byteLength: beforeDragSnapshot.byteLength },
        held: { sha256: heldDragSnapshot.sha256, byteLength: heldDragSnapshot.byteLength },
        moving: { sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength, machineResume: dragSnapshot.machineResume, preFrontBufferCrc: dragSnapshot.preFrontBufferCrc },
        released: { sha256: releasedDragSnapshot.sha256, byteLength: releasedDragSnapshot.byteLength },
      },
      duringDrag: { sha256: dragSnapshot.sha256, byteLength: dragSnapshot.byteLength, preFrontBufferCrc: dragSnapshot.preFrontBufferCrc },
    },
    restores: {
      normal: firstRestore,
      duringDrag: secondRestore,
    },
    interactions: {
      shellProbe,
      agentProbe,
      firstCommand,
      postAudioCommand,
      cursor: cursorProof,
      postRestore: postRestoreInteraction,
      postRestoreAudioBefore: audioBefore,
      postRestoreAudioAfter: postAudioAfter,
      postRestoreCursor,
      postRestoreAudioRenderedFrameDelta: postAudioAfter.renderedFrames - postAudioBefore.renderedFrames,
      postRestoreElapsedMeasuredMs: postRestoreEnd - postRestoreStart,
      dragButtonReleased: afterDragState.pointer.heldButtons.length === 0,
    },
    final: finalState,
    errors: { browser: browserErrors, http: httpErrors },
    elapsedMs: Date.now() - startedAt,
  };
  await writeFile(path.join(out, "desktop-roundtrip.json"), `${JSON.stringify(result, jsonReplacer, 2)}\n`);
  await writeFile(path.join(out, "desktop-roundtrip-server.log"), serverOutput);
  phaseProgress("evidence:write", "done");
  console.log(JSON.stringify(result, jsonReplacer, 2));
} catch (error) {
  const phase = lastPhase?.phase || "setup";
  phaseProgress(phase, "failed");
  const label = `failure-${phase.replace(/[^a-zA-Z0-9_.-]/gu, "-")}`;
  await captureFailure(label, error).catch((captureError) => {
    console.error(`[e5-t26f] ${JSON.stringify({
      timestamp: new Date().toISOString(), phase, event: "capture-error",
      error: String(captureError?.message || captureError).slice(0, 240),
    })}`);
  });
  throw error;
} finally {
  stopProgressSampling();
  await context?.close().catch(() => {});
  await browser?.close().catch(() => {});
  if (server) {
    try { process.kill(-server.pid, "SIGTERM"); } catch (error) { if (error?.code !== "ESRCH") throw error; }
    await sleep(300);
    server.unref();
  }
}
