import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";

// Independent, bounded decoder for the RGB/RGBA PNGs emitted by Chromium.
// This does not import the recorder, product presentation, or a worker oracle.
export function pngRgba(png) {
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  let cursor = 8, width, height, channels, end = false;
  const compressed = [];
  while (cursor < png.length) {
    assert.ok(cursor + 12 <= png.length);
    const size = png.readUInt32BE(cursor), type = png.toString("ascii", cursor + 4, cursor + 8);
    assert.ok(cursor + 12 + size <= png.length);
    const data = png.subarray(cursor + 8, cursor + 8 + size);
    if (type === "IHDR") {
      assert.equal(width, undefined); assert.equal(size, 13);
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      assert.ok(width > 0 && width <= 4096 && height > 0 && height <= 4096);
      assert.equal(data[8], 8); assert.ok([2, 6].includes(data[9]));
      channels = data[9] === 2 ? 3 : 4;
      assert.deepEqual([...data.subarray(10)], [0, 0, 0]);
    } else if (type === "IDAT") compressed.push(data);
    else if (type === "IEND") { assert.equal(size, 0); end = true; }
    cursor += size + 12;
    if (end) break;
  }
  assert.ok(end && width && compressed.length); assert.equal(cursor, png.length);
  const stride = width * channels;
  const packed = inflateSync(Buffer.concat(compressed), { maxOutputLength: (stride + 1) * height });
  assert.equal(packed.length, (stride + 1) * height);
  const scan = Buffer.alloc(stride * height);
  const paeth = (left, up, upperLeft) => {
    const p = left + up - upperLeft;
    const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
    return a <= b && a <= c ? left : b <= c ? up : upperLeft;
  };
  for (let y = 0; y < height; y++) {
    const filter = packed[(stride + 1) * y]; assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const at = stride * y + x, left = x >= channels ? scan[at - channels] : 0;
      const up = y ? scan[at - stride] : 0;
      const upperLeft = y && x >= channels ? scan[at - stride - channels] : 0;
      const predictor = [0, left, up, Math.floor((left + up) / 2), paeth(left, up, upperLeft)][filter];
      scan[at] = (packed[(stride + 1) * y + x + 1] + predictor) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = scan[i * channels];
    rgba[i * 4 + 1] = scan[i * channels + 1];
    rgba[i * 4 + 2] = scan[i * channels + 2];
    rgba[i * 4 + 3] = channels === 4 ? scan[i * channels + 3] : 255;
  }
  return { width, height, rgba };
}
