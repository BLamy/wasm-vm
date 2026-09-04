// E5-T20c — S16 AudioSink, AudioContext rate negotiation, clock, and latency telemetry.
// Run from the repository root with: node --test web/tests/audio-sink.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import {
  AudioSink,
  AudioSinkRateError,
  AudioWorkletSink,
  REQUESTED_SAMPLE_RATE_HZ,
  S16_SCALE,
} from "../src/audio/sink.js";

class FakeAudioContext {
  constructor({ sampleRate = REQUESTED_SAMPLE_RATE_HZ, baseLatency, outputLatency } = {}) {
    this.sampleRate = sampleRate;
    this.currentTime = 0;
    this.destination = { kind: "destination" };
    if (baseLatency !== undefined) this.baseLatency = baseLatency;
    if (outputLatency !== undefined) this.outputLatency = outputLatency;
    this.audioWorklet = {
      addModule: async (url) => { this.loadedModule = url; },
    };
    this.closed = false;
  }

  async close() {
    this.closed = true;
  }
}

function contextFactory(overrides = {}) {
  const calls = [];
  const factory = (options = {}) => {
    calls.push({ ...options });
    return new FakeAudioContext({ ...overrides, sampleRate: overrides.sampleRate ?? options.sampleRate });
  };
  return { calls, factory };
}

function ramp(values) {
  return new Int16Array(values);
}

test("S16 stereo ramp converts exactly and each sink owns a distinct ring", () => {
  const vmA = { stats: {} };
  const vmB = { stats: {} };
  const a = contextFactory({ sampleRate: 48_000 });
  const b = contextFactory({ sampleRate: 48_000 });
  const sinkA = new AudioWorkletSink({ vm: vmA, audioContextFactory: a.factory });
  const sinkB = new AudioWorkletSink({ vm: vmB, audioContextFactory: b.factory });
  const framesA = ramp([-32_768, -1, 0, 1, 32_767, 12_345]);
  const framesB = ramp([7, 8]);

  assert.notEqual(sinkA.ring.sharedBuffer, sinkB.ring.sharedBuffer);
  assert.equal(AudioSink, AudioWorkletSink);
  assert.deepEqual(sinkA.push(framesA), {
    acceptedFrames: 3,
    droppedFrames: 0,
    complete: true,
    sampleRateHz: 48_000,
  });
  assert.equal(sinkB.push(framesB).acceptedFrames, 1);
  const outA = new Float32Array(framesA.length);
  const outB = new Float32Array(framesB.length);
  assert.equal(sinkA.ring.consumer().readInto(outA), 3);
  assert.equal(sinkB.ring.consumer().readInto(outB), 1);
  for (let index = 0; index < framesA.length; index += 1) {
    assert.equal(outA[index], framesA[index] * S16_SCALE);
  }
  assert.equal(outB[0], 7 * S16_SCALE);
  assert.equal(outB[1], 8 * S16_SCALE);
  assert.equal(vmA.stats.audio.fill, 3);
  assert.equal(vmB.stats.audio.fill, 1);
});

test("requested 48 kHz is advertised when honored and actual fallback rate rejects resampling", () => {
  const honored = contextFactory({ sampleRate: 48_000 });
  const native = new AudioWorkletSink({ audioContextFactory: honored.factory });
  assert.equal(native.requestedSampleRateHz, REQUESTED_SAMPLE_RATE_HZ);
  assert.equal(native.advertisedSampleRateHz, 48_000);
  assert.equal(honored.calls[0].sampleRate, 48_000);
  assert.equal("baseLatency" in native.stats(), false);
  assert.equal("outputLatency" in native.stats(), false);

  const fallbackCalls = [];
  const fallback = (options = {}) => {
    fallbackCalls.push({ ...options });
    if (options.sampleRate !== undefined) throw new Error("rate option rejected");
    return new FakeAudioContext({ sampleRate: 44_100 });
  };
  const sink = new AudioWorkletSink({ audioContextFactory: fallback });
  assert.equal(sink.rateRequested, false);
  assert.equal(sink.advertisedSampleRateHz, 44_100);
  assert.equal(fallbackCalls.length, 2);
  assert.equal(fallbackCalls[1].sampleRate, undefined);
  assert.equal(sink.push(ramp([1, -1]), 44_100).complete, true);
  assert.throws(() => sink.push(ramp([1, -1]), 48_000), AudioSinkRateError);
});

