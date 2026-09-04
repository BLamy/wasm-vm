// E5-T21d: lazy microphone permission and lifecycle policy.
//
// This module owns browser media objects only. The guest advertises capture at boot, but this
// adapter does not call getUserMedia until the loader reports a successful capture PCM_START. A
// denied, missing, muted, or ended track leaves the already-attached wasm capture source running;
// the shared-ring consumer then supplies paced zero-filled rxq periods and the guest receives the
// existing bounded PCM XRUN event through eventq.

import {
  AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME,
} from "./capture-worklet.js";

export const MICROPHONE_OFF = "off";
export const MICROPHONE_LIVE = "live";
export const MICROPHONE_DENIED = "denied";
export const MICROPHONE_REVOKED = "revoked";

export const MICROPHONE_CONSTRAINTS = Object.freeze({
  audio: Object.freeze({
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48_000 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
  }),
  video: false,
});

function defaultGetUserMedia(constraints) {
  const mediaDevices = globalThis.navigator?.mediaDevices;
  return mediaDevices?.getUserMedia(constraints);
}

function defaultAudioContextFactory(options) {
  if (typeof globalThis.AudioContext !== "function") {
    throw new TypeError("AudioContext is not available for microphone capture");
  }
  return new globalThis.AudioContext(options);
}

function defaultWorkletNodeFactory(context, processorName, options) {
  if (typeof globalThis.AudioWorkletNode !== "function") {
    throw new TypeError("AudioWorkletNode is not available for microphone capture");
  }
  return new globalThis.AudioWorkletNode(context, processorName, options);
}

function defaultMediaSourceFactory(context, stream) {
  if (typeof context.createMediaStreamSource !== "function") {
    throw new TypeError("AudioContext cannot create a microphone source");
  }
  return context.createMediaStreamSource(stream);
}

function defaultGainFactory(context) {
  if (typeof context.createGain !== "function") {
    throw new TypeError("AudioContext cannot create a silent microphone sink");
  }
  return context.createGain();
}

function errorCode(error) {
  const name = String(error?.name || "");
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "no-device";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") return "denied";
  return name || "capture-unavailable";
}

function stopTracks(stream) {
  for (const track of stream?.getTracks?.() ?? []) {
    try { track.stop?.(); } catch { /* a torn-down host track is already unusable */ }
  }
}

/**
 * Own one lazy microphone session. `onPcmStart({ startCount })` is the only entry point that can
 * invoke getUserMedia. All other lifecycle methods are reactions to the one granted track.
 */
