// E5-T23d — host-side agent Channel.
//
// This module deliberately knows nothing about Window, DOM, or the virtio implementation. A
// transport only needs send(bytes), subscribe({ data, close, error }), and optionally close(). That
// shape works in a page, a DedicatedWorker, and Node's deterministic fixtures alike.

export const FRAME_HEADER_BYTES = 8;
export const MAX_PAYLOAD_BYTES = 1 << 20;
export const MAX_CLIPBOARD_BYTES = 256 << 10;
export const PROTOCOL_VERSION = 1;

export const TYPE_HELLO = 0;
export const TYPE_PING = 1;
export const TYPE_PONG = 2;
export const TYPE_NAK = 3;
export const TYPE_CLIP_SET = 4;
export const TYPE_CLIP_GET = 5;

export const FLAG_NONE = 0;
export const NAK_UNKNOWN_TYPE = 1;
export const NAK_INVALID_PAYLOAD = 2;
export const NAK_CAPABILITY = 3;
export const NAK_CLIPBOARD_UNAVAILABLE = 4;

export const CAP_PING = 1n << 0n;
export const CAP_CLIPBOARD = 1n << 1n;
export const CAP_DISPLAY = 1n << 2n;

export const CHANNEL_STATE = Object.freeze({
  IDLE: "idle",
  CONNECTING: "connecting",
  HANDSHAKING: "handshaking",
  READY: "ready",
  DISCONNECTED: "disconnected",
  CLOSED: "closed",
});

const UINT64_MAX = (1n << 64n) - 1n;
const DEFAULT_MAX_PENDING = 1_024;
const DEFAULT_HANDSHAKE_TIMEOUT_MS = 2_000;
const DEFAULT_PING_TIMEOUT_MS = 5_000;
const DEFAULT_RECONNECT_MIN_DELAY_MS = 10;
const DEFAULT_RECONNECT_MAX_DELAY_MS = 800;

