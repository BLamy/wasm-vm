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
    // The rendering thread reuses this one interleaved scratch block on every process call.
    this._scratch = new Float32Array(AUDIO_QUANTUM_FRAMES * CHANNELS);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output?.[0];
    const right = output?.[1];
    if (!left || !right) return true;

    const frameCount = Math.min(AUDIO_QUANTUM_FRAMES, left.length, right.length);
    const read = this._consumer.readInto(this._scratch, frameCount);
    for (let frame = 0; frame < frameCount; frame += 1) {
      const sampleIndex = frame * CHANNELS;
      const sample = frame < read ? this._scratch[sampleIndex] : 0;
      const otherSample = frame < read ? this._scratch[sampleIndex + 1] : 0;
      left[frame] = sample;
      right[frame] = otherSample;
    }
    if (read < frameCount) this._ring.recordUnderrun();
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
