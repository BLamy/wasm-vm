// E5-T21e: bounded guest-side capture recorder used by the browser proof.
//
// This is deliberately a downstream rxq consumer, not another host-media adapter. The real
// WasmLinux bridge consumes the same reversed SAB ring in Rust; this small recorder mirrors the
// guest's bounded `arecord` periods so Chromium can inspect a finalized WAV without inventing a
// second permission or ring protocol.

import { AudioCaptureRingBuffer } from "./capture-ring.js";

export const CAPTURE_CHANNELS = 2;
export const PCM16_BYTES_PER_SAMPLE = 2;
export const PCM16_BYTES_PER_FRAME = CAPTURE_CHANNELS * PCM16_BYTES_PER_SAMPLE;
export const PCM_STATUS_BYTES = 8;
export const MAX_CAPTURE_PERIOD_BYTES = 1 << 20;
export const DEFAULT_CAPTURE_PERIOD_BYTES = 480 * PCM16_BYTES_PER_FRAME;

function validateRate(sampleRateHz) {
  const rate = Number(sampleRateHz);
  if (!Number.isSafeInteger(rate) || ![44_100, 48_000].includes(rate)) {
    throw new RangeError("guest capture rate must be 44100 or 48000 Hz");
  }
  return rate;
}

function validatePeriodBytes(periodBytes) {
  const bytes = Number(periodBytes);
  if (!Number.isSafeInteger(bytes)
    || bytes < PCM16_BYTES_PER_FRAME
    || bytes > MAX_CAPTURE_PERIOD_BYTES
    || bytes % PCM16_BYTES_PER_FRAME !== 0) {
    throw new RangeError("guest capture period must be stereo PCM16 and fit in 1 MiB");
  }
  return bytes;
}

function sampleToS16(sample) {
  if (!Number.isFinite(sample)) return 0;
  return Math.round(Math.max(-1, Math.min(0.999969482421875, sample)) * 32_768);
}