test("connect loads the stable worklet with this sink's ring", async () => {
  const context = contextFactory({ sampleRate: 48_000 });
  const calls = [];
  const node = {
    connect(destination) { calls.push({ kind: "connect", destination }); },
    disconnect() { calls.push({ kind: "disconnect" }); },
  };
  const sink = new AudioWorkletSink({
    audioContextFactory: context.factory,
    workletNodeFactory: (actualContext, name, options) => {
      calls.push({ kind: "node", actualContext, name, options });
      return node;
    },
  });
  await sink.connect();
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0].sampleRate, 48_000);
  assert.match(sink.context.loadedModule, /worklet\.js$/);
  assert.equal(calls[0].kind, "node");
  assert.equal(calls[0].name, "wasm-vm-audio-consumer");
  assert.equal(calls[0].options.processorOptions.sharedBuffer, sink.ring.sharedBuffer);
  assert.deepEqual(calls[1], { kind: "connect", destination: sink.context.destination });
});

test("stats include ring fill plus exposed context latency and stay under 120 ms", () => {
  const { factory } = contextFactory({ sampleRate: 48_000, baseLatency: 0.01, outputLatency: 0.02 });
  const vm = { stats: {} };
  const sink = new AudioWorkletSink({ vm, audioContextFactory: factory });
  const full = new Int16Array(4_096 * 2);
  const result = sink.push(full);
  assert.equal(result.acceptedFrames, 4_096);
  const stats = vm.stats.audio;
  assert.equal(stats.fill, 4_096);
  assert.equal(stats.underruns, 0);
  assert.equal(stats.baseLatency, 0.01);
  assert.equal(stats.outputLatency, 0.02);
  assert.ok(stats.latency_ms > 115 && stats.latency_ms < 116);
  assert.ok(stats.latency_ms < 120);

  sink.ring.recordUnderrun();
  const updated = sink.stats();
  assert.equal(updated.underruns, 1);
  assert.equal(updated.fill, 4_096);
  assert.equal(vm.stats.audio.underruns, 1);

  const consumer = sink.ring.consumer();
  assert.equal(consumer.readInto(new Float32Array(4_096 * 2)), 4_096);
  const empty = sink.stats();
  assert.equal(empty.fill, 0);
  assert.equal(empty.underruns, 1);
  assert.ok(empty.latency_ms < updated.latency_ms);
  sink.context.currentTime = 0.5;
  const paused = sink.stats();
  assert.equal(paused.fill, 0);
  assert.equal(paused.latency_ms, empty.latency_ms);
});

test("AudioContext time and the atomic consumed-frame cursor provide a monotonic clock", () => {
  const { factory } = contextFactory({ sampleRate: 48_000 });
  const sink = new AudioWorkletSink({ audioContextFactory: factory });
  const producer = sink.ring.producer();
  const consumer = sink.ring.consumer();
  const first = sink.audioClockNowNs();
  assert.equal(producer.write(new Float32Array(2 * 128)), 128);
  assert.equal(consumer.readInto(new Float32Array(2 * 128)), 128);
  sink.context.currentTime = 128 / 48_000;
  const second = sink.audioClockNowNs();
  assert.ok(second >= first + 2_000_000);
  sink.context.currentTime = 0;
  assert.ok(sink.audioClockNowNs() >= second);
});

test("full ring returns bounded backpressure instead of spinning or resampling", () => {
  const { factory } = contextFactory({ sampleRate: 48_000 });
  const sink = new AudioWorkletSink({ capacityFrames: 4, audioContextFactory: factory });
  assert.equal(sink.push(ramp([1, 1, 2, 2, 3, 3, 4, 4])).complete, true);
  const partial = sink.push(ramp([5, 5, 6, 6]), 48_000);
  assert.deepEqual(partial, {
    acceptedFrames: 0,
    droppedFrames: 2,
    complete: false,
    sampleRateHz: 48_000,
  });
});
