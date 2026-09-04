// E5-T21c — deterministic capture AudioWorklet producer.
// Run from the repository root with: node --test web/tests/audio-capture-worklet.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { AudioCaptureRingBuffer } from "../src/audio/capture-ring.js";
import { CHANNELS } from "../src/audio/ring.js";
import {
  AUDIO_CAPTURE_QUANTUM_FRAMES,
  AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME,
  AudioCaptureWorkletProcessor,
  processSyntheticQuantum,
  SUPPORTED_CAPTURE_SAMPLE_RATES_HZ,
} from "../src/audio/capture-worklet.js";

function channelRamp(start, count) {
  const channel = new Float32Array(count);
  for (let frame = 0; frame < count; frame += 1) channel[frame] = start + frame + 0.5;
  return channel;
}

function processorFor({ capacityFrames = 512, sampleRateHz = 48_000, withClock = false } = {}) {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames });
  const clockBuffer = withClock ? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT) : null;
  const processor = new AudioCaptureWorkletProcessor({
    processorOptions: {
      captureBuffer: ring.sharedBuffer,
      sampleRateHz,
      ...(clockBuffer ? { clockBuffer } : {}),
    },
  });
  return { clockBuffer, processor, ring };
}

function readFrames(ring, count) {
  const output = new Float32Array(count * CHANNELS);
  assert.equal(ring.consumer().readInto(output, count), count);
  return output;
}

test("the capture processor registers a stable producer name and publishes stereo input exactly", () => {
  assert.equal(AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME, "wasm-vm-audio-capture-producer");
  const { clockBuffer, processor, ring } = processorFor({ withClock: true });
  const left = channelRamp(10, AUDIO_CAPTURE_QUANTUM_FRAMES);
  const right = channelRamp(-20, AUDIO_CAPTURE_QUANTUM_FRAMES);

  assert.equal(processSyntheticQuantum(processor, [left, right]), true);
  const output = readFrames(ring, AUDIO_CAPTURE_QUANTUM_FRAMES);
  for (let frame = 0; frame < AUDIO_CAPTURE_QUANTUM_FRAMES; frame += 1) {
    assert.equal(output[frame * CHANNELS], left[frame]);
    assert.equal(output[frame * CHANNELS + 1], right[frame]);
  }
  assert.equal(processor.processedFrames, AUDIO_CAPTURE_QUANTUM_FRAMES);
  assert.equal(processor.droppedFrames, 0);
  assert.equal(ring.fillFrames, 0);
  assert.equal(Atomics.load(new Int32Array(clockBuffer), 0), AUDIO_CAPTURE_QUANTUM_FRAMES);
});

test("mono input expands to both advertised channels and short/missing input is zero-filled", () => {
  const { processor, ring } = processorFor();
  const mono = channelRamp(3, 37);

  assert.equal(processSyntheticQuantum(processor, [mono]), true);
  assert.equal(processSyntheticQuantum(processor, []), true);
  const output = readFrames(ring, AUDIO_CAPTURE_QUANTUM_FRAMES * 2);
  for (let frame = 0; frame < AUDIO_CAPTURE_QUANTUM_FRAMES; frame += 1) {
    const expected = frame < mono.length ? mono[frame] : 0;
    assert.equal(output[frame * CHANNELS], expected);
    assert.equal(output[frame * CHANNELS + 1], expected);
  }
  for (let frame = 0; frame < AUDIO_CAPTURE_QUANTUM_FRAMES; frame += 1) {
    assert.equal(output[(frame + AUDIO_CAPTURE_QUANTUM_FRAMES) * CHANNELS], 0);
    assert.equal(output[(frame + AUDIO_CAPTURE_QUANTUM_FRAMES) * CHANNELS + 1], 0);
  }
});

