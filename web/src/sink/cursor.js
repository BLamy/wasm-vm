// E5-T15b: bounded cursor-resource conversion shared by the browser sink and its proof fixtures.
//
// The core supplies host-owned u32 words synchronously. This module copies those words into a
// private RGBA/PNG representation and never retains the source view. CSS cursor selection is a
// size decision only; pointer-mode and DOM lifecycle policy belong to E5-T15c.

export const CURSOR_FORMAT_B8G8R8A8_UNORM = 1;
export const CURSOR_FORMAT_B8G8R8X8_UNORM = 2;
export const CURSOR_FORMAT_A8R8G8B8_UNORM = 3;
export const CURSOR_FORMAT_X8R8G8B8_UNORM = 4;
export const CURSOR_FORMAT_R8G8B8A8_UNORM = 67;
export const CURSOR_FORMAT_R8G8B8X8_UNORM = 68;

export const CURSOR_CSS_MAX_DIMENSION = 128;
export const CURSOR_MAX_DIMENSION = 256;
export const CURSOR_MAX_PIXELS = CURSOR_MAX_DIMENSION * CURSOR_MAX_DIMENSION;
export const CURSOR_MAX_RGBA_BYTES = CURSOR_MAX_PIXELS * 4;
export const CURSOR_MAX_RAW_BYTES = CURSOR_MAX_RGBA_BYTES + CURSOR_MAX_DIMENSION;
export const CURSOR_DEFLATE_BLOCK_BYTES = 65_535;
export const CURSOR_MAX_DEFLATE_BLOCKS = Math.ceil(CURSOR_MAX_RAW_BYTES / CURSOR_DEFLATE_BLOCK_BYTES);
// PNG = signature + IHDR chunk + IDAT chunk (zlib header, stored-block headers, raw scanlines,
// Adler-32, CRC) + IEND chunk. The exact bound makes every allocation below auditable.
export const CURSOR_MAX_PNG_BYTES =
  8 + (12 + 13) + 12 + (2 + CURSOR_MAX_RAW_BYTES + CURSOR_MAX_DEFLATE_BLOCKS * 5 + 4) + 12;
export const CURSOR_PNG_DATA_URL_PREFIX = "data:image/png;base64,";
export const CURSOR_MAX_DATA_URL_CHARS =
  CURSOR_PNG_DATA_URL_PREFIX.length + 4 * Math.ceil(CURSOR_MAX_PNG_BYTES / 3);

