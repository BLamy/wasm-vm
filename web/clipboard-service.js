// E5-T24c — host clipboard permissions, gesture staging, and ordered guest sync.
//
// This module is deliberately independent of the GUI compositor. It consumes the verified agent
// Channel and a focused DOM target, so a future canvas and the current terminal can share one
// privacy/permission policy without polling the asynchronous clipboard-read API. Paste events are
// the only host-to-guest read path: clipboardData is inspected only after focus has been proven.

import {
  CAP_CLIPBOARD,
  CHANNEL_STATE,
  ClipboardError,
  decodeClipboardSet,
  encodeClipboardText,
  MAX_CLIPBOARD_BYTES,
  TYPE_CLIP_SET,
} from "./agent-channel.js";

export const CLIPBOARD_STATE = Object.freeze({
  IDLE: "idle",
  WRITING: "writing",
  SYNCED: "synced",
  STAGED: "staged",
  DENIED: "denied",
  UNAVAILABLE: "unavailable",
  DISCONNECTED: "disconnected",
  INVALID: "invalid",
});

export const CLIPBOARD_PERMISSION = Object.freeze({
  UNKNOWN: "unknown",
  GRANTED: "granted",
  DENIED: "denied",
});

export const CLIPBOARD_DIRECTION = Object.freeze({
  HOST_TO_GUEST: "host-to-guest",
  GUEST_TO_HOST: "guest-to-host",
});

export const DEFAULT_ECHO_WINDOW_MS = 250;
export const MAX_ECHO_HISTORY = 2;

const STATUS_TEXT = Object.freeze({
  [CLIPBOARD_STATE.IDLE]: "Clipboard: waiting for a copy",
  [CLIPBOARD_STATE.WRITING]: "Clipboard: writing…",
  [CLIPBOARD_STATE.SYNCED]: "Clipboard: synced",
  [CLIPBOARD_STATE.STAGED]: "Clipboard: pending — use a gesture to allow access",
  [CLIPBOARD_STATE.DENIED]: "Clipboard: blocked — use a gesture to retry",
  [CLIPBOARD_STATE.UNAVAILABLE]: "Clipboard: unavailable",
  [CLIPBOARD_STATE.DISCONNECTED]: "Clipboard: waiting for guest",
  [CLIPBOARD_STATE.INVALID]: "Clipboard: rejected invalid text",
});

function defaultNow() {
  const now = globalThis.performance?.now?.();
  return Number.isFinite(now) ? now : Date.now();
}

function defaultWriteClipboard(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") {
    const error = new Error("navigator.clipboard.writeText is unavailable");
    error.code = "CLIPBOARD_UNAVAILABLE";
    return Promise.reject(error);
  }
  return clipboard.writeText(text);
}

function defaultIsFocused(target) {
  if (!target) return false;
  const document = target.ownerDocument ?? globalThis.document;
  const active = document?.activeElement;
  return active === target || Boolean(target.contains?.(active));
}

function asError(error, fallbackCode = "CLIPBOARD_ERROR") {
  if (error instanceof Error) return error;
  const normalized = new Error(String(error ?? "clipboard operation failed"));
  normalized.code = error?.code || fallbackCode;
  return normalized;
}

function errorCode(error) {
  const code = String(error?.code || error?.name || "");
  if (["NotAllowedError", "PermissionDeniedError", "CLIPBOARD_PERMISSION_DENIED"].includes(code)) {
    return "CLIPBOARD_PERMISSION_DENIED";
  }
  if (["NotFoundError", "SecurityError", "CLIPBOARD_UNAVAILABLE"].includes(code)) {
    return "CLIPBOARD_UNAVAILABLE";
  }
  return code || "CLIPBOARD_WRITE_FAILED";
}

function stateForWriteFailure(error) {
  const code = errorCode(error);
  if (code === "CLIPBOARD_PERMISSION_DENIED") return CLIPBOARD_STATE.DENIED;
  if (code === "CLIPBOARD_UNAVAILABLE") return CLIPBOARD_STATE.UNAVAILABLE;
  return CLIPBOARD_STATE.STAGED;
}

function copyBytes(bytes) {
  return new Uint8Array(bytes);
}

