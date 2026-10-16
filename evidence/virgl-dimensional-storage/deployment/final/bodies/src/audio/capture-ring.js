// E5-T21c: the reversed SPSC role for browser microphone capture.
//
// The capture AudioWorklet owns the producer endpoint and the VM-side host bridge owns the
// consumer endpoint.  The bytes are intentionally the T20a AudioRingBuffer layout: keeping one
// atomic contract means the only role change is which side calls producer() and consumer().

import {
  AudioRingBuffer,
  CHANNELS,
  HEADER,
} from "./ring.js";

const UINT32_MAX = 0xffff_ffff;

/** Add to the capture drop counter without allowing the uint32 cell to wrap. */
function addSaturated(header, index, amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError("capture drop count must be a non-negative integer");
  }
  for (;;) {
    const current = Atomics.load(header, index) >>> 0;
    if (current === UINT32_MAX || amount === 0) return current;
    const next = Math.min(UINT32_MAX, current + amount);
    const observed = Atomics.compareExchange(header, index, current | 0, next | 0) >>> 0;
    if (observed === current) return next;
  }
}

/** A T20a ring viewed from the microphone side: worklet producer, VM consumer. */
export class AudioCaptureRingBuffer {
  static allocate(options = {}) {
    return new AudioCaptureRingBuffer(AudioRingBuffer.allocate(options));
  }

  static fromSharedBuffer(sharedBuffer) {
    return new AudioCaptureRingBuffer(AudioRingBuffer.fromSharedBuffer(sharedBuffer));
  }

  constructor(ring) {
    if (!(ring instanceof AudioRingBuffer)) {
      throw new TypeError("capture ring requires an AudioRingBuffer");
    }
    this._ring = ring;
    this._header = new Int32Array(ring.sharedBuffer, 0, HEADER.DROPPED_FRAMES + 1);
  }

  get sharedBuffer() {
    return this._ring.sharedBuffer;
  }

  get capacityFrames() {
    return this._ring.capacityFrames;
  }

  get channels() {
    return CHANNELS;
  }

  get fillFrames() {
    return this._ring.fillFrames;
  }

  get writeIndex() {
    return this._ring.writeIndex;
  }

  get readIndex() {
    return this._ring.readIndex;
  }

  /** Number of input frames refused because the ring had no free slot. */
  get droppedFrames() {
    return Atomics.load(this._header, HEADER.DROPPED_FRAMES) >>> 0;
  }

  /** Alias for callers that describe the same state as an overrun counter. */
  get overflowCount() {
    return this.droppedFrames;
  }

  recordDroppedFrames(frameCount) {
    return addSaturated(this._header, HEADER.DROPPED_FRAMES, frameCount);
  }

  producer() {
    return new AudioCaptureRingProducer(this);
  }

  consumer() {
    return this._ring.consumer();
  }
}

export class AudioCaptureRingProducer {
  constructor(captureRing) {
    this._captureRing = captureRing;
    this._producer = captureRing._ring.producer();
  }

  availableFrames() {
    return this._producer.availableFrames();
  }

  /** Publish what fits and account for the rest without waiting for the consumer. */
  write(frames, frameCount = frames.length / CHANNELS, frameOffset = 0) {
    const written = this._producer.write(frames, frameCount, frameOffset);
    if (written < frameCount) this._captureRing.recordDroppedFrames(frameCount - written);
    return written;
  }
}

export function createAudioCaptureRing(options) {
  return AudioCaptureRingBuffer.allocate(options);
}
