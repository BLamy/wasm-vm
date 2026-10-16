// E5-T09d: switch the bounded presentation drain between rAF and a hidden-tab timer.

import { FrameScheduler } from "./frame-scheduler.js";

const DEFAULT_TIMER_MS = 250;

function checkedTimerMs(value) {
  const milliseconds = Number(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > DEFAULT_TIMER_MS) {
    throw new RangeError(`hidden presentation timer must be 1..${DEFAULT_TIMER_MS} ms`);
  }
  return milliseconds;
}

function boundGlobal(name) {
  const callback = globalThis[name];
  if (typeof callback !== "function") throw new Error(`VisibilityFrameScheduler requires ${name}`);
  return callback.bind(globalThis);
}

function defaultNow() {
  return typeof globalThis.performance?.now === "function"
    ? globalThis.performance.now()
    : Date.now();
}

/**
 * Own visibility transitions around the generic one-slot FrameScheduler.
 *
 * A scheduled handle is tagged so the matching cancellation primitive is used. Visibility changes
 * pause the inner scheduler, invalidating delayed callbacks, then immediately resume it against
 * the current mode. The inner scheduler still owns latest-wins, counter, and teardown semantics.
 */
export class VisibilityFrameScheduler {
  constructor({
    present,
    visibilityTarget = globalThis.document,
    isHidden,
    requestAnimationFrame,
    cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    now = defaultNow,
    timerMs = DEFAULT_TIMER_MS,
    onError,
  } = {}) {
    if (typeof present !== "function") {
      throw new TypeError("VisibilityFrameScheduler requires a present function");
    }
    if (typeof isHidden !== "function" && visibilityTarget === null) {
      throw new TypeError("VisibilityFrameScheduler requires a visibility target or isHidden function");
    }
    if (typeof now !== "function") throw new TypeError("VisibilityFrameScheduler now must be a function");
    this._visibilityTarget = visibilityTarget;
    this._isHidden = isHidden ?? (() => Boolean(this._visibilityTarget?.hidden));
    if (typeof this._isHidden !== "function") throw new TypeError("VisibilityFrameScheduler isHidden must be a function");
    this._requestAnimationFrame = requestAnimationFrame ?? boundGlobal("requestAnimationFrame");
    this._cancelAnimationFrame = cancelAnimationFrame ?? boundGlobal("cancelAnimationFrame");
    this._setTimeout = setTimeout ?? boundGlobal("setTimeout");
    this._clearTimeout = clearTimeout ?? boundGlobal("clearTimeout");
    if (typeof this._requestAnimationFrame !== "function") throw new TypeError("requestAnimationFrame must be a function");
    if (typeof this._cancelAnimationFrame !== "function") throw new TypeError("cancelAnimationFrame must be a function");
    if (typeof this._setTimeout !== "function") throw new TypeError("setTimeout must be a function");
    if (typeof this._clearTimeout !== "function") throw new TypeError("clearTimeout must be a function");
    this._now = now;
    this._timerMs = checkedTimerMs(timerMs);
    this._manualPaused = false;
    this._disposed = false;

    this._scheduler = new FrameScheduler({
      present,
      requestFrame: (callback) => this._requestFrame(callback),
      cancelFrame: (handle) => this._cancelFrame(handle),
      onError,
    });
    this._onVisibilityChange = () => this.visibilityChanged();
    if (this._visibilityTarget
      && typeof this._visibilityTarget.addEventListener === "function"
      && typeof this._visibilityTarget.removeEventListener === "function") {
      this._visibilityTarget.addEventListener("visibilitychange", this._onVisibilityChange, false);
    }
  }

  _requestFrame(callback) {
    if (this._isHidden()) {
      return {
        mode: "timer",
        id: this._setTimeout(() => callback(this._now()), this._timerMs),
      };
    }
    return { mode: "raf", id: this._requestAnimationFrame(callback) };
  }

  _cancelFrame(handle) {
    if (!handle || typeof handle !== "object") return;
    if (handle.mode === "timer") this._clearTimeout(handle.id);
    else if (handle.mode === "raf") this._cancelAnimationFrame(handle.id);
  }

  get pendingCount() {
    return this._scheduler.pendingCount;
  }

  get scheduled() {
    return this._scheduler.scheduled;
  }

  enqueue(frame) {
    return this._scheduler.enqueue(frame);
  }

  discardPending() {
    return this._scheduler.discardPending();
  }

  pause() {
    if (this._disposed || this._manualPaused) return false;
    this._manualPaused = true;
    return this._scheduler.pause();
  }

  resume() {
    if (this._disposed || !this._manualPaused) return false;
    this._manualPaused = false;
    return this._scheduler.resume();
  }

  /** Reschedule one pending plan in the current visibility mode. */
  visibilityChanged() {
    if (this._disposed || this._manualPaused) return false;
    const hadWork = this.pendingCount !== 0 || this.scheduled;
    this._scheduler.pause();
    this._scheduler.resume();
    return hadWork;
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this._visibilityTarget && typeof this._visibilityTarget.removeEventListener === "function") {
      this._visibilityTarget.removeEventListener("visibilitychange", this._onVisibilityChange, false);
    }
    this._scheduler.dispose();
  }

  snapshot() {
    return {
      ...this._scheduler.snapshot(),
      hidden: Boolean(this._isHidden()),
      mode: this._isHidden() ? "timer" : "raf",
      timerMs: this._timerMs,
    };
  }
}