function setU32(bytes, offset, value) {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

function wavHeader(sampleRateHz, dataBytes) {
  const header = new Uint8Array(44);
  header.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
  setU32(header, 4, 36 + dataBytes);
  header.set([0x57, 0x41, 0x56, 0x45], 8); // WAVE
  header.set([0x66, 0x6d, 0x74, 0x20], 12); // fmt
  setU32(header, 16, 16);
  header[20] = 1; // PCM
  header[22] = CAPTURE_CHANNELS;
  setU32(header, 24, sampleRateHz);
  setU32(header, 28, sampleRateHz * PCM16_BYTES_PER_FRAME);
  header[32] = PCM16_BYTES_PER_FRAME;
  header[34] = 16;
  header.set([0x64, 0x61, 0x74, 0x61], 36); // data
  setU32(header, 40, dataBytes);
  return header;
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A bounded `arecord`-shaped consumer for the reversed capture ring.
 *
 * Every `readPeriod` call consumes at most one guest rxq period, zero-fills a short ring read,
 * writes an eight-byte PCM status after the data, and records only the PCM bytes. The optional
 * destination lets the proof place canaries around 16-byte and 1 MiB periods.
 */
export class GuestCaptureRecorder {
  constructor({
    ring,
    sampleRateHz = 48_000,
    maxFrames = 48_000 * 60,
  } = {}) {
    if (!(ring instanceof AudioCaptureRingBuffer)) {
      throw new TypeError("guest capture recorder requires an AudioCaptureRingBuffer");
    }
    this.ring = ring;
    this.consumer = ring.consumer();
    this.sampleRateHz = validateRate(sampleRateHz);
    if (!Number.isSafeInteger(maxFrames) || maxFrames < 1) {
      throw new RangeError("guest capture recorder maxFrames must be positive");
    }
    this.maxFrames = maxFrames;
    this.framesRecorded = 0;
    this.framesRead = 0;
    this.silenceFrames = 0;
    this.shortPeriods = 0;
    this.periods = 0;
    this.usedBytes = 0;
    this._scratch = new Float32Array(0);
    this._chunks = [];
  }

  get durationNs() {
    return Math.round((this.framesRecorded * 1_000_000_000) / this.sampleRateHz);
  }

  get durationSeconds() {
    return this.framesRecorded / this.sampleRateHz;
  }

  _ensureScratch(frameCount) {
    const samples = frameCount * CAPTURE_CHANNELS;
    if (this._scratch.length < samples) this._scratch = new Float32Array(samples);
  }

  /** Consume one bounded rxq period, returning its exact used length and silence accounting. */
  readPeriod(periodBytes = DEFAULT_CAPTURE_PERIOD_BYTES, { destination = null } = {}) {
    const bytes = validatePeriodBytes(periodBytes);
    const frameCount = bytes / PCM16_BYTES_PER_FRAME;
    if (this.framesRecorded + frameCount > this.maxFrames) {
      throw new RangeError("guest capture recorder frame budget exceeded");
    }
    if (destination !== null
      && (!(destination instanceof Uint8Array) || destination.length < bytes + PCM_STATUS_BYTES)) {
      throw new TypeError("capture destination must hold PCM data and status");
    }
    const output = destination ?? new Uint8Array(bytes + PCM_STATUS_BYTES);
    this._ensureScratch(frameCount);
    this._scratch.fill(0, 0, frameCount * CAPTURE_CHANNELS);
    const read = this.consumer.readInto(this._scratch, frameCount);
    const missing = frameCount - read;
    for (let frame = 0; frame < frameCount; frame += 1) {
      const left = sampleToS16(this._scratch[frame * CAPTURE_CHANNELS]);
      const right = sampleToS16(this._scratch[frame * CAPTURE_CHANNELS + 1]);
      const offset = frame * PCM16_BYTES_PER_FRAME;
      output[offset] = left & 0xff;
      output[offset + 1] = (left >> 8) & 0xff;
      output[offset + 2] = right & 0xff;
      output[offset + 3] = (right >> 8) & 0xff;
    }
    // VIRTIO_SND_S_OK, followed by zero latency. The guest sees an intentional XRUN event for a
    // short host read, but the bounded PCM buffer still completes with digital silence.
    setU32(output, bytes, 0x8000);
    setU32(output, bytes + 4, 0);
    this._chunks.push(output.slice(0, bytes));
    this.framesRecorded += frameCount;
    this.framesRead += read;
    this.silenceFrames += missing;
    if (missing !== 0) this.shortPeriods += 1;
    this.periods += 1;
    this.usedBytes += bytes + PCM_STATUS_BYTES;
    return {
      periodBytes: bytes,
      frameCount,
      readFrames: read,
      silenceFrames: missing,
      statusBytes: PCM_STATUS_BYTES,
      usedBytes: bytes + PCM_STATUS_BYTES,
      status: "ok",
    };
  }

  /** Record an exact duration at wall-clock pacing, as a guest `arecord` loop would. */
  async recordForDuration(durationMs, {
    periodBytes = Math.round(this.sampleRateHz / 100) * PCM16_BYTES_PER_FRAME,
    intervalMs = 10,
  } = {}) {
    const duration = Number(durationMs);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new RangeError("capture duration must be positive");
    }
    const targetFrames = Math.round((duration * this.sampleRateHz) / 1_000);
    const start = typeof performance !== "undefined" ? performance.now() : Date.now();
    while (this.framesRecorded < targetFrames) {
      const remaining = targetFrames - this.framesRecorded;
      const requestedFrames = validatePeriodBytes(periodBytes) / PCM16_BYTES_PER_FRAME;
      const frames = Math.min(remaining, requestedFrames);
      this.readPeriod(frames * PCM16_BYTES_PER_FRAME);
      if (this.framesRecorded < targetFrames) await sleep(Math.max(0, Number(intervalMs) || 0));
    }
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    return {
      targetFrames,
      frames: this.framesRecorded,
      elapsedMs: end - start,
      sampleRateHz: this.sampleRateHz,
      durationNs: this.durationNs,
      durationSeconds: this.durationSeconds,
      framesRead: this.framesRead,
      silenceFrames: this.silenceFrames,
      shortPeriods: this.shortPeriods,
      periods: this.periods,
      usedBytes: this.usedBytes,
      droppedFrames: this.ring.droppedFrames,
    };
  }

  /** Return the finalized stereo PCM16 WAV, with no trailing capacity or status bytes. */
  wavBytes() {
    const dataBytes = this.framesRecorded * PCM16_BYTES_PER_FRAME;
    const wav = new Uint8Array(44 + dataBytes);
    wav.set(wavHeader(this.sampleRateHz, dataBytes));
    let offset = 44;
    for (const chunk of this._chunks) {
      wav.set(chunk, offset);
      offset += chunk.length;
    }
    return wav;
  }

  pcmBytes() {
    return this.wavBytes().slice(44);
  }

  async digest() {
    const digest = await crypto.subtle.digest("SHA-256", this.pcmBytes());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  /** Direct spectrum check for a deterministic loopback tone. */
  analyze({ firstFrames = 8_192, minHz = 400, maxHz = 480 } = {}) {
    const pcm = this.pcmBytes();
    const count = Math.min(firstFrames, this.framesRecorded);
    const samples = new Float64Array(count);
    let nonZeroFrames = 0;
    for (let frame = 0; frame < count; frame += 1) {
      const offset = frame * PCM16_BYTES_PER_FRAME;
      const left = pcm[offset] | (pcm[offset + 1] << 8);
      const signed = left & 0x8000 ? left - 0x1_0000 : left;
      samples[frame] = signed;
      if (signed !== 0) nonZeroFrames += 1;
    }
    const powers = [];
    for (let frequency = minHz; frequency <= maxHz; frequency += 1) {
      let real = 0;
      let imaginary = 0;
      for (let frame = 0; frame < count; frame += 1) {
        const angle = (2 * Math.PI * frequency * frame) / this.sampleRateHz;
        real += samples[frame] * Math.cos(angle);
        imaginary -= samples[frame] * Math.sin(angle);
      }
      powers.push({ frequency, power: real * real + imaginary * imaginary });
    }
    powers.sort((a, b) => b.power - a.power);
    const peak = powers[0] ?? { frequency: null, power: 0 };
    const neighbors = powers.filter((item) => Math.abs(item.frequency - peak.frequency) > 2);
    const neighborPower = neighbors.reduce((sum, item) => sum + item.power, 0) / Math.max(1, neighbors.length);
    return {
      inspectedFrames: count,
      nonZeroFrames,
      peakHz: peak.frequency,
      peakToNeighborDb: 10 * Math.log10(peak.power / Math.max(1, neighborPower)),
    };
  }

  snapshot() {
    return {
      sampleRateHz: this.sampleRateHz,
      framesRecorded: this.framesRecorded,
      framesRead: this.framesRead,
      silenceFrames: this.silenceFrames,
      shortPeriods: this.shortPeriods,
      periods: this.periods,
      usedBytes: this.usedBytes,
      droppedFrames: this.ring.droppedFrames,
      durationNs: this.durationNs,
    };
  }
}
