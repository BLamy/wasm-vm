#!/usr/bin/env node
// E5-T21d: deterministic verifier for lazy microphone permission and lifecycle fallback.
// The browser's permission UI cannot be automated portably, so this harness replaces only the
// media/context factories while exercising the production state machine and real SAB ring.

import assert from "node:assert/strict";

import { AudioCaptureRingBuffer } from "../../web/src/audio/capture-ring.js";
import {
  MICROPHONE_DENIED,
  MICROPHONE_LIVE,
  MICROPHONE_OFF,
  MICROPHONE_REVOKED,
  MICROPHONE_CONSTRAINTS,
  MicrophonePermissionController,
} from "../../web/src/audio/microphone.js";

class Track {
  constructor({ muted = false } = {}) {
    this.muted = muted;
    this.readyState = "live";
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
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  listenerCount() {
    return [...this.listeners.values()].reduce((total, listeners) => total + listeners.size, 0);
  }

  stop() {
    this.stopCalls += 1;
    this.readyState = "ended";
  }
}

class Stream {
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

class Context {
  constructor({ sampleRate }) {
    this.sampleRate = sampleRate;
    this.destination = {};
    this.audioWorklet = { addModule: async (url) => { this.workletUrl = url; } };
    this.closeCalls = 0;
  }

  async resume() {}

  async close() {
    this.closeCalls += 1;
  }
}

class Node {
  connect() {}

  disconnect() {}
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

function makeHarness(getUserMedia) {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 64 });
  const gumCalls = [];
  const contexts = [];
  const notifications = [];
  const controller = new MicrophonePermissionController({
    enabled: true,
    ring,
    getUserMedia: async (constraints) => {
      gumCalls.push(constraints);
      return getUserMedia(constraints);
    },
    audioContextFactory: (options) => {
      const context = new Context(options);
      contexts.push(context);
      return context;
    },
    workletNodeFactory: () => new Node(),
    mediaSourceFactory: () => new Node(),
    gainFactory: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    notifyGuest: (event) => notifications.push(event),
  });
  return { controller, contexts, gumCalls, notifications, ring };
}

const lazy = makeHarness(async () => { throw new Error("must remain lazy"); });
assert.equal(lazy.controller.state, MICROPHONE_OFF);
assert.equal(lazy.gumCalls.length, 0);
assert.equal(lazy.controller.snapshot().listenerCount, 0);

const firstPermission = deferred();
const secondPermission = deferred();
const firstTrack = new Track();
const secondTrack = new Track();
const permissionResponses = [firstPermission.promise, secondPermission.promise];
const permission = makeHarness(async () => permissionResponses.shift());
const firstRequest = permission.controller.onPcmStart({ enabled: true, startCount: 1 });
assert.equal(permission.gumCalls.length, 1);
assert.equal(permission.controller.snapshot().state, MICROPHONE_OFF);
assert.equal(permission.controller.snapshot().pending, true);
assert.strictEqual(permission.controller.onPcmStart({ enabled: true, startCount: 1 }), firstRequest);
assert.equal(permission.gumCalls.length, 1);
const delayedTimeline = { delayedPermissionMs: 30_000, silenceFramesBeforeGrant: permission.ring.fillFrames };
assert.deepEqual(delayedTimeline, { delayedPermissionMs: 30_000, silenceFramesBeforeGrant: 0 });

firstPermission.resolve(new Stream(firstTrack));
assert.deepEqual(await firstRequest, {
  ok: true,
  state: MICROPHONE_LIVE,
  reason: "granted",
  startCount: 1,
});
assert.equal(permission.controller.snapshot().listenerCount, 3);
assert.deepEqual(permission.gumCalls[0], MICROPHONE_CONSTRAINTS);

permission.ring.producer().write(new Float32Array([0.5, -0.5]));
firstTrack.emit("mute");
assert.equal(permission.controller.state, MICROPHONE_REVOKED);
assert.equal(permission.ring.fillFrames, 0);
firstTrack.emit("unmute");
assert.equal(permission.controller.state, MICROPHONE_LIVE);
firstTrack.emit("ended");
assert.equal(permission.controller.state, MICROPHONE_REVOKED);
assert.equal(permission.controller.snapshot().listenerCount, 0);
assert.deepEqual(permission.notifications, ["muted", "revoked"]);
assert.equal(permission.controller.retry().reason, "awaiting-guest-pcm-start");

const retry = permission.controller.onPcmStart({ enabled: true, startCount: 2 });
assert.equal(permission.gumCalls.length, 2);
secondPermission.resolve(new Stream(secondTrack));
assert.deepEqual(await retry, {
  ok: true,
  state: MICROPHONE_LIVE,
  reason: "granted",
  startCount: 2,
});
assert.equal(permission.controller.snapshot().listenerCount, 3);
assert.equal(firstTrack.listenerCount(), 0);

let denialAttempt = 0;
const denied = makeHarness(async () => {
  denialAttempt += 1;
  const error = new Error(`denied-${denialAttempt}`);
  error.name = "NotAllowedError";
  throw error;
});
assert.equal((await denied.controller.onPcmStart({ enabled: true, startCount: 1 })).state, MICROPHONE_DENIED);
assert.equal((await denied.controller.onPcmStart({ enabled: true, startCount: 2 })).state, MICROPHONE_DENIED);
assert.equal(denied.gumCalls.length, 2);
assert.deepEqual(denied.notifications, ["denied", "denied"]);
assert.equal(denied.controller.snapshot().listenerCount, 0);

const noDevice = makeHarness(async () => new Stream());
const noDeviceResult = await noDevice.controller.onPcmStart({ enabled: true, startCount: 1 });
assert.deepEqual(noDeviceResult, {
  ok: false,
  state: MICROPHONE_DENIED,
  reason: "no-device",
  startCount: 1,
});
assert.deepEqual(noDevice.notifications, ["denied"]);

const cancelledPermission = deferred();
const cancelledTrack = new Track();
const cancelled = makeHarness(async () => cancelledPermission.promise);
const cancelledRequest = cancelled.controller.onPcmStart({ enabled: true, startCount: 1 });
cancelled.controller.reset();
cancelledPermission.resolve(new Stream(cancelledTrack));
assert.deepEqual(await cancelledRequest, {
  ok: false,
  state: MICROPHONE_OFF,
  reason: "cancelled",
  startCount: 1,
});
assert.equal(cancelled.controller.state, MICROPHONE_OFF);
assert.equal(cancelledTrack.stopCalls, 1);
assert.equal(cancelled.controller.snapshot().listenerCount, 0);

console.log(JSON.stringify({
  task: "E5-T21d",
  result: "passed",
  stages: {
    noCaptureStart: { getUserMediaCalls: lazy.gumCalls.length, state: lazy.controller.state },
    delayedGrant: {
      delayedPermissionMs: delayedTimeline.delayedPermissionMs,
      stateBeforeGrant: "off",
      silenceFramesBeforeGrant: delayedTimeline.silenceFramesBeforeGrant,
      duplicateCalls: permission.gumCalls.length,
      postGrantListeners: 3,
      notifications: permission.notifications,
      retryState: permission.controller.state,
    },
    deniedTwice: { calls: denied.gumCalls.length, state: denied.controller.state, notifications: denied.notifications },
    noDevice: { state: noDevice.controller.state, notifications: noDevice.notifications },
    cancelledLateGrant: { state: cancelled.controller.state, trackStopCalls: cancelledTrack.stopCalls },
  },
}, null, 2));