const PNG_SIGNATURE = Object.freeze([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_IHDR = "IHDR";
const PNG_IDAT = "IDAT";
const PNG_IEND = "IEND";
const ZLIB_MODULO = 65_521;

function checkedInteger(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new RangeError(`${name} must be an integer in [${min}, ${max}]`);
  }
  return number;
}

/** Validate a cursor resource's dimensions and return all bounded byte counts. */
export function validateCursorSize(width, height) {
  const checkedWidth = checkedInteger(width, "cursor width", { min: 1, max: CURSOR_MAX_DIMENSION });
  const checkedHeight = checkedInteger(height, "cursor height", { min: 1, max: CURSOR_MAX_DIMENSION });
  const pixels = checkedWidth * checkedHeight;
  const rgbaBytes = pixels * 4;
  const rawBytes = rgbaBytes + checkedHeight;
  if (pixels > CURSOR_MAX_PIXELS || rgbaBytes > CURSOR_MAX_RGBA_BYTES || rawBytes > CURSOR_MAX_RAW_BYTES) {
    throw new RangeError("cursor resource exceeds the bounded pixel budget");
  }
  return Object.freeze({
    width: checkedWidth,
    height: checkedHeight,
    pixels,
    rgbaBytes,
    rawBytes,
  });
}

function checkedHotspot(value, name, limit) {
  return checkedInteger(value, name, { min: 0, max: limit - 1 });
}

/** Validate a hotspot against a previously checked cursor size. */
export function validateCursorHotspot(hotX, hotY, width, height) {
  const size = validateCursorSize(width, height);
  return Object.freeze({
    x: checkedHotspot(hotX, "cursor hot_x", size.width),
    y: checkedHotspot(hotY, "cursor hot_y", size.height),
  });
}

function channelLayout(format) {
  switch (Number(format)) {
    // Packed A/R/G/B formats are B/G/R/A in little-endian guest memory.
    case CURSOR_FORMAT_B8G8R8A8_UNORM:
    case CURSOR_FORMAT_A8R8G8B8_UNORM:
      return "bgra";
    // Packed X/R/G/B formats carry no alpha; the browser must see opaque pixels.
    case CURSOR_FORMAT_B8G8R8X8_UNORM:
    case CURSOR_FORMAT_X8R8G8B8_UNORM:
      return "bgrx";
    // Packed R/G/B/A formats are R/G/B/A in little-endian guest memory.
    case CURSOR_FORMAT_R8G8B8A8_UNORM:
      return "rgba";
    case CURSOR_FORMAT_R8G8B8X8_UNORM:
      return "rgbx";
    default:
      throw new RangeError(`unsupported cursor resource format ${String(format)}`);
  }
}

/**
 * Copy checked cursor words into a private row-major RGBA byte array.
 *
 * The source may be a temporary wasm Uint32Array view. It is read exactly once and never stored
 * by the returned value or by CursorSink.
 */
export function cursorWordsToRgba(words, width, height, format = CURSOR_FORMAT_B8G8R8A8_UNORM) {
  const size = validateCursorSize(width, height);
  const layout = channelLayout(format);
  if (words === null || words === undefined || !Number.isSafeInteger(words.length)) {
    throw new TypeError("cursor pixels must be an array-like value");
  }
  if (words.length !== size.pixels) {
    throw new RangeError(`cursor pixel count ${words.length} does not match ${size.width}x${size.height}`);
  }
  const rgba = new Uint8Array(size.rgbaBytes);
  for (let index = 0; index < size.pixels; index += 1) {
    const word = Number(words[index]);
    if (!Number.isSafeInteger(word) || word < 0 || word > 0xffff_ffff) {
      throw new RangeError(`cursor pixel ${index} is not a u32`);
    }
    const offset = index * 4;
    if (layout === "bgra" || layout === "bgrx") {
      rgba[offset] = (word >>> 16) & 0xff;
      rgba[offset + 1] = (word >>> 8) & 0xff;
      rgba[offset + 2] = word & 0xff;
      rgba[offset + 3] = layout === "bgra" ? (word >>> 24) & 0xff : 0xff;
    } else {
      rgba[offset] = word & 0xff;
      rgba[offset + 1] = (word >>> 8) & 0xff;
      rgba[offset + 2] = (word >>> 16) & 0xff;
      rgba[offset + 3] = layout === "rgba" ? (word >>> 24) & 0xff : 0xff;
    }
  }
  return rgba;
}

function writeU16Le(target, offset, value) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32Be(target, offset, value) {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function crc32(bytes, start, end) {
  let crc = 0xffff_ffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb8_8320 & -(crc & 1));
    }
  }
  return (~crc) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % ZLIB_MODULO;
    b = (b + a) % ZLIB_MODULO;
  }
  return ((b << 16) | a) >>> 0;
}

function writeChunk(target, offset, type, data) {
  writeU32Be(target, offset, data.length);
  offset += 4;
  const typeStart = offset;
  for (let index = 0; index < 4; index += 1) target[offset + index] = type.charCodeAt(index);
  offset += 4;
  target.set(data, offset);
  offset += data.length;
  writeU32Be(target, offset, crc32(target, typeStart, offset));
  return offset + 4;
}

function writeZlibStoredStream(target, offset, raw) {
  target[offset++] = 0x78;
  target[offset++] = 0x01;
  for (let start = 0; start < raw.length; start += CURSOR_DEFLATE_BLOCK_BYTES) {
    const length = Math.min(CURSOR_DEFLATE_BLOCK_BYTES, raw.length - start);
    const final = start + length === raw.length;
    // Stored DEFLATE blocks are byte-aligned. BTYPE=00 plus the final bit is 0x00/0x01.
    target[offset++] = final ? 0x01 : 0x00;
    writeU16Le(target, offset, length);
    offset += 2;
    writeU16Le(target, offset, (~length) & 0xffff);
    offset += 2;
    target.set(raw.subarray(start, start + length), offset);
    offset += length;
  }
  writeU32Be(target, offset, adler32(raw));
  return offset + 4;
}