export class MicrophonePermissionController {
  constructor({
    enabled = false,
    ring = null,
    sampleRateHz = 48_000,
    getUserMedia = defaultGetUserMedia,
    audioContextFactory = defaultAudioContextFactory,
    workletUrl = new URL("./capture-worklet.js", import.meta.url).href,
    workletNodeFactory = defaultWorkletNodeFactory,
    mediaSourceFactory = defaultMediaSourceFactory,
    gainFactory = defaultGainFactory,
    notifyGuest = null,
    onStateChange = null,
  } = {}) {
    if (typeof getUserMedia !== "function") throw new TypeError("getUserMedia must be a function");
    if (typeof audioContextFactory !== "function") {
      throw new TypeError("audioContextFactory must be a function");
    }
    if (typeof workletNodeFactory !== "function") {
      throw new TypeError("workletNodeFactory must be a function");
    }
    if (typeof mediaSourceFactory !== "function") {
      throw new TypeError("mediaSourceFactory must be a function");
    }
    if (typeof gainFactory !== "function") throw new TypeError("gainFactory must be a function");
    if (notifyGuest !== null && typeof notifyGuest !== "function") {
      throw new TypeError("notifyGuest must be a function or null");
    }
    if (onStateChange !== null && typeof onStateChange !== "function") {
      throw new TypeError("onStateChange must be a function or null");
    }
    if (!Number.isInteger(Number(sampleRateHz)) || ![44_100, 48_000].includes(Number(sampleRateHz))) {
      throw new RangeError("microphone sample rate must be 44100 or 48000 Hz");
    }
    if (ring !== null && typeof ring !== "object") throw new TypeError("microphone ring is invalid");

    this.enabled = Boolean(enabled);
    this.ring = ring;
    this.sampleRateHz = Number(sampleRateHz);
    this._getUserMedia = getUserMedia;
    this._audioContextFactory = audioContextFactory;
    this._workletUrl = workletUrl;
    this._workletNodeFactory = workletNodeFactory;
    this._mediaSourceFactory = mediaSourceFactory;
    this._gainFactory = gainFactory;
    this._notifyGuest = notifyGuest;
    this._onStateChange = onStateChange;

    this._state = MICROPHONE_OFF;
    this._pending = false;
    this._startCount = 0;
    this._lastGuestStartCount = 0;
    this._getUserMediaCalls = 0;
    this._transitionCount = 0;
    this._lastError = null;
    this._requestPromise = null;
    this._sessionGeneration = 0;
    this._stream = null;
    this._track = null;
    this._trackListeners = [];
    this._context = null;
    this._source = null;
    this._node = null;
    this._gain = null;
    this._ringConsumer = ring?.consumer?.() ?? null;
    this._clearScratch = new Float32Array(256 * 2);
    this._notifyCount = 0;
    this._emit();
  }

  get state() {
    return this._state;
  }

  get pending() {
    return this._pending;
  }

  get stream() {
    return this._stream;
  }

  get track() {
    return this._track;
  }

  /** Snapshot used by the UI and deterministic browser harness. */
  snapshot() {
    return {
      enabled: this.enabled,
      state: this._state,
      pending: this._pending,
      startCount: this._startCount,
      getUserMediaCalls: this._getUserMediaCalls,
      listenerCount: this._trackListeners.length,
      streamActive: Boolean(this._stream),
      trackReadyState: this._track?.readyState ?? null,
      trackMuted: this._track?.muted === true,
      ringFillFrames: this.ring?.fillFrames ?? 0,
      ringDroppedFrames: this.ring?.droppedFrames ?? 0,
      notifyCount: this._notifyCount,
      transitionCount: this._transitionCount,
      lastError: this._lastError,
    };
  }

  /**
   * Observe one successful guest capture start. Duplicate observations of the same generation are
   * ignored, so a delayed worker message cannot create a second stream or listener set.
   */
  onPcmStart(info = {}) {
    if (!this.enabled || info?.enabled !== true) return Promise.resolve({ ok: false, state: this._state, reason: "disabled" });
    const startCount = Number(info.startCount);
    if (!Number.isSafeInteger(startCount) || startCount < 1) {
      return Promise.resolve({ ok: false, state: this._state, reason: "invalid-start" });
    }
    if (startCount <= this._lastGuestStartCount) {
      return this._requestPromise ?? Promise.resolve({ ok: this._state === MICROPHONE_LIVE, state: this._state, reason: "duplicate-start" });
    }
    this._lastGuestStartCount = startCount;
    this._startCount = startCount;
    if (this._requestPromise) return this._requestPromise;
    if (this._state === MICROPHONE_LIVE && this._stream && this._track?.readyState !== "ended") {
      return Promise.resolve({ ok: true, state: MICROPHONE_LIVE, reason: "already-live" });
    }
    if (!this.ring) {
      this._pending = false;
      this._lastError = "capture-ring-unavailable";
      this._setState(MICROPHONE_DENIED);
      this._notify("denied");
      return Promise.resolve({ ok: false, state: MICROPHONE_DENIED, reason: this._lastError });
    }

    this._pending = true;
    this._lastError = null;
    this._emit();
    const request = this._requestMedia(startCount, this._sessionGeneration);
    this._requestPromise = request;
    request.finally(() => {
      if (this._requestPromise === request) this._requestPromise = null;
    }).catch(() => { /* _requestMedia classifies all expected failures */ });
    return request;
  }

