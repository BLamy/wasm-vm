// E5-T06a: Canvas2D presentation backend for the core FrameSink.

import {
  PresentBackend,
  validateCanvasSize,
  validatePixelWords,
  validatePresentRect,
  writeBgraRectAsRgba,
} from "./present-backend.js";

const DEFAULT_CONTEXT_ATTRIBUTES = Object.freeze({ alpha: true });

/**
 * Present a full resource-sized BGRA word view through a CanvasRenderingContext2D.
 *
 * ImageData cannot consume a SharedArrayBuffer-backed view portably.  Each present therefore
 * converts into this backend's private Uint8ClampedArray before handing a fresh ImageData object
 * to the context.  The private staging capacity is never larger than the current canvas byte
 * budget and is dropped on resize so a large old canvas cannot remain retained indefinitely.
 */
export class Canvas2DBackend extends PresentBackend {
  constructor(canvas, { context = null, contextAttributes = DEFAULT_CONTEXT_ATTRIBUTES } = {}) {
    if (canvas === null || typeof canvas !== "object" || typeof canvas.getContext !== "function") {
      throw new TypeError("Canvas2DBackend requires a canvas-like object");
    }
    const resolvedContext = context ?? canvas.getContext("2d", contextAttributes);
    if (resolvedContext === null || typeof resolvedContext !== "object" ||
        typeof resolvedContext.createImageData !== "function" ||
        typeof resolvedContext.putImageData !== "function") {
      throw new TypeError("canvas does not provide a 2D presentation context");
    }
    const size = validateCanvasSize(canvas.width, canvas.height);
    super();
    this.canvas = canvas;
    this.context = resolvedContext;
    this.width = size.width;
    this.height = size.height;
    this._canvasBytes = size.bytes;
    this._staging = new Uint8ClampedArray(0);
    this._presentCount = 0;
  }

  /** Resize the target and discard staging owned by the previous size. */
  resize(width, height) {
    const size = validateCanvasSize(width, height);
    this.canvas.width = size.width;
    this.canvas.height = size.height;
    this.width = size.width;
    this.height = size.height;
    this._canvasBytes = size.bytes;
    this._staging = new Uint8ClampedArray(0);
    return { width: this.width, height: this.height };
  }

  /** Present one validated row-major BGRA damage rectangle. */
  present(rect, pixels) {
    const damage = validatePresentRect(rect, this.width, this.height);
    const pixelCount = damage.width * damage.height;
    validatePixelWords(pixels, this.width * this.height);
    const byteLength = pixelCount * 4;
    if (byteLength > this._canvasBytes) {
      throw new RangeError("present staging exceeds the current canvas byte budget");
    }
    if (this._staging.byteLength < byteLength || this._staging.byteLength > this._canvasBytes) {
      this._staging = new Uint8ClampedArray(byteLength);
    }
    writeBgraRectAsRgba(pixels, this.width, damage, this._staging);

    const imageData = this.context.createImageData(damage.width, damage.height);
    if (imageData === null || typeof imageData !== "object" ||
        imageData.data === null || typeof imageData.data.set !== "function" ||
        imageData.data.length < byteLength) {
      throw new TypeError("2D context returned invalid ImageData");
    }
    imageData.data.set(this._staging.subarray(0, byteLength));
    this.context.putImageData(imageData, damage.x, damage.y);
    this._presentCount += 1;
    return damage;
  }

  /** Number of private staging bytes currently retained by this backend. */
  get stagingCapacity() {
    return this._staging.byteLength;
  }

  /** Current canvas byte budget, exposed for bounded-allocation diagnostics. */
  get canvasByteBudget() {
    return this._canvasBytes;
  }

  get presentCount() {
    return this._presentCount;
  }
}
