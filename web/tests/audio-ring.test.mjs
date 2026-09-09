// E5-T20a — deterministic SharedArrayBuffer ring contract.
// Run from the repository root with: node --test web/tests/audio-ring.test.mjs

import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import test from "node:test";

import {
  AUDIO_RING_MAGIC,
  AUDIO_RING_VERSION,
  AudioRingBuffer,
  CHANNELS,
  DEFAULT_CAPACITY_FRAMES,
  HEADER,
  HEADER_WORDS,
} from "../src/audio/ring.js";

function sequence(start, count) {
  const frames = new Float32Array(count * CHANNELS);
  for (let frame = 0; frame < count; frame += 1) {
    frames[frame * CHANNELS] = start + frame + 0.25;
    frames[frame * CHANNELS + 1] = -(start + frame + 0.75);
  }
  return frames;
}

function assertSequence(frames, start, count) {
  assert.ok(frames.length >= count * CHANNELS);
  for (let frame = 0; frame < count; frame += 1) {
    assert.equal(frames[frame * CHANNELS], start + frame + 0.25);
    assert.equal(frames[frame * CHANNELS + 1], -(start + frame + 0.75));
  }
}

function drainAndAssert(consumer, destination, expectedStart, count) {
  assert.equal(consumer.readInto(destination, count), count);
  assertSequence(destination, expectedStart, count);
}

test("header cells are initialized and empty reads do not manufacture frames", () => {
  const ring = AudioRingBuffer.allocate();
  const header = new Int32Array(ring.sharedBuffer, 0, HEADER_WORDS);

  assert.equal(ring.capacityFrames, DEFAULT_CAPACITY_FRAMES);
  assert.equal(Atomics.load(header, HEADER.MAGIC), AUDIO_RING_MAGIC);
  assert.equal(Atomics.load(header, HEADER.VERSION), AUDIO_RING_VERSION);
  assert.equal(Atomics.load(header, HEADER.CHANNELS), CHANNELS);
  assert.equal(Atomics.load(header, HEADER.WRITE_INDEX), 0);
  assert.equal(Atomics.load(header, HEADER.READ_INDEX), 0);
  assert.equal(Atomics.load(header, HEADER.WRITE_SLOT), 0);
  assert.equal(Atomics.load(header, HEADER.READ_SLOT), 0);
  assert.equal(Atomics.load(header, HEADER.FILL_FRAMES), 0);
  assert.equal(Atomics.load(header, HEADER.UNDERRUNS), 0);
  assert.equal(ring.consumer().readInto(new Float32Array(2)), 0);
  assert.equal(ring.fillFrames, 0);
});

test("partial writes, exact fill, full-ring backpressure, and wrap preserve samples", () => {
  const ring = AudioRingBuffer.allocate({ capacityFrames: 4 });
  const producer = ring.producer();
  const consumer = ring.consumer();
  const first = sequence(0, 3);
  const second = sequence(3, 4);
  const output = new Float32Array(2 * 4);

  assert.equal(producer.write(first), 3);
  assert.equal(ring.fillFrames, 3);
  drainAndAssert(consumer, output, 0, 2);
  assert.equal(ring.fillFrames, 1);

  assert.equal(producer.write(second), 3);
  assert.equal(ring.fillFrames, 4);
  assert.equal(producer.availableFrames(), 0);
  assert.equal(producer.write(sequence(7, 1)), 0);

  drainAndAssert(consumer, output, 2, 4);
  assert.equal(ring.fillFrames, 0);
  assert.equal(ring.readIndex, ring.writeIndex);
});

test("a 4095-frame ring drains 128-frame quanta across repeated non-power-of-two wraps", () => {
  const capacityFrames = DEFAULT_CAPACITY_FRAMES - 1;
  const ring = AudioRingBuffer.allocate({ capacityFrames });
  const producer = ring.producer();
  const consumer = ring.consumer();
  const source = new Float32Array(2 * 241);
  const quantum = new Float32Array(2 * 128);
  let nextFrame = 0;
  let expectedFrame = 0;

  for (let schedule = 0; schedule < 700; schedule += 1) {
    const requested = 1 + ((schedule * 97) % 240);
    for (let frame = 0; frame < requested; frame += 1) {
      source[frame * 2] = nextFrame + frame + 0.25;
      source[frame * 2 + 1] = -(nextFrame + frame + 0.75);
    }
    let written = 0;
    while (written < requested) {
      const count = producer.write(source, requested - written, written);
      if (count === 0) {
        assert.ok(consumer.availableFrames() > 0);
        const drain = Math.min(128, consumer.availableFrames());
        drainAndAssert(consumer, quantum, expectedFrame, drain);
        expectedFrame += drain;
      } else {
        written += count;
        nextFrame += count;
      }
    }
    while (consumer.availableFrames() >= 128) {
      drainAndAssert(consumer, quantum, expectedFrame, 128);
      expectedFrame += 128;
    }
    assert.ok(ring.fillFrames >= 0 && ring.fillFrames <= capacityFrames);
  }

  while (consumer.availableFrames() > 0) {
    const drain = Math.min(128, consumer.availableFrames());
    drainAndAssert(consumer, quantum, expectedFrame, drain);
    expectedFrame += drain;
  }
  assert.equal(expectedFrame, nextFrame);
  assert.equal(ring.fillFrames, 0);
});

