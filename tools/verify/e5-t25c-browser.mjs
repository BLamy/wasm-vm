#!/usr/bin/env node
// E5-T25c: headed focused-key input-to-first-damage latency, calibration, and recording.
// The detector is pure and separately attacked in Node; this runner supplies the real Foot
// window, physical Chromium KeyboardEvents, Canvas2D presents, and headed rAF timing.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  KEY_LATENCY_TRIAL_COUNT,
  KEY_LATENCY_WARMUP_COUNT,
  PRESENT_DELAY_CALIBRATION_MS,
  calibratePresentDelay,
  summarizeKeyLatency,
} from "../../web/bench/desktop-perf.js";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const execFile = promisify(execFileCallback);
const out = path.resolve(process.env.E5_T25C_OUT || path.join(repo, "evidence/e5-t25c/browser"));
const assetRoot = path.resolve(process.env.E5_T25C_ASSET_DIR || path.join(repo, "target/e5-t22c/chunks/desktop-solid-v7"));
const imageInfoPath = path.resolve(process.env.E5_T25C_IMAGE_INFO || path.join(repo, "target/e5-t22c/desktop-image-solid-v7/desktop-info.json"));
const timeoutMs = Number(process.env.E5_T25C_TIMEOUT_MS || 900_000);
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 120_000, "timeout must be at least two minutes");

const CALIBRATION_TRIALS = 20;
const CROSS_CHECK_TRIAL_INDEX = 0;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
const imageSha256 = process.env.E5_T25C_IMAGE_SHA256 || imageInfo.image?.sha256;
assert.match(imageSha256, /^[0-9a-f]{64}$/);
const { stdout: headOutput } = await execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd: repo });
const head = headOutput.trim();
assert.match(head, /^[0-9a-f]{40}$/, "runner must record an exact Git head");
if (process.env.E5_T25C_REQUIRE_HEAD) assert.equal(head, process.env.E5_T25C_REQUIRE_HEAD);

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
let video;
let screenCapture = null;
let cdp;
const errors = [];
const httpErrors = [];

async function guestPoint(box, x, y) {
  return { x: box.x + ((x / 1280) * box.width), y: box.y + ((y / 800) * box.height) };
}

async function clickGuest(box, x, y) {
  const point = await guestPoint(box, x, y);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(1_000);
  await page.mouse.down();
  await page.mouse.up();
}

async function waitForPointerFrames(minimum) {
  await page.waitForFunction(
    (value) => window.__desktopTerminal?.state?.().pointerFrames >= value,
    minimum,
    { timeout: 30_000 },
  );
}

async function refreshMeasurement() {
  return page.evaluate(async () => new Promise((resolve) => {
    const timestamps = [];
    const startedAt = performance.now();
    const tick = (timestamp) => {
      timestamps.push(timestamp);
      if (timestamps.length < 121) requestAnimationFrame(tick);
      else {
        const deltas = timestamps.slice(1).map((value, index) => value - timestamps[index]);
        const sorted = [...deltas].sort((left, right) => left - right);
        const medianFrameMs = sorted[Math.floor(sorted.length / 2)];
        resolve({
          startedAt,
          endedAt: performance.now(),
          frameCount: timestamps.length,
          medianFrameMs,
          refreshRateHz: 1000 / medianFrameMs,
          timestamps,
        });
      }
    };
    requestAnimationFrame(tick);
  }));
}

async function startScreenCapture() {
  cdp = await context.newCDPSession(page);
  const timeOrigin = await page.evaluate(() => performance.timeOrigin);
  screenCapture = { timeOrigin, frames: [], firstData: null, lastData: null };
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    if (screenCapture === null) {
      await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      return;
    }
    const timestamp = typeof metadata?.timestamp === "number"
      ? (metadata.timestamp * 1_000) - screenCapture.timeOrigin
      : null;
    screenCapture.frames.push({ timestamp, metadata });
    if (screenCapture.firstData === null) screenCapture.firstData = data;
    screenCapture.lastData = data;
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", {
    format: "png",
    quality: 100,
    maxWidth: 1440,
    maxHeight: 1050,
    everyNthFrame: 1,
  });
}

