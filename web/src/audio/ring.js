// E5-T20a: the SharedArrayBuffer contract between the VM worker and AudioWorklet.
//
// The payload is interleaved stereo f32 PCM.  The header is an Int32Array so every control cell
// can be accessed with Atomics; the two logical counters are unsigned 32-bit values stored in
// their two's-complement Int32 representation.  The payload itself is published by the atomic
// fill update after its samples have been written.

export const CHANNELS = 2;
export const BYTES_PER_SAMPLE = Float32Array.BYTES_PER_ELEMENT;
export const DEFAULT_CAPACITY_FRAMES = 4096;
export const HEADER_WORDS = 10;
export const HEADER_BYTES = HEADER_WORDS * Int32Array.BYTES_PER_ELEMENT;
export const AUDIO_RING_MAGIC = 0x4155_5247; // "AURG"
export const AUDIO_RING_VERSION = 1;

/** Fixed header cells. WRITE_INDEX and READ_INDEX are monotonic uint32 counters. */
export const HEADER = Object.freeze({
  WRITE_INDEX: 0,
  READ_INDEX: 1,
  FILL_FRAMES: 2,
  CAPACITY_FRAMES: 3,
  WRITE_SLOT: 4,
  READ_SLOT: 5,
  MAGIC: 6,
  VERSION: 7,
  CHANNELS: 8,
});

const UINT32_MAX = 0xffff_ffff;
const INT32_MAX = 0x7fff_ffff;

function requireSharedArrayBuffer(sharedBuffer) {
  if (typeof SharedArrayBuffer === "undefined" || !(sharedBuffer instanceof SharedArrayBuffer)) {
    throw new TypeError("audio ring requires a SharedArrayBuffer");
  }
}

function validateCapacity(capacityFrames) {
  if (!Number.isSafeInteger(capacityFrames) || capacityFrames < 1 || capacityFrames > INT32_MAX) {
    throw new RangeError(`audio ring capacity must be an integer in [1, ${INT32_MAX}]`);
  }
  const payloadBytes = capacityFrames * CHANNELS * BYTES_PER_SAMPLE;
  const byteLength = HEADER_BYTES + payloadBytes;
  if (!Number.isSafeInteger(byteLength)) {
    throw new RangeError("audio ring allocation is too large");
  }
  return byteLength;
}

function asUint32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > UINT32_MAX) {
    throw new RangeError(`${name} must be an unsigned 32-bit integer`);
  }
  return value >>> 0;
}

function validateFill(fillFrames, capacityFrames) {
  if (!Number.isInteger(fillFrames) || fillFrames < 0 || fillFrames > capacityFrames) {
    throw new RangeError("audio ring fill is outside its capacity");
  }
  return fillFrames;
}

function validateSlot(slot, capacityFrames, name) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= capacityFrames) {
    throw new RangeError(`${name} must be a slot in [0, ${capacityFrames})`);
  }
  return slot;
}

function validateInitialState(writeIndex, readIndex, writeSlot, readSlot, fillFrames, capacityFrames) {
  validateFill(fillFrames, capacityFrames);
  validateSlot(writeSlot, capacityFrames, "writeSlot");
  validateSlot(readSlot, capacityFrames, "readSlot");
  const distance = (writeIndex - readIndex) >>> 0;
  // A full ring can have equal counters (the first exact fill) or counters separated by one
  // capacity (after a later wrap).  For every non-full state the counter distance is unambiguous.
  if (fillFrames !== capacityFrames && distance !== fillFrames) {
    throw new RangeError("audio ring counters do not match the initial fill");
  }
  if (fillFrames === capacityFrames && distance !== 0 && distance !== capacityFrames) {
    throw new RangeError("audio ring full-state counters are inconsistent");
  }
  const expectedWriteSlot = (readSlot + fillFrames) % capacityFrames;
  if (writeSlot !== expectedWriteSlot) {
    throw new RangeError("audio ring slot cursors do not match the initial fill");
  }
}

function validateFloat32Array(value, name) {
  if (!(value instanceof Float32Array)) {
    throw new TypeError(`${name} must be a Float32Array`);
  }
}

function validateFrameRange(array, frameCount, frameOffset, name) {
  if (!Number.isSafeInteger(frameCount) || frameCount < 0) {
    throw new RangeError(`${name} frameCount must be a non-negative integer`);
  }
  if (!Number.isSafeInteger(frameOffset) || frameOffset < 0) {
    throw new RangeError(`${name} frameOffset must be a non-negative integer`);
  }
  if (frameOffset + frameCount > array.length / CHANNELS) {
    throw new RangeError(`${name} frame range exceeds the interleaved buffer`);
  }
}

