// E5-T21d — lazy permission and microphone lifecycle state-machine fixtures.

import assert from "node:assert/strict";
import test from "node:test";

import { AudioCaptureRingBuffer } from "../src/audio/capture-ring.js";
import {
  MICROPHONE_DENIED,
  MICROPHONE_LIVE,
  MICROPHONE_OFF,
  MICROPHONE_REVOKED,
  MicrophonePermissionController,
  MICROPHONE_CONSTRAINTS,
} from "../src/audio/microphone.js";

class FakeTrack {
  constructor({ muted = false, readyState = "live" } = {}) {
    this.muted = muted;
    this.readyState = readyState;
    this.listeners = new Map();
    this.stopCalls = 0;
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
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, target: this });
  }

  listenerCount() {
    let count = 0;
    for (const listeners of this.listeners.values()) count += listeners.size;
    return count;
  }

  stop() {
    this.stopCalls += 1;
    this.readyState = "ended";
  }
}

class FakeStream {
  constructor(track = null) {
    this.track = track;
  }

  getAudioTracks() {
    return this.track ? [this.track] : [];
  }

  getTracks() {
    return this.getAudioTracks();
  }
}

class FakeContext {
  constructor({ sampleRate }) {
    this.sampleRate = sampleRate;
    this.destination = {};
    this.closed = false;
    this.resumeCalls = 0;
    this.closeCalls = 0;
    this.audioWorklet = {
      addModule: async (url) => { this.workletUrl = url; },
    };
  }

  async resume() {
    this.resumeCalls += 1;
  }

  async close() {
    this.closeCalls += 1;
    this.closed = true;
  }
}

class FakeNode {
  constructor() {
    this.connectCalls = [];
    this.disconnectCalls = 0;
  }

  connect(target) {
    this.connectCalls.push(target);
  }

  disconnect() {
    this.disconnectCalls += 1;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

function harness({ getUserMedia, sampleRateHz = 48_000 } = {}) {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 64 });
  const contexts = [];
  const nodes = [];
  const calls = [];
  const notifications = [];
  const controller = new MicrophonePermissionController({
    enabled: true,
    ring,
    sampleRateHz,
    getUserMedia: async (constraints) => {
      calls.push(constraints);
      return getUserMedia(constraints);
    },
    audioContextFactory: (options) => {
      const context = new FakeContext(options);
      contexts.push(context);
      return context;
    },
    workletNodeFactory: (_context, _name, options) => {
      const node = new FakeNode();
      nodes.push({ node, options });
      return node;
    },
    mediaSourceFactory: () => new FakeNode(),
    gainFactory: () => ({
      gain: { value: 1 },
      connect() {},
      disconnect() {},
    }),
    notifyGuest: (event) => notifications.push(event),
  });
  return { calls, contexts, controller, nodes, notifications, ring };
}

test("capture permission stays lazy and does not construct a microphone graph before PCM_START", async () => {
  let gumCalls = 0;
  const h = harness({ getUserMedia: async () => { gumCalls += 1; throw new Error("unexpected"); } });

  assert.deepEqual(h.controller.snapshot(), {
    enabled: true,
    state: MICROPHONE_OFF,
    pending: false,
    startCount: 0,
    getUserMediaCalls: 0,
    listenerCount: 0,
    streamActive: false,
    trackReadyState: null,
    trackMuted: false,
    ringFillFrames: 0,
    ringDroppedFrames: 0,
    notifyCount: 0,
    transitionCount: 0,
    lastError: null,
  });
  assert.equal(gumCalls, 0);
  assert.equal(h.calls.length, 0);
  assert.equal(h.contexts.length, 0);
  assert.deepEqual(await h.controller.onPcmStart({ enabled: false, startCount: 1 }), {
    ok: false,
    state: MICROPHONE_OFF,
    reason: "disabled",
  });
  assert.equal(gumCalls, 0);
});

