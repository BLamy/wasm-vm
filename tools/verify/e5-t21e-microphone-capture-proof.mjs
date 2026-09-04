#!/usr/bin/env node
// E5-T21e: bounded Chromium proof for the complete opt-in microphone path.
//
// The production microphone controller and real AudioWorklet producer run in Chromium. A tiny
// deterministic stream factory supplies a 440 Hz loopback tone to that graph, while the checked-in
// GuestCaptureRecorder consumes the same reversed SAB contract as the guest rxq and finalizes the
// bytes an `arecord`-style loop would write. Native virtio-snd rxq proof is run first; the shipped
// public rootfs has no ALSA `arecord` binary, so this boundary harness keeps the guest wire contract
// exact without smuggling a browser permission or a second host audio implementation into core.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence", "e5-t21e");
const evidencePath = path.join(evidenceDir, "microphone-capture-2026-09-04.json");
const screenshotPath = path.join(evidenceDir, "microphone-capture-2026-09-04.png");
const transcriptPath = path.join(evidenceDir, "microphone-capture-2026-09-04.txt");
const requestedBase = process.env.E5_T21E_BASE_URL?.replace(/\/$/, "") || null;
const durationMs = Number(process.env.E5_T21E_DURATION_MS || 5_000);
const bootTimeoutMs = Number(process.env.E5_T21E_BOOT_TIMEOUT_MS || 30_000);
const MICROPHONE_OFF = "off";
const MICROPHONE_LIVE = "live";
const MICROPHONE_DENIED = "denied";
const MICROPHONE_REVOKED = "revoked";
const MAX_CAPTURE_PERIOD_BYTES = 1 << 20;
let port = Number(process.env.E5_T21E_PORT || 0);
let server = null;
let browser = null;
let page = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

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
    "web/src/audio/capture-ring.js",
    "web/src/audio/capture-worklet.js",
    "web/src/audio/capture-recorder.js",
    "web/src/audio/microphone.js",
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

function zeroDigest(frameCount) {
  return sha256(Buffer.alloc(frameCount * 4));
}

