// E5-T20b: the allocation-free AudioWorklet consumer for the T20a stereo PCM ring.

import { AudioRingBuffer, CHANNELS } from "./ring.js";

export const AUDIO_WORKLET_PROCESSOR_NAME = "wasm-vm-audio-consumer";
export const AUDIO_QUANTUM_FRAMES = 128;

// Node imports this module for the deterministic test hook, where AudioWorkletProcessor is not
// defined. The browser path extends the real host base and registers the stable processor name.
const WorkletProcessorBase = typeof AudioWorkletProcessor === "function"
  ? AudioWorkletProcessor
  : class AudioWorkletProcessorFallback {};

export class AudioRingWorkletProcessor extends WorkletProcessorBase {
  constructor(options = {}) {
    super();
    const sharedBuffer = options?.processorOptions?.sharedBuffer;
    if (typeof SharedArrayBuffer === "undefined" || !(sharedBuffer instanceof SharedArrayBuffer)) {
      throw new TypeError("audio worklet requires processorOptions.sharedBuffer");
    }
    const ring = AudioRingBuffer.fromSharedBuffer(sharedBuffer);
    this._ring = ring;
    this._consumer = ring.consumer();
    const clockBuffer = options?.processorOptions?.clockBuffer;
    if (clockBuffer !== undefined && clockBuffer !== null) {
      if (typeof SharedArrayBuffer === "undefined"
        || !(clockBuffer instanceof SharedArrayBuffer)
        || clockBuffer.byteLength < Int32Array.BYTES_PER_ELEMENT) {
        throw new TypeError("audio worklet clock requires a one-word SharedArrayBuffer");
      }
      this._clock = new Int32Array(clockBuffer, 0, 1);
    } else {
      this._clock = null;
    }
    this._capture = options?.processorOptions?.capture === true
      && typeof this.port?.postMessage === "function";
    const captureReadyBuffer = options?.processorOptions?.captureReadyBuffer;
    if (this._capture) {
      if (typeof SharedArrayBuffer === "undefined"
        || !(captureReadyBuffer instanceof SharedArrayBuffer)
        || captureReadyBuffer.byteLength < Int32Array.BYTES_PER_ELEMENT) {
        throw new TypeError("captured audio worklet requires a one-word ready buffer");
      }
      this._captureReady = new Int32Array(captureReadyBuffer, 0, 1);
    } else {
      this._captureReady = null;
    }
    this._captureScratch = this._capture
      ? new Float32Array(AUDIO_QUANTUM_FRAMES * CHANNELS)
      : null;
    // The rendering thread reuses this one interleaved scratch block on every process call.
    this._scratch = new Float32Array(AUDIO_QUANTUM_FRAMES * CHANNELS);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) return true;

    const frameCount = Math.min(AUDIO_QUANTUM_FRAMES, left.length, right.length);
    if (this._captureReady && Atomics.load(this._captureReady, 0) === 0) {
      left.fill(0, 0, frameCount);
      right.fill(0, 0, frameCount);
      return true;
    }
    const read = this._consumer.readInto(this._scratch, frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const sampleIndex = frame * CHANNELS;
      const sample = frame < read ? this._scratch[sampleIndex] : 0;
      const otherSample = frame < read ? this._scratch[sampleIndex + 1] : 0;
      left[frame] = sample;
      right[frame] = otherSample;
    }
    if (read < frameCount) this._ring.recordUnderrun();
    if (this._clock) Atomics.add(this._clock, 0, frameCount);
    if (this._capture) {
      for (let frame = 0; frame < frameCount; frame += 1) {
        const sampleIndex = frame * CHANNELS;
        this._captureScratch[sampleIndex] = left[frame];
        this._captureScratch[sampleIndex + 1] = right[frame];
      }
      this.port.postMessage({ frames: frameCount, samples: this._captureScratch });
    }
    return true;
  }
}

/** Test-only adapter: drive the real processor with caller-owned synthetic output channels. */
export function processSyntheticQuantum(processor, left, right) {
  return processor.process([], [[left, right]], []);
}

if (typeof registerProcessor === "function") {
  registerProcessor(AUDIO_WORKLET_PROCESSOR_NAME, AudioRingWorkletProcessor);
}
