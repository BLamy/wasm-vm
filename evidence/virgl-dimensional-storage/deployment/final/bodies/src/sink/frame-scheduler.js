// E5-T09c: bounded, latest-wins browser presentation scheduling.

const NO_FRAME = Symbol("no pending frame");

const noop = () => {};

function browserRequestFrame() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    throw new Error("FrameScheduler requires requestAnimationFrame");
  }
  return globalThis.requestAnimationFrame.bind(globalThis);
}

function browserCancelFrame() {
  if (typeof globalThis.cancelAnimationFrame !== "function") {
    throw new Error("FrameScheduler requires cancelAnimationFrame");
  }
  return globalThis.cancelAnimationFrame.bind(globalThis);
}

/**
 * Retain at most one frame plan and drain it once per display callback.
 *
 * `present` is synchronous and returns false when the plan did not reach its backend. Any other
 * return value counts as one backend invocation. A new plan that arrives while `present` runs is
 * an overrun; it is left pending for the next callback instead of creating a second rAF chain.
 */
export class FrameScheduler {
  constructor({ present, requestFrame, cancelFrame, onError } = {}) {
    if (typeof present !== "function") throw new TypeError("FrameScheduler requires a present function");
    this._present = present;
    this._requestFrame = requestFrame ?? browserRequestFrame();
    this._cancelFrame = cancelFrame ?? browserCancelFrame();
    if (typeof this._requestFrame !== "function") {
      throw new TypeError("FrameScheduler requestFrame must be a function");
    }
    if (typeof this._cancelFrame !== "function") {
      throw new TypeError("FrameScheduler cancelFrame must be a function");
    }
    this._onError = onError ?? noop;
    if (typeof this._onError !== "function") throw new TypeError("FrameScheduler onError must be a function");

    this._pending = NO_FRAME;
    this._frameToken = null;
    this._running = false;
    this._paused = false;
    this._disposed = false;
    this._enqueuedDuringPresent = false;
    this._enqueued = 0;
    this._coalesced = 0;
    this._presented = 0;
    this._skipped = 0;
    this._overruns = 0;
    this._maxPending = 0;
  }

  get pendingCount() {
    return this._pending === NO_FRAME ? 0 : 1;
  }

  get scheduled() {
    return this._frameToken !== null;
  }

  _reportError(error, frame) {
    try {
      this._onError(error, frame);
    } catch {
      // Error reporting must not tear down the one-chain invariant.
    }
  }

  _invalidateFrame() {
    const token = this._frameToken;
    this._frameToken = null;
    if (!token) return;
    token.active = false;
    if (token.id !== null) this._cancelFrame(token.id);
  }

  _schedule() {
    if (this._disposed || this._paused || this._running || this.pendingCount === 0 || this.scheduled) {
      return false;
    }
    const token = { active: true, id: null };
    this._frameToken = token;
    try {
      token.id = this._requestFrame((timestamp) => this._tick(token, timestamp));
    } catch (error) {
      if (this._frameToken === token) this._frameToken = null;
      token.active = false;
      this._reportError(error, this._pending === NO_FRAME ? null : this._pending);
      return false;
    }
    // A deliberately synchronous fake callback, or a reentrant pause/dispose, may invalidate the
    // token before requestFrame returns. Do not leave the returned handle as a phantom chain.
    if (this._frameToken !== token || !token.active) {
      if (token.id !== null) this._cancelFrame(token.id);
      return false;
    }
    return true;
  }

  _tick(token, _timestamp) {
    if (this._frameToken !== token || !token.active) return;
    this._frameToken = null;
    token.active = false;
    if (this._disposed || this._paused || this.pendingCount === 0) return;

    const frame = this._pending;
    this._pending = NO_FRAME;
    this._running = true;
    this._enqueuedDuringPresent = false;
    try {
      if (this._present(frame) === false) {
        this._skipped += 1;
      } else {
        this._presented += 1;
      }
    } catch (error) {
      this._skipped += 1;
      this._reportError(error, frame);
    } finally {
      this._running = false;
      if (this._enqueuedDuringPresent) this._overruns += 1;
      if (!this._disposed && !this._paused && this.pendingCount !== 0) this._schedule();
    }
  }

  /** Enqueue a plan; replacing an older pending plan is the only coalescing operation. */
  enqueue(frame) {
    if (this._disposed) throw new Error("FrameScheduler is disposed");
    this._enqueued += 1;
    if (this._pending !== NO_FRAME) {
      this._coalesced += 1;
      this._skipped += 1;
    }
    this._pending = frame;
    this._maxPending = Math.max(this._maxPending, 1);
    if (this._running) this._enqueuedDuringPresent = true;
    else this._schedule();
    return true;
  }

  /** Drop a pending plan when a resize or another owner invalidates its dimensions. */
  discardPending() {
    if (this._pending === NO_FRAME) return false;
    this._pending = NO_FRAME;
    this._skipped += 1;
    return true;
  }

  /** Pause draining while preserving the newest pending plan. */
  pause() {
    if (this._disposed || this._paused) return false;
    this._paused = true;
    this._invalidateFrame();
    return true;
  }

  /** Resume draining with exactly one callback if a plan is pending. */
  resume() {
    if (this._disposed || !this._paused) return false;
    this._paused = false;
    this._schedule();
    return true;
  }

  /** Cancel future callbacks and drop the one pending plan. Stale callbacks become no-ops. */
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._invalidateFrame();
    this.discardPending();
  }

  /** Return only scalar, JSON-safe scheduler state. */
  snapshot() {
    return {
      enqueued: this._enqueued,
      coalesced: this._coalesced,
      presented: this._presented,
      skipped: this._skipped,
      overruns: this._overruns,
      pending: this.pendingCount,
      maxPending: this._maxPending,
      paused: this._paused,
      disposed: this._disposed,
      scheduled: this.scheduled,
    };
  }
}