export class AgentChannelError extends Error {
  constructor(message, code = "CHANNEL_ERROR", options = {}) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

export class DisconnectedError extends AgentChannelError {
  constructor(message = "agent channel is disconnected", options = {}) {
    super(message, "DISCONNECTED", options);
  }
}

export class BackpressureError extends AgentChannelError {
  constructor(message = "agent channel pending limit reached", options = {}) {
    super(message, "BACKPRESSURE", options);
  }
}

export class CapabilityError extends AgentChannelError {
  constructor(message = "agent channel capability is not negotiated", options = {}) {
    super(message, "CAPABILITY", options);
  }
}

export class NegotiationError extends AgentChannelError {
  constructor(message = "agent channel has no common protocol version", options = {}) {
    super(message, "NO_COMMON_VERSION", options);
  }
}

export class ProtocolError extends AgentChannelError {
  constructor(message = "invalid agent channel frame", code = "PROTOCOL", options = {}) {
    super(message, code, options);
  }
}

export class RequestTimeoutError extends AgentChannelError {
  constructor(message = "agent channel request timed out", options = {}) {
    super(message, "TIMEOUT", options);
  }
}

export class NakError extends AgentChannelError {
  constructor(message = "agent rejected the channel request", options = {}) {
    super(message, "NAK", options);
  }
}

export class ClipboardError extends AgentChannelError {
  constructor(message = "invalid clipboard payload", code = "CLIPBOARD_INVALID_UTF8", options = {}) {
    super(message, code, options);
  }
}

function viewBytes(value, label = "bytes") {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (Array.isArray(value)) return Uint8Array.from(value);
  throw new TypeError(`${label} must be an ArrayBuffer or Uint8Array`);
}

function ownedBytes(value, label = "bytes") {
  return viewBytes(value, label).slice();
}

function integerInRange(value, min, max, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function asU64(value, label) {
  let number;
  try {
    number = BigInt(value);
  } catch (error) {
    throw new RangeError(`${label} must be an unsigned 64-bit integer`, { cause: error });
  }
  if (number < 0n || number > UINT64_MAX) {
    throw new RangeError(`${label} must be an unsigned 64-bit integer`);
  }
  return number;
}

function writeU64LE(output, offset, value) {
  let remaining = value;
  for (let index = 0; index < 8; index += 1) {
    output[offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

function readU64LE(input, offset = 0) {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(input[offset + index]);
  }
  return value;
}

function frameRecord(type, flags, payload) {
  return Object.freeze({
    type,
    messageType: type,
    flags,
    payload,
  });
}

/** Encode the shared little-endian {u32 len, u16 type, u16 flags, payload} frame. */
export function encodeFrame(typeOrFrame, payload, flags = FLAG_NONE) {
  let type = typeOrFrame;
  let body = payload;
  let frameFlags = flags;
  if (typeOrFrame && typeof typeOrFrame === "object" && !ArrayBuffer.isView(typeOrFrame)
      && !(typeOrFrame instanceof ArrayBuffer)) {
    type = typeOrFrame.type ?? typeOrFrame.messageType;
    body = typeOrFrame.payload ?? new Uint8Array();
    frameFlags = typeOrFrame.flags ?? FLAG_NONE;
  }
  type = integerInRange(type, 0, 0xffff, "message type");
  frameFlags = integerInRange(frameFlags, 0, 0xffff, "frame flags");
  body = ownedBytes(body ?? new Uint8Array(), "frame payload");
  if (body.byteLength > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`frame payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }
  const output = new Uint8Array(FRAME_HEADER_BYTES + body.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, body.byteLength, true);
  view.setUint16(4, type, true);
  view.setUint16(6, frameFlags, true);
  output.set(body, FRAME_HEADER_BYTES);
  return output;
}

function encodeHello(version, capabilities) {
  const payload = new Uint8Array(10);
  const view = new DataView(payload.buffer);
  view.setUint16(0, version, true);
  writeU64LE(payload, 2, capabilities);
  return payload;
}

function decodeHello(payload) {
  if (payload.byteLength !== 10) {
    throw new ProtocolError(`HELLO payload has ${payload.byteLength} bytes; expected 10`, "HELLO_LENGTH");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return Object.freeze({
    version: view.getUint16(0, true),
    capabilities: readU64LE(payload, 2),
  });
}

function encodePing(nonce) {
  const payload = new Uint8Array(8);
  writeU64LE(payload, 0, nonce);
  return payload;
}

function decodePing(payload, typeName) {
  if (payload.byteLength !== 8) {
    throw new ProtocolError(`${typeName} payload has ${payload.byteLength} bytes; expected 8`, `${typeName}_LENGTH`);
  }
  return readU64LE(payload, 0);
}

function encodeNak(rejectedType, code = NAK_UNKNOWN_TYPE) {
  const payload = new Uint8Array(4);
  const view = new DataView(payload.buffer);
  view.setUint16(0, rejectedType, true);
  view.setUint16(2, code, true);
  return payload;
}

function decodeNak(payload) {
  if (payload.byteLength !== 4) {
    throw new ProtocolError(`NAK payload has ${payload.byteLength} bytes; expected 4`, "NAK_LENGTH");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  return Object.freeze({
    rejectedType: view.getUint16(0, true),
    code: view.getUint16(2, true),
  });
}

function assertWellFormedString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) {
        throw new ClipboardError("clipboard string contains an unpaired UTF-16 surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new ClipboardError("clipboard string contains an unpaired UTF-16 surrogate");
    }
  }
}

/** Encode or validate one text/plain clipboard payload without applying the 1 MiB frame limit. */
export function encodeClipboardText(value) {
  let bytes;
  if (typeof value === "string") {
    assertWellFormedString(value);
    bytes = new TextEncoder().encode(value);
  } else {
    bytes = viewBytes(value, "clipboard payload");
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new ClipboardError("clipboard payload is not valid UTF-8", "CLIPBOARD_INVALID_UTF8", { cause: error });
    }
  }
  if (bytes.byteLength > MAX_CLIPBOARD_BYTES) {
    throw new ClipboardError(
      `clipboard payload exceeds ${MAX_CLIPBOARD_BYTES} bytes`,
      "CLIPBOARD_TOO_LARGE",
    );
  }
  return bytes.slice();
}

/** Decode a text/plain clipboard payload; rejected input is not copied or delivered. */
export function decodeClipboardText(payload) {
  const bytes = viewBytes(payload, "clipboard payload");
  if (bytes.byteLength > MAX_CLIPBOARD_BYTES) {
    throw new ClipboardError(
      `clipboard payload exceeds ${MAX_CLIPBOARD_BYTES} bytes`,
      "CLIPBOARD_TOO_LARGE",
    );
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ClipboardError("clipboard payload is not valid UTF-8", "CLIPBOARD_INVALID_UTF8", { cause: error });
  }
  return Object.freeze({ text, bytes: bytes.slice() });
}

/** Encode a CLIP_SET frame carrying exactly one bounded UTF-8 text/plain payload. */
export function encodeClipboardSet(value, flags = FLAG_NONE) {
  return encodeFrame(TYPE_CLIP_SET, encodeClipboardText(value), flags);
}

/** Decode the payload of a CLIP_SET frame into text and owned UTF-8 bytes. */
export function decodeClipboardSet(payload) {
  return decodeClipboardText(payload);
}

/** Encode a CLIP_GET request; its payload is always empty. */
export function encodeClipboardGet(flags = FLAG_NONE) {
  return encodeFrame(TYPE_CLIP_GET, new Uint8Array(), flags);
}

/** Validate the payload of a CLIP_GET request. */
export function decodeClipboardGet(payload) {
  const bytes = viewBytes(payload, "CLIP_GET payload");
  if (bytes.byteLength !== 0) {
    throw new ProtocolError(`CLIP_GET payload has ${bytes.byteLength} bytes; expected 0`, "CLIP_GET_LENGTH");
  }
  return Object.freeze({});
}

/**
 * Incremental parser for one connection. Oversized lengths are rejected before a payload buffer
 * is allocated; malformed or truncated data is connection-fatal because the stream has no magic
 * byte with which to safely resynchronize.
 */
export class AgentFrameDecoder {
  constructor() {
    this._header = new Uint8Array(FRAME_HEADER_BYTES);
    this._headerLength = 0;
    this._payloadLength = null;
    this._payloadFilled = 0;
    this._type = 0;
    this._flags = 0;
    this._payload = null;
  }

  get pendingBytes() {
    return this._headerLength + this._payloadFilled;
  }

  get payloadCapacity() {
    return this._payload?.byteLength ?? 0;
  }

  get idle() {
    return this._headerLength === 0;
  }

  push(input, emit) {
    const bytes = viewBytes(input, "frame input");
    let offset = 0;
    while (offset < bytes.byteLength) {
      if (this._headerLength < FRAME_HEADER_BYTES) {
        const count = Math.min(FRAME_HEADER_BYTES - this._headerLength, bytes.byteLength - offset);
        this._header.set(bytes.subarray(offset, offset + count), this._headerLength);
        this._headerLength += count;
        offset += count;
        if (this._headerLength < FRAME_HEADER_BYTES) break;

        const header = new DataView(this._header.buffer);
        this._payloadLength = header.getUint32(0, true);
        if (this._payloadLength > MAX_PAYLOAD_BYTES) {
          this.reset();
          throw new ProtocolError(
            `frame payload length ${this._payloadLength} exceeds ${MAX_PAYLOAD_BYTES}`,
            "PAYLOAD_TOO_LARGE",
          );
        }
        this._type = header.getUint16(4, true);
        this._flags = header.getUint16(6, true);
        this._payloadFilled = 0;
        this._payload = this._payloadLength === 0 ? new Uint8Array() : new Uint8Array(this._payloadLength);
      }

      const remaining = this._payloadLength - this._payloadFilled;
      const count = Math.min(remaining, bytes.byteLength - offset);
      if (count > 0) {
        this._payload.set(bytes.subarray(offset, offset + count), this._payloadFilled);
        this._payloadFilled += count;
        offset += count;
      }
      if (this._payloadFilled !== this._payloadLength) break;

      const frame = frameRecord(this._type, this._flags, this._payload);
      this._resetFrame();
      emit?.(frame);
    }
    return offset;
  }

  finish() {
    if (!this.idle) {
      throw new ProtocolError(`stream ended with ${this.pendingBytes} pending bytes`, "TRUNCATED");
    }
  }

  reset() {
    this._resetFrame();
  }

  _resetFrame() {
    this._headerLength = 0;
    this._payloadLength = null;
    this._payloadFilled = 0;
    this._type = 0;
    this._flags = 0;
    this._payload = null;
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  // Reconnect and close may settle a promise before a consumer attaches. Keep that lifecycle
  // diagnostic from becoming a process-level unhandled rejection while returning the same promise.
  promise.catch(() => {});
  return { promise, resolve, reject, settled: false };
}

function eventData(value) {
  if (value && typeof value === "object" && !(value instanceof Uint8Array)
      && !(value instanceof ArrayBuffer) && ArrayBuffer.isView(value) === false
      && "data" in value) {
    return value.data;
  }
  return value;
}

/**
 * Adapt a MessagePort, Worker, or compatible endpoint without depending on a main-thread global.
 * The channel owns the endpoint listener and transfers a private frame copy on every send.
 */
export function createMessageTransport(endpoint) {
  if (!endpoint || typeof endpoint.postMessage !== "function") {
    throw new TypeError("message transport endpoint must provide postMessage()");
  }
  return {
    send(bytes) {
      const copy = ownedBytes(bytes, "transport frame");
      endpoint.postMessage(copy, [copy.buffer]);
    },
    subscribe(handlers) {
      const onMessage = (event) => handlers.data?.(eventData(event));
      const onClose = (event) => handlers.close?.(event?.reason ?? event);
      const onError = (event) => handlers.error?.(event?.error ?? event);
      if (typeof endpoint.addEventListener === "function") {
        endpoint.addEventListener("message", onMessage);
        endpoint.addEventListener("close", onClose);
        endpoint.addEventListener("messageerror", onError);
        endpoint.addEventListener("error", onError);
        endpoint.start?.();
        return () => {
          endpoint.removeEventListener?.("message", onMessage);
          endpoint.removeEventListener?.("close", onClose);
          endpoint.removeEventListener?.("messageerror", onError);
          endpoint.removeEventListener?.("error", onError);
        };
      }
      const previousMessage = endpoint.onmessage;
      const previousError = endpoint.onmessageerror;
      endpoint.onmessage = onMessage;
      endpoint.onmessageerror = onError;
      return () => {
        if (endpoint.onmessage === onMessage) endpoint.onmessage = previousMessage ?? null;
        if (endpoint.onmessageerror === onError) endpoint.onmessageerror = previousError ?? null;
      };
    },
    close() {
      endpoint.close?.();
      if (typeof endpoint.close !== "function") endpoint.terminate?.();
    },
  };
}

function subscribeTransport(transport, handlers) {
  if (typeof transport.subscribe === "function") {
    const unsubscribe = transport.subscribe(handlers);
    return typeof unsubscribe === "function" ? unsubscribe : () => {};
  }
  if (typeof transport.addEventListener === "function" && typeof transport.postMessage === "function") {
    return createMessageTransport(transport).subscribe(handlers);
  }
  throw new TypeError("agent transport must provide subscribe() or an event endpoint");
}

function normalizeTransport(candidate) {
  const transport = candidate?.transport ?? candidate;
  if (transport && typeof transport.send === "function") return transport;
  if (transport && typeof transport.postMessage === "function") return createMessageTransport(transport);
  throw new TypeError("agent connector must return a transport");
}

function normalizeMilliseconds(value, fallback, { minimum = 0 } = {}) {
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    throw new RangeError(`timeout must be a finite number >= ${minimum}`);
  }
  return number;
}

/**
 * Host-side Channel for the shared guest-agent protocol.
 *
 * `connect({ attempt })` must return a fresh transport (or a Promise for one). `start()` is
 * non-blocking; await `channel.ready` for the first successful HELLO intersection and
 * `waitUntilReady()` for a later reconnect. User subscriptions survive reconnects, while the
 * transport listener is removed before its old transport is closed.
 */
export class Channel {
  constructor(options = {}) {
    const hasConnector = typeof options.connect === "function";
    const hasTransport = options.transport != null;
    if (!hasConnector && !hasTransport) {
      throw new TypeError("agent Channel requires connect() or transport");
    }
    this._connect = hasConnector ? options.connect : () => options.transport;
    this._reconnectEnabled = options.reconnect ?? hasConnector;
    this._localVersion = integerInRange(options.version ?? PROTOCOL_VERSION, 0, 0xffff, "protocol version");
    this._localCapabilities = asU64(options.capabilities ?? CAP_PING, "capabilities");
    this._maxPending = integerInRange(options.maxPending ?? DEFAULT_MAX_PENDING, 1, 1_000_000, "maxPending");
    this._handshakeTimeoutMs = normalizeMilliseconds(
      options.handshakeTimeoutMs,
      DEFAULT_HANDSHAKE_TIMEOUT_MS,
      { minimum: 1 },
    );
    this._pingTimeoutMs = normalizeMilliseconds(options.pingTimeoutMs, DEFAULT_PING_TIMEOUT_MS, { minimum: 0 });
    this._reconnectMinDelayMs = normalizeMilliseconds(
      options.reconnectMinDelayMs,
      DEFAULT_RECONNECT_MIN_DELAY_MS,
    );
    this._reconnectMaxDelayMs = normalizeMilliseconds(
      options.reconnectMaxDelayMs,
      Math.max(DEFAULT_RECONNECT_MAX_DELAY_MS, this._reconnectMinDelayMs),
    );
    if (this._reconnectMaxDelayMs < this._reconnectMinDelayMs) {
      throw new RangeError("reconnectMaxDelayMs must be >= reconnectMinDelayMs");
    }
    this._maxReconnectAttempts = options.maxReconnectAttempts == null
      ? Infinity
      : integerInRange(options.maxReconnectAttempts, 0, 1_000_000, "maxReconnectAttempts");
    this._onError = typeof options.onError === "function" ? options.onError : null;

    this._state = CHANNEL_STATE.IDLE;
    this._negotiated = null;
    this._peerHello = null;
    this._firstReady = deferred();
    this._readyWaiters = new Set();
    this._stateListeners = new Set();
    this._subscriptions = new Map();
    this._pending = new Map();
    this._nextNonce = 1n;
    this._started = false;
    this._closed = false;
    this._connecting = false;
    this._connectAttempt = 0;
    this._reconnectAttempts = 0;
    this._retryDelayMs = this._reconnectMinDelayMs;
    this._retryTimer = null;
    this._handshakeTimer = null;
    this._generation = 0;
    this._transportGeneration = 0;
    this._transport = null;
    this._transportUnsubscribe = null;
    this._decoder = new AgentFrameDecoder();
    this._writeTail = Promise.resolve();
    this._writeDepth = 0;
    this._lastError = null;
  }

  get state() {
    return this._state;
  }

  get ready() {
    return this._firstReady.promise;
  }

  get negotiated() {
    return this._negotiated;
  }

  get negotiatedVersion() {
    return this._negotiated?.version ?? null;
  }

  get transportGeneration() {
    return this._transportGeneration;
  }

  get negotiatedCapabilities() {
    return this._negotiated?.capabilities ?? 0n;
  }

  get pendingCount() {
    return this._pending.size;
  }

  get maxPending() {
    return this._maxPending;
  }

  get lastError() {
    return this._lastError;
  }

  /** Start connection attempts; returns immediately so callers can attach to `ready`. */
  start() {
    if (this._closed) throw new DisconnectedError("agent channel is closed");
    if (this._started) return this;
    this._started = true;
    void this._attemptConnect();
    return this;
  }

  waitUntilReady() {
    if (this._state === CHANNEL_STATE.READY) return Promise.resolve(this._negotiated);
    if (this._closed) return Promise.reject(new DisconnectedError("agent channel is closed"));
    const waiter = deferred();
    this._readyWaiters.add(waiter);
    return waiter.promise;
  }

  /**
   * Force a new transport generation and resolve only after its peer HELLO has been intersected.
   * Desktop restore uses this instead of treating a still-open transport as application readiness.
   */
  async rehandshake() {
    if (this._closed) throw new DisconnectedError("agent channel is closed");
    if (!this._started) this.start();
    if (this._state !== CHANNEL_STATE.READY) await this.waitUntilReady();
    if (!this._reconnectEnabled) {
      throw new DisconnectedError("agent channel cannot re-handshake without a reconnecting connector");
    }
    const waiter = deferred();
    this._readyWaiters.add(waiter);
    this._failConnection(
      new DisconnectedError("desktop restore requested a fresh agent HELLO"),
      this._transportGeneration,
    );
    const negotiated = await waiter.promise;
    return Object.freeze({
      ...negotiated,
      generation: this._transportGeneration,
    });
  }

  supports(capability) {
    const required = asU64(capability, "capability");
    return (this.negotiatedCapabilities & required) === required;
  }

  /** Subscribe to one numeric message type. The callback receives an owned frame payload. */
  subscribe(type, listener) {
    type = integerInRange(type, 0, 0xffff, "message type");
    if (typeof listener !== "function") throw new TypeError("channel subscription must be a function");
    let listeners = this._subscriptions.get(type);
    if (!listeners) {
      listeners = new Set();
      this._subscriptions.set(type, listeners);
    }
    listeners.add(listener);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      listeners.delete(listener);
      if (listeners.size === 0) this._subscriptions.delete(type);
      return true;
    };
  }

  /** Subscribe to state transitions. It is safe to call from either a page or a Worker. */
  subscribeState(listener) {
    if (typeof listener !== "function") throw new TypeError("state subscription must be a function");
    this._stateListeners.add(listener);
    let active = true;
    return () => {
      if (!active) return false;
      active = false;
      return this._stateListeners.delete(listener);
    };
  }

  listenerCount(type) {
    if (type == null) {
      let count = 0;
      for (const listeners of this._subscriptions.values()) count += listeners.size;
      return count;
    }
    return this._subscriptions.get(integerInRange(type, 0, 0xffff, "message type"))?.size ?? 0;
  }

  get transportListenerCount() {
    return this._transportUnsubscribe ? 1 : 0;
  }

  /**
   * Send an extension frame. There is no implicit retry: if the VM is in a restart gap the
   * returned Promise rejects with DisconnectedError, so a caller cannot mistake loss for success.
   */
  send(typeOrFrame, payload, flagsOrOptions = FLAG_NONE) {
    let type = typeOrFrame;
    let body = payload;
    let flags = flagsOrOptions;
    let capability = null;
    if (typeOrFrame && typeof typeOrFrame === "object" && !ArrayBuffer.isView(typeOrFrame)
        && !(typeOrFrame instanceof ArrayBuffer)) {
      type = typeOrFrame.type ?? typeOrFrame.messageType;
      body = typeOrFrame.payload ?? new Uint8Array();
      flags = typeOrFrame.flags ?? FLAG_NONE;
      capability = typeOrFrame.capability ?? null;
    } else if (flagsOrOptions && typeof flagsOrOptions === "object") {
      flags = flagsOrOptions.flags ?? FLAG_NONE;
      capability = flagsOrOptions.capability ?? null;
    }
    if (this._state !== CHANNEL_STATE.READY) {
      return Promise.reject(new DisconnectedError("agent channel is disconnected; send was not queued"));
    }
    if (capability != null && !this.supports(capability)) {
      return Promise.reject(new CapabilityError(`capability ${String(capability)} is not negotiated`));
    }
    let frame;
    try {
      frame = encodeFrame(type, body ?? new Uint8Array(), flags);
    } catch (error) {
      return Promise.reject(error);
    }
    const generation = this._transportGeneration;
    return this._writeFrame(frame, generation).catch((error) => {
      if (error instanceof BackpressureError) throw error;
      const disconnected = error instanceof DisconnectedError
        ? error
        : new DisconnectedError("agent channel disconnected while sending", { cause: error });
      this._failConnection(disconnected, generation);
      throw disconnected;
    }).then(() => true);
  }

  /** Send a typed PING and resolve with exactly the nonce carried by its PONG. */
  ping(nonceOrOptions) {
    let nonce = nonceOrOptions;
    let timeoutMs = this._pingTimeoutMs;
    if (nonceOrOptions && typeof nonceOrOptions === "object" && !(nonceOrOptions instanceof Number)) {
      nonce = nonceOrOptions.nonce;
      timeoutMs = nonceOrOptions.timeoutMs ?? timeoutMs;
    }
    if (nonce == null) {
      nonce = this._nextNonce;
      this._nextNonce = (this._nextNonce + 1n) & UINT64_MAX;
      if (this._nextNonce === 0n) this._nextNonce = 1n;
    }
    try {
      nonce = asU64(nonce, "PING nonce");
      timeoutMs = normalizeMilliseconds(timeoutMs, this._pingTimeoutMs, { minimum: 0 });
    } catch (error) {
      return Promise.reject(error);
    }
    if (this._state !== CHANNEL_STATE.READY) {
      return Promise.reject(new DisconnectedError("agent channel is disconnected; PING was not queued"));
    }
    if (!this.supports(CAP_PING)) {
      return Promise.reject(new CapabilityError("CAP_PING was not negotiated"));
    }
    if (this._pending.size >= this._maxPending) {
      return Promise.reject(new BackpressureError(
        `agent channel has ${this._pending.size} pending requests (limit ${this._maxPending})`,
      ));
    }
    const key = nonce.toString();
    if (this._pending.has(key)) {
      return Promise.reject(new BackpressureError(`PING nonce ${key} is already in flight`));
    }
    const generation = this._transportGeneration;
    const request = deferred();
    const pending = { nonce, request, timer: null, generation };
    this._pending.set(key, pending);
    if (timeoutMs > 0) {
      pending.timer = setTimeout(() => {
        if (this._pending.get(key) !== pending) return;
        this._settlePending(key, pending, "reject", new RequestTimeoutError(`PING ${key} timed out`));
      }, timeoutMs);
      pending.timer.unref?.();
    }
    let frame;
    try {
      frame = encodeFrame(TYPE_PING, encodePing(nonce), FLAG_NONE);
    } catch (error) {
      this._settlePending(key, pending, "reject", error);
      return request.promise;
    }
    this._writeFrame(frame, generation).catch((error) => {
      if (error instanceof BackpressureError) {
        this._settlePending(key, pending, "reject", error);
        return;
      }
      const disconnected = error instanceof DisconnectedError
        ? error
        : new DisconnectedError("agent channel disconnected while sending PING", { cause: error });
      this._failConnection(disconnected, generation);
      this._settlePending(key, pending, "reject", disconnected);
    });
    return request.promise;
  }

  close(reason = "agent channel closed") {
    if (this._closed) return false;
    this._closed = true;
    this._started = false;
    if (this._retryTimer != null) clearTimeout(this._retryTimer);
    this._retryTimer = null;
    this._clearHandshakeTimer();
    const error = reason instanceof DisconnectedError
      ? reason
      : new DisconnectedError(String(reason), { cause: reason instanceof Error ? reason : undefined });
    this._rejectPending(error);
    this._rejectReadyWaiters(error);
    if (!this._firstReady.settled) {
      this._firstReady.settled = true;
      this._firstReady.reject(error);
    }
    this._cleanupTransport();
    this._transition(CHANNEL_STATE.CLOSED, { error });
    this._subscriptions.clear();
    this._stateListeners.clear();
    return true;
  }

  destroy(reason) {
    return this.close(reason);
  }

  async _attemptConnect() {
    if (this._closed || !this._started || this._connecting) return;
    this._connecting = true;
    this._connectAttempt += 1;
    this._transition(CHANNEL_STATE.CONNECTING, { attempt: this._connectAttempt });
    let candidate;
    try {
      candidate = await this._connect({ attempt: this._connectAttempt });
    } catch (error) {
      this._connecting = false;
      this._failConnection(error, null);
      return;
    }
    this._connecting = false;
    if (this._closed || !this._started) {
      try { normalizeTransport(candidate).close?.(); } catch { /* caller closed during connect */ }
      return;
    }
    let transport;
    try {
      transport = normalizeTransport(candidate);
      const generation = ++this._generation;
      this._transport = transport;
      this._transportGeneration = generation;
      this._decoder.reset();
      this._peerHello = null;
      this._negotiated = null;
      this._transition(CHANNEL_STATE.HANDSHAKING, { generation });
      this._transportUnsubscribe = subscribeTransport(transport, {
        data: (data) => this._receive(data, generation),
        close: (reason) => this._failConnection(
          new DisconnectedError("agent transport closed", { cause: reason instanceof Error ? reason : undefined }),
          generation,
        ),
        error: (reason) => this._failConnection(
          new DisconnectedError("agent transport reported an error", { cause: reason instanceof Error ? reason : undefined }),
          generation,
        ),
      });
      this._armHandshakeTimer(generation);
      const hello = encodeFrame(TYPE_HELLO, encodeHello(this._localVersion, this._localCapabilities), FLAG_NONE);
      this._writeFrame(hello, generation, true).catch((error) => this._failConnection(error, generation));
    } catch (error) {
      try { transport?.close?.(); } catch { /* failed transport setup */ }
      this._failConnection(error, this._transportGeneration || null);
    }
  }

  _receive(value, generation) {
    if (this._closed || generation !== this._transportGeneration) return;
    try {
      this._decoder.push(eventData(value), (frame) => this._receiveFrame(frame, generation));
    } catch (error) {
      this._failConnection(error, generation);
    }
  }

  _receiveFrame(frame, generation) {
    if (this._closed || generation !== this._transportGeneration) return;
    try {
      if (frame.type === TYPE_HELLO) {
        this._receiveHello(frame, generation);
        this._dispatch(frame);
        return;
      }
      if (this._state !== CHANNEL_STATE.READY) {
        throw new ProtocolError("agent frame arrived before HELLO negotiation", "FRAME_BEFORE_HELLO");
      }
      switch (frame.type) {
        case TYPE_PING: {
          const nonce = decodePing(frame.payload, "PING");
          this._writeFrame(encodeFrame(TYPE_PONG, encodePing(nonce), FLAG_NONE), generation)
            .catch((error) => this._failConnection(error, generation));
          this._dispatch(frame);
          break;
        }
        case TYPE_PONG: {
          const nonce = decodePing(frame.payload, "PONG");
          const key = nonce.toString();
          const pending = this._pending.get(key);
          if (pending) this._settlePending(key, pending, "resolve", nonce);
          this._dispatch(frame);
          break;
        }
        case TYPE_NAK: {
          const nak = decodeNak(frame.payload);
          if (nak.rejectedType === TYPE_PING) {
            for (const [key, pending] of [...this._pending]) {
              this._settlePending(
                key,
                pending,
                "reject",
                new NakError(`agent rejected PINGs with NAK code ${nak.code}`),
              );
            }
          }
          this._dispatch(frame);
          break;
        }
        default: {
          if (!this._subscriptions.has(frame.type)) {
            this._writeFrame(
              encodeFrame(TYPE_NAK, encodeNak(frame.type, NAK_UNKNOWN_TYPE), FLAG_NONE),
              generation,
            ).catch((error) => this._failConnection(error, generation));
          } else {
            this._dispatch(frame);
          }
          break;
        }
      }
    } catch (error) {
      this._failConnection(error, generation);
    }
  }

  _receiveHello(frame, generation) {
    const peer = decodeHello(frame.payload);
    if (this._state === CHANNEL_STATE.READY) {
      if (this._peerHello?.version === peer.version && this._peerHello?.capabilities === peer.capabilities) return;
      throw new ProtocolError("peer HELLO changed after negotiation", "STALE_HELLO");
    }
    if (this._state !== CHANNEL_STATE.HANDSHAKING) {
      throw new ProtocolError("HELLO arrived outside the handshake", "HELLO_STATE");
    }
    const version = Math.min(this._localVersion, peer.version);
    if (version === 0) {
      throw new NegotiationError(
        `no common agent protocol version (local=${this._localVersion}, peer=${peer.version})`,
      );
    }
    this._peerHello = peer;
    this._negotiated = Object.freeze({
      version,
      capabilities: this._localCapabilities & peer.capabilities,
      peerVersion: peer.version,
      peerCapabilities: peer.capabilities,
    });
    this._clearHandshakeTimer();
    this._reconnectAttempts = 0;
    this._retryDelayMs = this._reconnectMinDelayMs;
    this._transition(CHANNEL_STATE.READY, { generation, negotiated: this._negotiated });
    if (!this._firstReady.settled) {
      this._firstReady.settled = true;
      this._firstReady.resolve(this._negotiated);
    }
    for (const waiter of this._readyWaiters) {
      if (!waiter.settled) {
        waiter.settled = true;
        waiter.resolve(this._negotiated);
      }
    }
    this._readyWaiters.clear();
  }

  _dispatch(frame) {
    const listeners = this._subscriptions.get(frame.type);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(frameRecord(frame.type, frame.flags, frame.payload.slice()));
      } catch (error) {
        this._reportError(error);
      }
    }
  }

  _writeFrame(bytes, generation, allowHandshaking = false) {
    if (this._closed || generation !== this._transportGeneration || !this._transport
        || (this._state !== CHANNEL_STATE.READY && !(allowHandshaking && this._state === CHANNEL_STATE.HANDSHAKING))) {
      return Promise.reject(new DisconnectedError("agent channel is disconnected; frame was not queued"));
    }
    if (this._writeDepth >= this._maxPending) {
      return Promise.reject(new BackpressureError("agent channel outbound queue is full"));
    }
    const transport = this._transport;
    this._writeDepth += 1;
    const prior = this._writeTail.catch(() => {});
    const operation = prior.then(() => {
      if (this._closed || generation !== this._transportGeneration || transport !== this._transport) {
        throw new DisconnectedError("agent channel disconnected before frame write");
      }
      return transport.send(bytes);
    });
    this._writeTail = operation.catch(() => {});
    return operation.finally(() => {
      this._writeDepth -= 1;
    });
  }

  _settlePending(key, pending, method, value) {
    if (this._pending.get(key) !== pending || pending.request.settled) return false;
    this._pending.delete(key);
    if (pending.timer != null) clearTimeout(pending.timer);
    pending.request.settled = true;
    pending.request[method](value);
    return true;
  }

  _rejectPending(error) {
    for (const [key, pending] of [...this._pending]) this._settlePending(key, pending, "reject", error);
  }

  _rejectReadyWaiters(error) {
    for (const waiter of this._readyWaiters) {
      if (!waiter.settled) {
        waiter.settled = true;
        waiter.reject(error);
      }
    }
    this._readyWaiters.clear();
  }

  _failConnection(reason, generation) {
    if (this._closed) return;
    if (generation != null && generation !== this._transportGeneration) return;
    const cause = reason instanceof Error ? reason : undefined;
    const error = reason instanceof DisconnectedError
      ? reason
      : new DisconnectedError("agent channel disconnected; reconnecting", { cause });
    this._lastError = reason instanceof Error ? reason : error;
    this._clearHandshakeTimer();
    this._cleanupTransport();
    this._decoder.reset();
    this._peerHello = null;
    this._negotiated = null;
    this._rejectPending(error);
    this._transition(CHANNEL_STATE.DISCONNECTED, { error });
    this._reportError(error);
    this._scheduleReconnect();
  }

  _scheduleReconnect() {
    if (!this._reconnectEnabled || this._closed || !this._started || this._retryTimer != null
        || this._connecting || this._reconnectAttempts >= this._maxReconnectAttempts) return;
    const delay = this._retryDelayMs;
    this._reconnectAttempts += 1;
    this._retryDelayMs = Math.min(
      this._reconnectMaxDelayMs,
      Math.max(this._reconnectMinDelayMs, delay === 0 ? this._reconnectMinDelayMs : delay * 2),
    );
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      void this._attemptConnect();
    }, delay);
    this._retryTimer.unref?.();
  }

  _armHandshakeTimer(generation) {
    this._clearHandshakeTimer();
    this._handshakeTimer = setTimeout(() => {
      if (generation === this._transportGeneration && this._state === CHANNEL_STATE.HANDSHAKING) {
        this._failConnection(new ProtocolError("agent HELLO handshake timed out", "HELLO_TIMEOUT"), generation);
      }
    }, this._handshakeTimeoutMs);
    this._handshakeTimer.unref?.();
  }

  _clearHandshakeTimer() {
    if (this._handshakeTimer != null) clearTimeout(this._handshakeTimer);
    this._handshakeTimer = null;
  }

  _cleanupTransport() {
    const unsubscribe = this._transportUnsubscribe;
    const transport = this._transport;
    this._transportUnsubscribe = null;
    this._transport = null;
    this._transportGeneration = 0;
    try { unsubscribe?.(); } catch (error) { this._reportError(error); }
    try { transport?.close?.(); } catch (error) { this._reportError(error); }
  }

  _transition(state, details = {}) {
    const previous = this._state;
    this._state = state;
    const event = Object.freeze({
      state,
      previous,
      generation: this._transportGeneration || null,
      negotiated: this._negotiated,
      ...details,
    });
    for (const listener of [...this._stateListeners]) {
      try { listener(event); } catch (error) { this._reportError(error); }
    }
  }

  _reportError(error) {
    try { this._onError?.(error); } catch { /* diagnostics must not break the channel */ }
  }
}

export function createAgentChannel(options) {
  return new Channel(options);
}
