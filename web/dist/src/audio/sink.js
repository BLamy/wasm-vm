// E5-T20c: producer-side bridge from virtio-snd S16 frames to the T20a/T20b browser path.

import { AUDIO_WORKLET_PROCESSOR_NAME } from "./worklet.js";
import {
  AudioRingBuffer,
  CHANNELS,
  DEFAULT_CAPACITY_FRAMES,
} from "./ring.js";

export const REQUESTED_SAMPLE_RATE_HZ = 48_000;
export const S16_SCALE = 1 / 32_768;
export const CONVERSION_CHUNK_FRAMES = 128;
export const AUDIO_CLOCK_BYTES = Int32Array.BYTES_PER_ELEMENT;
export const AUDIO_CAPTURE_CONTROL_BYTES = Int32Array.BYTES_PER_ELEMENT;

function defaultAudioContextFactory(options) {
  if (typeof AudioContext !== "function") {
    throw new TypeError("AudioContext is not available in this realm");
  }
  return new AudioContext(options);
}

function defaultWorkletNodeFactory(context, processorName, options) {
  if (typeof AudioWorkletNode !== "function") {
    throw new TypeError("AudioWorkletNode is not available in this realm");
  }
  return new AudioWorkletNode(context, processorName, options);
}

function validSampleRate(sampleRateHz) {
  if (!Number.isInteger(sampleRateHz) || sampleRateHz < 1) {
    throw new RangeError("audio sample rate must be a positive integer");
  }
  return sampleRateHz;
}

function createClockBuffer(clockBuffer) {
  if (typeof SharedArrayBuffer === "undefined") {
    throw new TypeError("audio clock requires SharedArrayBuffer");
  }
  if (clockBuffer === null || clockBuffer === undefined) {
    return new SharedArrayBuffer(AUDIO_CLOCK_BYTES);
  }
  if (!(clockBuffer instanceof SharedArrayBuffer) || clockBuffer.byteLength < AUDIO_CLOCK_BYTES) {
    throw new TypeError("audio clock must be a SharedArrayBuffer with one Int32 cell");
  }
  return clockBuffer;
}