async function stopScreenCapture() {
  if (!screenCapture) return null;
  await cdp.send("Page.stopScreencast").catch(() => {});
  await page.waitForTimeout(100);
  const frames = screenCapture.frames.filter(({ timestamp }) => Number.isFinite(timestamp));
  const deltas = frames.slice(1).map(({ timestamp }, index) => timestamp - frames[index].timestamp)
    .filter((value) => value > 0);
  const sorted = [...deltas].sort((left, right) => left - right);
  const medianFrameMs = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const capture = {
    schema: "wasm-vm.e5-t25c-screencast-v1",
    setup: "headed Chromium CDP Page.startScreencast, PNG, everyNthFrame=1",
    requestedEveryNthFrame: 1,
    timeOrigin: screenCapture.timeOrigin,
    frameCount: frames.length,
    timestamps: frames.map(({ timestamp }) => timestamp),
    medianFrameMs,
    refreshRateHz: medianFrameMs ? 1_000 / medianFrameMs : null,
  };
  if (screenCapture.firstData) {
    await writeFile(path.join(out, "screen-capture-first.png"), Buffer.from(screenCapture.firstData, "base64"));
  }
  if (screenCapture.lastData) {
    await writeFile(path.join(out, "screen-capture-last.png"), Buffer.from(screenCapture.lastData, "base64"));
  }
  screenCapture = null;
  return capture;
}

async function locateCursorCell() {
  return waitFor(async () => page.evaluate(() => {
    const chrome = window.__desktopCursor?.detectWindowChrome?.();
    if (!chrome) return null;
    return window.__e5t25c.findTerminalCursorCell(window.__desktopCursor.pixels(), chrome);
  }), "visible Foot block cursor", 30_000);
}

async function startRafTrace() {
  return page.evaluate(() => {
    const state = { active: true, timestamps: [] };
    const tick = (timestamp) => {
      if (!state.active) return;
      state.timestamps.push(timestamp);
      requestAnimationFrame(tick);
    };
    state.stop = () => { state.active = false; };
    window.__e5t25cTrace = state;
    requestAnimationFrame(tick);
    return true;
  });
}

async function stopRafTrace() {
  return page.evaluate(() => {
    const state = window.__e5t25cTrace;
    if (!state) return [];
    state.stop();
    return [...state.timestamps];
  });
}

async function waitForKeyEvent(minimum, code) {
  const handle = await page.waitForFunction(
    ({ minimum: lowerBound, code: expectedCode }) => window.__desktopPerf.keyboardEvents()
      .slice(lowerBound)
      .find((event) => event.type === "keydown" && event.code === expectedCode) || null,
    { minimum, code },
    { timeout: 30_000 },
  );
  const event = await handle.jsonValue();
  await handle.dispose();
  return event;
}