  /** Retry is intentionally a marker, not a permission entry point; the next guest PCM_START owns it. */
  retry() {
    return {
      ok: false,
      state: this._state,
      reason: "awaiting-guest-pcm-start",
      startCount: this._lastGuestStartCount,
    };
  }

  reset() {
    this._sessionGeneration += 1;
    this._teardown({ stopStream: true });
    this._drainRing();
    this._state = MICROPHONE_OFF;
    this._pending = false;
    this._startCount = 0;
    this._lastGuestStartCount = 0;
    this._lastError = null;
    this._requestPromise = null;
    this._emit();
  }

  close() {
    this.reset();
  }

  async _requestMedia(startCount, sessionGeneration) {
    let stream;
    try {
      this._getUserMediaCalls += 1;
      stream = await this._getUserMedia(MICROPHONE_CONSTRAINTS);
    } catch (error) {
      this._pending = false;
      this._lastError = errorCode(error);
      this._setState(MICROPHONE_DENIED);
      this._notify("denied");
      return { ok: false, state: MICROPHONE_DENIED, reason: this._lastError, startCount };
    }

    // A boot/reset can retire a pending browser permission prompt, but browsers do not expose a
    // portable abort for getUserMedia. Ignore a late grant and stop its tracks instead of letting a
    // stale response recreate listeners or a hidden AudioContext on the next guest session.
    if (sessionGeneration !== this._sessionGeneration) {
      stopTracks(stream);
      return { ok: false, state: MICROPHONE_OFF, reason: "cancelled", startCount };
    }

    const track = stream?.getAudioTracks?.().find((candidate) => candidate) ?? null;
    if (!track) {
      stopTracks(stream);
      this._pending = false;
      this._lastError = "no-device";
      this._setState(MICROPHONE_DENIED);
      this._notify("denied");
      return { ok: false, state: MICROPHONE_DENIED, reason: this._lastError, startCount };
    }

    try {
      await this._installGraph(stream, track, sessionGeneration);
    } catch (error) {
      stopTracks(stream);
      this._teardown({ stopStream: false });
      if (sessionGeneration !== this._sessionGeneration) {
        return { ok: false, state: MICROPHONE_OFF, reason: "cancelled", startCount };
      }
      this._pending = false;
      this._lastError = errorCode(error);
      this._setState(MICROPHONE_DENIED);
      this._notify("denied");
      return { ok: false, state: MICROPHONE_DENIED, reason: this._lastError, startCount };
    }
    if (sessionGeneration !== this._sessionGeneration) {
      stopTracks(stream);
      this._teardown({ stopStream: false });
      return { ok: false, state: MICROPHONE_OFF, reason: "cancelled", startCount };
    }
    this._pending = false;
    this._lastError = null;
    if (track.muted === true) {
      this._setState(MICROPHONE_REVOKED);
      this._notify("muted");
      return { ok: true, state: MICROPHONE_REVOKED, reason: "muted", startCount };
    }
    this._setState(MICROPHONE_LIVE);
    return { ok: true, state: MICROPHONE_LIVE, reason: "granted", startCount };
  }

