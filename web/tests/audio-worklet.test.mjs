// E5-T20b — deterministic AudioWorklet consumer and underrun accounting.
// Run from the repository root with: node --test web/tests/audio-worklet.test.mjs

import assert from "node:assert/strict";
import test from "node:test";

import { AudioRingBuffer, CHANNELS } from "../src/audio/ring.js";
import {
  AUDIO_QUANTUM_FRAMES,
  AudioRingWorkletProcessor,
  processSyntheticQuantum,
} from "../src/audio/worklet.js";

function sequence(start, count) {
  const frames = new Float32Array(count * CHANNELS);
  for (let frame = 0; frame < count; frame += 1) {
    frames[frame * CHANNELS] = start + frame + 0.25;
    frames[frame * CHANNELS + 1] = -(start + frame + 0.75);
  }
  return frames;
}

function assertOutput(left, right, start, count, total = AUDIO_QUANTUM_FRAMES) {
  for (let frame = 0; frame < total; frame += 1) {
    if (frame < count) {
      assert.equal(left[frame], start + frame + 0.25);
      assert.equal(right[frame], -(start + frame + 0.75));
    } else {
      assert.equal(left[frame], 0);
      assert.equal(right[frame], 0);
    }
  }
}

function processorFor(capacityFrames = 512) {
  const ring = AudioRingBuffer.allocate({ capacityFrames });
  const processor = new AudioRingWorkletProcessor({
    processorOptions: { sharedBuffer: ring.sharedBuffer },
  });
  return { ring, producer: ring.producer(), processor };
}

function output() {
  return [new Float32Array(AUDIO_QUANTUM_FRAMES), new Float32Array(AUDIO_QUANTUM_FRAMES)];
}

test("full 128-frame quantum is copied sample-for-sample with no underrun", () => {
  const { ring, producer, processor } = processorFor();
  const [left, right] = output();
  assert.equal(producer.write(sequence(0, AUDIO_QUANTUM_FRAMES)), AUDIO_QUANTUM_FRAMES);
  assert.equal(processSyntheticQuantum(processor, left, right), true);
  assertOutput(left, right, 0, AUDIO_QUANTUM_FRAMES);
  assert.equal(ring.underrunCount, 0);
});

test("partial and empty quanta zero-fill only the missing frames and count once each", () => {
  const { ring, producer, processor } = processorFor();
  const [left, right] = output();
  left.fill(99);
  right.fill(99);
  assert.equal(producer.write(sequence(10, AUDIO_QUANTUM_FRAMES - 1)), AUDIO_QUANTUM_FRAMES - 1);
  processSyntheticQuantum(processor, left, right);
  assertOutput(left, right, 10, AUDIO_QUANTUM_FRAMES - 1);
  assert.equal(ring.underrunCount, 1);

  left.fill(99);
  right.fill(99);
  processSyntheticQuantum(processor, left, right);
  assertOutput(left, right, 0, 0);
  assert.equal(ring.underrunCount, 2);
});

test("a quantum-sized ring wrap has no duplicated or missing frames", () => {
  const { ring, producer, processor } = processorFor(AUDIO_QUANTUM_FRAMES);
  const [left, right] = output();
  assert.equal(producer.write(sequence(0, AUDIO_QUANTUM_FRAMES)), AUDIO_QUANTUM_FRAMES);
  processSyntheticQuantum(processor, left, right);
  assertOutput(left, right, 0, AUDIO_QUANTUM_FRAMES);
  assert.equal(producer.write(sequence(AUDIO_QUANTUM_FRAMES, AUDIO_QUANTUM_FRAMES)), AUDIO_QUANTUM_FRAMES);
  processSyntheticQuantum(processor, left, right);
  assertOutput(left, right, AUDIO_QUANTUM_FRAMES, AUDIO_QUANTUM_FRAMES);
  assert.equal(ring.underrunCount, 0);
});

test("alternating starvation stays exact across 10,000 simulated process calls", () => {
  const { ring, producer, processor } = processorFor(257);
  const [left, right] = output();
  const block = new Float32Array(AUDIO_QUANTUM_FRAMES * CHANNELS);
  let nextFrame = 0;
  let expectedUnderruns = 0;

  for (let quantum = 0; quantum < 10_000; quantum += 1) {
    const starved = quantum % 3 === 1;
    if (!starved) {
      for (let frame = 0; frame < AUDIO_QUANTUM_FRAMES; frame += 1) {
        block[frame * CHANNELS] = nextFrame + frame + 0.25;
        block[frame * CHANNELS + 1] = -(nextFrame + frame + 0.75);
      }
      assert.equal(producer.write(block), AUDIO_QUANTUM_FRAMES);
    } else {
      expectedUnderruns += 1;
    }
    processSyntheticQuantum(processor, left, right);
    assertOutput(left, right, starved ? 0 : nextFrame, starved ? 0 : AUDIO_QUANTUM_FRAMES);
    if (!starved) nextFrame += AUDIO_QUANTUM_FRAMES;
  }

  assert.equal(ring.underrunCount, expectedUnderruns);
  assert.equal(ring.fillFrames, 0);
});

test("process contains no blocking primitive or per-quantum allocation helper", () => {
  const source = `${AudioRingWorkletProcessor.prototype.process}\n${AudioRingWorkletProcessor.prototype._render ?? ""}`;
  assert.doesNotMatch(source, /\b(?:new|Promise|setTimeout|setInterval|Atomics\.wait|subarray|slice)\b/);
});
