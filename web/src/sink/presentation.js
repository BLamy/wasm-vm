// E5-T06d: runtime presentation selection and context-loss recovery.

import { Canvas2DBackend } from "./canvas2d.js";
import { WebGL2Backend } from "./webgl.js";
import { FrameScheduler } from "./frame-scheduler.js";
import { VisibilityFrameScheduler } from "./visibility-scheduler.js";
import { checkedDisplaySize, fitFrameToViewport } from "./viewport.js";

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const BACKEND_NAMES = Object.freeze(["canvas2d", "webgl2"]);
const FORMAT_B8G8R8X8_UNORM = 2;

function checkedDimension(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function checkedFrame(frame) {
  if (frame === null || typeof frame !== "object") {
    throw new TypeError("presentation frame must be an object");
  }
  const width = checkedDimension(Number(frame.resourceWidth), "resource width");
  const height = checkedDimension(Number(frame.resourceHeight), "resource height");
  const format = Number(frame.format ?? 1);
  if (!Number.isSafeInteger(format) || format < 1) {
    throw new RangeError("presentation frame format must be a positive safe integer");
  }
  const rect = frame.rect;
  if (rect === null || typeof rect !== "object") {
    throw new TypeError("presentation frame rect is missing");
  }
  const checkedRect = Object.freeze({
    x: Number(rect.x),
    y: Number(rect.y),
    width: Number(rect.width),
    height: Number(rect.height),
  });
  for (const [name, value] of Object.entries(checkedRect)) {
    if (!Number.isSafeInteger(value) || value < 0 || (name === "width" || name === "height") && value < 1) {
      throw new RangeError(`presentation rect ${name} is invalid`);
    }
  }
  if (checkedRect.x + checkedRect.width > width || checkedRect.y + checkedRect.height > height) {
    throw new RangeError("presentation rect is outside the resource");
  }
  const expected = width * height;
  if (!Number.isSafeInteger(expected)) throw new RangeError("presentation frame is too large");
  if (frame.pixels === null || frame.pixels === undefined || frame.pixels.length !== expected) {
    throw new RangeError(`presentation pixel count does not match ${width}x${height}`);
  }
  // Rust's callback supplies a temporary wasm-memory view. Copy it before any backend call so the
  // latest frame remains valid across a WebGL context loss and later guest memory growth.
  const pixels = frame.pixels instanceof Uint32Array
    ? new Uint32Array(frame.pixels)
    : Uint32Array.from(frame.pixels);
  // Linux's B8G8R8X8_UNORM fbcon surface uses the high byte as padding. The guest is allowed to
  // leave that X byte zero, but browser ImageData treats it as alpha, so normalize it to opaque at
  // the presentation boundary before Canvas2D or WebGL2 consumes the copied frame.
  if (format === FORMAT_B8G8R8X8_UNORM) {
    for (let index = 0; index < pixels.length; index += 1) pixels[index] |= 0xff000000;
  }
  return Object.freeze({
    scanout: frame.scanout == null ? null : Number(frame.scanout),
    format,
    rect: checkedRect,
    resourceWidth: width,
    resourceHeight: height,
    pixels,
  });
}

function disposeQuietly(backend, errors) {
  if (!backend || typeof backend.dispose !== "function") return;
  try {
    backend.dispose();
  } catch (error) {
    errors.push(String(error?.message || error));
  }
}

/**
 * Own the selected browser presentation backend and the one-frame recovery policy.
 *
 * Canvas2D is the measured default from E5-T06c. WebGL2 is attempted when explicitly requested or
 * when Canvas2D is unavailable. A real WebGL canvas cannot change context type after creation, so
 * context-loss recovery replaces that element with a same-attribute canvas before activating the
 * Canvas2D backend. The controller owns that replacement and its event listeners.
 */
export class PresentationController {
  constructor(canvas, options = {}) {
    if (canvas === null || typeof canvas !== "object" || typeof canvas.getContext !== "function") {
      throw new TypeError("PresentationController requires a canvas-like object");
    }
    const defaultBackend = options.defaultBackend ?? "canvas2d";
    if (!BACKEND_NAMES.includes(defaultBackend)) {
      throw new RangeError(`unknown presentation backend: ${defaultBackend}`);
    }
    this.canvas = canvas;
    this.defaultBackend = defaultBackend;
    this._factories = {
      canvas2d: options.backendFactories?.canvas2d
        ?? ((target) => new Canvas2DBackend(target, options.canvas2dOptions)),
      webgl2: options.backendFactories?.webgl2
        ?? ((target) => new WebGL2Backend(target, options.webgl2Options)),
    };
    this._width = checkedDimension(
      Number(options.width ?? (canvas.width > 0 ? canvas.width : DEFAULT_WIDTH)),
      "canvas width",
    );
    this._height = checkedDimension(
      Number(options.height ?? (canvas.height > 0 ? canvas.height : DEFAULT_HEIGHT)),
      "canvas height",
    );
    this._backend = null;
    this._backendName = null;
    this._latest = null;
    this._paintedResource = null;
    this._fixedViewport = false;
    this._disposed = false;
    this._contextLost = false;
    this._lossDropCounted = false;
    this._listenerCanvas = null;
    this._errors = [];
    this._framesReceived = 0;
    this._successfulPresents = 0;
    this._replayedFrames = 0;
    this._droppedFrames = 0;
    this._fallbacks = 0;
    this._contextLosses = 0;
    this._contextRestores = 0;
    this._uploadedBytes = 0;
    this._drawnPresents = 0;
    this._drawnBytes = 0;
    this._presentationSequence = 0;
    this._onPresent = typeof options.onPresent === "function" ? options.onPresent : null;
    this._now = typeof options.now === "function" ? options.now : null;
    this._guestInstructions = typeof options.guestInstructions === "function" ? options.guestInstructions : null;
    this._lastGuestInstructions = null;
    this._statsOwner = options.vm ?? null;
    if (this._statsOwner !== null && (typeof this._statsOwner !== "object" || Array.isArray(this._statsOwner))) {
      throw new TypeError("PresentationController vm must be an object");
    }
    const schedulerOptions = {
      present: (frame) => this._deliver(frame),
      requestFrame: options.requestFrame,
      cancelFrame: options.cancelFrame,
      onError: options.onSchedulerError
        ?? ((error) => this._errors.push(`scheduled present: ${String(error?.message || error)}`)),
    };
    this._scheduler = options.scheduleFrames
      ? options.visibilityTarget
        ? new VisibilityFrameScheduler({
          present: schedulerOptions.present,
          visibilityTarget: options.visibilityTarget,
          isHidden: options.isHidden,
          requestAnimationFrame: options.requestAnimationFrame ?? options.requestFrame,
          cancelAnimationFrame: options.cancelAnimationFrame ?? options.cancelFrame,
          setTimeout: options.setTimeout,
          clearTimeout: options.clearTimeout,
          now: options.now,
          timerMs: options.timerMs,
          onError: schedulerOptions.onError,
        })
        : new FrameScheduler(schedulerOptions)
      : null;
    this._installStatsSurface();
    this._attachCanvasListeners();
    this._ensureCanvasSize();
    this._activateWithFallback(defaultBackend);
  }

  _ensureCanvasSize() {
    if (this.canvas.width !== this._width) this.canvas.width = this._width;
    if (this.canvas.height !== this._height) this.canvas.height = this._height;
  }

  _attachCanvasListeners() {
    this._detachCanvasListeners();
    if (typeof this.canvas.addEventListener !== "function") return;
    this._onContextLost = (event) => this._handleContextLost(event);
    this._onContextRestored = (event) => this._handleContextRestored(event);
    this.canvas.addEventListener("webglcontextlost", this._onContextLost, false);
    this.canvas.addEventListener("webglcontextrestored", this._onContextRestored, false);
    this._listenerCanvas = this.canvas;
  }

  _detachCanvasListeners() {
    if (!this._listenerCanvas || typeof this._listenerCanvas.removeEventListener !== "function") return;
    this._listenerCanvas.removeEventListener("webglcontextlost", this._onContextLost, false);
    this._listenerCanvas.removeEventListener("webglcontextrestored", this._onContextRestored, false);
    this._listenerCanvas = null;
  }

  _activate(name) {
    const factory = this._factories[name];
    if (typeof factory !== "function") throw new TypeError(`presentation factory ${name} is unavailable`);
    const candidate = factory(this.canvas);
    if (candidate === null || typeof candidate !== "object" ||
        typeof candidate.present !== "function" || typeof candidate.resize !== "function") {
      throw new TypeError(`presentation factory ${name} returned an invalid backend`);
    }
    if (candidate.width !== this._width || candidate.height !== this._height) {
      candidate.resize(this._width, this._height);
    }
    const prior = this._backend;
    this._backend = candidate;
    this._backendName = name;
    this._paintedResource = null;
    disposeQuietly(prior, this._errors);
  }

  _activateWithFallback(preferred) {
    const order = [preferred, ...BACKEND_NAMES.filter((name) => name !== preferred)];
    let failure = null;
    for (const name of order) {
      try {
        this._activate(name);
        if (name !== preferred) this._fallbacks += 1;
        return name;
      } catch (error) {
        failure = error;
        this._errors.push(`${name}: ${String(error?.message || error)}`);
      }
    }
    throw new Error(`no presentation backend is available: ${String(failure?.message || failure)}`);
  }

  _replaceCanvasForFallback() {
    const oldCanvas = this.canvas;
    const parent = oldCanvas.parentNode;
    if (!parent || typeof oldCanvas.cloneNode !== "function" || typeof parent.replaceChild !== "function") {
      // Dependency-injected test canvases may support both context types on one object. Real DOM
      // canvases take the replacement path above; retaining this path keeps the controller testable.
      return false;
    }
    const replacement = oldCanvas.cloneNode(false);
    replacement.width = this._width;
    replacement.height = this._height;
    parent.replaceChild(replacement, oldCanvas);
    this._detachCanvasListeners();
    this.canvas = replacement;
    this._attachCanvasListeners();
    return true;
  }

  _fallbackToCanvas() {
    this._disposeBackend();
    const replaced = this._replaceCanvasForFallback();
    this._activate("canvas2d");
    this._fallbacks += 1;
    this._contextLost = false;
    this._lossDropCounted = false;
    if (this._latest) {
      // A replacement canvas starts transparent. If the lost WebGL frame was a partial update,
      // replay the retained full-resource source across the whole new surface so unchanged pixels
      // are not lost during the backend transition.
      const replay = replaced
        ? { ...this._latest, rect: { x: 0, y: 0,
          width: this._latest.resourceWidth, height: this._latest.resourceHeight } }
        : this._latest;
      this._deliver(replay, true);
    }
  }

  _guestInstructionAttribution() {
    if (!this._guestInstructions) return { total: null, delta: null };
    let raw;
    try {
      raw = this._guestInstructions();
    } catch (error) {
      this._errors.push(`guest instruction telemetry: ${String(error?.message || error)}`);
      return { total: null, delta: null };
    }
    const value = raw !== null && typeof raw === "object"
      ? raw.retiredInstructions ?? raw.guestInstructions
      : raw;
    const total = Number(value);
    if (!Number.isSafeInteger(total) || total < 0) return { total: null, delta: null };
    const delta = this._lastGuestInstructions === null
      ? total
      : total >= this._lastGuestInstructions ? total - this._lastGuestInstructions : null;
    this._lastGuestInstructions = total;
    return { total, delta };
  }

  _disposeBackend() {
    const backend = this._backend;
    this._backend = null;
    this._backendName = null;
    disposeQuietly(backend, this._errors);
  }

  _handleContextLost(event) {
    if (this._disposed || this._backendName !== "webgl2") return;
    event?.preventDefault?.();
    this._contextLosses += 1;
    this._contextLost = true;
    this._lossDropCounted = false;
    try {
      this._fallbackToCanvas();
    } catch (error) {
      this._errors.push(`context-loss recovery: ${String(error?.message || error)}`);
    }
  }

  _handleContextRestored(_event) {
    if (this._disposed) return;
    this._contextRestores += 1;
    // A recovered WebGL context is deliberately not reselected: the new Canvas2D element is the
    // stable fallback surface, and replaying the latest frame there avoids a second transition.
    if (this._backendName === "canvas2d") this._contextLost = false;
  }

  _deliver(frame, replay = false) {
    if (!this._backend || this._contextLost) {
      if (!this._lossDropCounted) {
        this._droppedFrames += 1;
        this._lossDropCounted = true;
      }
      return false;
    }
    try {
      // Decide at paint time, not receipt time: the scheduler can replace any pending
      // full repaint with a newer partial frame before its animation callback runs.
      // Until a resource size has actually reached this backend, replay its full copy.
      const repaint = this._fixedViewport && (!this._paintedResource ||
        this._paintedResource.width !== frame.resourceWidth ||
        this._paintedResource.height !== frame.resourceHeight)
        ? { ...frame, rect: { x: 0, y: 0, width: frame.resourceWidth, height: frame.resourceHeight } }
        : frame;
      const fitted = this._fixedViewport ? fitFrameToViewport(repaint, this._width, this._height) : repaint;
      this._backend.present(fitted.rect, fitted.pixels);
      this._paintedResource = { width: frame.resourceWidth, height: frame.resourceHeight };
      this._successfulPresents += 1;
      const bytes = fitted.rect.width * fitted.rect.height * 4;
      this._uploadedBytes += bytes;
      const drawn = typeof this._backend.drawsPixels === "function"
        ? Boolean(this._backend.drawsPixels())
        : true;
      if (drawn) {
        this._drawnPresents += 1;
        this._drawnBytes += bytes;
      }
      const guest = this._guestInstructionAttribution();
      if (replay) this._replayedFrames += 1;
      this._lossDropCounted = false;
      if (this._onPresent) {
        const timestamp = this._now
          ? Number(this._now())
          : (typeof globalThis.performance?.now === "function" ? globalThis.performance.now() : Date.now());
        const record = Object.freeze({
          sequence: ++this._presentationSequence,
          timestamp,
          backend: this._backendName,
          drawn,
          replay,
          rect: Object.freeze({ ...fitted.rect }),
          resourceWidth: frame.resourceWidth,
          resourceHeight: frame.resourceHeight,
          bytes,
          guestInstructions: guest.delta,
          guestInstructionsTotal: guest.total,
        });
        try {
          this._onPresent(record);
        } catch (error) {
          this._errors.push(`present telemetry: ${String(error?.message || error)}`);
        }
      }
      return true;
    } catch (error) {
      this._errors.push(`present via ${this._backendName}: ${String(error?.message || error)}`);
      if (this._backendName === "webgl2") {
        try {
          this._fallbackToCanvas();
          return true;
        } catch (fallbackError) {
          this._errors.push(`present fallback: ${String(fallbackError?.message || fallbackError)}`);
        }
      }
      this._droppedFrames += 1;
      return false;
    }
  }

  _installStatsSurface() {
    if (!this._statsOwner) return;
    if (!this._statsOwner.stats || typeof this._statsOwner.stats !== "object") this._statsOwner.stats = {};
    const stats = this._statsOwner.stats;
    try {
      Object.defineProperty(stats, "gpu", {
        configurable: true,
        enumerable: true,
        get: () => this._gpuStats(),
      });
    } catch {
      // A host may provide a non-configurable stats object. Keep the public value useful without
      // retaining a backend/canvas reference in the serialized snapshot.
      stats.gpu = this._gpuStats();
    }
  }

  _gpuStats() {
    const scheduler = this._scheduler?.snapshot();
    return {
      framesReceived: this._framesReceived,
      enqueued: scheduler?.enqueued ?? this._framesReceived,
      coalesced: scheduler?.coalesced ?? 0,
      presented: scheduler?.presented ?? this._successfulPresents,
      successfulPresents: this._successfulPresents,
      skipped: scheduler?.skipped ?? this._droppedFrames,
      droppedFrames: this._droppedFrames,
      overruns: scheduler?.overruns ?? 0,
      pending: scheduler?.pending ?? 0,
      maxPending: scheduler?.maxPending ?? 0,
      uploadedBytes: this._uploadedBytes,
      drawnPresents: this._drawnPresents,
      drawnBytes: this._drawnBytes,
      width: this._width,
      height: this._height,
    };
  }

  /** Publish one full-resource frame and return whether it reached a backend. */
  present(frame) {
    if (this._disposed) throw new Error("PresentationController is disposed");
    const checked = checkedFrame(frame);
    this._framesReceived += 1;
    if (!this._fixedViewport && (checked.resourceWidth !== this._width || checked.resourceHeight !== this._height)) {
      this.resize(checked.resourceWidth, checked.resourceHeight);
    }
    this._latest = checked;
    return this._scheduler ? this._scheduler.enqueue(checked) : this._deliver(checked);
  }

  /** Resize the visible target and backend resource. */
  setViewport(width, height) {
    if (this._disposed) throw new Error("PresentationController is disposed");
    checkedDisplaySize(width, height);
    this._fixedViewport = true;
    if (width !== this._width || height !== this._height) {
      this.resize(width, height);
      if (this._latest) {
        this._deliver({ ...this._latest, rect: { x: 0, y: 0,
          width: this._latest.resourceWidth, height: this._latest.resourceHeight } }, true);
      }
    }
    return { width, height };
  }

  /** Legacy resource-following resize; viewport users call setViewport instead. */
  resize(width, height) {
    if (this._disposed) throw new Error("PresentationController is disposed");
    const nextWidth = checkedDimension(Number(width), "canvas width");
    const nextHeight = checkedDimension(Number(height), "canvas height");
    if (this._scheduler && (nextWidth !== this._width || nextHeight !== this._height)) {
      // A queued frame contains a full-resource pixel view. It cannot be presented after the
      // backend has changed dimensions, so retire it before resizing the target.
      this._scheduler.discardPending();
    }
    this._width = nextWidth;
    this._height = nextHeight;
    this._paintedResource = null;
    if (this._backend) {
      this._backend.resize(this._width, this._height);
    } else {
      this._ensureCanvasSize();
    }
    return { width: this._width, height: this._height };
  }

  /** Return a compact, JSON-safe diagnostic snapshot for browser evidence. */
  snapshot() {
    return {
      backend: this._backendName,
      defaultBackend: this.defaultBackend,
      width: this._width,
      height: this._height,
      fixedViewport: this._fixedViewport,
      sizeMismatch: Boolean(this._latest &&
        (!this._paintedResource || this._paintedResource.width !== this._width ||
          this._paintedResource.height !== this._height)),
      framesReceived: this._framesReceived,
      successfulPresents: this._successfulPresents,
      drawnPresents: this._drawnPresents,
      drawnBytes: this._drawnBytes,
      replayedFrames: this._replayedFrames,
      droppedFrames: this._droppedFrames,
      contextLosses: this._contextLosses,
      contextRestores: this._contextRestores,
      fallbacks: this._fallbacks,
      listenerCount: this._listenerCanvas ? 2 : 0,
      scheduler: this._scheduler?.snapshot() ?? null,
      gpu: this._gpuStats(),
      latest: this._latest
        ? { rect: this._latest.rect, resourceWidth: this._latest.resourceWidth, resourceHeight: this._latest.resourceHeight }
        : null,
      errors: [...this._errors],
    };
  }

  /** Read the visible RGBA surface when the active backend exposes a readback API. */
  readPixels() {
    if (this._disposed) throw new Error("PresentationController is disposed");
    if (this._backendName === "canvas2d") {
      const context = this.canvas.getContext("2d");
      if (!context || typeof context.getImageData !== "function") throw new Error("2D readback unavailable");
      return new Uint8ClampedArray(context.getImageData(0, 0, this._width, this._height).data);
    }
    if (this._backendName === "webgl2" && this._backend?.gl) {
      const output = new Uint8Array(this._width * this._height * 4);
      this._backend.gl.readPixels(0, 0, this._width, this._height, this._backend.gl.RGBA, this._backend.gl.UNSIGNED_BYTE, output);
      return output;
    }
    throw new Error("presentation readback unavailable");
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this._scheduler?.dispose();
    this._detachCanvasListeners();
    this._disposeBackend();
    this._latest = null;
    this._paintedResource = null;
  }

  /** Pause/resume the optional page-owned display drain without affecting guest frame receipt. */
  pause() {
    return this._scheduler?.pause() ?? false;
  }

  resume() {
    return this._scheduler?.resume() ?? false;
  }

  visibilityChanged() {
    return this._scheduler?.visibilityChanged?.() ?? false;
  }

  get backendName() {
    return this._backendName;
  }

  get backend() {
    return this._backend;
  }
}
