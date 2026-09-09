// E5-T15b — bounded cursor-resource conversion, PNG encoding, and presentation choice.

import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { inflateSync } from "node:zlib";
import test from "node:test";

import {
  CURSOR_FORMAT_B8G8R8A8_UNORM,
  CURSOR_MAX_DATA_URL_CHARS,
  CURSOR_MAX_PNG_BYTES,
  CursorSink,
  cssCursorDescriptor,
  cursorPngDataUrl,
  cursorPresentationMode,
  cursorWordsToRgba,
  validateCursorHotspot,
  validateCursorSize,
} from "../src/sink/cursor.js";

const PNG_SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readU32Be(bytes, offset) {
  return bytes[offset] * 0x1_000_000
    + bytes[offset + 1] * 0x1_0000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3];
}

function decodeCursorPng(dataUrl) {
  assert.match(dataUrl, /^data:image\/png;base64,/);
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  assert.deepEqual([...bytes.subarray(0, PNG_SIGNATURE.length)], [...PNG_SIGNATURE]);

  let offset = PNG_SIGNATURE.length;
  let width;
  let height;
  const idat = [];
  let sawIend = false;
  while (offset < bytes.length) {
    assert.ok(offset + 12 <= bytes.length, "PNG chunk header is truncated");
    const length = readU32Be(bytes, offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    assert.ok(dataEnd + 4 <= bytes.length, `${type} chunk is truncated`);
    if (type === "IHDR") {
      assert.equal(length, 13);
      width = readU32Be(bytes, dataStart);
      height = readU32Be(bytes, dataStart + 4);
      assert.equal(bytes[dataStart + 8], 8);
      assert.equal(bytes[dataStart + 9], 6);
    } else if (type === "IDAT") {
      idat.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      assert.equal(length, 0);
      sawIend = true;
    }
    offset = dataEnd + 4;
    if (sawIend) break;
  }
  assert.equal(offset, bytes.length);
  assert.equal(sawIend, true);
  assert.ok(Number.isSafeInteger(width) && Number.isSafeInteger(height));
  const raw = inflateSync(Buffer.concat(idat));
  const rgba = new Uint8Array(width * height * 4);
  const rowBytes = width * 4;
  const filteredRowBytes = rowBytes + 1;
  assert.equal(raw.length, filteredRowBytes * height);
  for (let row = 0; row < height; row += 1) {
    const rawOffset = row * filteredRowBytes;
    assert.equal(raw[rawOffset], 0, "cursor encoder must use PNG filter None");
    rgba.set(raw.subarray(rawOffset + 1, rawOffset + filteredRowBytes), row * rowBytes);
  }
  return { bytes, width, height, rgba };
}

function cursorState(resourceId, hotX, hotY, x = 40, y = 50) {
  return {
    resourceId,
    hotX,
    hotY,
    pos: { scanoutId: 0, x, y },
  };
}

test("64x64 BGRA checkerboard round-trips every RGBA byte, including alpha", () => {
  const width = 64;
  const height = 64;
  const words = new Uint32Array(width * height);
  const expected = new Uint8Array(words.length * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const red = (x * 3 + y) & 0xff;
      const green = (x + y * 5) & 0xff;
      const blue = ((x ^ y) * 7) & 0xff;
      const alpha = [0, 0x80, 0xff][(x + y) % 3];
      words[index] = ((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0;
      const offset = index * 4;
      expected[offset] = red;
      expected[offset + 1] = green;
      expected[offset + 2] = blue;
      expected[offset + 3] = alpha;
    }
  }

  const rgba = cursorWordsToRgba(words, width, height, CURSOR_FORMAT_B8G8R8A8_UNORM);
  const dataUrl = cursorPngDataUrl(rgba, width, height);
  const decoded = decodeCursorPng(dataUrl);
  assert.equal(decoded.width, width);
  assert.equal(decoded.height, height);
  assert.deepEqual(decoded.rgba, expected);
  assert.equal(dataUrl, cursorPngDataUrl(rgba, width, height), "PNG encoding is deterministic");
});

test("hotspot coordinates are rendered exactly in the CSS cursor descriptor", () => {
  const words = new Uint32Array(64 * 64).fill(0xff112233);
  const sink = new CursorSink();
  const descriptor = sink.update(
    cursorState(7, 10, 3),
    CURSOR_FORMAT_B8G8R8A8_UNORM,
    64,
    64,
    words,
  );
  assert.equal(descriptor.kind, "css");
  assert.equal(descriptor.css, `url("${descriptor.dataUrl}") 10 3, none`);
  assert.equal(descriptor.css, cssCursorDescriptor(descriptor.dataUrl, 10, 3, 64, 64));
  assert.equal(descriptor.hotX, 10);
  assert.equal(descriptor.hotY, 3);
  assert.deepEqual(sink.snapshot(), {
    kind: "css",
    width: 64,
    height: 64,
    hotX: 10,
    hotY: 3,
    dataUrlChars: descriptor.dataUrl.length,
    updates: 1,
    callbackErrors: 0,
  });
});

test("256x256 uses the bounded overlay descriptor and exposes exact allocation limits", () => {
  const size = validateCursorSize(256, 256);
  assert.deepEqual(size, {
    width: 256,
    height: 256,
    pixels: 65_536,
    rgbaBytes: 262_144,
    rawBytes: 262_400,
  });
  const words = new Uint32Array(size.pixels);
  const sink = new CursorSink();
  const descriptor = sink.update(
    cursorState(9, 255, 255),
    CURSOR_FORMAT_B8G8R8A8_UNORM,
    size.width,
    size.height,
    words,
  );
  assert.equal(descriptor.kind, "overlay");
  assert.equal(descriptor.width, 256);
  assert.equal(descriptor.height, 256);
  assert.equal(descriptor.hotX, 255);
  assert.equal(descriptor.hotY, 255);
  assert.equal(decodeCursorPng(descriptor.src).bytes.length, CURSOR_MAX_PNG_BYTES);
  assert.ok(descriptor.src.length <= CURSOR_MAX_DATA_URL_CHARS);
  assert.ok(sink.snapshot().dataUrlChars <= CURSOR_MAX_DATA_URL_CHARS);
  assert.equal(cursorPresentationMode(128, 128), "css");
  assert.equal(cursorPresentationMode(129, 128), "overlay");
});

test("odd dimensions, transparency, malformed inputs, and 1,000 updates stay bounded", () => {
  const oddWords = new Uint32Array(63 * 65).fill(0x00102030);
  const oddRgba = cursorWordsToRgba(oddWords, 63, 65, CURSOR_FORMAT_B8G8R8A8_UNORM);
  const oddPng = decodeCursorPng(cursorPngDataUrl(oddRgba, 63, 65));
  assert.equal(oddPng.width, 63);
  assert.equal(oddPng.height, 65);
  assert.deepEqual([...oddPng.rgba.subarray(0, 4)], [0x10, 0x20, 0x30, 0]);

  assert.throws(() => validateCursorSize(0, 1), RangeError);
  assert.throws(() => validateCursorSize(1, 0), RangeError);
  assert.throws(() => validateCursorSize(257, 1), RangeError);
  assert.throws(() => validateCursorHotspot(-1, 0, 3, 5), RangeError);
  assert.throws(() => validateCursorHotspot(3, 0, 3, 5), RangeError);
  assert.throws(() => validateCursorHotspot(0, 5, 3, 5), RangeError);
  assert.throws(() => cursorWordsToRgba(new Uint32Array(2), 3, 1), RangeError);
  assert.throws(() => cursorWordsToRgba(new Uint32Array(1), 1, 1, 999), RangeError);
  assert.throws(() => cssCursorDescriptor("data:image/png;base64,bad\n", 0, 0, 1, 1), TypeError);

  let callbackCount = 0;
  const sink = new CursorSink({ onChange: () => { callbackCount += 1; } });
  const words = new Uint32Array([0x80402010]);
  const first = sink.update(cursorState(3, 0, 0), CURSOR_FORMAT_B8G8R8A8_UNORM, 1, 1, words);
  const firstUrl = first.dataUrl;
  for (let index = 0; index < 1_000; index += 1) {
    sink.update(cursorState(3, 0, 0, index, index), CURSOR_FORMAT_B8G8R8A8_UNORM, 1, 1, words);
  }
  words[0] = 0xffffffff;
  assert.equal(first.dataUrl, firstUrl, "source mutation cannot alter a copied descriptor");
  assert.equal(callbackCount, 1_001);
  assert.deepEqual(sink.snapshot(), {
    kind: "css",
    width: 1,
    height: 1,
    hotX: 0,
    hotY: 0,
    dataUrlChars: sink.snapshot().dataUrlChars,
    updates: 1_001,
    callbackErrors: 0,
  });
  assert.ok(sink.snapshot().dataUrlChars <= CURSOR_MAX_DATA_URL_CHARS);
  assert.equal(Object.hasOwn(sink, "_history"), false);
  assert.equal(Object.hasOwn(sink, "_sourcePixels"), false);
  assert.equal(Object.hasOwn(sink, "_rgba"), false);
});

test("hidden cursor updates clear the descriptor without retaining an image", () => {
  const sink = new CursorSink();
  sink.update(cursorState(3, 0, 0), CURSOR_FORMAT_B8G8R8A8_UNORM, 1, 1, new Uint32Array([0xff000000]));
  const hidden = sink.update(cursorState(0, 0, 0), null, 0, 0, []);
  assert.equal(hidden.kind, "hidden");
  assert.equal(sink.snapshot().kind, "hidden");
  assert.equal(sink.snapshot().dataUrlChars, 0);
  assert.equal(sink.snapshot().updates, 2);
});
