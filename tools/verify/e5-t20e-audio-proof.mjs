#!/usr/bin/env node
// E5-T20e: local Chromium proof for the complete browser audio bridge.
//
// The busybox boot proves that the assembled WasmLinux instance owns the page-provided
// virtio-snd sink. The reference producer below then drives that same sink with deterministic
// S16 ramp/sine data so the real AudioWorklet capture can be checked sample-for-sample. The
// shipped busybox rootfs has no ALSA playback utility, so this deliberately keeps the guest
// transport and browser PCM assertions separate: T19d proves the guest virtio-mmio assembly,
// while this run proves the exact ring/worklet boundary and its measured browser behavior.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence", "e5-t20e");
const evidencePath = path.join(evidenceDir, "audio-proof-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "audio-proof-2026-09-03.png");
const transcriptPath = path.join(evidenceDir, "audio-proof-2026-09-03.txt");
const requestedBase = process.env.E5_T20E_BASE_URL?.replace(/\/$/, "") || null;
const bootTimeout = Number(process.env.E5_T20E_BOOT_TIMEOUT_MS || 180_000);
const rampFrames = Number(process.env.E5_T20E_RAMP_FRAMES || 48_000 * 30);
const starvationFrames = Number(process.env.E5_T20E_STARVATION_FRAMES || 48_000 * 2);
const rateProbeFrames = Number(process.env.E5_T20E_RATE_PROBE_FRAMES || 8_192);
let port = Number(process.env.E5_T20E_PORT || 0);
let server = null;
let browser = null;
let page = null;
let sinePage = null;
let starvationPage = null;
let ratePage = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const hexDigest = (bytes) => Buffer.from(bytes).toString("hex");

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

async function fileParity() {
  const paths = [
    "web/main.js",
    "web/loader.js",
    "web/linux-worker-protocol.js",
    "web/roadmap.js",
    "web/src/audio/ring.js",
    "web/src/audio/autoplay.js",
    "web/src/audio/sink.js",
    "web/src/audio/worklet.js",
  ];
  const parity = [];
  for (const sourcePath of paths) {
    const distPath = sourcePath.replace(/^web\//, "web/dist/");
    const [source, dist] = await Promise.all([
      fs.readFile(path.join(repo, sourcePath)),
      fs.readFile(path.join(repo, distPath)),
    ]);
    assert.deepEqual(dist, source, `${sourcePath} and ${distPath} differ`);
    parity.push({
      source: sourcePath,
      dist: distPath,
      sourceSha256: sha256(source),
      distSha256: sha256(dist),
      equal: true,
    });
  }
  const wasmFiles = (await fs.readdir(path.join(repo, "web/dist/pkg")))
    .filter((name) => name.endsWith(".wasm"))
    .sort();
  const generated = [];
  for (const name of wasmFiles) {
    const bytes = await fs.readFile(path.join(repo, "web/dist/pkg", name));
    generated.push({ path: `web/dist/pkg/${name}`, sha256: sha256(bytes), bytes: bytes.length });
  }
  return { parity, generated };
}

function expectedSample(kind, frame, rate) {
  if (kind === "ramp") return (frame % 65_536) - 32_768;
  return Math.round(Math.sin((2 * Math.PI * 440 * frame) / rate) * 32_767);
}

function expectedDigest(kind, frames, rate) {
  const bytes = Buffer.allocUnsafe(frames * 4);
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = expectedSample(kind, frame, rate);
    bytes.writeInt16LE(sample, frame * 4);
    bytes.writeInt16LE(sample, frame * 4 + 2);
  }
  return sha256(bytes);
}

async function analyzeCapture(targetPage, startBlock, totalFrames, kind, rate, {
  starvation = false,
} = {}) {
  return targetPage.evaluate(async ({ startBlock: first, totalFrames: expectedFrames, kind: pattern, rate: sampleRate, starvation: hasStarvation }) => {
    const blocks = window.__audioCapture.slice(first);
    let capturedFrames = 0;
    let framesInspected = 0;
    let mismatches = 0;
    let sequenceErrors = 0;
    let zeroFrames = 0;
    let previous = null;
    const preview = [];
    const encoded = new Uint8Array(expectedFrames * 4);
    const spectrumSamples = pattern === "sine" ? new Float64Array(Math.min(expectedFrames, 8_192)) : null;
    let tailNonZero = 0;
    let tailTransitions = 0;
    const tailValues = [];

    for (const block of blocks) {
      const blockFrames = Math.max(0, Math.min(Number(block?.frames) || 0, block?.samples?.length / 2 || 0));
      capturedFrames += blockFrames;
      for (let index = 0; index < blockFrames && framesInspected < expectedFrames; index += 1) {
        const left = Math.round(block.samples[index * 2] * 32_768);
        const right = Math.round(block.samples[index * 2 + 1] * 32_768);
        const expected = pattern === "ramp"
          ? ((framesInspected % 65_536) - 32_768)
          : Math.round(Math.sin((2 * Math.PI * 440 * framesInspected) / sampleRate) * 32_767);
        if (left !== expected || right !== expected) mismatches += 1;
        if (preview.length < 8) preview.push({ frame: framesInspected, left, right, expected });
        if (left === 0 && right === 0 && expected !== 0) zeroFrames += 1;
        if (previous !== null && pattern === "ramp") {
          const delta = left - previous;
          if (delta !== 1 && delta !== -65_535) sequenceErrors += 1;
        }
        if (framesInspected < encoded.length / 4) {
          const offset = framesInspected * 4;
          encoded[offset] = left & 0xff;
          encoded[offset + 1] = (left >> 8) & 0xff;
          encoded[offset + 2] = right & 0xff;
          encoded[offset + 3] = (right >> 8) & 0xff;
        }
        if (spectrumSamples && framesInspected < spectrumSamples.length) spectrumSamples[framesInspected] = left;
        previous = left;
        framesInspected += 1;
      }
    }

    const tailStart = Math.max(0, framesInspected - Math.min(2_048, framesInspected));
    if (hasStarvation) {
      for (let index = tailStart; index < framesInspected; index += 1) {
        const byteOffset = index * 4;
        const value = encoded[byteOffset] | (encoded[byteOffset + 1] << 8);
        const signed = value & 0x8000 ? value - 0x1_0000 : value;
        if (signed !== 0) tailNonZero += 1;
        if (index > tailStart) {
          const previousOffset = (index - 1) * 4;
          const previousValue = encoded[previousOffset] | (encoded[previousOffset + 1] << 8);
          const previousSigned = previousValue & 0x8000 ? previousValue - 0x1_0000 : previousValue;
          const delta = signed - previousSigned;
          if (delta === 1 || delta === -65_535) tailTransitions += 1;
        }
        tailValues.push(signed);
      }
    }

    let peakHz = null;
    let peakToBandRatio = null;
    let peakToNeighborDb = null;
    if (spectrumSamples) {
      const count = spectrumSamples.length;
      const powers = [];
      for (let frequency = 400; frequency <= 480; frequency += 1) {
        let real = 0;
        let imaginary = 0;
        for (let index = 0; index < count; index += 1) {
          const angle = (2 * Math.PI * frequency * index) / sampleRate;
          real += spectrumSamples[index] * Math.cos(angle);
          imaginary -= spectrumSamples[index] * Math.sin(angle);
        }
        powers.push({ frequency, power: real * real + imaginary * imaginary });
      }
      powers.sort((a, b) => b.power - a.power);
      const peak = powers[0];
      const bandPower = powers.reduce((sum, item) => sum + item.power, 0);
      const neighbors = powers.filter((item) => Math.abs(item.frequency - peak.frequency) > 2);
      const neighborPower = neighbors.reduce((sum, item) => sum + item.power, 0) / Math.max(1, neighbors.length);
      peakHz = peak.frequency;
      peakToBandRatio = peak.power / Math.max(1, bandPower);
      peakToNeighborDb = 10 * Math.log10(peak.power / Math.max(1, neighborPower));
    }

    const digest = await crypto.subtle.digest("SHA-256", encoded);
    return {
      blockCount: blocks.length,
      capturedFrames,
      framesInspected,
      mismatches,
      sequenceErrors,
      zeroFrames,
      preview,
      captureDigest: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join(""),
      peakHz,
      peakToBandRatio,
      peakToNeighborDb,
      tailFrames: tailValues.length,
      tailNonZero,
      tailTransitions,
    };
  }, { startBlock, totalFrames, kind, rate, starvation });
}

async function capturedFrames(targetPage, startBlock) {
  return targetPage.evaluate((first) => window.__audioCapture
    .slice(first)
    .reduce((total, block) => total + (Number(block?.frames) || 0), 0), startBlock);
}

async function waitForCaptured(targetPage, startBlock, totalFrames, timeout = 10_000) {
  await targetPage.waitForFunction(({ first, expected }) => {
    let total = 0;
    for (let index = first; index < (window.__audioCapture?.length || 0); index += 1) {
      total += Number(window.__audioCapture[index]?.frames) || 0;
      if (total >= expected) return true;
    }
    return false;
  }, { first: startBlock, expected: totalFrames }, { timeout, polling: 50 });
}

async function unlockAndStart(targetPage, kind = "ramp") {
  const captureStart = await targetPage.evaluate(() => window.__audioCapture.length);
  const clockBefore = await targetPage.evaluate(() => window.__audioSink.renderedFrames);
  await targetPage.mouse.click(500, 500);
  // The click handler has started resume(), but the async AudioWorklet module load has not yet
  // completed. Fill the ring during that gap so the first render quantum cannot underrun.
  const seed = await targetPage.evaluate((pattern) => {
    const sink = window.__audioSink;
    const frames = new Int16Array(4_096 * 2);
    for (let frame = 0; frame < 4_096; frame += 1) {
      const value = pattern === "ramp"
        ? (frame % 65_536) - 32_768
        : Math.round(Math.sin((2 * Math.PI * 440 * frame) / sink.sampleRateHz) * 32_767);
      frames[frame * 2] = value;
      frames[frame * 2 + 1] = value;
    }
    return sink.push(frames, sink.sampleRateHz);
  }, kind);
  await targetPage.waitForFunction(() => window.__audioAutoplayPolicy?.state === "unlocked"
    && Boolean(window.__audioSink?.workletNode), null, { timeout: 15_000 });
  const clockAtUnlock = await targetPage.evaluate(() => window.__audioSink.renderedFrames);
  // Let the first port messages cross into the page before a later producer stage records its
  // capture start. The seed ring has >80 ms of headroom, so this does not create an underrun.
  await sleep(50);
  return {
    captureStart,
    clockBefore,
    clockAtUnlock,
    seed,
    captureAfterWarmup: await targetPage.evaluate(() => window.__audioCapture
      .slice(0, 3)
      .map((block) => ({
        frames: block.frames,
        samples: Array.from(block.samples.slice(0, 4)).map((sample) => Math.round(sample * 32_768)),
      }))),
  };
}

async function runPattern(targetPage, {
  kind,
  totalFrames,
  starveAtMs = null,
  starveForMs = 0,
  tailFrames = 4_096,
  initialCursor = 0,
  captureStart = null,
  seedFrames = 4_096,
}) {
  return targetPage.evaluate(async ({ pattern, expectedFrames, starvationAt, starvationDuration, tail, startCursor, firstCapture, seed }) => {
    const sink = window.__audioSink;
    const rate = sink.sampleRateHz;
    const captureStartBlock = firstCapture === null ? window.__audioCapture.length : firstCapture;
    let cursor = startCursor;
    let pushes = 0;
    let acceptedFrames = 0;
    let droppedFrames = 0;
    let postStarveFrames = 0;
    let starvationSeen = false;
    let resumeSeen = false;
    const started = performance.now();

    const push = (count) => {
      const frames = new Int16Array(count * 2);
      for (let frame = 0; frame < count; frame += 1) {
        const sample = pattern === "ramp"
          ? ((cursor + frame) % 65_536) - 32_768
          : Math.round(Math.sin((2 * Math.PI * 440 * (cursor + frame)) / rate) * 32_767);
        frames[frame * 2] = sample;
        frames[frame * 2 + 1] = sample;
      }
      const result = sink.push(frames, rate);
      pushes += 1;
      cursor += result.acceptedFrames;
      acceptedFrames += result.acceptedFrames;
      droppedFrames += result.droppedFrames;
      if (resumeSeen) postStarveFrames += result.acceptedFrames;
      return result;
    };

    // A full seed prevents the first live quantum from racing the producer. The unlock stage can
    // supply this seed itself, so its capture remains contiguous with the post-unlock producer.
    if (seed > 0) push(Math.min(seed, expectedFrames + tail - cursor));
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        clearInterval(timer);
        reject(new Error("reference producer exceeded its bounded deadline"));
      }, Math.max(10_000, ((expectedFrames + tail) / rate) * 1_000 + 10_000));
      const timer = setInterval(() => {
        const elapsed = performance.now() - started;
        const inStarvation = starvationAt !== null
          && elapsed >= starvationAt
          && elapsed < starvationAt + starvationDuration;
        if (inStarvation) {
          starvationSeen = true;
          return;
        }
        if (starvationSeen && !resumeSeen) resumeSeen = true;
        const remaining = expectedFrames + tail - cursor;
        const available = sink.ring.capacityFrames - sink.ring.fillFrames;
        if (remaining > 0 && available > 0) push(Math.min(256, remaining, available));
        if (cursor >= expectedFrames + tail) {
          clearTimeout(deadline);
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });
    return {
      rate,
      captureStart: captureStartBlock,
      cursor,
      targetFrames: expectedFrames,
      acceptedFrames,
      droppedFrames,
      pushes,
      postStarveFrames,
      elapsedMs: performance.now() - started,
      stats: sink.stats(),
      renderedFrames: sink.renderedFrames,
    };
  }, {
    pattern: kind,
    expectedFrames: totalFrames,
    starvationAt: starveAtMs,
    starvationDuration: starveForMs,
    tail: tailFrames,
    startCursor: initialCursor,
    firstCapture: captureStart,
    seed: seedFrames,
  });
}

