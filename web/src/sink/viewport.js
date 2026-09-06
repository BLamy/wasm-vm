// E5-T22b: viewport policy is independent of whether a guest compositor adopted a mode.
export const DISPLAY_MIN_WIDTH = 320;
export const DISPLAY_MIN_HEIGHT = 240;
export const DISPLAY_MAX_DIMENSION = 4095;
export const DISPLAY_DEBOUNCE_MS = 250;

export function checkedDisplaySize(width, height) {
  for (const value of [width, height]) {
    if (!Number.isInteger(value) || value < 1 || value > DISPLAY_MAX_DIMENSION) {
      throw new RangeError("display dimensions must be integers in 1..4095");
    }
  }
  return { width, height };
}

export function viewportPixelMode(cssWidth, cssHeight, dpr) {
  if (![cssWidth, cssHeight, dpr].every(Number.isFinite) || cssWidth < 0 || cssHeight < 0 || dpr <= 0) {
    throw new RangeError("viewport dimensions and DPR must be finite and non-negative (DPR > 0)");
  }
  // Hidden/collapsed panes have no current viewport and must not hotplug a minimum mode.
  if (cssWidth === 0 || cssHeight === 0) return null;
  const width = Math.min(DISPLAY_MAX_DIMENSION, Math.max(DISPLAY_MIN_WIDTH, Math.round(cssWidth * dpr)));
  const height = Math.min(DISPLAY_MAX_DIMENSION, Math.max(DISPLAY_MIN_HEIGHT, Math.round(cssHeight * dpr)));
  if (!Number.isFinite(width / dpr) || !Number.isFinite(height / dpr)) throw new RangeError("DPR is too small");
  return { width, height, dpr, cssWidth: width / dpr, cssHeight: height / dpr };
}

/** Native-pixel top-left fit. Input has already passed the full-resource frame validator. */
export function fitFrameToViewport(frame, width, height) {
  checkedDisplaySize(width, height);
  if (frame.resourceWidth === width && frame.resourceHeight === height) return frame;
  const pixels = new Uint32Array(width * height);
  pixels.fill(0xff000000);
  const columns = Math.min(width, frame.resourceWidth);
  const rows = Math.min(height, frame.resourceHeight);
  for (let row = 0; row < rows; row++) {
    const start = row * frame.resourceWidth;
    pixels.set(frame.pixels.subarray(start, start + columns), row * width);
  }
  return { ...frame, resourceWidth: width, resourceHeight: height,
    rect: { x: 0, y: 0, width, height }, pixels };
}

/** Map pointer coordinates to the old guest resource during a clipped/letterboxed transition. */
export function nativeContentRect(containerRect, resourceWidth, resourceHeight, dpr) {
  if (![resourceWidth, resourceHeight, dpr].every(Number.isFinite) ||
      resourceWidth <= 0 || resourceHeight <= 0 || dpr <= 0) return null;
  return { left: containerRect.left, top: containerRect.top,
    width: resourceWidth / dpr, height: resourceHeight / dpr };
}

export class DisplayViewportController {
  constructor({ container, presentation, controller = null, onState = () => {},
    ResizeObserverClass = globalThis.ResizeObserver,
    matchMedia = globalThis.matchMedia?.bind(globalThis),
    getDpr = () => globalThis.devicePixelRatio || 1,
    setTimer = globalThis.setTimeout.bind(globalThis), clearTimer = globalThis.clearTimeout.bind(globalThis),
    testDebounceMs = undefined,
  } = {}) {
    if (!container?.getBoundingClientRect || !presentation?.setViewport ||
        typeof ResizeObserverClass !== "function" || typeof matchMedia !== "function") {
      throw new TypeError("viewport requires a container, presentation, ResizeObserver and matchMedia");
    }
    if (testDebounceMs !== undefined && testDebounceMs !== 0) throw new RangeError("only the explicit zero-delay test hook is supported");
    this.container = container;
    this.presentation = presentation;
    this._controller = controller;
    this._onState = onState;
    this._getDpr = getDpr;
    this._matchMedia = matchMedia;
    this._setTimer = setTimer;
    this._clearTimer = clearTimer;
    this._delay = testDebounceMs ?? DISPLAY_DEBOUNCE_MS;
    this._timer = null;
    this._dprTimer = null;
    this._media = null;
    this._disposed = false;
    this._sequence = 0;
    this._desired = null;
    this._due = false;
    this._inFlight = null;
    this._requested = null;
    this._accepted = null;
    this._requests = 0;
    this._error = null;
    this._onDpr = () => { if (!this._disposed) { this._watchDpr(); this.measure(); } };
    this._observer = new ResizeObserverClass(() => this.measure());
    try {
      this._watchDpr();
      this._observer.observe(container);
      this.measure();
      this._pollDpr();
    } catch (error) {
      this._observer.disconnect();
      this._media?.removeEventListener("change", this._onDpr);
      throw error;
    }
  }