async function runAdversarialInputChecks(cursorCell) {
  const unfocusedBefore = await page.evaluate(() => {
    const canvas = document.querySelector("#desktop-canvas");
    canvas.blur();
    const priorPresents = window.__desktopPerf.presents();
    const clear = window.__desktopPerf.clear();
    return {
      keyboardEvents: window.__desktopPerf.keyboardEvents().length,
      inputAt: performance.now(),
      focused: document.activeElement === canvas,
      sequenceBefore: priorPresents.at(-1)?.sequence ?? 0,
      clear,
    };
  });
  assert.equal(unfocusedBefore.focused, false, "unfocused attack did not remove canvas focus");
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1_000);
  const unfocusedEvent = await page.evaluate((minimum) => window.__desktopPerf.keyboardEvents()
    .slice(minimum)
    .find((event) => event.type === "keydown" && event.code === "ArrowRight") || null,
  unfocusedBefore.keyboardEvents);
  await page.waitForTimeout(180);
  const unfocusedRejected = await page.evaluate(({ inputAt, sequenceBefore, cursorCell: cell }) => {
    const records = window.__desktopPerf.presents();
    return window.__e5t25c.findFirstIntersectingPresent({
      records,
      inputAt,
      cursorCell: cell,
      focused: false,
      sequenceBefore,
    }) === null;
  }, {
    inputAt: unfocusedEvent?.timestamp ?? unfocusedBefore.inputAt,
    sequenceBefore: unfocusedBefore.sequenceBefore,
    cursorCell,
  });
  assert.equal(unfocusedRejected, true, "unfocused key was attributed to a drawn present");

  await page.evaluate(() => document.querySelector("#desktop-canvas").focus());
  await page.evaluate((delay) => window.__desktopPerf.setPresentDelay(delay), PRESENT_DELAY_CALIBRATION_MS);
  await page.keyboard.press("Home");
  await page.waitForTimeout(80);
  const overlapBefore = await page.evaluate(() => {
    const priorPresents = window.__desktopPerf.presents();
    const clear = window.__desktopPerf.clear();
    return {
      keyboardEvents: window.__desktopPerf.keyboardEvents().length,
      focused: document.activeElement === document.querySelector("#desktop-canvas"),
      sequenceBefore: priorPresents.at(-1)?.sequence ?? 0,
      clear,
    };
  });
  assert.equal(overlapBefore.focused, true, "overlap attack could not restore canvas focus");
  await page.keyboard.press("ArrowRight");
  const firstEvent = await waitForKeyEvent(overlapBefore.keyboardEvents, "ArrowRight");
  await page.keyboard.press("ArrowRight");
  const secondEvent = await waitForKeyEvent(overlapBefore.keyboardEvents + 1, "ArrowRight");
  await page.waitForFunction(() => window.__desktopPerf.presents().length > 0, null, { timeout: 30_000 });
  const overlap = await page.evaluate(({ firstAt, secondAt, sequenceBefore, cursorCell: cell }) => {
    const records = window.__desktopPerf.presents();
    const first = window.__e5t25c.findFirstIntersectingPresent({
      records,
      inputAt: firstAt,
      nextInputAt: secondAt,
      cursorCell: cell,
      focused: true,
      sequenceBefore,
    });
    return { recordCount: records.length, firstAt, secondAt, first };
  }, {
    firstAt: firstEvent.timestamp,
    secondAt: secondEvent.timestamp,
    sequenceBefore: overlapBefore.sequenceBefore,
    cursorCell,
  });
  assert.ok(overlap.recordCount > 0, "overlap attack produced no present to interrogate");
  assert.equal(overlap.first, null, "two keys before first present were attributed to the first key");
  await page.evaluate(() => window.__desktopPerf.setPresentDelay(0));
  await page.keyboard.press("Home");
  await page.waitForTimeout(80);
  await page.evaluate(() => window.__desktopPerf.clear());
  return {
    unfocused: {
      rejected: unfocusedRejected,
      captured: unfocusedEvent !== null,
      keyCode: unfocusedEvent?.code ?? null,
    },
    overlapping: { rejectedFirst: overlap.first === null, recordCount: overlap.recordCount },
  };
}