function sameBytes(left, right) {
  if (!left || !right || left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

// FNV-1a is deterministic, cheap, and only an index. The byte comparison in sameBytes() keeps a
// hash collision from suppressing real clipboard content.
function contentHash(bytes) {
  let hash = 0x811c9dc5;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, "0");
}

function channelGeneration(event, fallback) {
  const value = Number(event?.generation);
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

/**
 * Host-side clipboard service for one focused guest surface.
 *
 * `channel` is a T23d Channel (or a deterministic test double with subscribe(), send(), and
 * optionally subscribeState()). `target` is the canvas/terminal surface. `onPasteReady` is called
 * only after the CLIP_SET frame has been handed to the Channel; callers that forward a guest key
 * event use that callback as the ordering barrier. `attach()` installs capture-phase paste and
 * gesture listeners; it never closes the caller-owned Channel.
 */
export class ClipboardService {
  constructor({
    channel,
    target = null,
    focusTarget = target,
    gestureTarget = target ?? globalThis.document ?? null,
    statusElement = null,
    writeClipboard = defaultWriteClipboard,
    isFocused = () => defaultIsFocused(focusTarget),
    now = defaultNow,
    echoWindowMs = DEFAULT_ECHO_WINDOW_MS,
    onStateChange = null,
    onError = null,
    onPasteReady = null,
    onPasteRejected = null,
    autoAttach = true,
  } = {}) {
    if (!channel || typeof channel.send !== "function" || typeof channel.subscribe !== "function") {
      throw new TypeError("ClipboardService requires a Channel-like send()/subscribe() object");
    }
    if (target !== null && typeof target.addEventListener !== "function") {
      throw new TypeError("clipboard target must provide addEventListener()");
    }
    if (gestureTarget !== null && typeof gestureTarget.addEventListener !== "function") {
      throw new TypeError("clipboard gesture target must provide addEventListener()");
    }
    if (typeof writeClipboard !== "function") throw new TypeError("writeClipboard must be a function");
    if (typeof isFocused !== "function") throw new TypeError("isFocused must be a function");
    if (typeof now !== "function") throw new TypeError("now must be a function");
    if (!Number.isFinite(Number(echoWindowMs)) || Number(echoWindowMs) < 0) {
      throw new RangeError("echoWindowMs must be a finite non-negative number");
    }
    if (onStateChange !== null && typeof onStateChange !== "function") {
      throw new TypeError("onStateChange must be a function or null");
    }
    if (onError !== null && typeof onError !== "function") throw new TypeError("onError must be a function or null");
    if (onPasteReady !== null && typeof onPasteReady !== "function") {
      throw new TypeError("onPasteReady must be a function or null");
    }
    if (onPasteRejected !== null && typeof onPasteRejected !== "function") {
      throw new TypeError("onPasteRejected must be a function or null");
    }

    this.channel = channel;
    this.target = target;
    this.focusTarget = focusTarget;
    this.gestureTarget = gestureTarget;
    this.statusElement = statusElement;
    this._writeClipboard = writeClipboard;
    this._isFocused = isFocused;
    this._now = now;
    this._echoWindowMs = Number(echoWindowMs);
    this._onStateChange = onStateChange;
    this._onError = onError;
    this._onPasteReady = onPasteReady;
    this._onPasteRejected = onPasteRejected;

    this._state = CLIPBOARD_STATE.IDLE;
    this._permission = CLIPBOARD_PERMISSION.UNKNOWN;
    this._generation = 0;
    this._pendingHost = null;
    this._writeActive = null;
    this._needsGesture = false;
    this._lastError = null;
    this._history = [];
    this._lastPaste = Promise.resolve({ ok: false, reason: "none" });
    this._sentFrames = 0;
    this._guestFrames = 0;
    this._suppressedEchoes = 0;
    this._attached = false;
    this._unsubscribeClipboard = null;
    this._unsubscribeState = null;
    this._pasteListener = (event) => { void this.handlePasteEvent(event); };
    this._gestureListener = () => { void this.flushStaged(); };

    this._render();
    if (autoAttach) this.attach();
  }

  get state() {
    return this._state;
  }

  get permission() {
    return this._permission;
  }

  get generation() {
    return this._generation;
  }

  get lastError() {
    return this._lastError;
  }

  get pending() {
    return this._pendingHost !== null;
  }

  get pendingBytes() {
    return this._pendingHost?.bytes.byteLength ?? 0;
  }

  get sentFrames() {
    return this._sentFrames;
  }

  get guestFrames() {
    return this._guestFrames;
  }

  get suppressedEchoes() {
    return this._suppressedEchoes;
  }

  /** A stable, text-free snapshot for UI/test diagnostics. */
  snapshot() {
    return {
      state: this._state,
      permission: this._permission,
      generation: this._generation,
      pending: this.pending,
      pendingBytes: this.pendingBytes,
      historyDepth: this._history.length,
      sentFrames: this._sentFrames,
      guestFrames: this._guestFrames,
      suppressedEchoes: this._suppressedEchoes,
      attached: this._attached,
      lastError: this._lastError,
    };
  }

  /** Attach once to the caller-owned Channel and DOM targets. */
  attach() {
    if (this._attached) return this;
    this._attached = true;
    this._unsubscribeClipboard = this.channel.subscribe(TYPE_CLIP_SET, (frame) => {
      void this.handleGuestFrame(frame);
    });
    if (typeof this.channel.subscribeState === "function") {
      this._unsubscribeState = this.channel.subscribeState((event) => this._handleChannelState(event));
    }
    this.target?.addEventListener("paste", this._pasteListener, true);
    // A gesture is the only retry trigger after a denied write. These listeners never inspect
    // clipboard contents; they merely unlock the already-retained guest value.
    this.gestureTarget?.addEventListener("pointerdown", this._gestureListener, true);
    this.gestureTarget?.addEventListener("keydown", this._gestureListener, true);
    return this;
  }

  /** Remove listeners and subscriptions without closing the Channel. */
  detach() {
    if (!this._attached) return false;
    this._attached = false;
    try { this._unsubscribeClipboard?.(); } catch (error) { this._reportError(error); }
    try { this._unsubscribeState?.(); } catch (error) { this._reportError(error); }
    this._unsubscribeClipboard = null;
    this._unsubscribeState = null;
    this.target?.removeEventListener?.("paste", this._pasteListener, true);
    this.gestureTarget?.removeEventListener?.("pointerdown", this._gestureListener, true);
    this.gestureTarget?.removeEventListener?.("keydown", this._gestureListener, true);
    return true;
  }

  destroy() {
    return this.detach();
  }

  /**
   * Receive one Channel CLIP_SET frame. Invalid/oversized input is consumed as an explicit local
   * rejection; it never reaches writeText and never becomes an unhandled Promise rejection.
   */
  handleGuestFrame(frame) {
    this._guestFrames += 1;
    let clipboard;
    try {
      clipboard = decodeClipboardSet(frame?.payload ?? new Uint8Array());
    } catch (error) {
      const failure = asError(error, "CLIPBOARD_INVALID_PAYLOAD");
      this._lastError = { code: failure.code || "CLIPBOARD_INVALID_PAYLOAD", message: failure.message };
      this._setState(CLIPBOARD_STATE.INVALID);
      this._reportError(failure);
      return Promise.resolve({ ok: false, reason: "invalid", error: failure });
    }

    const bytes = copyBytes(clipboard.bytes);
    const generation = channelGeneration(frame, this._generation);
    if (this._isExpectedEcho(bytes, generation)) {
      this._suppressedEchoes += 1;
      this._lastError = null;
      this._setState(CLIPBOARD_STATE.SYNCED, { suppressed: true });
      return Promise.resolve({ ok: true, suppressed: true, text: clipboard.text });
    }

    // One newest value is enough. A denied browser permission must not turn guest traffic into an
    // unbounded Promise/array queue; a later user gesture retries exactly this retained value.
    this._pendingHost = {
      text: clipboard.text,
      bytes,
      generation,
      hash: contentHash(bytes),
    };
    return this._drainHostWrite();
  }

  /**
   * Send host clipboard text to the guest. The Channel call occurs synchronously in this method,
   * before the returned Promise settles, so a paste handler can install an explicit ordering barrier.
   */
  sendHostText(value, { generation = this._generation } = {}) {
    let bytes;
    try {
      bytes = encodeClipboardText(value);
    } catch (error) {
      const failure = asError(error, "CLIPBOARD_INVALID_PAYLOAD");
      this._lastError = { code: failure.code || "CLIPBOARD_INVALID_PAYLOAD", message: failure.message };
      this._setState(CLIPBOARD_STATE.INVALID);
      this._reportError(failure);
      return Promise.resolve({ ok: false, reason: "invalid", error: failure });
    }

    if (typeof this.channel.supports === "function" && !this.channel.supports(CAP_CLIPBOARD)) {
      const failure = new Error("CAP_CLIPBOARD is not negotiated");
      failure.code = "CAPABILITY";
      this._lastError = { code: failure.code, message: failure.message };
      this._setState(CLIPBOARD_STATE.DISCONNECTED);
      this._reportError(failure);
      return Promise.resolve({ ok: false, reason: "capability", error: failure });
    }

    const record = this._remember(CLIPBOARD_DIRECTION.HOST_TO_GUEST, bytes, generation, true);
    let sent;
    try {
      sent = this.channel.send(TYPE_CLIP_SET, bytes, { capability: CAP_CLIPBOARD });
    } catch (error) {
      this._forget(record);
      return this._hostSendFailure(error);
    }

    this._sentFrames += 1;
    const result = Promise.resolve(sent).then(
      () => {
        this._lastError = null;
        this._setState(CLIPBOARD_STATE.SYNCED, { direction: CLIPBOARD_DIRECTION.HOST_TO_GUEST });
        return { ok: true, text: typeof value === "string" ? value : new TextDecoder().decode(bytes) };
      },
      (error) => {
        this._forget(record);
        return this._hostSendFailure(error);
      },
    );
    return result;
  }

  /**
   * Capture-phase paste handler. Focus is checked before touching clipboardData, so an unfocused
   * guest surface cannot inspect or synchronize the host clipboard. The event is consumed only for
   * a focused surface; invalid/missing text is rejected visibly instead of falling through to keys.
   */
  handlePasteEvent(event) {
    let focused;
    try {
      focused = Boolean(this._isFocused(event));
    } catch (error) {
      this._reportError(error);
      return Promise.resolve({ ok: false, handled: false, reason: "focus-check-failed" });
    }
    if (!focused) return Promise.resolve({ ok: false, handled: false, reason: "unfocused" });

    event?.preventDefault?.();
    event?.stopImmediatePropagation?.();
    let text;
    try {
      const data = event?.clipboardData;
      if (!data || typeof data.getData !== "function") throw new Error("paste event has no text/plain data");
      text = data.getData("text/plain");
    } catch (error) {
      const failure = asError(error, "CLIPBOARD_INVALID_PAYLOAD");
      this._lastError = { code: failure.code, message: failure.message };
      this._setState(CLIPBOARD_STATE.INVALID);
      this._reportError(failure);
      const rejected = Promise.resolve({ ok: false, handled: true, reason: "invalid", error: failure });
      this._lastPaste = rejected;
      return rejected;
    }

    const sent = this.sendHostText(text);
    const result = Promise.resolve(sent).then((outcome) => {
      const withHandling = { ...outcome, handled: true };
      if (outcome.ok) {
        try { this._onPasteReady?.({ text, outcome: withHandling, event }); } catch (error) { this._reportError(error); }
      } else {
        try { this._onPasteRejected?.({ text, outcome: withHandling, event }); } catch (error) { this._reportError(error); }
      }
      return withHandling;
    });
    this._lastPaste = result;
    return result;
  }

  /** Resolve after the latest host paste has reached the Channel. */
  waitForLastPaste() {
    return this._lastPaste;
  }

  /** Retry the retained guest value from a user-gesture handler; all expected failures are returned. */
  async flushStaged() {
    if (this._writeActive) {
      await this._writeActive;
    }
    if (!this._pendingHost) {
      return { ok: false, reason: "empty", state: this._state };
    }
    return this._drainHostWrite({ gesture: true });
  }

  _handleChannelState(event) {
    if (event?.state === CHANNEL_STATE.READY) {
      const nextGeneration = channelGeneration(event, this._generation);
      if (nextGeneration !== this._generation) {
        this._generation = nextGeneration;
        this._history = [];
      }
      if (this._state === CLIPBOARD_STATE.DISCONNECTED) {
        this._setState(this._pendingHost ? CLIPBOARD_STATE.STAGED : CLIPBOARD_STATE.IDLE);
      }
      return;
    }
    if (event?.state === CHANNEL_STATE.DISCONNECTED || event?.state === CHANNEL_STATE.CLOSED) {
      this._generation += 1;
      this._history = [];
      if (this._pendingHost) this._setState(CLIPBOARD_STATE.DISCONNECTED);
    }
  }

  _drainHostWrite({ gesture = false } = {}) {
    if (this._writeActive) return this._writeActive;
    if (!this._pendingHost) return Promise.resolve({ ok: false, reason: "empty", state: this._state });
    if (this._needsGesture && !gesture) {
      this._setState(this._permission === CLIPBOARD_PERMISSION.DENIED
        ? CLIPBOARD_STATE.DENIED
        : CLIPBOARD_STATE.STAGED);
      return Promise.resolve({ ok: false, staged: true, state: this._state });
    }

    const pending = this._pendingHost;
    this._pendingHost = null;
    this._setState(CLIPBOARD_STATE.WRITING, { direction: CLIPBOARD_DIRECTION.GUEST_TO_HOST });

    let write;
    try {
      write = this._writeClipboard(pending.text);
    } catch (error) {
      write = Promise.reject(error);
    }
    const operation = Promise.resolve(write).then(
      () => {
        this._permission = CLIPBOARD_PERMISSION.GRANTED;
        this._needsGesture = false;
        this._lastError = null;
        this._remember(CLIPBOARD_DIRECTION.GUEST_TO_HOST, pending.bytes, pending.generation, false);
        this._setState(CLIPBOARD_STATE.SYNCED, { direction: CLIPBOARD_DIRECTION.GUEST_TO_HOST });
        return { ok: true, text: pending.text };
      },
      (error) => {
        const failure = asError(error, "CLIPBOARD_WRITE_FAILED");
        if (!this._pendingHost) this._pendingHost = pending;
        this._needsGesture = true;
        this._permission = errorCode(failure) === "CLIPBOARD_PERMISSION_DENIED"
          ? CLIPBOARD_PERMISSION.DENIED
          : CLIPBOARD_PERMISSION.UNKNOWN;
        this._lastError = { code: errorCode(failure), message: failure.message };
        this._setState(stateForWriteFailure(failure));
        this._reportError(failure);
        return { ok: false, staged: true, state: this._state, error: failure };
      },
    );
    this._writeActive = operation;
    operation.finally(() => {
      if (this._writeActive === operation) this._writeActive = null;
      if (this._pendingHost && !this._needsGesture) void this._drainHostWrite();
    }).catch((error) => this._reportError(error));
    return operation;
  }

  _hostSendFailure(error) {
    const failure = asError(error, "CLIPBOARD_SEND_FAILED");
    const code = errorCode(failure);
    this._lastError = { code, message: failure.message };
    this._setState(code === "CLIPBOARD_PERMISSION_DENIED"
      ? CLIPBOARD_STATE.DENIED
      : code === "CLIPBOARD_UNAVAILABLE" || code === "CAPABILITY"
        ? CLIPBOARD_STATE.UNAVAILABLE
        : CLIPBOARD_STATE.DISCONNECTED);
    this._reportError(failure);
    return Promise.resolve({ ok: false, reason: "send", state: this._state, error: failure });
  }

  _remember(direction, bytes, generation, expectedEcho) {
    const record = {
      direction,
      generation,
      hash: contentHash(bytes),
      bytes: copyBytes(bytes),
      expectedEcho,
      expiresAt: Number(this._now()) + this._echoWindowMs,
    };
    this._history.push(record);
    while (this._history.length > MAX_ECHO_HISTORY) this._history.shift();
    return record;
  }

  _forget(record) {
    const index = this._history.indexOf(record);
    if (index >= 0) this._history.splice(index, 1);
  }

  _isExpectedEcho(bytes, generation) {
    const now = Number(this._now());
    for (let index = this._history.length - 1; index >= 0; index -= 1) {
      const record = this._history[index];
      if (record.direction !== CLIPBOARD_DIRECTION.HOST_TO_GUEST || !record.expectedEcho) continue;
      if (record.generation !== generation || record.expiresAt < now || record.hash !== contentHash(bytes)) continue;
      if (!sameBytes(record.bytes, bytes)) continue;
      this._history.splice(index, 1);
      return true;
    }
    this._history = this._history.filter((record) => record.expiresAt >= now);
    return false;
  }

  _setState(state, details = {}) {
    const previous = this._state;
    this._state = state;
    this._render();
    const event = Object.freeze({
      state,
      previous,
      permission: this._permission,
      pending: this.pending,
      pendingBytes: this.pendingBytes,
      generation: this._generation,
      ...details,
    });
    try { this._onStateChange?.(event); } catch (error) { this._reportError(error); }
  }

  _render() {
    const element = this.statusElement;
    if (!element) return;
    element.dataset.state = this._state;
    element.dataset.pending = this.pending ? "true" : "false";
    element.setAttribute?.("role", "status");
    element.setAttribute?.("aria-live", "polite");
    element.textContent = STATUS_TEXT[this._state] ?? STATUS_TEXT[CLIPBOARD_STATE.UNAVAILABLE];
  }

  _reportError(error) {
    try { this._onError?.(error); } catch { /* diagnostics must never break paste or gesture paths */ }
  }
}

export function createClipboardService(options) {
  return new ClipboardService(options);
}

export { MAX_CLIPBOARD_BYTES };
