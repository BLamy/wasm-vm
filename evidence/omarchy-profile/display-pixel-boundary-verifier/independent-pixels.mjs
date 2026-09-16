import assert from "node:assert/strict";
import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");

// Intentionally independent of product and worker harness converters: byte
// indices, not Uint32Array words, describe little-endian BGRA wire storage.
export function wireToVisibleRgba(bytes, frame, width, height) {
  assert.ok([1, 2].includes(frame.format));
  assert.equal(bytes.length, frame.resourceWidth * frame.resourceHeight * 4);
  const out = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const destination = 4 * (width * y + x);
      out[destination + 3] = 255;
      if (x >= frame.resourceWidth || y >= frame.resourceHeight) continue;
      const source = 4 * (frame.resourceWidth * y + x);
      out[destination] = bytes[source + 2];
      out[destination + 1] = bytes[source + 1];
      out[destination + 2] = bytes[source];
      if (frame.format === 1) out[destination + 3] = bytes[source + 3];
    }
  }
  return out;
}

export function compareRgba(left, right, width) {
  assert.equal(left.length, right.length);
  let changedBytes = 0, changedPixels = 0, first = null;
  let minX = width, minY = left.length / 4 / width, maxX = -1, maxY = -1;
  for (let at = 0; at < left.length; at += 4) {
    let different = false;
    for (let c = 0; c < 4; c++) if (left[at + c] !== right[at + c]) {
      changedBytes++; different = true;
      first ??= { byte: at + c, left: left[at + c], right: right[at + c] };
    }
    if (different) {
      changedPixels++;
      const x = (at / 4) % width, y = Math.floor(at / 4 / width);
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  return { equal: changedBytes === 0, changedBytes, changedPixels, first,
    bounds: changedPixels ? { minX, minY, maxX, maxY } : null,
    leftSha256: sha256(left), rightSha256: sha256(right) };
}

export function checkLiteralOracle() {
  const raw = Buffer.from([
    3, 2, 1, 0, 13, 12, 11, 99, 23, 22, 21, 0,
    33, 32, 31, 254, 43, 42, 41, 23, 53, 52, 51, 0,
    63, 62, 61, 0, 73, 72, 71, 0, 83, 82, 81, 0,
  ]);
  const converted = wireToVisibleRgba(raw, { format: 2, resourceWidth: 3, resourceHeight: 3 }, 2, 2);
  assert.deepEqual([...converted], [1, 2, 3, 255, 11, 12, 13, 255, 31, 32, 33, 255, 41, 42, 43, 255]);
  const changed = Buffer.from(converted); changed[8] ^= 1;
  assert.deepEqual(compareRgba(converted, changed, 2).bounds, { minX: 0, minY: 1, maxX: 0, maxY: 1 });
  assert.equal(compareRgba(converted, changed, 2).changedPixels, 1);
  return { literalOracle: "held", bytes: converted.length, sha256: sha256(converted) };
}