async function runTrial({ label, cursorCell, trace = false }) {
  if (trace) await startRafTrace();
  await page.keyboard.press("Home");
  await page.waitForTimeout(80);
  const before = await page.evaluate(() => {
    const priorPresents = window.__desktopPerf.presents();
    const clear = window.__desktopPerf.clear();
    return {
      keyboardEvents: window.__desktopPerf.keyboardEvents().length,
      inputAt: performance.now(),
      focused: document.activeElement === document.querySelector("#desktop-canvas"),
      sequenceBefore: priorPresents.at(-1)?.sequence ?? 0,
      clear,
    };
  });
  assert.equal(before.focused, true, `${label}: terminal lost focus before key injection`);
  await page.keyboard.press("ArrowRight");
  const keyEvent = await page.waitForFunction(
    (minimum) => window.__desktopPerf.keyboardEvents().slice(minimum).find((event) => event.type === "keydown" && event.code === "ArrowRight") || null,
    before.keyboardEvents,
    { timeout: 30_000 },
  );
  const event = await keyEvent.jsonValue();
  await keyEvent.dispose();
  assert.ok(event?.timestamp >= before.inputAt, `${label}: missing browser keydown timestamp`);
  await page.waitForFunction(
    ({ inputAt, cursorCell, focused, sequenceBefore }) => window.__desktopPerf.presents().some((record) => {
      try {
        return window.__e5t25c.findFirstIntersectingPresent({
          records: [record], inputAt, cursorCell, focused, sequenceBefore,
        }) !== null;
      } catch {
        return false;
      }
    }),
    { inputAt: event.timestamp, cursorCell, focused: before.focused, sequenceBefore: before.sequenceBefore },
    { timeout: 30_000 },
  );
  const match = await page.evaluate(({ inputAt, cursorCell, focused, sequenceBefore }) => {
    const records = window.__desktopPerf.presents();
    const result = window.__e5t25c.findFirstIntersectingPresent({
      records, inputAt, cursorCell, focused, sequenceBefore,
    });
    return result;
  }, {
    inputAt: event.timestamp,
    cursorCell,
    focused: before.focused,
    sequenceBefore: before.sequenceBefore,
  });
  assert.ok(match, `${label}: detector returned no matching present`);
  const rafTimestamps = trace ? await stopRafTrace() : [];
  return {
    trial: label,
    ...match,
    keyCode: event.code,
    keyEventType: event.type,
    focused: before.focused,
    sequenceBefore: before.sequenceBefore,
    discardedPending: before.clear?.discardedPending === true,
    rafTimestamps,
  };
}