test("a delayed grant is one request, tracks mute/end, and can be retried after revocation", async () => {
  const first = deferred();
  const second = deferred();
  const firstTrack = new FakeTrack();
  const secondTrack = new FakeTrack();
  const responses = [first.promise, second.promise];
  const h = harness({ getUserMedia: async () => responses.shift() });

  const request = h.controller.onPcmStart({ enabled: true, startCount: 1 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.snapshot().state, MICROPHONE_OFF);
  assert.equal(h.controller.pending, true);
  assert.equal(h.controller.snapshot().listenerCount, 0);
  assert.strictEqual(h.controller.onPcmStart({ enabled: true, startCount: 1 }), request);
  assert.equal(h.calls.length, 1, "duplicate worker observations must not duplicate permission prompts");

  // The permission prompt is logically delayed for 30 seconds, but the fixture does not sleep.
  const delayedTimeline = { beforeGrantMs: 30_000, fillFrames: h.ring.fillFrames };
  assert.deepEqual(delayedTimeline, { beforeGrantMs: 30_000, fillFrames: 0 });

  first.resolve(new FakeStream(firstTrack));
  assert.deepEqual(await request, { ok: true, state: MICROPHONE_LIVE, reason: "granted", startCount: 1 });
  assert.equal(h.controller.state, MICROPHONE_LIVE);
  assert.equal(h.controller.snapshot().listenerCount, 3);
  assert.equal(h.contexts.length, 1);
  assert.equal(h.contexts[0].sampleRate, 48_000);
  assert.equal(h.nodes[0].options.processorOptions.sampleRateHz, 48_000);
  assert.deepEqual(h.calls[0], MICROPHONE_CONSTRAINTS);

  const producer = h.ring.producer();
  producer.write(new Float32Array([0.5, -0.5, 0.25, -0.25]));
  assert.equal(h.ring.fillFrames, 2);
  firstTrack.emit("mute");
  assert.equal(h.controller.state, MICROPHONE_REVOKED);
  assert.equal(h.ring.fillFrames, 0, "mute must drain queued PCM so the guest only sees silence");
  assert.equal(h.controller.snapshot().listenerCount, 3);
  assert.deepEqual(h.notifications, ["muted"]);

  firstTrack.emit("unmute");
  assert.equal(h.controller.state, MICROPHONE_LIVE);
  firstTrack.emit("ended");
  await Promise.resolve();
  assert.equal(h.controller.state, MICROPHONE_REVOKED);
  assert.equal(h.controller.snapshot().listenerCount, 0);
  assert.equal(h.controller.snapshot().streamActive, false);
  assert.deepEqual(h.notifications, ["muted", "revoked"]);
  assert.equal(h.controller.retry().reason, "awaiting-guest-pcm-start");

  const retry = h.controller.onPcmStart({ enabled: true, startCount: 2 });
  assert.equal(h.calls.length, 2);
  second.resolve(new FakeStream(secondTrack));
  assert.deepEqual(await retry, { ok: true, state: MICROPHONE_LIVE, reason: "granted", startCount: 2 });
  assert.equal(h.controller.snapshot().listenerCount, 3);
  assert.equal(firstTrack.listenerCount(), 0);
  assert.deepEqual(
    await h.controller.onPcmStart({ enabled: true, startCount: 2 }),
    { ok: true, state: MICROPHONE_LIVE, reason: "duplicate-start" },
  );
});

test("denial twice and no-device fallback never throw and keep the stream absent", async () => {
  const noDevice = new FakeStream();
  let attempt = 0;
  const h = harness({
    getUserMedia: async () => {
      attempt += 1;
      if (attempt === 1) {
        const error = new Error("user denied");
        error.name = "NotAllowedError";
        throw error;
      }
      return noDevice;
    },
  });

  assert.deepEqual(await h.controller.onPcmStart({ enabled: true, startCount: 1 }), {
    ok: false,
    state: MICROPHONE_DENIED,
    reason: "denied",
    startCount: 1,
  });
  assert.deepEqual(await h.controller.onPcmStart({ enabled: true, startCount: 2 }), {
    ok: false,
    state: MICROPHONE_DENIED,
    reason: "no-device",
    startCount: 2,
  });
  assert.equal(h.controller.snapshot().getUserMediaCalls, 2);
  assert.equal(h.controller.snapshot().listenerCount, 0);
  assert.equal(h.controller.snapshot().streamActive, false);
  assert.deepEqual(h.notifications, ["denied", "denied"]);
});

test("reset cancels a late grant instead of resurrecting a retired session", async () => {
  const permission = deferred();
  const track = new FakeTrack();
  const h = harness({ getUserMedia: async () => permission.promise });
  const request = h.controller.onPcmStart({ enabled: true, startCount: 1 });
  h.controller.reset();
  permission.resolve(new FakeStream(track));

  assert.deepEqual(await request, { ok: false, state: MICROPHONE_OFF, reason: "cancelled", startCount: 1 });
  assert.equal(h.controller.state, MICROPHONE_OFF);
  assert.equal(h.controller.snapshot().listenerCount, 0);
  assert.equal(h.contexts.length, 0);
  assert.equal(track.stopCalls, 1);
});

test("an already-muted grant is honest immediately and a later unmute returns to live", async () => {
  const track = new FakeTrack({ muted: true });
  const h = harness({ getUserMedia: async () => new FakeStream(track) });

  assert.deepEqual(await h.controller.onPcmStart({ enabled: true, startCount: 1 }), {
    ok: true,
    state: MICROPHONE_REVOKED,
    reason: "muted",
    startCount: 1,
  });
  assert.equal(h.controller.state, MICROPHONE_REVOKED);
  assert.deepEqual(h.notifications, ["muted"]);
  track.emit("unmute");
  assert.equal(h.controller.state, MICROPHONE_LIVE);
});
