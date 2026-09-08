// Exact pixels only, not OCR or proof of token identity. The caller must pin a reviewed
// raster/hash, its exact text and provenance, and an explicit search region.
// Self-contained: serialize createTextOracle into page.evaluate without installing globals.
export function createTextOracle() {
  const MAX_PIXEL_COMPARISONS = 4_194_304;

  function integer(value, min, max, label) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new RangeError(`invalid ${label}`);
    }
    return value;
  }

  function object(value, label) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`invalid ${label}`);
    return value;
  }

  // Own a stable copy; reject shared/resizable buffers and numeric coercion. Plain arrays
  // support browser serialization; only unsigned byte views are accepted otherwise.
  function bytes(value, length, label) {
    if (Array.isArray(value)) {
      if (value.length !== length) throw new RangeError(`invalid ${label} length`);
      const copy = new Uint8Array(length);
      for (let i = 0; i < length; i++) copy[i] = integer(value[i], 0, 255, `${label} byte`);
      return copy;
    }
    const tag = Object.prototype.toString.call(value);
    if (!ArrayBuffer.isView(value) || (tag !== "[object Uint8Array]" && tag !== "[object Uint8ClampedArray]")) {
      throw new TypeError(`invalid ${label} byte array`);
    }
    if (Object.prototype.toString.call(value.buffer) !== "[object ArrayBuffer]" || value.buffer.resizable) {
      throw new TypeError(`invalid ${label} shared/resizable buffer`);
    }
    if (value.length !== length) throw new RangeError(`invalid ${label} length`);
    return new Uint8Array(value);
  }

  // Returns a detached, immutable, serializable template; never mutates the supplied raster.
  function validateTemplate(input) {
    const { width, height, rgba } = object(input, "template");
    integer(width, 1, 256, "template width");
    integer(height, 1, 32, "template height");
    const copy = bytes(rgba, width * height * 4, "template RGBA");
    let varied = false;
    for (let i = 0; i < copy.length; i += 4) {
      if (copy[i + 3] !== 255) throw new RangeError("template must be opaque");
      if (copy[i] !== copy[0] || copy[i + 1] !== copy[1] || copy[i + 2] !== copy[2]) varied = true;
    }
    if (!varied) throw new RangeError("template must contain varied RGB pixels, not a solid color");
    return Object.freeze({ width, height, rgba: Object.freeze(Array.from(copy)) });
  }

  // Returns every exact match as {x,y}, in row-major order, up to four matches. A fifth
  // match or excess comparison work throws: never silently truncate or report absence.
  // ROI is mandatory: [left,right) x [top,bottom), wholly within the frame. A template
  // larger than a valid ROI has no matches. Limits are fixed, not caller-relaxable.
  function findTemplate(input) {
    const { pixels, width, height, template, region } = object(input, "frame");
    integer(width, 1, 1280, "frame width");
    integer(height, 1, 800, "frame height");
    const { left, top, right, bottom } = object(region, "region");
    integer(left, 0, width - 1, "region left");
    integer(top, 0, height - 1, "region top");
    integer(right, left + 1, width, "region right");
    integer(bottom, top + 1, height, "region bottom");
    const target = validateTemplate(template);
    const frame = bytes(pixels, width * height * 4, "frame RGBA");
    const matches = [];
    const rowBytes = target.width * 4;
    // First pixel plus the first contrasting pixel reject solid/background candidates
    // before full row comparison. Both are derived from the pinned template, not colors
    // hardcoded to a success marker.
    let second = 4;
    while (target.rgba[second] === target.rgba[0] && target.rgba[second + 1] === target.rgba[1] &&
      target.rgba[second + 2] === target.rgba[2]) second += 4;
    const secondOffset = Math.floor(second / rowBytes) * width * 4 + second % rowBytes;
    let comparisons = 0;
    function equalPixel(frameOffset, templateOffset) {
      if (++comparisons > MAX_PIXEL_COMPARISONS) throw new RangeError("text oracle comparison work limit exceeded");
      return frame[frameOffset] === target.rgba[templateOffset] &&
        frame[frameOffset + 1] === target.rgba[templateOffset + 1] &&
        frame[frameOffset + 2] === target.rgba[templateOffset + 2] &&
        frame[frameOffset + 3] === target.rgba[templateOffset + 3];
    }
    for (let y = top; y <= bottom - target.height; y++) {
      candidate: for (let x = left; x <= right - target.width; x++) {
        const start = (y * width + x) * 4;
        if (!equalPixel(start, 0) || !equalPixel(start + secondOffset, second)) continue;
        for (let row = 0; row < target.height; row++) {
          for (let column = 0; column < rowBytes; column += 4) {
            if (!equalPixel(start + row * width * 4 + column, row * rowBytes + column)) continue candidate;
          }
        }
        if (matches.length === 4) throw new RangeError("text oracle match overflow (more than four)");
        matches.push({ x, y });
      }
    }
    return matches;
  }

  return Object.freeze({ validateTemplate, findTemplate });
}

export const { validateTemplate, findTemplate } = createTextOracle();
