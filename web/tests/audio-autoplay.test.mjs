// E5-T20d — deterministic autoplay unlock and suspended-context discard policy.
// Run from the repository root with: node --test web/tests/audio-autoplay.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTOPLAY_LOCKED,
  AUTOPLAY_UNLOCKED,
  AUTOPLAY_UNLOCKING,
  AudioAutoplayPolicy,
} from "../src/audio/autoplay.js";
import { AudioRingBuffer, CHANNELS } from "../src/audio/ring.js";

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.addCalls = new Map();
  }

  addEventListener(type, listener) {
    this.addCalls.set(type, (this.addCalls.get(type) ?? 0) + 1);
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type });
  }

  count(type) {
    return this.listeners.get(type)?.size ?? 0;
  }

  added(type) {
    return this.addCalls.get(type) ?? 0;
  }
}

class FakeBadge {
  constructor() {
    this.dataset = {};
    this.hidden = false;
    this.attributes = {};
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }
}

class FakeContext {
  constructor(resumeImpl = () => Promise.resolve()) {
    this.sampleRate = 48_000;
    this.state = "suspended";
    this.resumeCalls = 0;
    this.resumeImpl = resumeImpl;
  }

  resume() {
    this.resumeCalls += 1;
    return Promise.resolve(this.resumeImpl()).then((value) => {
      this.state = "running";
      return value;
    });
  }
}

function manualScheduler() {
  const pending = new Set();
  return {
    schedule(callback, delayMs) {
      const entry = { callback, delayMs, cancelled: false };
      pending.add(entry);
      return entry;
    },
    cancel(entry) {
      entry.cancelled = true;
      pending.delete(entry);
    },
    pending: () => [...pending],
  };
}

function frames(start, count) {
  const result = new Float32Array(count * CHANNELS);
  for (let frame = 0; frame < count; frame += 1) {
    result[frame * CHANNELS] = start + frame + 0.25;
    result[frame * CHANNELS + 1] = -(start + frame + 0.75);
  }
  return result;
}

function harness({ resumeImpl = () => Promise.resolve(), ring = AudioRingBuffer.allocate() } = {}) {
  const target = new FakeTarget();
  const badge = new FakeBadge();
  const context = new FakeContext(resumeImpl);
  const scheduler = manualScheduler();
  let now = 0;
  const policy = new AudioAutoplayPolicy({
    context,
    ring,
    sampleRateHz: context.sampleRate,
    badge,
    target,
    nowMs: () => now,
    schedule: scheduler.schedule,
    cancel: scheduler.cancel,
  });
  return {
    badge,
    context,
    now(value) { now = value; },
    policy,
    producer: ring.producer(),
    ring,
    scheduler,
    target,
  };
}

test("no gesture shows the muted badge and discards at the negotiated clock rate", () => {
  const h = harness({ ring: AudioRingBuffer.allocate({ capacityFrames: 256 }) });
  h.policy.start();
  assert.equal(h.policy.state, AUTOPLAY_LOCKED);
  assert.equal(h.badge.hidden, false);
  assert.match(h.badge.textContent, /muted until interaction/);
  assert.equal(h.target.count("click"), 1);
  assert.equal(h.target.count("keydown"), 1);
  assert.equal(h.target.added("click"), 1);
  assert.equal(h.target.added("keydown"), 1);
  assert.equal(h.context.resumeCalls, 0);

  assert.equal(h.producer.write(frames(0, 128)), 128);
  h.now((128 / 48_000) * 1_000);
  assert.equal(h.policy.pump(), 128);
  assert.equal(h.policy.discardedFrames, 128);
  assert.equal(h.ring.fillFrames, 0);

  // A long backgrounding gap is still only one bounded read. The elapsed clock credit is not
  // allowed to become a burst drain when the page returns to the foreground.
  assert.equal(h.producer.write(frames(128, 256)), 256);
  h.now(5_000);
  assert.equal(h.policy.pump(), 128);
  assert.equal(h.ring.fillFrames, 128);
});