/** Encode RGBA bytes as a deterministic PNG with bounded stored-DEFLATE blocks. */
export function encodeCursorPng(rgba, width, height) {
  const size = validateCursorSize(width, height);
  if (rgba === null || rgba === undefined || rgba.byteLength !== size.rgbaBytes) {
    throw new RangeError(`cursor RGBA byte length must be ${size.rgbaBytes}`);
  }
  const source = rgba instanceof Uint8Array
    ? rgba
    : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  const raw = new Uint8Array(size.rawBytes);
  const rowBytes = size.width * 4;
  for (let row = 0; row < size.height; row += 1) {
    const rawOffset = row * (rowBytes + 1);
    raw[rawOffset] = 0; // PNG filter type None; checkerboard/alpha bytes remain untouched.
    raw.set(source.subarray(row * rowBytes, (row + 1) * rowBytes), rawOffset + 1);
  }

  const blocks = Math.ceil(raw.length / CURSOR_DEFLATE_BLOCK_BYTES);
  const zlibBytes = 2 + raw.length + blocks * 5 + 4;
  const idatBytes = zlibBytes;
  const pngBytes = 8 + (12 + 13) + (12 + idatBytes) + 12;
  if (blocks > CURSOR_MAX_DEFLATE_BLOCKS || pngBytes > CURSOR_MAX_PNG_BYTES) {
    throw new RangeError("cursor PNG exceeds the bounded encoding budget");
  }
  const output = new Uint8Array(pngBytes);
  output.set(PNG_SIGNATURE, 0);
  let offset = PNG_SIGNATURE.length;
  const ihdr = new Uint8Array(13);
  writeU32Be(ihdr, 0, size.width);
  writeU32Be(ihdr, 4, size.height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // no interlace
  offset = writeChunk(output, offset, PNG_IHDR, ihdr);

  writeU32Be(output, offset, idatBytes);
  offset += 4;
  const idatTypeStart = offset;
  for (let index = 0; index < 4; index += 1) output[offset + index] = PNG_IDAT.charCodeAt(index);
  offset += 4;
  const idatPayloadEnd = writeZlibStoredStream(output, offset, raw);
  offset = idatPayloadEnd;
  writeU32Be(output, offset, crc32(output, idatTypeStart, idatPayloadEnd));
  offset += 4;
  offset = writeChunk(output, offset, PNG_IEND, new Uint8Array(0));
  if (offset !== output.length) throw new Error("cursor PNG size accounting drifted");
  return output;
}

function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    const parts = [];
    // Every non-final chunk must be a multiple of three bytes. Otherwise btoa adds padding to
    // each chunk and concatenating those fragments no longer decodes to the original PNG.
    const chunkBytes = 0x7ffe;
    for (let start = 0; start < bytes.length; start += chunkBytes) {
      parts.push(btoa(String.fromCharCode(...bytes.subarray(start, start + chunkBytes))));
    }
    return parts.join("");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    const value = (a << 16) | (b << 8) | c;
    output += alphabet[(value >>> 18) & 63];
    output += alphabet[(value >>> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(value >>> 6) & 63] : "=";
    output += index + 2 < bytes.length ? alphabet[value & 63] : "=";
  }
  return output;
}

/** Encode a private RGBA cursor as a self-contained PNG data URL. */
export function cursorPngDataUrl(rgba, width, height) {
  const png = encodeCursorPng(rgba, width, height);
  const dataUrl = `${CURSOR_PNG_DATA_URL_PREFIX}${bytesToBase64(png)}`;
  if (dataUrl.length > CURSOR_MAX_DATA_URL_CHARS) {
    throw new RangeError("cursor data URL exceeds the bounded encoding budget");
  }
  return dataUrl;
}