function checkedFill(header, capacityFrames) {
  if (Atomics.load(header, HEADER.CAPACITY_FRAMES) !== capacityFrames) {
    throw new RangeError("audio ring capacity metadata changed after initialization");
  }
  const fillFrames = Atomics.load(header, HEADER.FILL_FRAMES);
  return validateFill(fillFrames, capacityFrames);
}

function initializeHeader(sharedBuffer, {
  capacityFrames,
  writeIndex,
  readIndex,
  writeSlot,
  readSlot,
  fillFrames,
}) {
  const header = new Int32Array(sharedBuffer, 0, HEADER_WORDS);
  Atomics.store(header, HEADER.MAGIC, AUDIO_RING_MAGIC);
  Atomics.store(header, HEADER.VERSION, AUDIO_RING_VERSION);
  Atomics.store(header, HEADER.CHANNELS, CHANNELS);
  Atomics.store(header, HEADER.CAPACITY_FRAMES, capacityFrames);
  Atomics.store(header, HEADER.WRITE_INDEX, writeIndex | 0);
  Atomics.store(header, HEADER.READ_INDEX, readIndex | 0);
  Atomics.store(header, HEADER.WRITE_SLOT, writeSlot);
  Atomics.store(header, HEADER.READ_SLOT, readSlot);
  Atomics.store(header, HEADER.FILL_FRAMES, fillFrames);
  return header;
}

/**
 * A shared stereo PCM ring. Construct one producer and one consumer endpoint for SPSC use.
 *
 * `initial*` options are intentionally exposed for deterministic wrap tests. Production callers
 * should leave them at zero and transfer only `sharedBuffer` to the worklet.
 */
export class AudioRingBuffer {
  static allocate(options = {}) {
    const {
      capacityFrames = DEFAULT_CAPACITY_FRAMES,
      initialWriteIndex = 0,
      initialReadIndex = 0,
      initialFillFrames = 0,
      initialWriteSlot,
      initialReadSlot,
    } = options;
    const byteLength = validateCapacity(capacityFrames);
    const writeIndex = asUint32(initialWriteIndex, "initialWriteIndex");
    const readIndex = asUint32(initialReadIndex, "initialReadIndex");
    const writeSlot = validateSlot(
      initialWriteSlot ?? (writeIndex % capacityFrames),
      capacityFrames,
      "initialWriteSlot",
    );
    const readSlot = validateSlot(
      initialReadSlot ?? (readIndex % capacityFrames),
      capacityFrames,
      "initialReadSlot",
    );
    const fillFrames = validateFill(initialFillFrames, capacityFrames);
    validateInitialState(writeIndex, readIndex, writeSlot, readSlot, fillFrames, capacityFrames);
    const sharedBuffer = new SharedArrayBuffer(byteLength);
    initializeHeader(sharedBuffer, {
      capacityFrames,
      writeIndex,
      readIndex,
      writeSlot,
      readSlot,
      fillFrames,
    });
    return new AudioRingBuffer(sharedBuffer);
  }

  static fromSharedBuffer(sharedBuffer) {
    return new AudioRingBuffer(sharedBuffer);
  }

  constructor(sharedBuffer) {
    requireSharedArrayBuffer(sharedBuffer);
    if (sharedBuffer.byteLength < HEADER_BYTES) {
      throw new RangeError("audio ring SharedArrayBuffer is smaller than its header");
    }

    const header = new Int32Array(sharedBuffer, 0, HEADER_WORDS);
    if (Atomics.load(header, HEADER.MAGIC) !== AUDIO_RING_MAGIC) {
      throw new RangeError("audio ring header magic does not match");
    }
    if (Atomics.load(header, HEADER.VERSION) !== AUDIO_RING_VERSION) {
      throw new RangeError("unsupported audio ring header version");
    }
    if (Atomics.load(header, HEADER.CHANNELS) !== CHANNELS) {
      throw new RangeError("audio ring channel count does not match");
    }

    const capacityFrames = Atomics.load(header, HEADER.CAPACITY_FRAMES);
    const byteLength = validateCapacity(capacityFrames);
    if (sharedBuffer.byteLength !== byteLength) {
      throw new RangeError("audio ring SharedArrayBuffer size does not match its declared capacity");
    }

    const writeIndex = Atomics.load(header, HEADER.WRITE_INDEX) >>> 0;
    const readIndex = Atomics.load(header, HEADER.READ_INDEX) >>> 0;
    const writeSlot = Atomics.load(header, HEADER.WRITE_SLOT);
    const readSlot = Atomics.load(header, HEADER.READ_SLOT);
    const fillFrames = Atomics.load(header, HEADER.FILL_FRAMES);
    validateInitialState(writeIndex, readIndex, writeSlot, readSlot, fillFrames, capacityFrames);

    this._sharedBuffer = sharedBuffer;
    this._header = header;
    this._capacityFrames = capacityFrames;
    this._samples = new Float32Array(sharedBuffer, HEADER_BYTES, capacityFrames * CHANNELS);
  }