function optionalLatencySeconds(context, name) {
  const value = Number(context?.[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function createContext({
  audioContextFactory,
  contextOptions,
  requestedSampleRateHz,
}) {
  const options = { ...contextOptions, sampleRate: requestedSampleRateHz };
  try {
    return {
      context: audioContextFactory(options),
      requested: true,
    };
  } catch (requestedError) {
    // Some implementations reject an explicit rate. Retrying without sampleRate lets the
    // context choose its native rate; push() will then require PCM at that actual rate.
    const fallbackOptions = { ...contextOptions };
    delete fallbackOptions.sampleRate;
    try {
      return {
        context: audioContextFactory(fallbackOptions),
        requested: false,
      };
    } catch (fallbackError) {
      fallbackError.cause = requestedError;
      throw fallbackError;
    }
  }
}

export class AudioSinkRateError extends Error {
  constructor(expectedRateHz, actualRateHz) {
    super(`audio PCM rate ${actualRateHz} Hz does not match context rate ${expectedRateHz} Hz`);
    this.name = "AudioSinkRateError";
    this.expectedRateHz = expectedRateHz;
    this.actualRateHz = actualRateHz;
  }
}

/**
 * Host-side implementation of the T19 interleaved stereo S16 AudioSink contract.
 *
 * `push()` is synchronous and never waits for the consumer. It returns the accepted frame count;
 * callers retry a partial result after the ring drains. Input must already use the context's
 * advertised sample rate: this bridge intentionally has no implicit resampler.
 */
export class AudioWorkletSink {
  constructor({
    vm = null,
    ring = null,
    capacityFrames = DEFAULT_CAPACITY_FRAMES,
    requestedSampleRateHz = REQUESTED_SAMPLE_RATE_HZ,
    audioContextFactory = defaultAudioContextFactory,
    contextOptions = {},
    workletUrl = new URL("./worklet.js", import.meta.url).href,
    workletNode = null,
    workletNodeFactory = defaultWorkletNodeFactory,
    clockBuffer = null,
    capture = false,
    onCapture = null,
  } = {}) {
    this._vm = vm;
    this._requestedSampleRateHz = validSampleRate(requestedSampleRateHz);
    if (typeof audioContextFactory !== "function") {
      throw new TypeError("audioContextFactory must be a function");
    }
    const created = createContext({
      audioContextFactory,
      contextOptions,
      requestedSampleRateHz: this._requestedSampleRateHz,
    });
    if (!created.context || !Number.isInteger(Number(created.context.sampleRate))) {
      throw new TypeError("AudioContext must expose an integer sampleRate");
    }

    this.context = created.context;
    this.sampleRateHz = validSampleRate(Number(this.context.sampleRate));
    this.rateRequested = created.requested;
    this.ring = ring ?? AudioRingBuffer.allocate({ capacityFrames });
    this.clockBuffer = createClockBuffer(clockBuffer);
    this._clock = new Int32Array(this.clockBuffer, 0, 1);
    this._originClockFrames = Atomics.load(this._clock, 0) >>> 0;
    this._producer = this.ring.producer();
    this._conversion = new Float32Array(
      Math.min(this.ring.capacityFrames, CONVERSION_CHUNK_FRAMES) * CHANNELS,
    );
    this._workletUrl = workletUrl;
    this._workletNode = workletNode;
    this._workletNodeFactory = workletNodeFactory;
    this._capture = capture === true;
    this._onCapture = typeof onCapture === "function" ? onCapture : null;
    this.captureReadyBuffer = this._capture
      ? new SharedArrayBuffer(AUDIO_CAPTURE_CONTROL_BYTES)
      : null;
    this._captureReady = this.captureReadyBuffer
      ? new Int32Array(this.captureReadyBuffer, 0, 1)
      : null;
    this._captureListener = null;
    this._originReadIndex = this.ring.readIndex;
    this._originContextTime = Number(this.context.currentTime);
    this._originContextTime = Number.isFinite(this._originContextTime) && this._originContextTime >= 0
      ? this._originContextTime
      : 0;
    this._lastClockNs = Math.round(this._originContextTime * 1e9);
    this._publishStats();
  }

  get workletNode() {
    return this._workletNode;
  }

  get requestedSampleRateHz() {
    return this._requestedSampleRateHz;
  }

  get advertisedSampleRateHz() {
    return this.sampleRateHz;
  }

  get consumedFrames() {
    return this.ring.readIndex;
  }

  get renderedFrames() {
    return Atomics.load(this._clock, 0) >>> 0;
  }

  /** Load the processor module, construct the node, and connect it to the context destination. */
  async connect() {
    if (this._workletNode) return this;
    if (!this.context.audioWorklet || typeof this.context.audioWorklet.addModule !== "function") {
      throw new TypeError("AudioContext.audioWorklet.addModule is not available");
    }
    await this.context.audioWorklet.addModule(this._workletUrl);
    this._workletNode = this._workletNodeFactory(
      this.context,
      AUDIO_WORKLET_PROCESSOR_NAME,
      {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [CHANNELS],
        processorOptions: {
          sharedBuffer: this.ring.sharedBuffer,
          clockBuffer: this.clockBuffer,
          ...(this.captureReadyBuffer ? { captureReadyBuffer: this.captureReadyBuffer } : {}),
          capture: this._capture,
        },
      },
    );
    if (this._capture && this._onCapture && this._workletNode.port) {
      this._captureListener = (event) => this._onCapture(event.data);
      this._workletNode.port.addEventListener?.("message", this._captureListener);
      if (!this._workletNode.port.addEventListener) this._workletNode.port.onmessage = this._captureListener;
      this._workletNode.port.start?.();
    }
    // The node constructor may run one process callback before this task reaches the listener
    // setup. Keep the consumer paused until capture can observe its first frame exactly once.
    if (this._captureReady) Atomics.store(this._captureReady, 0, 1);
    this._workletNode.connect?.(this.context.destination);
    return this;
  }

  /**
   * Push interleaved signed 16-bit stereo PCM without resampling or blocking.
   *
   * The result is `{ acceptedFrames, droppedFrames, complete, sampleRateHz }`. A partial result
   * means the ring was full; no input frame is silently converted at a different sample rate.
   */
  push(frames, sampleRateHz = this.sampleRateHz) {
    if (!(frames instanceof Int16Array)) {
      throw new TypeError("audio sink frames must be an Int16Array");
    }
    if (frames.length % CHANNELS !== 0) {
      throw new RangeError("audio sink frames must contain complete stereo samples");
    }
    const inputRateHz = validSampleRate(sampleRateHz);
    if (inputRateHz !== this.sampleRateHz) {
      throw new AudioSinkRateError(this.sampleRateHz, inputRateHz);
    }

    const totalFrames = frames.length / CHANNELS;
    let acceptedFrames = 0;
    while (acceptedFrames < totalFrames) {
      const chunkFrames = Math.min(
        totalFrames - acceptedFrames,
        this._conversion.length / CHANNELS,
      );
      for (let frame = 0; frame < chunkFrames; frame += 1) {
        const sourceIndex = (acceptedFrames + frame) * CHANNELS;
        const targetIndex = frame * CHANNELS;
        this._conversion[targetIndex] = frames[sourceIndex] * S16_SCALE;
        this._conversion[targetIndex + 1] = frames[sourceIndex + 1] * S16_SCALE;
      }
      const written = this._producer.write(this._conversion, chunkFrames);
      acceptedFrames += written;
      if (written < chunkFrames) break;
    }

    const result = {
      acceptedFrames,
      droppedFrames: totalFrames - acceptedFrames,
      complete: acceptedFrames === totalFrames,
      sampleRateHz: this.sampleRateHz,
    };
    this._publishStats();
    return result;
  }

  /**
   * Return the rendered audio clock in nanoseconds. The worklet (or the pre-unlock discard policy)
   * advances the shared frame cell at the negotiated sample rate; `currentTime` and the ring read
   * cursor remain monotonic fallbacks for older/fake contexts.
   */
  audioClockNowNs() {
    const currentTime = Number(this.context.currentTime);
    const contextClockNs = Number.isFinite(currentTime) && currentTime >= 0
      ? Math.round(currentTime * 1e9)
      : this._lastClockNs;
    const consumedDelta = (this.ring.readIndex - this._originReadIndex) >>> 0;
    const frameClockNs = Math.round(
      this._originContextTime * 1e9 + (consumedDelta * 1e9) / this.sampleRateHz,
    );
    const renderedDelta = (this.renderedFrames - this._originClockFrames) >>> 0;
    const renderedClockNs = Math.round(
      this._originContextTime * 1e9 + (renderedDelta * 1e9) / this.sampleRateHz,
    );
    this._lastClockNs = Math.max(this._lastClockNs, contextClockNs, frameClockNs, renderedClockNs);
    return this._lastClockNs;
  }

  stats() {
    return this._publishStats();
  }

  async close() {
    if (this._captureListener && this._workletNode?.port) {
      this._workletNode.port.removeEventListener?.("message", this._captureListener);
      if (this._workletNode.port.onmessage === this._captureListener) this._workletNode.port.onmessage = null;
      this._captureListener = null;
    }
    this._workletNode?.disconnect?.();
    await this.context.close?.();
  }

  _publishStats() {
    const baseLatency = optionalLatencySeconds(this.context, "baseLatency");
    const outputLatency = optionalLatencySeconds(this.context, "outputLatency");
    const fill = this.ring.fillFrames;
    const contextLatencySeconds = (baseLatency ?? 0) + (outputLatency ?? 0);
    const audio = {
      latency_ms: ((fill / this.sampleRateHz) + contextLatencySeconds) * 1_000,
      underruns: this.ring.underrunCount,
      fill,
      sampleRateHz: this.sampleRateHz,
    };
    if (baseLatency !== null) audio.baseLatency = baseLatency;
    if (outputLatency !== null) audio.outputLatency = outputLatency;
    if (this._vm) {
      if (!this._vm.stats || typeof this._vm.stats !== "object") this._vm.stats = {};
      this._vm.stats.audio = audio;
    }
    this._lastStats = audio;
    return audio;
  }
}

// The alias keeps the browser bridge name aligned with T19's host-side AudioSink trait.
export const AudioSink = AudioWorkletSink;

export async function createAudioSink(options) {
  const sink = new AudioWorkletSink(options);
  await sink.connect();
  return sink;
}
