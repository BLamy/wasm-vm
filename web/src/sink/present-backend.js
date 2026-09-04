// E5-T06a: browser-side presentation contract shared by the Canvas2D and WebGL backends.
//
// The core FrameSink exposes little-endian B8G8R8A8 words.  Channel conversion belongs at this
// boundary; the core remains browser-independent and never knows about RGBA ImageData bytes.

/**
 * Minimal presentation contract for a browser-backed scanout.
 *
 * Concrete backends must accept a non-empty integer rect with `x`, `y`, `width`, and `height`,
 * together with the full resource-sized BGRA word view in row-major order.  `resize` establishes
 * the canvas bounds and source stride used to validate subsequent presents.
 */
export class PresentBackend {
  present(_rect, _pixels) {
    throw new Error("PresentBackend.present must be implemented by a concrete backend");
  }

  resize(_width, _height) {
    throw new Error("PresentBackend.resize must be implemented by a concrete backend");
  }
}

function positiveSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
  return value;
}

/** Validate a canvas size and return its exact byte budget. */
export function validateCanvasSize(width, height) {
  const checkedWidth = positiveSafeInteger(width, "canvas width");
  const checkedHeight = positiveSafeInteger(height, "canvas height");
  const pixels = checkedWidth * checkedHeight;
  const bytes = pixels * 4;
  if (!Number.isSafeInteger(pixels) || !Number.isSafeInteger(bytes)) {
    throw new RangeError("canvas size is too large for a bounded pixel buffer");
  }
  return Object.freeze({ width: checkedWidth, height: checkedHeight, bytes });
}

/** Validate and normalize a damage rectangle against the current canvas bounds. */
export function validatePresentRect(rect, canvasWidth, canvasHeight) {
  if (rect === null || typeof rect !== "object") {
    throw new TypeError("present rect must be an object");
  }
  const bounds = validateCanvasSize(canvasWidth, canvasHeight);
  const x = nonNegativeSafeInteger(rect.x, "rect x");
  const y = nonNegativeSafeInteger(rect.y, "rect y");
  const width = positiveSafeInteger(rect.width, "rect width");
  const height = positiveSafeInteger(rect.height, "rect height");
  if (x < 0 || y < 0 || x + width > bounds.width || y + height > bounds.height) {
    throw new RangeError("present rect is outside the canvas");
  }
  return Object.freeze({ x, y, width, height });
}

/** Validate the row-major BGRA word count for a damage rectangle. */
export function validatePixelWords(pixels, expectedLength) {
  if (pixels === null || pixels === undefined || !Number.isSafeInteger(pixels.length)) {
    throw new TypeError("present pixels must be an array-like value");
  }
  if (pixels.length !== expectedLength) {
    throw new RangeError(`present pixel count ${pixels.length} does not match ${expectedLength}`);
  }
  return pixels;
}

/**
 * Convert little-endian B8G8R8A8 words to the byte order required by ImageData.
 *
 * A word such as 0xAARRGGBB is stored by the core as bytes [B, G, R, A].  ImageData requires
 * [R, G, B, A], so the conversion is explicit and preserves alpha, including 0x00.
 */
export function writeBgraWordsAsRgba(pixels, target) {
  const requiredBytes = pixels.length * 4;
  if (target.length < requiredBytes) {
    throw new RangeError("RGBA staging buffer is too small");
  }
  for (let index = 0; index < pixels.length; index += 1) {
    const word = Number(pixels[index]) >>> 0;
    const offset = index * 4;
    target[offset] = (word >>> 16) & 0xff;
    target[offset + 1] = (word >>> 8) & 0xff;
    target[offset + 2] = word & 0xff;
    target[offset + 3] = word >>> 24;
  }
  return target;
}

/**
 * Copy one damage rectangle out of a full resource-sized BGRA word view as RGBA bytes.
 *
 * The source stride is the canvas width, not the damage width.  Keeping this extraction here
 * makes the T03 FrameSink-to-backend contract explicit and prevents odd-width damage from being
 * accidentally treated as a compact full-frame source.
 */
export function writeBgraRectAsRgba(pixels, canvasWidth, rect, target) {
  const requiredBytes = rect.width * rect.height * 4;
  if (target.length < requiredBytes) {
    throw new RangeError("RGBA staging buffer is too small");
  }
  for (let row = 0; row < rect.height; row += 1) {
    for (let column = 0; column < rect.width; column += 1) {
      const sourceIndex = (rect.y + row) * canvasWidth + rect.x + column;
      const word = Number(pixels[sourceIndex]) >>> 0;
      const offset = (row * rect.width + column) * 4;
      target[offset] = (word >>> 16) & 0xff;
      target[offset + 1] = (word >>> 8) & 0xff;
      target[offset + 2] = word & 0xff;
      target[offset + 3] = word >>> 24;
    }
  }
  return target;
}