test("uint32 counters cross 2^32 without changing the payload order", () => {
  const base = 0xffff_fff8;
  const ring = AudioRingBuffer.allocate({
    capacityFrames: 7,
    initialWriteIndex: base,
    initialReadIndex: base,
  });
  const producer = ring.producer();
  const consumer = ring.consumer();
  const output = new Float32Array(2 * 4);
  const input = sequence(100, 12);

  assert.equal(producer.write(input, 4), 4);
  drainAndAssert(consumer, output, 100, 4);
  assert.equal(ring.writeIndex, (base + 4) >>> 0);
  assert.equal(ring.readIndex, (base + 4) >>> 0);
  assert.equal(producer.write(input, 8, 4), 7);
  drainAndAssert(consumer, output, 104, 4);
  drainAndAssert(consumer, output, 108, 3);
  assert.equal(ring.fillFrames, 0);
  assert.equal(ring.writeIndex, (base + 11) >>> 0);
  assert.equal(ring.readIndex, (base + 11) >>> 0);
});

test("capacity metadata is immutable and cannot silently desynchronize endpoints", () => {
  const ring = AudioRingBuffer.allocate({ capacityFrames: DEFAULT_CAPACITY_FRAMES });
  const header = new Int32Array(ring.sharedBuffer, 0, HEADER_WORDS);
  Atomics.store(header, HEADER.CAPACITY_FRAMES, DEFAULT_CAPACITY_FRAMES - 1);

  assert.throws(() => ring.producer().availableFrames(), /capacity metadata changed/);
  assert.throws(
    () => ring.consumer().readInto(new Float32Array(2)),
    /capacity metadata changed/,
  );
  assert.throws(
    () => AudioRingBuffer.fromSharedBuffer(ring.sharedBuffer),
    /size does not match its declared capacity/,
  );
});

test("malformed headers and caller ranges fail closed before touching the payload", () => {
  assert.throws(
    () => AudioRingBuffer.fromSharedBuffer(new ArrayBuffer(HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT)),
    /SharedArrayBuffer/,
  );
  assert.throws(() => AudioRingBuffer.fromSharedBuffer(new SharedArrayBuffer(HEADER_WORDS * 4 - 4)), /smaller/);
  assert.throws(() => AudioRingBuffer.allocate({ capacityFrames: 0 }), /capacity/);
  assert.throws(() => AudioRingBuffer.allocate({ initialWriteIndex: 1 }), /counters/);

  const malformed = (cell, value, message) => {
    const ring = AudioRingBuffer.allocate({ capacityFrames: 4 });
    const header = new Int32Array(ring.sharedBuffer, 0, HEADER_WORDS);
    Atomics.store(header, cell, value);
    assert.throws(() => AudioRingBuffer.fromSharedBuffer(ring.sharedBuffer), message);
  };
  malformed(HEADER.MAGIC, 0, /magic/);
  malformed(HEADER.VERSION, 0, /version/);
  malformed(HEADER.CHANNELS, 1, /channel/);
  malformed(HEADER.CAPACITY_FRAMES, 0, /capacity/);

  const ring = AudioRingBuffer.allocate({ capacityFrames: 4 });
  const producer = ring.producer();
  const consumer = ring.consumer();
  assert.throws(() => producer.write(new Int32Array(2)), /Float32Array/);
  assert.throws(() => producer.write(new Float32Array(2), 2), /frame range/);
  assert.throws(() => consumer.readInto(new Int32Array(2)), /Float32Array/);
  assert.throws(() => consumer.readInto(new Float32Array(2), 2), /frame range/);
  assert.equal(ring.fillFrames, 0);
});

test("concurrent worker producer and consumer never lose or duplicate an index", async () => {
  const capacityFrames = 257;
  const totalFrames = 30_000;
  const ring = AudioRingBuffer.allocate({ capacityFrames });
  const producer = ring.producer();
  const consumer = ring.consumer();
  const output = new Float32Array(2 * 31);
  const moduleUrl = new URL("../src/audio/ring.js", import.meta.url).href;
  const worker = new Worker(`
    import { parentPort, workerData } from "node:worker_threads";
    const { AudioRingBuffer } = await import(workerData.moduleUrl);
    const producer = AudioRingBuffer.fromSharedBuffer(workerData.sharedBuffer).producer();
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
  `, { eval: true, type: "module", workerData: {
    moduleUrl,
    sharedBuffer: ring.sharedBuffer,
    totalFrames,
  } });

  try {
    let expectedFrame = 0;
    while (expectedFrame < totalFrames) {
      const requested = Math.min(31, totalFrames - expectedFrame);
      const count = consumer.readInto(output, requested);
      if (count === 0) {
        await new Promise((resolve) => setImmediate(resolve));
        continue;
      }
      assertSequence(output, expectedFrame, count);
      expectedFrame += count;
      assert.ok(ring.fillFrames >= 0 && ring.fillFrames <= capacityFrames);
    }
    await new Promise((resolve, reject) => {
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
    assert.equal(ring.fillFrames, 0);
    assert.equal(ring.writeIndex, totalFrames >>> 0);
    assert.equal(ring.readIndex, totalFrames >>> 0);
  } finally {
    await worker.terminate();
  }
});

test("consumer copies into caller-owned storage without allocation helpers", () => {
  const source = AudioRingBuffer.allocate({ capacityFrames: 8 });
  const consumerSource = source.consumer().readInto.toString();
  assert.doesNotMatch(consumerSource, /\b(?:new|subarray|slice|map|filter|concat)\b/);
  assert.equal(source.producer().write(sequence(0, 2)), 2);
  const destination = new Float32Array(2 * 4);
  assert.equal(source.consumer().readInto(destination, 2, 1), 2);
  assertSequence(destination.subarray(2), 0, 2);
});