try {
  await waitFor(async () => {
    try { return (await fetch(`${base}/desktop-cursor.html`)).ok; } catch { return false; }
  }, "desktop dev server", 30_000);
  await mkdir(out, { recursive: true });
  const { chromium } = await import(pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")));
  browser = await chromium.launch({
    executablePath: process.env.E5_T25C_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: process.env.E5_T25C_HEADLESS === "1",
    args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows"],
  });
  context = await browser.newContext({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: Number(process.env.E5_T25C_DPR || 1),
    serviceWorkers: "block",
    recordVideo: { dir: out, size: { width: 1440, height: 1050 } },
  });
  page = await context.newPage();
  video = page.video();
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
    testHooks: "1", perfHooks: "1", latencyHooks: "1", jit: "1", quantum: "500000",
    imageSha256, manifestSha256,
  });
  await page.goto(`${base}/desktop-cursor.html?${query}`, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForFunction(() => document.documentElement.dataset.desktopReady === "ready", null, { timeout: timeoutMs });
  await page.waitForFunction(() => window.__desktopPerf?.ready?.() === true && window.__desktopPerf?.latencyHooks === true, null, { timeout: 60_000 });
  await page.evaluate(async () => { window.__e5t25c = await import("./bench/desktop-perf.js"); });

  const canvas = page.locator("#desktop-canvas");
  const canvasBox = await canvas.boundingBox();
  assert.ok(canvasBox?.width > 0 && canvasBox.height > 0, "desktop canvas has no layout");
  await page.evaluate(() => window.__desktopTerminal.beginLaunch("e5-t25c-latency"));
  await clickGuest(canvasBox, 24, 16);
  await page.waitForFunction(() => window.__desktopTerminal.state().active.launch?.terminalRendered === true, null, { timeout: timeoutMs });
  await page.evaluate(() => window.__desktopTerminal.finishLaunch());
  await page.waitForFunction(() => window.__desktopCursor?.detectWindowChrome?.() !== null, null, { timeout: timeoutMs });

  await page.evaluate(() => window.__desktopTerminal.beginFocus("e5-t25c-focus"));
  const pointerBefore = await page.evaluate(() => window.__desktopTerminal.state().pointerFrames);
  const focusGuest = await page.evaluate(() => window.__desktopCursor.focusGuestPoint());
  assert.ok(focusGuest, "Foot focus point is missing");
  await clickGuest(canvasBox, focusGuest.x, focusGuest.y);
  await waitForPointerFrames(pointerBefore + 3);
  // The interpreted guest can consume the click after the pointer RPC has completed. Match the
  // established T18b focus proof: allow one bounded guest interval, then restore host canvas focus
  // before the keyboard-latency trials begin.
  await page.waitForTimeout(30_000);
  await page.evaluate(() => window.__desktopTerminal.focus());
  const focus = await page.evaluate(() => window.__desktopTerminal.finishFocus());
  assert.equal(focus.focuses.at(-1).accepted, true, "terminal focus was not established");

  // Put one harmless character in the shell's readline buffer. Home/ArrowRight then toggles the
  // cursor between two known cells without running a command or changing the row under test.
  await page.keyboard.press("Control+L");
  await page.waitForTimeout(300);
  const beforeCharacter = await page.evaluate(() => window.__desktopTerminal.state().keyboardEvents);
  await page.keyboard.type("x");
  await page.waitForFunction((minimum) => window.__desktopTerminal.state().keyboardEvents >= minimum + 2, beforeCharacter, { timeout: 30_000 });
  await page.waitForTimeout(500);
  const cursorCell = await locateCursorCell();
  assert.ok(cursorCell, "could not locate the focused Foot block cursor");
  const adversarialInput = await runAdversarialInputChecks(cursorCell);

  const refresh = await refreshMeasurement();
  const baselineSamples = [];
  let crossCheck = null;
  await startScreenCapture();
  for (let index = 0; index < KEY_LATENCY_TRIAL_COUNT + KEY_LATENCY_WARMUP_COUNT; index += 1) {
    const sample = await runTrial({
      label: `baseline-${String(index + 1).padStart(3, "0")}`,
      cursorCell,
      trace: index === CROSS_CHECK_TRIAL_INDEX,
    });
    baselineSamples.push(sample);
    if (index === CROSS_CHECK_TRIAL_INDEX) {
      const capture = await stopScreenCapture();
      const timestamps = capture?.timestamps || [];
      const nearest = timestamps.reduce((best, timestamp) => {
        const distance = Math.abs(timestamp - sample.presentAt);
        return !best || distance < best.distance ? { timestamp, distance } : best;
      }, null);
      crossCheck = {
        inputAt: sample.inputAt,
        presentAt: sample.presentAt,
        detectorLatencyMs: sample.latencyMs,
        recordedScreenFrames: timestamps.length,
        nearestScreenTimestamp: nearest?.timestamp ?? null,
        nearestScreenDeltaMs: nearest?.distance ?? null,
        withinOneDisplayFrame: (nearest?.distance ?? Number.POSITIVE_INFINITY) <= refresh.medianFrameMs,
        capture,
      };
    }
  }
  const baseline = summarizeKeyLatency(baselineSamples, {
    warmupDiscardCount: KEY_LATENCY_WARMUP_COUNT,
    refreshRateHz: refresh.refreshRateHz,
  });

  // Interleave the control and delayed samples. A sequential block comparison lets slow guest
  // scheduling drift masquerade as the known delay; adjacent pairs hold that nuisance constant.
  const calibrationBaselineSamples = [];
  const delayedSamples = [];
  for (let index = 0; index < CALIBRATION_TRIALS; index += 1) {
    await page.evaluate(() => window.__desktopPerf.setPresentDelay(0));
    calibrationBaselineSamples.push(await runTrial({
      label: `calibration-control-${String(index + 1).padStart(2, "0")}`,
      cursorCell,
    }));
    await page.evaluate((delay) => window.__desktopPerf.setPresentDelay(delay), PRESENT_DELAY_CALIBRATION_MS);
    delayedSamples.push(await runTrial({
      label: `calibration-delayed-${String(index + 1).padStart(2, "0")}`,
      cursorCell,
    }));
  }
  await page.evaluate(() => window.__desktopPerf.setPresentDelay(0));
  const calibrationBaseline = summarizeKeyLatency(calibrationBaselineSamples, {
    warmupDiscardCount: 0,
    refreshRateHz: refresh.refreshRateHz,
    expectedTrials: CALIBRATION_TRIALS,
  });
  const delayed = summarizeKeyLatency(delayedSamples, {
    warmupDiscardCount: 0,
    refreshRateHz: refresh.refreshRateHz,
    expectedTrials: CALIBRATION_TRIALS,
  });
  const calibration = calibratePresentDelay(calibrationBaseline, delayed);
  assert.equal(calibration.shiftHeld, true, `100 ms present-delay calibration missed: ${JSON.stringify(calibration)}`);
  await page.evaluate(() => window.__desktopPerf.setPresentDelay(0));

  await page.keyboard.press("Control+C");
  assert.deepEqual(errors, [], "browser console errors");
  assert.deepEqual(httpErrors, [], "browser HTTP errors");
  const screenshot = await page.screenshot({ path: path.join(out, "input-photon.png") });
  const result = {
    schema: "wasm-vm.e5-t25c-browser-v1",
    task: "E5-T25c",
    head,
    browser: browser.version(),
    headed: process.env.E5_T25C_HEADLESS !== "1",
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: Number(await page.evaluate(() => devicePixelRatio)),
    image: { imageSha256, manifestSha256, assetRoot },
    focus,
    cursorCell,
    adversarialInput,
    refresh,
    baseline,
    calibration: { ...calibration, baseline: calibrationBaseline, delayed },
    crossCheck,
    screenCapture: crossCheck?.capture ?? null,
    errors,
    httpErrors,
    screenshotSha256: sha256(screenshot),
  };
  await writeFile(path.join(out, "input-photon.json"), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ baseline: { p50: baseline.latencyP50Ms, p95: baseline.latencyP95Ms }, calibration, crossCheck, errors, httpErrors }));
} catch (error) {
  let state = null;
  try {
    state = await page?.evaluate(() => ({
      url: location.href,
      status: document.getElementById("desktop-status")?.textContent,
      ready: document.documentElement.dataset.desktopReady || null,
      inspection: document.documentElement.dataset.desktopInspection || null,
      terminal: window.__desktopTerminal?.state?.() ?? null,
      presentation: window.__desktopTerminal?.presentation?.() ?? null,
      perf: window.__desktopPerf ? {
        version: window.__desktopPerf.version,
        latencyHooks: window.__desktopPerf.latencyHooks,
        ready: window.__desktopPerf.ready?.() ?? false,
        presentDelay: window.__desktopPerf.presentDelay?.() ?? null,
      } : null,
    }));
  } catch { /* retain the process-level error when the page is already gone */ }
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "failure.json"), `${JSON.stringify({
    schema: "wasm-vm.e5-t25c-browser-failure-v1",
    task: "E5-T25c",
    head,
    error: String(error?.stack || error),
    state,
    errors,
    httpErrors,
  }, null, 2)}\n`).catch(() => {});
  await page?.screenshot({ path: path.join(out, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await context?.close().catch(() => {});
  let videoPath = null;
  if (video) videoPath = await video.path().catch(() => null);
  if (videoPath) {
    try {
      await writeFile(path.join(out, "recording-path.txt"), `${videoPath}\n`);
    } catch { /* evidence write is best effort after browser teardown */ }
  }
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
  if (serverOutput && process.env.E5_T25C_VERBOSE === "1") process.stderr.write(serverOutput);
}