  get sharedBuffer() {
    return this._sharedBuffer;
  }

  get capacityFrames() {
    return this._capacityFrames;
  }

  get fillFrames() {
    return checkedFill(this._header, this._capacityFrames);
  }

  get writeIndex() {
    return Atomics.load(this._header, HEADER.WRITE_INDEX) >>> 0;
  }

  get readIndex() {
    return Atomics.load(this._header, HEADER.READ_INDEX) >>> 0;
  }

  producer() {
    return new AudioRingProducer(this);
  }

  consumer() {
    return new AudioRingConsumer(this);
  }
}

export function createAudioRingBuffer(options) {
  return AudioRingBuffer.allocate(options);
}

export class AudioRingProducer {
  constructor(ring) {
    this._header = ring._header;
    this._samples = ring._samples;
    this._capacityFrames = ring._capacityFrames;
  }

  availableFrames() {
    return this._capacityFrames - checkedFill(this._header, this._capacityFrames);
  }

  /** Write as many complete interleaved frames as fit, returning the number published. */
  write(frames, frameCount = frames.length / CHANNELS, frameOffset = 0) {
    validateFloat32Array(frames, "frames");
    validateFrameRange(frames, frameCount, frameOffset, "producer");

    const fillFrames = checkedFill(this._header, this._capacityFrames);
    const count = Math.min(frameCount, this._capacityFrames - fillFrames);
    if (count === 0) return 0;

    let writeIndex = Atomics.load(this._header, HEADER.WRITE_INDEX) >>> 0;
    let writeSlot = Atomics.load(this._header, HEADER.WRITE_SLOT);
    let sourceIndex = frameOffset * CHANNELS;
    for (let frame = 0; frame < count; frame += 1) {
      const sampleIndex = writeSlot * CHANNELS;
      this._samples[sampleIndex] = frames[sourceIndex];
      this._samples[sampleIndex + 1] = frames[sourceIndex + 1];
      sourceIndex += CHANNELS;
      writeIndex = (writeIndex + 1) >>> 0;
      writeSlot = (writeSlot + 1) % this._capacityFrames;
    }

    // Release sequence: payload → write counter → fill. The consumer never trusts an unpublished
    // slot, even when it races this endpoint between the two atomic operations.
    Atomics.store(this._header, HEADER.WRITE_SLOT, writeSlot);
    Atomics.store(this._header, HEADER.WRITE_INDEX, writeIndex | 0);
    Atomics.add(this._header, HEADER.FILL_FRAMES, count);
    return count;
  }
}

export class AudioRingConsumer {
  constructor(ring) {
    this._header = ring._header;
    this._samples = ring._samples;
    this._capacityFrames = ring._capacityFrames;
  }

  availableFrames() {
    return checkedFill(this._header, this._capacityFrames);
  }

  /** Read complete interleaved frames into caller-owned storage, returning the number consumed. */
  readInto(destination, frameCount = destination.length / CHANNELS, frameOffset = 0) {
    validateFloat32Array(destination, "destination");
    validateFrameRange(destination, frameCount, frameOffset, "consumer");

    const availableFrames = checkedFill(this._header, this._capacityFrames);
    const count = Math.min(frameCount, availableFrames);
    if (count === 0) return 0;

    let readIndex = Atomics.load(this._header, HEADER.READ_INDEX) >>> 0;
    let readSlot = Atomics.load(this._header, HEADER.READ_SLOT);
    let destinationIndex = frameOffset * CHANNELS;
    for (let frame = 0; frame < count; frame += 1) {
      const sampleIndex = readSlot * CHANNELS;
      destination[destinationIndex] = this._samples[sampleIndex];
      destination[destinationIndex + 1] = this._samples[sampleIndex + 1];
      destinationIndex += CHANNELS;
      readIndex = (readIndex + 1) >>> 0;
      readSlot = (readSlot + 1) % this._capacityFrames;
    }

    // Consume sequence: payload read → read counter → fill. A producer may only reuse a slot
    // after the fill decrement makes that space visible.
    Atomics.store(this._header, HEADER.READ_SLOT, readSlot);
    Atomics.store(this._header, HEADER.READ_INDEX, readIndex | 0);
    Atomics.sub(this._header, HEADER.FILL_FRAMES, count);
    return count;
  }
}