  _watchDpr() {
    this._media?.removeEventListener("change", this._onDpr);
    this._watchedDpr = this._getDpr();
    this._media = this._matchMedia("(resolution: " + this._watchedDpr + "dppx)");
    this._media.addEventListener("change", this._onDpr);
  }

  _pollDpr() {
    if (this._disposed) return;
    // A scale-factor change can update devicePixelRatio without a resolution change event
    // (observed with Chrome device emulation). One low-frequency scalar check covers that path.
    this._dprTimer = this._setTimer(() => {
      this._dprTimer = null;
      if (this._disposed) return;
      if (this._getDpr() !== this._watchedDpr) this._onDpr();
      this._pollDpr();
    }, 250);
  }

  _notify() {
    try { this._onState(this.snapshot()); } catch { /* diagnostics do not control device state */ }
  }

  measure() {
    if (this._disposed) return null;
    const rect = this.container.getBoundingClientRect();
    const next = viewportPixelMode(rect.width, rect.height, this._getDpr());
    if (!next) {
      this._clearPending();
      this._desired = null;
      this._notify();
      return null;
    }
    if (this._desired && ["width", "height", "dpr"].every((key) => this._desired[key] === next[key])) return next;
    this._desired = { ...next, sequence: ++this._sequence };
    this._error = null;
    this.presentation.setViewport(next.width, next.height);
    this.applyCanvasStyle();
    this._clearPending();
    this._timer = this._setTimer(() => {
      this._timer = null;
      this._due = true;
      void this._drain();
    }, this._delay);
    this._notify();
    return next;
  }

  // A WebGL context replacement copies styles, but callers may also reapply them after a frame.
  applyCanvasStyle() {
    if (!this._desired || this._disposed) return;
    const style = this.presentation.canvas.style;
    if (style) {
      style.width = this._desired.cssWidth + "px";
      style.height = this._desired.cssHeight + "px";
      style.maxWidth = "none";
      style.maxHeight = "none";
    }
  }

  _clearPending() {
    if (this._timer !== null) this._clearTimer(this._timer);
    this._timer = null;
    this._due = false;
  }

  setController(controller) {
    if (this._disposed) return;
    this._clearPending();
    this._controller = controller;
    this._inFlight = null;
    this._requested = null;
    this._accepted = null;
    this._error = null;
    // Initial mode is sent before the caller resumes a paused/new guest. Later resizes debounce.
    this._due = this._desired !== null;
    return this._drain();
  }

  async _drain() {
    if (this._disposed || !this._due || this._inFlight || !this._controller || !this._desired) return;
    const mode = this._desired;
    const controller = this._controller;
    const token = {}; // Identity fences completions from replaced/disposed controllers.
    this._due = false;
    this._inFlight = token;
    this._requested = mode;
    this._requests++;
    this._notify();
    try {
      const accepted = await controller.setDisplay(mode.width, mode.height);
      if (this._inFlight === token && this._desired?.sequence === mode.sequence) {
        this._accepted = accepted ? mode : null;
        this._error = accepted ? null : "GPU unavailable";
      }
    } catch (error) {
      if (this._inFlight === token && this._desired?.sequence === mode.sequence) this._error = String(error);
    } finally {
      if (this._inFlight === token) {
        this._inFlight = null;
        this._notify();
        void this._drain();
      }
    }
  }

  pointerRect() {
    const latest = this.presentation.snapshot().latest;
    const mode = this._desired;
    return mode && nativeContentRect(this.container.getBoundingClientRect(),
      latest?.resourceWidth ?? mode.width, latest?.resourceHeight ?? mode.height, mode.dpr);
  }

  snapshot() {
    return { disposed: this._disposed, desired: this._desired && { ...this._desired },
      requested: this._requested && { ...this._requested }, accepted: this._accepted && { ...this._accepted },
      requests: this._requests, inFlight: this._inFlight !== null, timerPending: this._timer !== null,
      dprWatcherPending: this._dprTimer !== null,
      debounceMs: this._delay, error: this._error };
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._clearPending();
    if (this._dprTimer !== null) this._clearTimer(this._dprTimer);
    this._dprTimer = null;
    this._observer.disconnect();
    this._media.removeEventListener("change", this._onDpr);
    this._controller = null;
    this._inFlight = null;
  }
}
