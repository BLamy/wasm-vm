// E5-T21c: allocation-free AudioWorklet producer for the reversed capture SAB ring.

import { CHANNELS } from "./ring.js";
import {
  AudioCaptureRingBuffer,
} from "./capture-ring.js";

export const AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME = "wasm-vm-audio-capture-producer";
export const AUDIO_CAPTURE_QUANTUM_FRAMES = 128;
export const SUPPORTED_CAPTURE_SAMPLE_RATES_HZ = Object.freeze([44_100, 48_000]);

const WorkletProcessorBase = typeof AudioWorkletProcessor === "function"
  ? AudioWorkletProcessor
  : class AudioWorkletProcessorFallback {};

function validateSampleRate(sampleRateHz) {
  const value = Number(sampleRateHz);
  if (!SUPPORTED_CAPTURE_SAMPLE_RATES_HZ.includes(value)) {
    throw new RangeError("capture worklet sample rate must be 44100 or 48000 Hz");
  }
  return value;
}

function configuredSampleRate(options) {
  const explicit = options?.processorOptions?.sampleRateHz;
  if (explicit !== undefined) return validateSampleRate(explicit);
  const ambient = Number(globalThis.sampleRate);
  return validateSampleRate(Number.isFinite(ambient) ? ambient : 48_000);
}

function makeClock(clockBuffer) {
  if (clockBuffer === undefined || clockBuffer === null) return null;
  if (typeof SharedArrayBuffer === "undefined"
    || !(clockBuffer instanceof SharedArrayBuffer)
    || clockBuffer.byteLength < Int32Array.BYTES_PER_ELEMENT) {
    throw new TypeError("capture worklet clock requires a one-word SharedArrayBuffer");
  }
  return new Int32Array(clockBuffer, 0, 1);
}

export class AudioCaptureWorkletProcessor extends WorkletProcessorBase {
  constructor(options = {}) {
    super();
    const processorOptions = options?.processorOptions ?? {};
    const sharedBuffer = processorOptions.captureBuffer ?? processorOptions.sharedBuffer;
    if (typeof SharedArrayBuffer === "undefined" || !(sharedBuffer instanceof SharedArrayBuffer)) {
      throw new TypeError("capture worklet requires processorOptions.captureBuffer");
    }
    const ring = AudioCaptureRingBuffer.fromSharedBuffer(sharedBuffer);
    this._ring = ring;
    this._producer = ring.producer();
    this._sampleRateHz = configuredSampleRate(options);
    this._clock = makeClock(processorOptions.clockBuffer);
    this._processedFrames = 0;
    // The rendering thread reuses this interleaved stereo block on every process call.
    this._scratch = new Float32Array(AUDIO_CAPTURE_QUANTUM_FRAMES * CHANNELS);
  }

  get sampleRateHz() {
    return this._sampleRateHz;
  }

  get channels() {
    return CHANNELS;
  }

  get processedFrames() {
    return this._processedFrames;
  }

  get processedDurationNs() {
    return Math.round((this._processedFrames * 1_000_000_000) / this._sampleRateHz);
  }

  get droppedFrames() {
    return this._ring.droppedFrames;
  }

  process(inputs) {
    const input = inputs?.[0];
    const first = input?.[0];
    const second = input?.[1];
    const stereoInput = (input?.length ?? 0) > 1;

    // Always publish one bounded quantum. Missing channels and short synthetic quanta become
    // digital zero, while a mono source is expanded to the ring's advertised stereo channels.
    for (let frame = 0; frame < AUDIO_CAPTURE_QUANTUM_FRAMES; frame += 1) {
      const sampleIndex = frame * CHANNELS;
      const sample = first && frame < first.length ? first[frame] : 0;
      this._scratch[sampleIndex] = sample;
      this._scratch[sampleIndex + 1] = stereoInput
        ? (second && frame < second.length ? second[frame] : 0)
        : sample;
    }
    this._producer.write(this._scratch, AUDIO_CAPTURE_QUANTUM_FRAMES);
    this._processedFrames = (this._processedFrames + AUDIO_CAPTURE_QUANTUM_FRAMES) >>> 0;
    if (this._clock) Atomics.add(this._clock, 0, AUDIO_CAPTURE_QUANTUM_FRAMES);
    return true;
  }
}

/** Test-only adapter: drive the real producer with caller-owned input channels. */
export function processSyntheticCaptureQuantum(processor, channels = []) {
  return processor.process([channels], [], []);
}

// Keep the short adapter name convenient for standalone worklet tests without colliding with the
// playback module's identically shaped test seam.
export const processSyntheticQuantum = processSyntheticCaptureQuantum;

if (typeof registerProcessor === "function") {
  registerProcessor(AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME, AudioCaptureWorkletProcessor);
}