async function runBrowser(base) {
  const errors = { console: [], page: [], requests: [] };
  page = await browser.newPage();
  page.setDefaultTimeout(bootTimeoutMs);
  page.on("console", (message) => {
    // Chromium reports a favicon 404 as a URL-less generic resource error. The response ledger
    // below still fails every other HTTP error, so this narrow exception keeps the expected icon
    // miss from hiding a real page failure.
    if (message.type() === "error"
      && !message.text().includes("favicon")
      && !message.text().includes("Failed to load resource: the server responded with a status of 404")) {
      errors.console.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const pathname = new URL(response.url()).pathname;
    if (!pathname.endsWith("/favicon.ico")) {
      errors.requests.push({ url: response.url(), status: response.status() });
    }
  });
  page.on("requestfailed", (request) => {
    if (!new URL(request.url()).pathname.endsWith("/favicon.ico")) {
      errors.requests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
    }
  });

  const flagOffUrl = `${base}/index.html?noAutoBoot=1&nosw=1&audioCapture=1&testHooks=1#ide`;
  await page.goto(flagOffUrl, { waitUntil: "domcontentloaded", timeout: bootTimeoutMs });
  await page.waitForFunction(() => window.__microphone);
  const flagOff = await page.evaluate(() => ({
    state: window.__microphone.state(),
    captureRing: Boolean(window.__audioCaptureRing),
    indicator: document.getElementById("ide-microphone-state")?.textContent || "",
  }));

  const url = `${base}/index.html?noAutoBoot=1&nosw=1&enableMic&audioCapture=1&testHooks=1#ide`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: bootTimeoutMs });
  await page.waitForFunction(() => window.__microphone && window.__audioCaptureRing);
  // The main page's output sink is also used by the full-duplex stage. The capture controller has
  // its own context and remains lazy until the synthetic guest sends PCM_START below.
  await page.mouse.click(20, 20);

  const result = await page.evaluate(async ({ duration }) => {
    const { AudioCaptureRingBuffer } = await import("./src/audio/capture-ring.js");
    const { GuestCaptureRecorder, MAX_CAPTURE_PERIOD_BYTES } = await import("./src/audio/capture-recorder.js");
    const {
      MICROPHONE_DENIED,
      MICROPHONE_LIVE,
      MICROPHONE_OFF,
      MICROPHONE_REVOKED,
      MicrophonePermissionController,
    } = await import("./src/audio/microphone.js");

    const waitUntil = async (predicate, timeout = 10_000) => {
      const deadline = performance.now() + timeout;
      while (!predicate()) {
        if (performance.now() >= deadline) throw new Error("capture proof wait exceeded its bound");
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    };
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deferred = () => {
      let resolve;
      let reject;
      const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
      });
      return { promise, resolve, reject };
    };

    class Track {
      constructor() {
        this.muted = false;
        this.readyState = "live";
        this.listeners = new Map();
        this.onMute = null;
        this.onUnmute = null;
        this.onEnded = null;
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
      }

      emit(type) {
        if (type === "mute") {
          this.muted = true;
          this.onMute?.();
        }
        if (type === "unmute") {
          this.muted = false;
          this.onUnmute?.();
        }
        if (type === "ended") {
          this.readyState = "ended";
          this.onEnded?.();
        }
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, target: this });
      }

      listenerCount() {
        return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
      }
    }

    class Stream {
      constructor(track) { this.track = track; }
      getAudioTracks() { return this.track ? [this.track] : []; }
      getTracks() { return this.getAudioTracks(); }
    }

    const wavHeader = (recorder) => {
      const bytes = recorder.wavBytes();
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return {
        riff: new TextDecoder().decode(bytes.slice(0, 4)),
        wave: new TextDecoder().decode(bytes.slice(8, 12)),
        sampleRateHz: view.getUint32(24, true),
        channels: view.getUint16(22, true),
        dataBytes: view.getUint32(40, true),
        wavBytes: bytes.length,
        durationSeconds: view.getUint32(40, true) / (view.getUint32(24, true) * 4),
      };
    };

    const recorderResult = async (recorder, expectedDurationMs) => ({
      recording: await recorder.recordForDuration(expectedDurationMs, { intervalMs: 10 }),
      header: wavHeader(recorder),
      digest: await recorder.digest(),
      analysis: recorder.analyze(),
    });

    // A delayed permission prompt is represented by a deferred result. This records the logical
    // 30-second browser delay without making the verifier sleep for 30 seconds.
    const delayedRing = AudioCaptureRingBuffer.allocate({ capacityFrames: 16_384 });
    const delayedPermission = deferred();
    const delayed = new MicrophonePermissionController({
      enabled: true,
      ring: delayedRing,
      getUserMedia: () => delayedPermission.promise,
      audioContextFactory: () => { throw new Error("delayed probe must not construct AudioContext"); },
    });
    const delayedRequest = delayed.onPcmStart({ enabled: true, startCount: 1 });
    const delayedDuplicate = delayed.onPcmStart({ enabled: true, startCount: 1 });
    const delayedSnapshot = delayed.snapshot();
    delayedPermission.resolve(new Stream(null));
    await delayedRequest;
    delayed.reset();

    // Flag-on granted capture: the production controller creates the real AudioWorklet node, but
    // this deterministic media-source factory feeds it an oscillator so the resulting ring is a
    // measurable loopback rather than a claim about whatever microphone is attached to the host.
    // Chromium's headless destination can run an AudioContext faster than wall clock. Keep the
    // proof's consumer paced like `arecord` without turning that scheduler quirk into a false
    // capture-overrun finding; fixed-capacity and hostile-period behavior are covered below.
    const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 1 << 20 });
    const tracks = [new Track(), new Track()];
    const streams = tracks.map((track) => new Stream(track));
    const graphs = [];
    const notifications = [];
    let gumIndex = 0;
    const controller = new MicrophonePermissionController({
      enabled: true,
      ring,
      sampleRateHz: 48_000,
      getUserMedia: async () => {
        const stream = streams[Math.min(gumIndex, streams.length - 1)];
        gumIndex += 1;
        return stream;
      },
      audioContextFactory: (options) => new AudioContext(options),
      workletNodeFactory: (context, name, options) => new AudioWorkletNode(context, name, options),
      mediaSourceFactory: (context, stream) => {
        const index = streams.indexOf(stream);
        const track = tracks[Math.max(0, index)];
        const oscillator = context.createOscillator();
        oscillator.type = "sine";
        oscillator.frequency.value = 440;
        const level = context.createGain();
        level.gain.value = 1;
        oscillator.connect(level);
        oscillator.start();
        track.onMute = () => { level.gain.value = 0; };
        track.onUnmute = () => { level.gain.value = 1; };
        track.onEnded = () => {
          level.gain.value = 0;
          try { oscillator.stop(); } catch {}
        };
        graphs.push({ oscillator, level });
        return level;
      },
      gainFactory: (context) => context.createGain(),
      notifyGuest: (event) => notifications.push(event),
    });

    const preStart = controller.snapshot();
    const firstStart = controller.onPcmStart({ enabled: true, startCount: 1 });
    const pending = controller.snapshot();
    const granted = await firstStart;
    await waitUntil(() => ring.fillFrames > 0);
    const grantedRecorder = new GuestCaptureRecorder({ ring, sampleRateHz: 48_000, maxFrames: 48_000 * 10 });
    const grantedCapture = await recorderResult(grantedRecorder, duration);

    tracks[0].emit("mute");
    // Let one real AudioContext quantum carry the track's muted zeroes through the producer before
    // starting the guest-shaped assertion, then apply the controller's own drain at the boundary.
    await sleep(50);
    controller._drainRing();
    const mutedState = controller.snapshot();
    const mutedRecorder = new GuestCaptureRecorder({ ring, sampleRateHz: 48_000, maxFrames: 48_000 });
    const mutedCapture = await recorderResult(mutedRecorder, 250);
    const mutedNotifications = [...notifications];
    tracks[0].emit("unmute");
    const unmutedState = controller.snapshot();
    const unmutedRecorder = new GuestCaptureRecorder({ ring, sampleRateHz: 48_000, maxFrames: 48_000 });
    const unmutedCapture = await recorderResult(unmutedRecorder, 250);

    // Full-duplex stage: keep the real page output sink running while the production microphone
    // graph and guest-shaped recorder consume the input ring.
    const sink = window.__audioSink;
    await sink.connect();
    const outputFrames = new Int16Array(480 * 2);
    for (let frame = 0; frame < 480; frame += 1) {
      const sample = Math.round(Math.sin((2 * Math.PI * 220 * frame) / 48_000) * 16_000);
      outputFrames[frame * 2] = sample;
      outputFrames[frame * 2 + 1] = sample;
    }
    const beforeDuplexOutput = sink.renderedFrames;
    const duplexRecorder = new GuestCaptureRecorder({ ring, sampleRateHz: 48_000, maxFrames: 48_000 });
    const duplexStarted = performance.now();
    const [duplexCapture, duplexOutput] = await Promise.all([
      recorderResult(duplexRecorder, 300),
      (async () => {
        let acceptedFrames = 0;
        let droppedFrames = 0;
        for (let index = 0; index < 35; index += 1) {
          const pushed = sink.push(outputFrames, sink.sampleRateHz);
          acceptedFrames += pushed.acceptedFrames;
          droppedFrames += pushed.droppedFrames;
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return {
          acceptedFrames,
          droppedFrames,
          renderedFrames: sink.renderedFrames,
          elapsedMs: performance.now() - duplexStarted,
        };
      })(),
    ]);

    tracks[0].emit("ended");
    const endedState = controller.snapshot();
    const retry = controller.onPcmStart({ enabled: true, startCount: 2 });
    await waitUntil(() => gumIndex === 2);
    await retry;
    await waitUntil(() => ring.fillFrames > 0);
    const retryRecorder = new GuestCaptureRecorder({ ring, sampleRateHz: 48_000, maxFrames: 48_000 });
    const retryCapture = await recorderResult(retryRecorder, 250);
    const finalState = controller.snapshot();

    // Denial uses the same wall-clock recorder with an empty ring. It must finish in the same
    // bounded time while producing an exact digital-silence WAV.
    const deniedRing = AudioCaptureRingBuffer.allocate({ capacityFrames: 16_384 });
    const deniedNotifications = [];
    const denied = new MicrophonePermissionController({
      enabled: true,
      ring: deniedRing,
      getUserMedia: async () => {
        const error = new Error("synthetic permission denial");
        error.name = "NotAllowedError";
        throw error;
      },
      notifyGuest: (event) => deniedNotifications.push(event),
    });
    const deniedStart = await denied.onPcmStart({ enabled: true, startCount: 1 });
    const deniedRecorder = new GuestCaptureRecorder({ ring: deniedRing, sampleRateHz: 48_000, maxFrames: 48_000 * 10 });
    const deniedCapture = await recorderResult(deniedRecorder, duration);
    denied.reset();

    // A separate real 44.1 kHz AudioContext proves duration truth is derived from the negotiated
    // rate rather than a hardcoded 48 kHz assumption.
    const rateRing = AudioCaptureRingBuffer.allocate({ capacityFrames: 16_384 });
    const rateTrack = new Track();
    const rateStream = new Stream(rateTrack);
    let rateLevel = null;
    const rateController = new MicrophonePermissionController({
      enabled: true,
      ring: rateRing,
      sampleRateHz: 44_100,
      getUserMedia: async () => rateStream,
      audioContextFactory: (options) => new AudioContext(options),
      workletNodeFactory: (context, name, options) => new AudioWorkletNode(context, name, options),
      mediaSourceFactory: (context) => {
        const oscillator = context.createOscillator();
        oscillator.frequency.value = 440;
        rateLevel = context.createGain();
        rateLevel.gain.value = 1;
        oscillator.connect(rateLevel);
        oscillator.start();
        return rateLevel;
      },
      gainFactory: (context) => context.createGain(),
    });
    const rateStart = await rateController.onPcmStart({ enabled: true, startCount: 1 });
    await waitUntil(() => rateRing.fillFrames > 0);
    const rateRecorder = new GuestCaptureRecorder({ ring: rateRing, sampleRateHz: 44_100, maxFrames: 44_100 * 2 });
    const rateCapture = await recorderResult(rateRecorder, 1_000);
    const actualRateContextHz = rateController._context?.sampleRate ?? null;
    rateTrack.emit("ended");
    rateController.reset();

    // Hostile rxq periods use the same recorder boundary and explicit canaries around the exact
    // writable data + status length. Neither period is allowed to grow a buffer from guest input.
    const periodRing = AudioCaptureRingBuffer.allocate({ capacityFrames: 16_384 });
    const periodRecorder = new GuestCaptureRecorder({
      ring: periodRing,
      sampleRateHz: 48_000,
      maxFrames: MAX_CAPTURE_PERIOD_BYTES / 4 + 4,
    });
    const smallCanary = new Uint8Array(16 + 8 + 16).fill(0xa5);
    const smallPeriod = periodRecorder.readPeriod(16, { destination: smallCanary });
    const largeCanary = new Uint8Array(MAX_CAPTURE_PERIOD_BYTES + 8 + 32).fill(0x5a);
    const largePeriod = periodRecorder.readPeriod(MAX_CAPTURE_PERIOD_BYTES, { destination: largeCanary });
    const canaryBytes = {
      small: Array.from(smallCanary.slice(24)),
      large: Array.from(largeCanary.slice(MAX_CAPTURE_PERIOD_BYTES + 8)),
    };
    periodRecorder.snapshot();

    return {
      delayed: {
        delayedPermissionMs: 30_000,
        stateBeforeGrant: delayedSnapshot.state,
        pending: delayedSnapshot.pending,
        calls: delayedSnapshot.getUserMediaCalls,
        ringFillFrames: delayedSnapshot.ringFillFrames,
        duplicateSharesPromise: delayedDuplicate === delayedRequest,
      },
      granted: {
        start: granted,
        preStart,
        pending,
        capture: grantedCapture,
        ringDroppedFrames: ring.droppedFrames,
      },
      mute: {
        state: mutedState,
        capture: mutedCapture,
        notifications: mutedNotifications,
      },
      unmute: {
        state: unmutedState,
        capture: unmutedCapture,
      },
      fullDuplex: {
        outputBefore: beforeDuplexOutput,
        output: duplexOutput,
        capture: duplexCapture,
        sinkStats: sink.stats(),
      },
      ended: endedState,
      retry: {
        capture: retryCapture,
        final: finalState,
        oldTrackListeners: tracks[0].listenerCount(),
      },
      denied: {
        start: deniedStart,
        capture: deniedCapture,
        notifications: deniedNotifications,
        digestIsSilence: deniedCapture.digest === await (async () => {
          const frames = Math.round((duration * 48_000) / 1_000);
          const bytes = new Uint8Array(frames * 4);
          const digest = await crypto.subtle.digest("SHA-256", bytes);
          return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
        })(),
      },
      rate44100: {
        start: rateStart,
        actualContextRate: actualRateContextHz,
        capture: rateCapture,
      },
      periods: {
        small: smallPeriod,
        large: largePeriod,
        canariesIntact: canaryBytes.small.every((value) => value === 0xa5)
          && canaryBytes.large.every((value) => value === 0x5a),
        canaryBytes,
      },
      crossOriginIsolated: globalThis.crossOriginIsolated,
    };
  }, { duration: durationMs });

  assert.equal(result.crossOriginIsolated, true);
  assert.equal(flagOff.state.enabled, false);
  assert.equal(flagOff.state.state, MICROPHONE_OFF);
  assert.equal(flagOff.state.getUserMediaCalls, 0);
  assert.equal(flagOff.state.listenerCount, 0);
  assert.equal(flagOff.captureRing, false);
  assert.equal(flagOff.indicator, "Microphone: off");
  assert.equal(result.delayed.stateBeforeGrant, "off");
  assert.equal(result.delayed.pending, true);
  assert.equal(result.delayed.calls, 1);
  assert.equal(result.delayed.ringFillFrames, 0);
  assert.equal(result.delayed.duplicateSharesPromise, true);

  const grantedFrames = Math.round((durationMs * 48_000) / 1_000);
  assert.equal(result.granted.start.state, MICROPHONE_LIVE);
  assert.equal(result.granted.capture.recording.frames, grantedFrames);
  assert.equal(result.granted.capture.header.riff, "RIFF");
  assert.equal(result.granted.capture.header.wave, "WAVE");
  assert.equal(result.granted.capture.header.sampleRateHz, 48_000);
  assert.equal(result.granted.capture.header.channels, 2);
  assert.equal(result.granted.capture.header.dataBytes, grantedFrames * 4);
  assert.equal(result.granted.capture.header.durationSeconds, durationMs / 1_000);
  assert.ok(result.granted.capture.analysis.peakHz >= 439 && result.granted.capture.analysis.peakHz <= 441,
    `unexpected loopback peak: ${JSON.stringify(result.granted.capture.analysis)}`);
  assert.ok(result.granted.capture.analysis.peakToNeighborDb > 12,
    `weak loopback tone: ${JSON.stringify(result.granted.capture.analysis)}`);
  assert.equal(result.granted.ringDroppedFrames, 0);
  assert.ok(result.granted.capture.recording.elapsedMs >= durationMs * 0.75,
    `capture completed too quickly: ${JSON.stringify(result.granted.capture.recording)}`);
  assert.ok(result.granted.capture.recording.elapsedMs <= durationMs + 1_500,
    `capture exceeded bound: ${JSON.stringify(result.granted.capture.recording)}`);

  assert.equal(result.mute.state.state, MICROPHONE_REVOKED);
  assert.equal(result.mute.state.ringFillFrames, 0);
  assert.equal(result.mute.capture.analysis.nonZeroFrames, 0);
  assert.deepEqual(result.mute.notifications, ["muted"]);
  assert.equal(result.unmute.state.state, MICROPHONE_LIVE);
  assert.ok(result.unmute.capture.analysis.nonZeroFrames > 0);
  assert.equal(result.ended.state, MICROPHONE_REVOKED);
  assert.equal(result.ended.listenerCount, 0);
  assert.equal(result.ended.streamActive, false);
  assert.equal(result.retry.capture.analysis.peakHz >= 439 && result.retry.capture.analysis.peakHz <= 441, true);
  assert.equal(result.retry.final.state, MICROPHONE_LIVE);
  assert.equal(result.retry.final.listenerCount, 3);
  assert.equal(result.retry.oldTrackListeners, 0);

  const deniedFrames = Math.round((durationMs * 48_000) / 1_000);
  assert.equal(result.denied.start.state, MICROPHONE_DENIED);
  assert.equal(result.denied.capture.recording.frames, deniedFrames);
  assert.equal(result.denied.capture.header.durationSeconds, durationMs / 1_000);
  assert.equal(result.denied.capture.analysis.nonZeroFrames, 0);
  assert.equal(result.denied.digestIsSilence, true);
  assert.deepEqual(result.denied.notifications, ["denied"]);
  assert.ok(Math.abs(result.denied.capture.recording.elapsedMs - result.granted.capture.recording.elapsedMs) < 1_000,
    `denied path was not paced similarly: ${JSON.stringify({ granted: result.granted.capture.recording.elapsedMs, denied: result.denied.capture.recording.elapsedMs })}`);

  assert.equal(result.rate44100.start.state, MICROPHONE_LIVE);
  assert.equal(result.rate44100.actualContextRate, 44_100);
  assert.equal(result.rate44100.capture.recording.frames, 44_100);
  assert.equal(result.rate44100.capture.header.sampleRateHz, 44_100);
  assert.equal(result.rate44100.capture.header.dataBytes, 44_100 * 4);
  assert.equal(result.rate44100.capture.header.durationSeconds, 1);
  assert.ok(result.rate44100.capture.analysis.peakHz >= 439 && result.rate44100.capture.analysis.peakHz <= 441);

  assert.equal(result.periods.small.usedBytes, 24);
  assert.equal(result.periods.large.usedBytes, MAX_CAPTURE_PERIOD_BYTES + 8);
  assert.equal(result.periods.canariesIntact, true);
  assert.ok(result.fullDuplex.output.renderedFrames > result.fullDuplex.outputBefore);
  assert.ok(result.fullDuplex.output.acceptedFrames > 0);
  assert.ok(result.fullDuplex.capture.analysis.nonZeroFrames > 0);
  assert.equal(result.fullDuplex.capture.recording.frames, Math.round(300 * 48_000 / 1_000));
  assert.deepEqual(errors, { console: [], page: [], requests: [] });
  return { url, errors, result: { ...result, flagOff } };
}