test("first click resumes exactly once, clears the badge, and repeated gestures are harmless", async () => {
  const h = harness();
  h.policy.start();

  h.target.dispatch("click");
  assert.equal(h.policy.state, AUTOPLAY_UNLOCKING);
  assert.equal(h.badge.hidden, false);
  assert.equal(h.context.resumeCalls, 1);
  h.target.dispatch("keydown");
  h.target.dispatch("click");
  assert.equal(h.context.resumeCalls, 1);

  const result = await h.policy.unlock("test");
  assert.deepEqual(result, { ok: true, state: AUTOPLAY_UNLOCKED, reason: "gesture" });
  assert.equal(h.policy.state, AUTOPLAY_UNLOCKED);
  assert.equal(h.policy.isUnlocked, true);
  assert.equal(h.badge.hidden, true);
  assert.equal(h.target.count("click"), 1);
  assert.equal(h.target.count("keydown"), 1);
  assert.equal(h.target.added("click"), 1);
  assert.equal(h.target.added("keydown"), 1);
  assert.equal(h.scheduler.pending().length, 0);

  h.target.dispatch("keydown");
  await h.policy.unlock("repeat");
  assert.equal(h.context.resumeCalls, 1);
});

test("gestures during a pending resume share one promise", async () => {
  let resolveResume;
  const h = harness({ resumeImpl: () => new Promise((resolve) => { resolveResume = resolve; }) });
  h.policy.start();

  h.target.dispatch("click");
  const first = h.policy.unlock("first");
  h.target.dispatch("keydown");
  const second = h.policy.unlock("second");
  assert.equal(first, second);
  assert.equal(h.context.resumeCalls, 1);
  assert.equal(h.policy.state, AUTOPLAY_UNLOCKING);

  resolveResume();
  const result = await first;
  assert.equal(result.ok, true);
  assert.equal(h.policy.state, AUTOPLAY_UNLOCKED);
  assert.equal(h.context.resumeCalls, 1);
});

test("resume rejection stays actionable and leaves the ring usable for a retry", async () => {
  const failure = new Error("autoplay denied");
  const h = harness({ resumeImpl: () => Promise.reject(failure) });
  h.policy.start();
  h.target.dispatch("click");
  const result = await h.policy.unlock("rejected");

  assert.equal(result.ok, false);
  assert.equal(result.error, failure);
  assert.equal(h.policy.state, AUTOPLAY_LOCKED);
  assert.equal(h.policy.lastError, failure);
  assert.equal(h.badge.hidden, false);
  assert.match(h.badge.textContent, /click or press a key/);
  assert.equal(h.context.resumeCalls, 1);
  assert.equal(h.target.count("click"), 1);
  assert.equal(h.target.count("keydown"), 1);

  assert.equal(h.producer.write(frames(0, 32)), 32);
  h.now((32 / 48_000) * 1_000);
  assert.equal(h.policy.pump(), 32);
  assert.equal(h.ring.fillFrames, 0);

  h.context.resumeImpl = () => Promise.resolve();
  h.target.dispatch("keydown");
  const retry = await h.policy.unlock("retry");
  assert.equal(retry.ok, true);
  assert.equal(h.policy.state, AUTOPLAY_UNLOCKED);
  assert.equal(h.context.resumeCalls, 2);
  assert.equal(h.badge.hidden, true);
});

test("listener attachment is idempotent and dispose removes both gesture listeners", () => {
  const h = harness();
  h.policy.start();
  h.policy.start();
  h.policy.attach();
  assert.equal(h.target.count("click"), 1);
  assert.equal(h.target.count("keydown"), 1);
  h.policy.dispose();
  assert.equal(h.target.count("click"), 0);
  assert.equal(h.target.count("keydown"), 0);
  assert.equal(h.scheduler.pending().length, 0);
});
