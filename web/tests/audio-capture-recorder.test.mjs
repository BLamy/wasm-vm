// E5-T21e — bounded guest `arecord`-shaped rxq consumer.

import assert from "node:assert/strict";
import test from "node:test";

import { AudioCaptureRingBuffer } from "../src/audio/capture-ring.js";
import {
  DEFAULT_CAPTURE_PERIOD_BYTES,
  GuestCaptureRecorder,
  MAX_CAPTURE_PERIOD_BYTES,
  PCM_STATUS_BYTES,
} from "../src/audio/capture-recorder.js";

test("guest recorder preserves a short stereo period and its canary", () => {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 8 });
  const producer = ring.producer();
  producer.write(new Float32Array([0.5, -0.5, 0.25, -0.25]));
  const recorder = new GuestCaptureRecorder({ ring });
  const destination = new Uint8Array(16 + PCM_STATUS_BYTES + 16).fill(0xa5);
  const result = recorder.readPeriod(16, { destination });

  assert.deepEqual(result, {
    periodBytes: 16,
    frameCount: 4,
    readFrames: 2,
    silenceFrames: 2,
    statusBytes: PCM_STATUS_BYTES,
    usedBytes: 24,
    status: "ok",
  });
  assert.equal(destination[0] | (destination[1] << 8), 0x4000);
  assert.equal(destination[2] | (destination[3] << 8), -0x4000 & 0xffff);
  assert.equal(destination[16] | (destination[17] << 8), 0x8000);
  assert.deepEqual([...destination.slice(24)], new Array(16).fill(0xa5));
  assert.equal(recorder.wavBytes().length, 44 + 16);
});

test("one MiB guest periods are bounded and zero-fill without overwriting canaries", () => {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 32 });
  ring.producer().write(new Float32Array([0.125, 0.125]));
  const recorder = new GuestCaptureRecorder({ ring, maxFrames: MAX_CAPTURE_PERIOD_BYTES / 4 });
  const destination = new Uint8Array(MAX_CAPTURE_PERIOD_BYTES + PCM_STATUS_BYTES + 32).fill(0x5a);
  const result = recorder.readPeriod(MAX_CAPTURE_PERIOD_BYTES, { destination });

  assert.equal(result.periodBytes, MAX_CAPTURE_PERIOD_BYTES);
  assert.equal(result.frameCount, MAX_CAPTURE_PERIOD_BYTES / 4);
  assert.equal(result.usedBytes, MAX_CAPTURE_PERIOD_BYTES + PCM_STATUS_BYTES);
  assert.equal(result.readFrames, 1);
  assert.equal(result.silenceFrames, result.frameCount - 1);
  assert.deepEqual(
    [...destination.slice(MAX_CAPTURE_PERIOD_BYTES + PCM_STATUS_BYTES)],
    new Array(32).fill(0x5a),
  );
  assert.throws(() => recorder.readPeriod(DEFAULT_CAPTURE_PERIOD_BYTES), /frame budget/);
});

test("44.1 kHz and 48 kHz recordings expose exact frame-duration truth", async () => {
  for (const sampleRateHz of [44_100, 48_000]) {
    const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 64 });
    const recorder = new GuestCaptureRecorder({ ring, sampleRateHz, maxFrames: sampleRateHz });
    const result = await recorder.recordForDuration(1_000, { intervalMs: 0 });
    const wav = recorder.wavBytes();

    assert.equal(result.targetFrames, sampleRateHz);
    assert.equal(result.frames, sampleRateHz);
    assert.equal(result.durationNs, 1_000_000_000);
    assert.equal(wav.length, 44 + sampleRateHz * 4);
    assert.equal(new DataView(wav.buffer).getUint32(24, true), sampleRateHz);
    assert.equal(new DataView(wav.buffer).getUint32(40, true), sampleRateHz * 4);
    assert.equal(result.periods, 100);
    assert.equal(
      recorder.snapshot().usedBytes,
      100 * (Math.round(sampleRateHz / 100) * 4 + PCM_STATUS_BYTES),
    );
  }
});

test("WAV PCM bytes are finalized without status or capacity bytes", () => {
  const ring = AudioCaptureRingBuffer.allocate({ capacityFrames: 4 });
  ring.producer().write(new Float32Array([0, 0, 1, 1]));
  const recorder = new GuestCaptureRecorder({ ring, maxFrames: 2 });
  recorder.readPeriod(8);
  const pcm = recorder.pcmBytes();
  assert.equal(pcm.length, 8);
  assert.deepEqual([...pcm], [0, 0, 0, 0, 0xff, 0x7f, 0xff, 0x7f]);
  assert.equal(new DataView(recorder.wavBytes().buffer).getUint32(4, true), 44);
});