  async _installGraph(stream, track, sessionGeneration) {
    this._teardown({ stopStream: true });
    const context = this._audioContextFactory({ sampleRate: this.sampleRateHz });
    this._context = context;
    let node = null;
    let source = null;
    let gain = null;
    try {
      if (!context?.audioWorklet?.addModule) throw new TypeError("capture AudioWorklet is unavailable");
      if (Number(context.sampleRate) !== this.sampleRateHz) {
        throw new RangeError("capture AudioContext sample rate does not match the guest");
      }
      await context.audioWorklet.addModule(this._workletUrl);
      if (sessionGeneration !== this._sessionGeneration) {
        throw new Error("capture session was reset");
      }
      node = this._workletNodeFactory(
        context,
        AUDIO_CAPTURE_WORKLET_PROCESSOR_NAME,
        {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          processorOptions: {
            captureBuffer: this.ring.sharedBuffer,
            sampleRateHz: this.sampleRateHz,
          },
        },
      );
      source = this._mediaSourceFactory(context, stream);
      gain = this._gainFactory(context);
      if (gain?.gain) gain.gain.value = 0;
      source.connect?.(node);
      node.connect?.(gain);
      gain.connect?.(context.destination);

      this._source = source;
      this._node = node;
      this._gain = gain;
      this._stream = stream;
      this._track = track;
      this._attachTrackListeners(track);
      // Capturing remains usable when autoplay policy keeps this private, zero-gain context
      // suspended. A rejected resume is expected and leaves the stream in live/silence fallback.
      try { await Promise.resolve(context.resume?.()); } catch { /* user gesture may be required */ }
    } catch (error) {
      try { source?.disconnect?.(); } catch {}
      try { node?.disconnect?.(); } catch {}
      try { gain?.disconnect?.(); } catch {}
      this._source = null;
      this._node = null;
      this._gain = null;
      this._stream = null;
      this._track = null;
      if (this._context === context) this._context = null;
      try { await Promise.resolve(context.close?.()); } catch {}
      throw error;
    }
  }

  _attachTrackListeners(track) {
    const listeners = [
      ["mute", () => this._trackMuted()],
      ["unmute", () => this._trackUnmuted()],
      ["ended", () => this._trackEnded()],
    ];
    for (const [type, listener] of listeners) {
      if (typeof track.addEventListener === "function") {
        track.addEventListener(type, listener);
        this._trackListeners.push([track, type, listener]);
      }
    }
  }

  _trackMuted() {
    this._drainRing();
    if (this._state !== MICROPHONE_REVOKED) {
      this._setState(MICROPHONE_REVOKED);
      this._notify("muted");
    }
  }

  _trackUnmuted() {
    if (this._stream && this._track?.readyState !== "ended") {
      this._lastError = null;
      this._setState(MICROPHONE_LIVE);
    }
  }

  _trackEnded() {
    this._drainRing();
    this._teardown({ stopStream: false });
    this._pending = false;
    this._lastError = "track-ended";
    this._setState(MICROPHONE_REVOKED);
    this._notify("revoked");
  }

  _teardown({ stopStream }) {
    for (const [track, type, listener] of this._trackListeners) {
      try { track.removeEventListener?.(type, listener); } catch { /* teardown is best effort */ }
    }
    this._trackListeners = [];
    try { this._source?.disconnect?.(); } catch {}
    try { this._node?.disconnect?.(); } catch {}
    try { this._gain?.disconnect?.(); } catch {}
    const stream = this._stream;
    this._source = null;
    this._node = null;
    this._gain = null;
    this._stream = null;
    this._track = null;
    const context = this._context;
    this._context = null;
    if (stopStream) stopTracks(stream);
    if (context?.close) void Promise.resolve(context.close()).catch(() => {});
  }

  _drainRing() {
    if (!this._ringConsumer) return;
    try {
      while (this._ringConsumer.readInto(this._clearScratch) > 0) {}
    } catch { /* a reset/teardown race should still leave the guest on silence */ }
  }

  _notify(event) {
    this._notifyCount += 1;
    try {
      const result = this._notifyGuest?.(event);
      if (result && typeof result.then === "function") result.catch(() => {});
    } catch { /* host lifecycle notification must never become an uncaught page exception */ }
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    this._transitionCount += 1;
    this._emit();
  }

  _emit() {
    try { this._onStateChange?.(this.snapshot()); } catch { /* diagnostics/UI cannot break capture */ }
  }
}

export function createMicrophonePermissionController(options) {
  return new MicrophonePermissionController(options);
}