async function setUpPage(targetPage, base, rate = null) {
  const query = [
    "guest=busybox",
    "nosw=1",
    "testHooks=1",
    "noAutoBoot=1",
    "jit=0",
    "audioCapture=1",
    "quantum=50000",
    ...(rate ? [`audioRate=${rate}`] : []),
  ].join("&");
  const url = `${base}/index.html?${query}#ide`;
  const errors = { console: [], page: [], requests: [] };
  const faviconPath = "/favicon.ico";
  targetPage.on("console", (message) => {
    if (message.type() === "error" && new URL(message.location().url || base).pathname !== faviconPath) {
      errors.console.push({ text: message.text(), url: message.location().url });
    }
  });
  targetPage.on("pageerror", (error) => errors.page.push(error.message));
  targetPage.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname !== faviconPath) {
      errors.requests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
    }
  });
  await targetPage.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await targetPage.waitForFunction(() => window.wvmDemo?.audioReady && window.wvmDemo.audioReady(), null, { timeout: 30_000 });
  return { url, errors };
}

const result = {
  task: "E5-T20e",
  command: "node tools/verify/e5-t20e-audio-proof.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  browser: {},
  sourceDist: null,
  stages: {},
  errors: { console: [], page: [], requests: [] },
  ok: false,
};

try {
  result.sourceDist = await fileParity();
  await startServer();
  const base = requestedBase || `http://127.0.0.1:${port}`;
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
  const chromePath = process.env.E5_T20E_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const launchOptions = {
    headless: process.env.E5_T20E_HEADED !== "1",
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
    viewport: { width: 1600, height: 1000 },
  };
  try {
    await fs.access(chromePath);
    launchOptions.executablePath = chromePath;
  } catch {}
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: browser.browserType().name(),
    version: browser.version(),
    headless: launchOptions.headless,
  };
  page = await browser.newPage();
  const configured = await setUpPage(page, base);
  result.url = configured.url;

  const ready = await page.evaluate(async () => ({
    ready: await window.wvmDemo.audioReady(),
    pipeline: window.wvmDemo.audioPipelineReady(),
    rate: window.__audioSink.sampleRateHz,
    requestedRate: window.__audioSink.requestedSampleRateHz,
    capacityFrames: window.__audioSink.ring.capacityFrames,
    nodeBeforeUnlock: Boolean(window.__audioSink.workletNode),
  }));
  assert.equal(ready.ready, true);
  assert.equal(ready.pipeline, true);
  assert.equal(ready.rate, 48_000);
  assert.equal(ready.requestedRate, 48_000);
  assert.equal(ready.capacityFrames, 4_096);
  assert.equal(ready.nodeBeforeUnlock, false);
  result.stages.ready = ready;

  const bootStarted = Date.now();
  const boot = await page.evaluate(() => window.wvmDemo.runBusybox());
  assert.equal(boot?.ok, true, `busybox boot failed: ${JSON.stringify(boot)}`);
  await page.waitForFunction(() => window.__linuxBootStateForTest?.().guestReady === true,
    null, { timeout: bootTimeout, polling: 200 });
  assert.equal(await page.evaluate(() => window.wvmDemo.audioOutputReady()), true);
  result.stages.guestAttach = {
    boot,
    elapsedMs: Date.now() - bootStarted,
    guestReady: await page.evaluate(() => window.__linuxBootStateForTest().guestReady),
    audioOutputReady: await page.evaluate(() => window.wvmDemo.audioOutputReady()),
  };

  const preUnlockStart = await page.evaluate(() => ({
    clock: window.__audioSink.renderedFrames,
    discarded: window.__audioAutoplayPolicy.discardedFrames,
    captures: window.__audioCapture.length,
  }));
  await page.evaluate(() => {
    const sink = window.__audioSink;
    const frames = new Int16Array(256 * 2);
    return sink.push(frames, sink.sampleRateHz);
  });
  await sleep(250);
  const preUnlock = await page.evaluate((start) => ({
    state: window.__audioAutoplayPolicy.state,
    node: Boolean(window.__audioSink.workletNode),
    clockDelta: window.__audioSink.renderedFrames - start.clock,
    discardedDelta: window.__audioAutoplayPolicy.discardedFrames - start.discarded,
    fill: window.__audioSink.ring.fillFrames,
    captures: window.__audioCapture.length - start.captures,
  }), preUnlockStart);
  assert.equal(preUnlock.state, "locked");
  assert.equal(preUnlock.node, false);
  assert.equal(preUnlock.fill, 0);
  assert.equal(preUnlock.captures, 0);
  assert.ok(preUnlock.discardedDelta > 0, `pre-unlock policy did not discard: ${JSON.stringify(preUnlock)}`);
  assert.ok(preUnlock.clockDelta >= 128, `pre-unlock clock did not advance: ${JSON.stringify(preUnlock)}`);
  result.stages.preUnlock = preUnlock;

  const unlock = await unlockAndStart(page);
  assert.equal(unlock.seed.complete, true);
  result.stages.unlock = unlock;

  const rampStarted = Date.now();
  const ramp = await runPattern(page, {
    kind: "ramp",
    totalFrames: rampFrames,
    initialCursor: unlock.seed.acceptedFrames,
    captureStart: unlock.captureStart,
    seedFrames: 0,
  });
  await waitForCaptured(page, ramp.captureStart, rampFrames, 10_000);
  const rampCapture = await analyzeCapture(page, ramp.captureStart, rampFrames, "ramp", ramp.rate);
  const rampAfter = await page.evaluate((clockBeforeUnlock) => ({
    stats: window.__audioSink.stats(),
    renderedDelta: window.__audioSink.renderedFrames - clockBeforeUnlock,
    policy: window.__audioAutoplayPolicy.state,
    contextState: window.__audioSink.context.state,
  }), unlock.clockBefore);
  assert.equal(ramp.cursor, rampFrames + 4_096);
  assert.equal(ramp.droppedFrames, 0);
  assert.equal(rampCapture.framesInspected, rampFrames);
  assert.equal(rampCapture.mismatches, 0, `ramp mismatches: ${JSON.stringify(rampCapture)}`);
  assert.equal(rampCapture.sequenceErrors, 0, `ramp sequence errors: ${JSON.stringify(rampCapture)}`);
  assert.equal(rampCapture.captureDigest, expectedDigest("ramp", rampFrames, ramp.rate));
  assert.equal(rampAfter.policy, "unlocked");
  assert.equal(rampAfter.contextState, "running");
  assert.ok(rampAfter.stats.latency_ms <= 120, `latency budget exceeded: ${JSON.stringify(rampAfter.stats)}`);
  assert.equal(rampAfter.stats.underruns, 0, `natural underrun: ${JSON.stringify(rampAfter.stats)}`);
  assert.ok(rampAfter.renderedDelta >= rampFrames, `render clock short: ${JSON.stringify(rampAfter)}`);
  const rampElapsedMs = Date.now() - rampStarted;
  const expectedRampMs = (rampFrames / ramp.rate) * 1_000;
  assert.ok(rampElapsedMs >= Math.max(250, expectedRampMs * 0.6)
    && rampElapsedMs <= expectedRampMs + 10_000,
    `capture was not wall-clock paced: ${rampElapsedMs} ms`);
  result.stages.ramp = { producer: ramp, capture: rampCapture, after: rampAfter, elapsedMs: rampElapsedMs };

  // Close the booted ramp tab after its capture. A stopped producer would otherwise leave a live
  // worklet posting empty quanta while the next assertions are queued behind those messages.
  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  await page.close();
  page = null;

  const sineFrames = 48_000;
  sinePage = await browser.newPage();
  const sineConfigured = await setUpPage(sinePage, base);
  const sineUnlock = await unlockAndStart(sinePage, "sine");
  const sine = await runPattern(sinePage, {
    kind: "sine",
    totalFrames: sineFrames,
    initialCursor: sineUnlock.seed.acceptedFrames,
    captureStart: sineUnlock.captureStart,
    seedFrames: 0,
  });
  await waitForCaptured(sinePage, sine.captureStart, sineFrames, 5_000);
  const sineCapture = await analyzeCapture(sinePage, sine.captureStart, sineFrames, "sine", sine.rate);
  assert.equal(sine.droppedFrames, 0);
  assert.equal(sineCapture.framesInspected, sineFrames);
  assert.equal(sineCapture.mismatches, 0, `sine mismatches: ${JSON.stringify(sineCapture)}`);
  assert.equal(sineCapture.captureDigest, expectedDigest("sine", sineFrames, sine.rate));
  assert.ok(sineCapture.peakHz >= 439 && sineCapture.peakHz <= 441,
    `unexpected sine peak: ${JSON.stringify(sineCapture)}`);
  // The 440 Hz tone is not an integer FFT bin in the 8192-frame inspection window, so the
  // neighboring bins contain expected leakage; the exact sample digest is the primary signal
  // check, with the spectral peak/12 dB margin as the independent frequency-domain check.
  assert.ok(sineCapture.peakToBandRatio > 0.15 && sineCapture.peakToNeighborDb > 12,
    `sine energy leaked: ${JSON.stringify(sineCapture)}`);
  result.stages.sine = { unlock: sineUnlock, producer: sine, capture: sineCapture };
  await sinePage.close();
  sinePage = null;

  const starvationStarted = Date.now();
  starvationPage = await browser.newPage();
  const starvationConfigured = await setUpPage(starvationPage, base);
  const starvationUnlock = await unlockAndStart(starvationPage, "ramp");
  const beforeStarvation = await starvationPage.evaluate(() => window.__audioSink.ring.underrunCount);
  const starvation = await runPattern(starvationPage, {
    kind: "ramp",
    totalFrames: starvationFrames,
    starveAtMs: 400,
    starveForMs: 500,
    initialCursor: starvationUnlock.seed.acceptedFrames,
    captureStart: starvationUnlock.captureStart,
    seedFrames: 0,
  });
  await waitForCaptured(starvationPage, starvation.captureStart, starvationFrames, 8_000);
  const starvationCapture = await analyzeCapture(starvationPage, starvation.captureStart, starvationFrames, "ramp", starvation.rate, { starvation: true });
  const afterStarvation = await starvationPage.evaluate((start) => ({
    stats: window.__audioSink.stats(),
    underrunDelta: window.__audioSink.ring.underrunCount - start,
  }), beforeStarvation);
  assert.equal(starvation.cursor, starvationFrames + 4_096);
  assert.equal(starvation.droppedFrames, 0);
  assert.ok(starvation.postStarveFrames > 0, `producer did not resume: ${JSON.stringify(starvation)}`);
  assert.ok(afterStarvation.underrunDelta > 0, `starvation did not increment XRUN/underrun: ${JSON.stringify(afterStarvation)}`);
  assert.ok(starvationCapture.tailFrames > 1_000 && starvationCapture.tailNonZero / starvationCapture.tailFrames > 0.99,
    `post-starvation playback did not recover: ${JSON.stringify(starvationCapture)}`);
  assert.ok(starvationCapture.tailTransitions / (starvationCapture.tailFrames - 1) > 0.99,
    `post-starvation ramp did not resume contiguously: ${JSON.stringify(starvationCapture)}`);
  result.stages.starvation = {
    unlock: starvationUnlock,
    producer: starvation,
    capture: starvationCapture,
    after: afterStarvation,
    elapsedMs: Date.now() - starvationStarted,
  };
  await starvationPage.close();
  starvationPage = null;

  ratePage = await browser.newPage();
  const rateConfigured = await setUpPage(ratePage, base, 44_100);
  const rateReady = await ratePage.evaluate(() => ({
    rate: window.__audioSink.sampleRateHz,
    requestedRate: window.__audioSink.requestedSampleRateHz,
    nodeBeforeUnlock: Boolean(window.__audioSink.workletNode),
  }));
  assert.equal(rateReady.rate, 44_100);
  assert.equal(rateReady.requestedRate, 44_100);
  assert.equal(rateReady.nodeBeforeUnlock, false);
  const rateUnlock = await unlockAndStart(ratePage);
  const rateRamp = await runPattern(ratePage, {
    kind: "ramp",
    totalFrames: rateProbeFrames,
    initialCursor: rateUnlock.seed.acceptedFrames,
    captureStart: rateUnlock.captureStart,
    seedFrames: 0,
  });
  await waitForCaptured(ratePage, rateRamp.captureStart, rateProbeFrames, 5_000);
  const rateCapture = await analyzeCapture(ratePage, rateRamp.captureStart, rateProbeFrames, "ramp", rateRamp.rate);
  assert.equal(rateRamp.droppedFrames, 0);
  assert.equal(rateCapture.mismatches, 0, `44.1 kHz mismatches: ${JSON.stringify(rateCapture)}`);
  assert.equal(rateCapture.captureDigest, expectedDigest("ramp", rateProbeFrames, rateRamp.rate));
  await waitForCaptured(ratePage, rateRamp.captureStart, rateProbeFrames + 4_096, 5_000);
  result.stages.rate44100 = {
    url: rateConfigured.url,
    ready: rateReady,
    unlock: rateUnlock,
    producer: rateRamp,
    capture: rateCapture,
  };

  result.errors = {
    console: [
      ...configured.errors.console,
      ...sineConfigured.errors.console,
      ...starvationConfigured.errors.console,
      ...rateConfigured.errors.console,
    ],
    page: [
      ...configured.errors.page,
      ...sineConfigured.errors.page,
      ...starvationConfigured.errors.page,
      ...rateConfigured.errors.page,
    ],
    requests: [
      ...configured.errors.requests,
      ...sineConfigured.errors.requests,
      ...starvationConfigured.errors.requests,
      ...rateConfigured.errors.requests,
    ],
  };
  assert.deepEqual(result.errors, { console: [], page: [], requests: [] },
    `unexpected browser errors: ${JSON.stringify(result.errors)}`);
  result.ok = true;
} catch (error) {
  result.error = error?.stack || String(error);
  throw error;
} finally {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  const transcript = [
    "E5-T20e Chromium audio proof",
    `status: ${result.ok ? "PASS" : "FAIL"}`,
    `gitHead: ${result.gitHead}`,
    `screenshot: ${screenshotPath}`,
    `json: ${evidencePath}`,
    `sourceDist: ${JSON.stringify(result.sourceDist)}`,
    result.error ? `error: ${result.error}` : "error: none",
  ].join("\n") + "\n";
  await fs.writeFile(transcriptPath, transcript);
  await ratePage?.close().catch(() => {});
  await sinePage?.close().catch(() => {});
  await starvationPage?.close().catch(() => {});
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopServer();
}