const result = {
  task: "E5-T21e",
  command: "node tools/verify/e5-t21e-microphone-capture-proof.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  native: null,
  browser: null,
  sourceDist: null,
  ok: false,
};

try {
  assert.ok(Number.isFinite(durationMs) && durationMs >= 5_000, "E5-T21e duration must be at least five seconds");
  result.sourceDist = await fileParity();
  result.native = execFileSync(
    "cargo",
    ["test", "-p", "wasm-vm-core", "--test", "virtio_snd_capture", "--quiet"],
    { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
  await startServer();
  const base = requestedBase || `http://127.0.0.1:${port}`;
  const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
  const chromePath = process.env.E5_T21E_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const launchOptions = {
    headless: process.env.E5_T21E_HEADED !== "1",
    args: [
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
      "--js-flags=--max-old-space-size=4096",
    ],
    viewport: { width: 1600, height: 1000 },
  };
  try { await fs.access(chromePath); launchOptions.executablePath = chromePath; } catch {}
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: browser.browserType().name(),
    version: browser.version(),
    headless: launchOptions.headless,
  };
  const browserResult = await runBrowser(base);
  result.url = browserResult.url;
  result.errors = browserResult.errors;
  result.stages = browserResult.result;
  await fs.mkdir(evidenceDir, { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  result.ok = true;
} catch (error) {
  result.error = error?.stack || String(error);
  throw error;
} finally {
  await fs.mkdir(evidenceDir, { recursive: true });
  await fs.writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
  const transcript = [
    "E5-T21e Chromium microphone capture proof",
    `status: ${result.ok ? "PASS" : "FAIL"}`,
    `gitHead: ${result.gitHead}`,
    `screenshot: ${screenshotPath}`,
    `json: ${evidencePath}`,
    `native: ${result.native || "not completed"}`,
    `sourceDist: ${JSON.stringify(result.sourceDist)}`,
    result.error ? `error: ${result.error}` : "error: none",
  ].join("\n") + "\n";
  await fs.writeFile(transcriptPath, transcript);
  await page?.close().catch(() => {});
  await browser?.close().catch(() => {});
  await stopServer();
}
