// E5-T06d: runtime presentation selection and context-loss recovery.

import { Canvas2DBackend } from "./canvas2d.js";
import { WebGL2Backend } from "./webgl.js";

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
        ? { ...this._latest, rect: { x: 0, y: 0, width: this._width, height: this._height } }
        : this._latest;
      this._deliver(replay, true);
    }
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
      this._backend.present(frame.rect, frame.pixels);
      this._successfulPresents += 1;
      if (replay) this._replayedFrames += 1;
      this._lossDropCounted = false;
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

  /** Publish one full-resource frame and return whether it reached a backend. */
  present(frame) {
    if (this._disposed) throw new Error("PresentationController is disposed");
    const checked = checkedFrame(frame);
    this._framesReceived += 1;
    if (checked.resourceWidth !== this._width || checked.resourceHeight !== this._height) {
      this.resize(checked.resourceWidth, checked.resourceHeight);
    }
    this._latest = checked;
    return this._deliver(checked);
  }

  /** Resize the visible target and backend resource. */
  resize(width, height) {
    if (this._disposed) throw new Error("PresentationController is disposed");
    this._width = checkedDimension(Number(width), "canvas width");
    this._height = checkedDimension(Number(height), "canvas height");
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
      framesReceived: this._framesReceived,
      successfulPresents: this._successfulPresents,
      replayedFrames: this._replayedFrames,
      droppedFrames: this._droppedFrames,
      contextLosses: this._contextLosses,
      contextRestores: this._contextRestores,
      fallbacks: this._fallbacks,
      listenerCount: this._listenerCanvas ? 2 : 0,
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
    this._detachCanvasListeners();
    this._disposeBackend();
    this._latest = null;
  }

  get backendName() {
    return this._backendName;
  }

  get backend() {
    return this._backend;
  }
}