test("stereo input never reads beyond a missing channel and ignores frames after the 128-frame bound", () => {
  const { processor, ring } = processorFor();
  const left = channelRamp(100, AUDIO_CAPTURE_QUANTUM_FRAMES + 20);
  const right = channelRamp(-100, 9);

  assert.equal(processSyntheticQuantum(processor, [left, right]), true);
  const output = readFrames(ring, AUDIO_CAPTURE_QUANTUM_FRAMES);
  for (let frame = 0; frame < AUDIO_CAPTURE_QUANTUM_FRAMES; frame += 1) {
    assert.equal(output[frame * CHANNELS], left[frame]);
    assert.equal(output[frame * CHANNELS + 1], frame < right.length ? right[frame] : 0);
  }
  assert.equal(processor.processedFrames, AUDIO_CAPTURE_QUANTUM_FRAMES);
});

test("full capture rings drop without waiting and preserve later frames after the consumer drains", () => {
  const { processor, ring } = processorFor({ capacityFrames: AUDIO_CAPTURE_QUANTUM_FRAMES });
  const first = channelRamp(1, AUDIO_CAPTURE_QUANTUM_FRAMES);
  const second = channelRamp(2, AUDIO_CAPTURE_QUANTUM_FRAMES);
  const consumer = ring.consumer();

  processSyntheticQuantum(processor, [first]);
  processSyntheticQuantum(processor, [second]);
  assert.equal(ring.fillFrames, AUDIO_CAPTURE_QUANTUM_FRAMES);
  assert.equal(processor.droppedFrames, AUDIO_CAPTURE_QUANTUM_FRAMES);

  const output = new Float32Array(AUDIO_CAPTURE_QUANTUM_FRAMES * CHANNELS);
  assert.equal(consumer.readInto(output, AUDIO_CAPTURE_QUANTUM_FRAMES), AUDIO_CAPTURE_QUANTUM_FRAMES);
  for (let frame = 0; frame < AUDIO_CAPTURE_QUANTUM_FRAMES; frame += 1) {
    assert.equal(output[frame * CHANNELS], first[frame]);
    assert.equal(output[frame * CHANNELS + 1], first[frame]);
  }
  processSyntheticQuantum(processor, [second]);
  const later = readFrames(ring, AUDIO_CAPTURE_QUANTUM_FRAMES);
  assert.equal(later[0], second[0]);
  assert.equal(later[1], second[0]);
});

test("each supported sample rate advances the same quantum timeline", () => {
  for (const sampleRateHz of SUPPORTED_CAPTURE_SAMPLE_RATES_HZ) {
    const { clockBuffer, processor, ring } = processorFor({ sampleRateHz, withClock: true });
    for (let quantum = 0; quantum < 3; quantum += 1) {
      processSyntheticQuantum(processor, [channelRamp(quantum, AUDIO_CAPTURE_QUANTUM_FRAMES)]);
    }
    const frames = AUDIO_CAPTURE_QUANTUM_FRAMES * 3;
    assert.equal(processor.sampleRateHz, sampleRateHz);
    assert.equal(processor.processedFrames, frames);
    assert.equal(processor.processedDurationNs, Math.round((frames * 1_000_000_000) / sampleRateHz));
    assert.equal(ring.fillFrames, frames);
    assert.equal(Atomics.load(new Int32Array(clockBuffer), 0), frames);
  }
});

test("the process path has no blocking primitive or per-quantum allocation helper", () => {
  const source = AudioCaptureWorkletProcessor.prototype.process.toString();
  assert.doesNotMatch(source, /\b(?:new|Promise|setTimeout|setInterval|Atomics\.wait|subarray|slice|map|filter|concat)\b/);
});

test("capture worklet validates its shared ring and supported rates", () => {
  assert.throws(
    () => new AudioCaptureWorkletProcessor({ processorOptions: { sampleRateHz: 48_000 } }),
    /captureBuffer/,
  );
  const ring = AudioCaptureRingBuffer.allocate();
  assert.throws(
    () => new AudioCaptureWorkletProcessor({
      processorOptions: { captureBuffer: ring.sharedBuffer, sampleRateHz: 32_000 },
    }),
    /44100 or 48000/,
  );
});
