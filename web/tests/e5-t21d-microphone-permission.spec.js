// E5-T21d — Chromium proof of the production microphone permission state machine.
import { test, expect } from "@playwright/test";

const MICROPHONE_OFF = "off";
const MICROPHONE_LIVE = "live";
const MICROPHONE_REVOKED = "revoked";

test("Chromium keeps microphone permission lazy and handles delayed grant, mute, end, and retry", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/?noAutoBoot=1&nosw&enableMic");
  await page.waitForFunction(() => window.__microphone && window.__audioCaptureRing);

  const result = await page.evaluate(async () => {
    const { AudioCaptureRingBuffer } = await import("./src/audio/capture-ring.js");
    const {
      MICROPHONE_LIVE,
      MICROPHONE_OFF,
      MICROPHONE_REVOKED,
      MicrophonePermissionController,
    } = await import("./src/audio/microphone.js");

    class Track {
      constructor() {
        this.muted = false;
        this.readyState = "live";
        this.listeners = new Map();
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
        if (type === "mute") this.muted = true;
        if (type === "unmute") this.muted = false;
        if (type === "ended") this.readyState = "ended";
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
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

    class Context {
      constructor({ sampleRate }) {
        this.sampleRate = sampleRate;
        this.destination = {};
        this.audioWorklet = { addModule: async () => {} };
        this.closed = false;
      }
      async resume() {}
      async close() { this.closed = true; }
    }

    class Node {
      connect() {}
      disconnect() {}
    }

    const deferred = () => {
      let resolve;
      const promise = new Promise((resolveValue) => { resolve = resolveValue; });
      return { promise, resolve };
    };
    const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 64 });
    const firstGrant = deferred();
    const secondGrant = deferred();
    const responses = [firstGrant.promise, secondGrant.promise];
    const tracks = [new Track(), new Track()];
    const calls = [];
    const notifications = [];
    const controller = new MicrophonePermissionController({
      enabled: true,
      ring,
      getUserMedia: async (constraints) => {
        calls.push(constraints);
        return responses.shift();
      },
      audioContextFactory: (options) => new Context(options),
      workletNodeFactory: () => new Node(),
      mediaSourceFactory: () => new Node(),
      gainFactory: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
      notifyGuest: (event) => notifications.push(event),
    });

    const pageHookBefore = window.__microphone.state();
    const disabledResult = await controller.onPcmStart({ enabled: false, startCount: 1 });
    const pending = controller.onPcmStart({ enabled: true, startCount: 1 });
    const duplicate = controller.onPcmStart({ enabled: true, startCount: 1 });
    const pendingSnapshot = controller.snapshot();
    firstGrant.resolve(new Stream(tracks[0]));
    const granted = await pending;
    const producer = ring.producer();
    producer.write(new Float32Array([0.5, -0.5]));
    tracks[0].emit("mute");
    const mutedSnapshot = controller.snapshot();
    const mutedNotifications = [...notifications];
    tracks[0].emit("unmute");
    tracks[0].emit("ended");
    const endedSnapshot = controller.snapshot();
    const retryMarker = controller.retry();
    const retry = controller.onPcmStart({ enabled: true, startCount: 2 });
    secondGrant.resolve(new Stream(tracks[1]));
    const regranted = await retry;
    const finalSnapshot = controller.snapshot();

    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      pageHookBefore,
      pageIndicatorBefore: document.getElementById("ide-microphone-state")?.textContent || "",
      disabledResult,
      pending: {
        calls: pendingSnapshot.getUserMediaCalls,
        state: pendingSnapshot.state,
        pending: pendingSnapshot.pending,
        ringFillFrames: pendingSnapshot.ringFillFrames,
        duplicateSharesPromise: duplicate === pending,
      },
      granted,
      muted: {
        state: mutedSnapshot.state,
        ringFillFrames: mutedSnapshot.ringFillFrames,
        notifications: mutedNotifications,
      },
      ended: {
        state: endedSnapshot.state,
        listenerCount: endedSnapshot.listenerCount,
        streamActive: endedSnapshot.streamActive,
      },
      retryMarker,
      regranted,
      final: {
        ...finalSnapshot,
        oldTrackListeners: tracks[0].listenerCount(),
      },
    };
  });

  await page.screenshot({
    path: "../evidence/e5-t21d/microphone-permission-2026-09-04.png",
    fullPage: true,
  });

  expect(consoleErrors).toEqual([]);
  expect(result.crossOriginIsolated).toBe(true);
  expect(result.pageHookBefore).toMatchObject({ state: MICROPHONE_OFF, getUserMediaCalls: 0 });
  expect(result.pageIndicatorBefore).toBe("Microphone: off");
  expect(result.disabledResult).toMatchObject({ ok: false, state: MICROPHONE_OFF });
  expect(result.pending).toMatchObject({
    calls: 1,
    state: MICROPHONE_OFF,
    pending: true,
    ringFillFrames: 0,
    duplicateSharesPromise: true,
  });
  expect(result.granted).toMatchObject({ ok: true, state: MICROPHONE_LIVE, startCount: 1 });
  expect(result.muted).toMatchObject({ state: MICROPHONE_REVOKED, ringFillFrames: 0, notifications: ["muted"] });
  expect(result.ended).toMatchObject({ state: MICROPHONE_REVOKED, listenerCount: 0, streamActive: false });
  expect(result.retryMarker.reason).toBe("awaiting-guest-pcm-start");
  expect(result.regranted).toMatchObject({ ok: true, state: MICROPHONE_LIVE, startCount: 2 });
  expect(result.final).toMatchObject({ state: MICROPHONE_LIVE, listenerCount: 3, oldTrackListeners: 0 });
  expect(result.final.getUserMediaCalls).toBe(2);
});