/** Return the exact CSS cursor declaration for a checked PNG and hotspot. */
export function cssCursorDescriptor(dataUrl, hotX, hotY, width, height) {
  if (typeof dataUrl !== "string" || dataUrl.length === 0 || /["'\\\r\n]/.test(dataUrl)) {
    throw new TypeError("cursor data URL is not CSS-safe");
  }
  const hotspot = validateCursorHotspot(hotX, hotY, width, height);
  return `url("${dataUrl}") ${hotspot.x} ${hotspot.y}, none`;
}

/** Choose CSS for browser-sized cursors and the transform-driven overlay for larger images. */
export function cursorPresentationMode(width, height, cssMaxDimension = CURSOR_CSS_MAX_DIMENSION) {
  const size = validateCursorSize(width, height);
  const max = checkedInteger(cssMaxDimension, "CSS cursor dimension", {
    min: 1,
    max: CURSOR_MAX_DIMENSION,
  });
  return size.width <= max && size.height <= max ? "css" : "overlay";
}

/** Return a DOM-ready overlay asset descriptor; E5-T15c owns its element and transform lifecycle. */
export function overlayCursorDescriptor(dataUrl, hotX, hotY, width, height) {
  if (typeof dataUrl !== "string" || dataUrl.length === 0) {
    throw new TypeError("cursor data URL is missing");
  }
  const size = validateCursorSize(width, height);
  const hotspot = validateCursorHotspot(hotX, hotY, size.width, size.height);
  return Object.freeze({
    kind: "overlay",
    src: dataUrl,
    width: size.width,
    height: size.height,
    hotX: hotspot.x,
    hotY: hotspot.y,
  });
}

function normalizedState(state) {
  if (state === null || typeof state !== "object") throw new TypeError("cursor state is missing");
  const pos = state.pos && typeof state.pos === "object" ? state.pos : state;
  return Object.freeze({
    resourceId: checkedInteger(state.resourceId, "cursor resource id", { min: 0, max: 0xffff_ffff }),
    hotX: checkedInteger(state.hotX ?? state.hot_x, "cursor hot_x", { min: 0, max: 0xffff_ffff }),
    hotY: checkedInteger(state.hotY ?? state.hot_y, "cursor hot_y", { min: 0, max: 0xffff_ffff }),
    scanout: checkedInteger(pos.scanout ?? pos.scanoutId ?? pos.scanout_id, "cursor scanout", {
      min: 0,
      max: 0xffff_ffff,
    }),
    x: checkedInteger(pos.x, "cursor x", { min: 0, max: 0xffff_ffff }),
    y: checkedInteger(pos.y, "cursor y", { min: 0, max: 0xffff_ffff }),
  });
}

function emitSafely(callback, value, sink) {
  try {
    callback(value);
  } catch {
    sink._callbackErrors += 1;
  }
}

/**
 * Convert cursor callbacks into one bounded current descriptor.
 *
 * The sink stores only the current PNG data URL and scalar metadata. It deliberately retains no
 * source Uint32Array, RGBA staging array, or history of prior updates.
 */
export class CursorSink {
  constructor({ onChange = () => {}, cssMaxDimension = CURSOR_CSS_MAX_DIMENSION } = {}) {
    if (typeof onChange !== "function") throw new TypeError("cursor sink onChange must be a function");
    this._onChange = onChange;
    this._cssMaxDimension = checkedInteger(cssMaxDimension, "CSS cursor dimension", {
      min: 1,
      max: CURSOR_MAX_DIMENSION,
    });
    this._descriptor = Object.freeze({ kind: "hidden" });
    this._updates = 0;
    this._callbackErrors = 0;
  }

  /** Consume one synchronous core callback and return the new CSS/overlay/hidden descriptor. */
  update(state, format, width, height, pixels) {
    const current = normalizedState(state);
    this._updates += 1;
    if (current.resourceId === 0) {
      this._descriptor = Object.freeze({ kind: "hidden", state: current });
      emitSafely(this._onChange, this._descriptor, this);
      return this._descriptor;
    }
    const size = validateCursorSize(width, height);
    const hotspot = validateCursorHotspot(current.hotX, current.hotY, size.width, size.height);
    const rgba = cursorWordsToRgba(pixels, size.width, size.height, format);
    const dataUrl = cursorPngDataUrl(rgba, size.width, size.height);
    const mode = cursorPresentationMode(size.width, size.height, this._cssMaxDimension);
    this._descriptor = mode === "css"
      ? Object.freeze({
        kind: "css",
        state: current,
        width: size.width,
        height: size.height,
        hotX: hotspot.x,
        hotY: hotspot.y,
        dataUrl,
        css: cssCursorDescriptor(dataUrl, hotspot.x, hotspot.y, size.width, size.height),
      })
      : Object.freeze({
        ...overlayCursorDescriptor(dataUrl, hotspot.x, hotspot.y, size.width, size.height),
        state: current,
      });
    emitSafely(this._onChange, this._descriptor, this);
    return this._descriptor;
  }

  /** Hide the current cursor without retaining the previous image. */
  hide(state = {
    resourceId: 0,
    hotX: 0,
    hotY: 0,
    scanout: 0,
    x: 0,
    y: 0,
  }) {
    return this.update(state, null, 1, 1, new Uint32Array(1));
  }

  /** Compact diagnostics; no image bytes or source buffers escape. */
  snapshot() {
    const descriptor = this._descriptor;
    return Object.freeze({
      kind: descriptor.kind,
      width: descriptor.width ?? 0,
      height: descriptor.height ?? 0,
      hotX: descriptor.hotX ?? 0,
      hotY: descriptor.hotY ?? 0,
      dataUrlChars: descriptor.dataUrl?.length ?? 0,
      updates: this._updates,
      callbackErrors: this._callbackErrors,
    });
  }
}
