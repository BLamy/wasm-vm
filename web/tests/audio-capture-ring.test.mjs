// E5-T21c — reversed SPSC capture ring and bounded drop accounting.
// Run from the repository root with: node --test web/tests/audio-capture-ring.test.mjs

import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import test from "node:test";

import {
  AudioCaptureRingBuffer,
} from "../src/audio/capture-ring.js";
import {
  HEADER,
  CHANNELS,
} from "../src/audio/ring.js";

const UINT32_MAX = 0xffff_ffff;

function sequence(start, count) {
  const frames = new Float32Array(count * CHANNELS);
  for (let frame = 0; frame < count; frame += 1) {
    frames[frame * CHANNELS] = start + frame + 0.25;
    frames[frame * CHANNELS + 1] = -(start + frame + 0.75);
  }
  return frames;
}

function assertSequence(frames, start, count) {
  for (let frame = 0; frame < count; frame += 1) {
    assert.equal(frames[frame * CHANNELS], start + frame + 0.25);
    assert.equal(frames[frame * CHANNELS + 1], -(start + frame + 0.75));
  }
}

test("capture ring reuses the T20 header while reversing producer and consumer roles", () => {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 7 });
  const header = new Int32Array(ring.sharedBuffer, 0, 10);

  assert.equal(ring.channels, CHANNELS);
  assert.equal(ring.fillFrames, 0);
  assert.equal(Atomics.load(header, HEADER.WRITE_INDEX), 0);
  assert.equal(Atomics.load(header, HEADER.READ_INDEX), 0);
  assert.equal(Atomics.load(header, HEADER.DROPPED_FRAMES), 0);
  assert.equal(ring.consumer().readInto(new Float32Array(CHANNELS)), 0);
});

test("ordered capture frames survive repeated non-power-of-two wraps and counter rollover", () => {
  const capacityFrames = 7;
  const initialIndex = UINT32_MAX - 3;
  const totalFrames = 12_345;
  const ring = AudioCaptureRingBuffer.allocate({
    capacityFrames,
    initialWriteIndex: initialIndex,
    initialReadIndex: initialIndex,
  });
  const producer = ring.producer();
  const consumer = ring.consumer();
  const writeBlock = new Float32Array(5 * CHANNELS);
  const readBlock = new Float32Array(3 * CHANNELS);
  let nextFrame = 0;
  let expectedFrame = 0;

  while (nextFrame < totalFrames || ring.fillFrames > 0) {
    if (nextFrame < totalFrames && producer.availableFrames() > 0) {
      const requested = Math.min(5, totalFrames - nextFrame, producer.availableFrames());
      for (let frame = 0; frame < requested; frame += 1) {
        writeBlock[frame * CHANNELS] = nextFrame + frame + 0.25;
        writeBlock[frame * CHANNELS + 1] = -(nextFrame + frame + 0.75);
      }
      const written = producer.write(writeBlock, requested);
      nextFrame += written;
    }

    const toRead = Math.min(3, ring.fillFrames);
    if (toRead > 0) {
      assert.equal(consumer.readInto(readBlock, toRead), toRead);
      assertSequence(readBlock, expectedFrame, toRead);
      expectedFrame += toRead;
    }
  }

  assert.equal(expectedFrame, totalFrames);
  assert.equal(nextFrame, totalFrames);
  assert.equal(ring.fillFrames, 0);
  assert.equal(ring.droppedFrames, 0);
  assert.equal(ring.writeIndex, (initialIndex + totalFrames) >>> 0);
  assert.equal(ring.readIndex, ring.writeIndex);
});

test("full and empty capture states apply bounded backpressure without overwrite", () => {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 5 });
  const producer = ring.producer();
  const consumer = ring.consumer();
  const output = new Float32Array(5 * CHANNELS);

  assert.equal(producer.write(sequence(0, 7)), 5);
  assert.equal(ring.fillFrames, 5);
  assert.equal(ring.droppedFrames, 2);
  assert.equal(producer.availableFrames(), 0);
  assert.equal(producer.write(sequence(7, 1)), 0);
  assert.equal(ring.droppedFrames, 3);

  assert.equal(consumer.readInto(output, 2), 2);
  assertSequence(output, 0, 2);
  assert.equal(producer.write(sequence(5, 3)), 2);
  assert.equal(ring.droppedFrames, 4);
  assert.equal(ring.fillFrames, 5);

  assert.equal(consumer.readInto(output, 5), 5);
  assertSequence(output, 2, 3);
  assertSequence(output.subarray(3 * CHANNELS), 5, 2);
  assert.equal(ring.fillFrames, 0);
  assert.equal(consumer.readInto(output, 1), 0);
});

test("capture drop accounting saturates instead of wrapping its uint32 status cell", () => {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 1 });
  const header = new Int32Array(ring.sharedBuffer, 0, 10);
  const producer = ring.producer();

  Atomics.store(header, HEADER.DROPPED_FRAMES, -2);
  assert.equal(producer.write(sequence(0, 1)), 1);
  assert.equal(producer.write(sequence(1, 1)), 0);
  assert.equal(ring.droppedFrames, UINT32_MAX);
  assert.equal(ring.overflowCount, UINT32_MAX);
});

test("a real worker producer races the VM consumer without duplicates or unpublished reads", async () => {
  const capacityFrames = 4095;
  const totalFrames = 18_000;
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames });
  const moduleUrl = new URL("../src/audio/capture-ring.js", import.meta.url).href;
  const worker = new Worker(`
    import { parentPort, workerData } from "node:worker_threads";
    const { AudioCaptureRingBuffer } = await import(workerData.moduleUrl);
    const producer = AudioCaptureRingBuffer.fromSharedBuffer(workerData.sharedBuffer).producer();
    const block = new Float32Array(2 * 19);
    let nextFrame = 0;
    while (nextFrame < workerData.totalFrames) {
      const requested = Math.min(19, workerData.totalFrames - nextFrame);
      for (let frame = 0; frame < requested; frame += 1) {
        block[frame * 2] = nextFrame + frame + 0.25;
        block[frame * 2 + 1] = -(nextFrame + frame + 0.75);
      }
      const written = producer.write(block, requested);
      if (written === 0) await new Promise((resolve) => setImmediate(resolve));
      else nextFrame += written;
    }
    parentPort.postMessage({ done: true });
  `, {
    eval: true,
    type: "module",
    workerData: { moduleUrl, sharedBuffer: ring.sharedBuffer, totalFrames },
  });
  const consumer = ring.consumer();
  const output = new Float32Array(31 * CHANNELS);
  let expectedFrame = 0;
  const workerDone = new Promise((resolve, reject) => {
    worker.once("message", (message) => {
      try {
        assert.deepEqual(message, { done: true });
        resolve();
      } catch (error) {
        reject(error);
      }
    });
    worker.once("error", reject);
  });

  try {
    while (expectedFrame < totalFrames) {
      const requested = Math.min(31, totalFrames - expectedFrame);
      const read = consumer.readInto(output, requested);
      if (read === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      assertSequence(output, expectedFrame, read);
      expectedFrame += read;
      assert.ok(ring.fillFrames >= 0 && ring.fillFrames <= capacityFrames);
    }

    await workerDone;
    assert.equal(ring.fillFrames, 0);
    assert.equal(ring.writeIndex, totalFrames >>> 0);
    assert.equal(ring.readIndex, totalFrames >>> 0);
    assert.equal(ring.overflowCount, ring.droppedFrames);
  } finally {
    await worker.terminate();
  }
});
