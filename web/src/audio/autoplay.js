// E5-T20d: browser autoplay unlock and the suspended-context discard policy.

import { CHANNELS } from "./ring.js";

export const AUTOPLAY_QUANTUM_FRAMES = 128;
export const AUTOPLAY_LOCKED = "locked";
export const AUTOPLAY_UNLOCKING = "unlocking";
export const AUTOPLAY_UNLOCKED = "unlocked";

const MAX_CLOCK_CREDIT_FRAMES = AUTOPLAY_QUANTUM_FRAMES * 4;

const BADGE_TEXT = Object.freeze({
  [AUTOPLAY_LOCKED]: "Audio muted until interaction — click or press a key to enable sound.",
  [AUTOPLAY_UNLOCKING]: "Enabling audio…",
  [AUTOPLAY_UNLOCKED]: "Audio enabled.",
});

function validSampleRate(sampleRateHz) {
  if (!Number.isInteger(sampleRateHz) || sampleRateHz < 1) {
    throw new RangeError("audio autoplay sample rate must be a positive integer");
  }
  return sampleRateHz;
}

function defaultNowMs() {
  const now = globalThis.performance?.now?.();
  return Number.isFinite(now) ? now : Date.now();
}

function defaultSchedule(callback, delayMs) {
  return setTimeout(callback, delayMs);
}

function defaultCancel(handle) {
  clearTimeout(handle);
}

function badgeText(state) {
  return BADGE_TEXT[state] ?? BADGE_TEXT[AUTOPLAY_LOCKED];
}

function renderBadge(badge, state) {
  if (!badge) return;
  badge.dataset.audioState = state;
  badge.setAttribute?.("role", "status");
  badge.setAttribute?.("aria-live", "polite");
  badge.textContent = badgeText(state);
  // A successful unlock clears the muted badge from the page. Locked, retryable, and in-flight
  // states remain visible so a suspended context is never mistaken for working audio.
  badge.hidden = state === AUTOPLAY_UNLOCKED;
}

/**
 * Own the one browser gesture → AudioContext.resume path.
 *
 * While the context is locked or a resume is in flight, `pump()` consumes at most one audio
 * quantum from the optional ring. The frame budget is derived from the negotiated sample rate;
 * a delayed timer contributes credit over later ticks instead of draining a whole backgrounding
 * gap in one call. A successful resume stops this reader before the AudioWorklet starts consuming.
 */
export class AudioAutoplayPolicy {
  constructor({
    context,
    ring = null,
    sampleRateHz = context?.sampleRate,
    badge = null,
    target = typeof document !== "undefined" ? document : null,
    nowMs = defaultNowMs,
    schedule = defaultSchedule,
    cancel = defaultCancel,
    quantumFrames = AUTOPLAY_QUANTUM_FRAMES,
  } = {}) {
    if (!context || typeof context.resume !== "function") {
      throw new TypeError("audio autoplay policy requires an AudioContext with resume()");
    }
    if (typeof nowMs !== "function") throw new TypeError("nowMs must be a function");
    if (typeof schedule !== "function") throw new TypeError("schedule must be a function");
    if (typeof cancel !== "function") throw new TypeError("cancel must be a function");
    if (!Number.isSafeInteger(quantumFrames) || quantumFrames < 1) {
      throw new RangeError("audio autoplay quantumFrames must be a positive integer");
    }
    if (ring !== null && typeof ring.consumer !== "function") {
      throw new TypeError("audio autoplay ring must expose consumer()");
    }

    this.context = context;
    this.ring = ring;
    this.sampleRateHz = validSampleRate(Number(sampleRateHz));
    this.badge = badge;
    this._target = target;
    this._nowMs = nowMs;
    this._schedule = schedule;
    this._cancel = cancel;
    this._quantumFrames = quantumFrames;
    this._quantumMs = (quantumFrames * 1_000) / this.sampleRateHz;
    this._consumer = ring?.consumer?.() ?? null;
    // Pre-unlock discard is deliberately allocation-free after construction. The same scratch
    // block is reused by every timer tick and is never handed to the AudioWorklet.
    this._discardScratch = new Float32Array(quantumFrames * CHANNELS);
    this._state = AUTOPLAY_LOCKED;
    this._started = false;
    this._disposed = false;
    this._attachedTarget = null;
    this._timer = null;
    this._timerActive = false;
    this._lastPumpMs = null;
    this._frameCredit = 0;
    this._discardedFrames = 0;
    this._resumeAttempts = 0;
    this._resumePromise = null;
    this._lastError = null;
    this._onGesture = () => { void this.unlock("gesture"); };
  }

  get state() {
    return this._state;
  }

  get isUnlocked() {
    return this._state === AUTOPLAY_UNLOCKED;
  }

  get resumeAttempts() {
    return this._resumeAttempts;
  }

  get discardedFrames() {
    return this._discardedFrames;
  }

  get lastError() {
    return this._lastError;
  }

  get hasGestureListeners() {
    return this._attachedTarget !== null;
  }

  /** Start the listeners and the bounded suspended-context clock pump. */
  start() {
    if (this._disposed) return this;
    if (this._started) return this;
    this._started = true;
    this.attach();
    this._lastPumpMs = this._nowMs();
    renderBadge(this.badge, this._state);
    this._schedulePump();
    return this;
  }

  /** Attach exactly one click and one keydown listener to the chosen DOM target. */
  attach(target = this._target) {
    if (this._disposed) return this;
    if (!target || typeof target.addEventListener !== "function") {
      throw new TypeError("audio autoplay policy requires an event target");
    }
    if (this._attachedTarget === target) return this;
    if (this._attachedTarget) this.detach();
    target.addEventListener("click", this._onGesture);
    target.addEventListener("keydown", this._onGesture);
    this._attachedTarget = target;
    return this;
  }

  detach() {
    if (!this._attachedTarget) return this;
    this._attachedTarget.removeEventListener?.("click", this._onGesture);
    this._attachedTarget.removeEventListener?.("keydown", this._onGesture);
    this._attachedTarget = null;
    return this;
  }

  /**
   * Consume the amount of PCM that the negotiated clock has made due since the last pump.
   * At most one quantum is read per call, including after a long timer/backgrounding gap.
   */
  pump(now = this._nowMs()) {
    if (this._disposed || this._state === AUTOPLAY_UNLOCKED) return 0;
    const currentMs = Number(now);
    if (!Number.isFinite(currentMs)) return 0;
    if (this._lastPumpMs === null) this._lastPumpMs = currentMs;
    const elapsedMs = Math.max(0, currentMs - this._lastPumpMs);
    this._lastPumpMs = currentMs;
    this._frameCredit = Math.min(
      MAX_CLOCK_CREDIT_FRAMES,
      this._frameCredit + (elapsedMs * this.sampleRateHz) / 1_000,
    );

    const dueFrames = Math.min(this._quantumFrames, Math.floor(this._frameCredit));
    if (dueFrames < 1) return 0;
    // Account for time, rather than for available payload. Silence is not carried forward as a
    // future read budget, and a resumed tab cannot turn an old timer gap into a burst drain.
    this._frameCredit -= dueFrames;
    if (!this._consumer) return 0;
    const read = this._consumer.readInto(this._discardScratch, dueFrames);
    this._discardedFrames += read;
    return read;
  }

  /**
   * Resume once per in-flight gesture sequence. Rejections resolve to `{ ok: false }` so a DOM
   * listener never creates an unhandled rejection; the visible badge stays actionable and the
   * pre-unlock pump remains active for a later gesture.
   */
  unlock(reason = "gesture") {
    if (this._disposed) return Promise.resolve({ ok: false, state: "disposed", reason });
    if (this._state === AUTOPLAY_UNLOCKED) {
      return Promise.resolve({ ok: true, state: AUTOPLAY_UNLOCKED, reason });
    }
    if (this._resumePromise) return this._resumePromise;

    this._resumeAttempts += 1;
    this._state = AUTOPLAY_UNLOCKING;
    this._lastError = null;
    renderBadge(this.badge, this._state);
    let resumeResult;
    try {
      resumeResult = Promise.resolve(this.context.resume());
    } catch (error) {
      resumeResult = Promise.reject(error);
    }
    this._resumePromise = resumeResult.then(
      () => {
        this._resumePromise = null;
        this._state = AUTOPLAY_UNLOCKED;
        this._frameCredit = 0;
        this._cancelPump();
        renderBadge(this.badge, this._state);
        return { ok: true, state: AUTOPLAY_UNLOCKED, reason };
      },
      (error) => {
        this._resumePromise = null;
        this._state = AUTOPLAY_LOCKED;
        this._lastError = error;
        renderBadge(this.badge, this._state);
        this._schedulePump();
        return { ok: false, state: AUTOPLAY_LOCKED, reason, error };
      },
    );
    return this._resumePromise;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._cancelPump();
    this.detach();
  }

  _schedulePump() {
    if (!this._started || !this._consumer || this._disposed || this._state === AUTOPLAY_UNLOCKED || this._timerActive) return;
    this._timerActive = true;
    this._timer = this._schedule(() => {
      this._timerActive = false;
      this._timer = null;
      if (this._state !== AUTOPLAY_UNLOCKED && !this._disposed) {
        this.pump();
        this._schedulePump();
      }
    }, this._quantumMs);
  }

  _cancelPump() {
    if (!this._timerActive) return;
    this._cancel(this._timer);
    this._timerActive = false;
    this._timer = null;
  }
}

export function createAutoplayPolicy(options) {
  return new AudioAutoplayPolicy(options);
}

export { BADGE_TEXT };
