// E5-T06a — deterministic Canvas2D presentation contract and readback proof.
// Run from the repository root with: node --test web/tests/e5-t06a-canvas2d.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Canvas2DBackend } from "../src/sink/canvas2d.js";

class FakeCanvas {
  constructor(width, height) {
    this._width = width;
    this._height = height;
    this.context = new FakeContext2D(this);
  }

  get width() {
    return this._width;
  }

  set width(value) {
    this._width = value;
    this.context?.reset();
  }

  get height() {
    return this._height;
  }

  set height(value) {
    this._height = value;
    this.context?.reset();
  }

  getContext(kind, attributes) {
    assert.equal(kind, "2d");
    this.context.attributes = { ...attributes };
    return this.context;
  }
}

class FakeContext2D {
  constructor(canvas) {
    this.canvas = canvas;
    this.attributes = null;
    this.puts = [];
    this.imageDataCreations = 0;
    this.maxImageDataBytes = 0;
    this.reset();
  }

  reset() {
    const bytes = Math.max(0, this.canvas._width * this.canvas._height * 4);
    this.pixels = new Uint8ClampedArray(bytes);
  }

  createImageData(width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    this.imageDataCreations += 1;
    this.maxImageDataBytes = Math.max(this.maxImageDataBytes, data.byteLength);
    return { width, height, data };
  }

  putImageData(imageData, destinationX, destinationY) {
    this.puts.push({
      width: imageData.width,
      height: imageData.height,
      x: destinationX,
      y: destinationY,
      data: new Uint8ClampedArray(imageData.data),
    });
    for (let sourceY = 0; sourceY < imageData.height; sourceY += 1) {
      const targetY = destinationY + sourceY;
      if (targetY < 0 || targetY >= this.canvas.height) continue;
      for (let sourceX = 0; sourceX < imageData.width; sourceX += 1) {
        const targetX = destinationX + sourceX;
        if (targetX < 0 || targetX >= this.canvas.width) continue;
        const sourceOffset = (sourceY * imageData.width + sourceX) * 4;
        const targetOffset = (targetY * this.canvas.width + targetX) * 4;
        this.pixels.set(imageData.data.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
  }

  getImageData(x, y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const sourceX = x + column;
        const sourceY = y + row;
        const targetOffset = (row * width + column) * 4;
        if (sourceX < 0 || sourceY < 0 || sourceX >= this.canvas.width || sourceY >= this.canvas.height) {
          continue;
        }
        const sourceOffset = (sourceY * this.canvas.width + sourceX) * 4;
        data.set(this.pixels.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      }
    }
    return { width, height, data };
  }
}

function rgbaReference(words) {
  const expected = new Uint8ClampedArray(words.length * 4);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] >>> 0;
    const offset = index * 4;
    expected[offset] = (word >>> 16) & 0xff;
    expected[offset + 1] = (word >>> 8) & 0xff;
    expected[offset + 2] = word & 0xff;
    expected[offset + 3] = word >>> 24;
  }
  return expected;
}

function canvasReference(width, height, patches = []) {
  const expected = new Uint8ClampedArray(width * height * 4);
  for (const { x, y, width: patchWidth, height: patchHeight, words } of patches) {
    const rgba = rgbaReference(words);
    for (let row = 0; row < patchHeight; row += 1) {
      const sourceOffset = row * patchWidth * 4;
      const targetOffset = ((y + row) * width + x) * 4;
      expected.set(rgba.subarray(sourceOffset, sourceOffset + patchWidth * 4), targetOffset);
    }
  }
  return expected;
}

function frameWithDamage(baseWords, width, rect, damageWords) {
  const frame = new Uint32Array(baseWords);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceOffset = row * rect.width;
    const targetOffset = (rect.y + row) * width + rect.x;
    frame.set(damageWords.subarray(sourceOffset, sourceOffset + rect.width), targetOffset);
  }
  return frame;
}

function assertReadback(canvas, expected) {
  const actual = canvas.context.getImageData(0, 0, canvas.width, canvas.height).data;
  assert.deepEqual([...actual], [...expected]);
}

function runGolden({ canvasWidth, canvasHeight, initial, damage = null }) {
  const canvas = new FakeCanvas(canvasWidth, canvasHeight);
  const backend = new Canvas2DBackend(canvas);
  const initialRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  backend.present(initialRect, initial);
  if (damage !== null) {
    backend.present(damage.rect, frameWithDamage(initial, canvasWidth, damage.rect, damage.words));
  }
  const patches = [{ ...initialRect, words: initial }];
  if (damage !== null) patches.push({ ...damage.rect, words: damage.words });
  assertReadback(canvas, canvasReference(canvasWidth, canvasHeight, patches));
  return { backend, canvas };
}

test("golden pattern 1: one-pixel full frame preserves BGRA-to-RGBA order", () => {
  runGolden({
    canvasWidth: 1,
    canvasHeight: 1,
    initial: new Uint32Array([0x11223344]),
  });
});

test("golden pattern 2: multi-row full frame keeps each row contiguous", () => {
  runGolden({
    canvasWidth: 3,
    canvasHeight: 2,
    initial: new Uint32Array([
      0xff0000ff, 0x80402010, 0x7fabcdef,
      0x01020304, 0xa5b6c7d8, 0x00ffeedd,
    ]),
  });
});

test("golden pattern 3: alpha-zero and opaque pixels survive readback", () => {
  runGolden({
    canvasWidth: 4,
    canvasHeight: 1,
    initial: new Uint32Array([0x00112233, 0xff445566, 0x00000000, 0xffffffff]),
  });
});

test("golden pattern 4: odd-width full frame has no row shear", () => {
  runGolden({
    canvasWidth: 5,
    canvasHeight: 3,
    initial: new Uint32Array([
      0x10010203, 0x11040506, 0x12070809, 0x130a0b0c, 0x140d0e0f,
      0x20101112, 0x21131415, 0x22161718, 0x23191a1b, 0x241c1d1e,
      0x30202122, 0x31232425, 0x32262728, 0x33292a2b, 0x342c2d2e,
    ]),
  });
});

test("golden pattern 5: partial damage updates a non-zero origin exactly", () => {
  const initial = new Uint32Array(6 * 4).fill(0x40101020);
  const damageWords = new Uint32Array([
    0x00010203, 0xffaabbcc, 0x80112233,
    0x7f445566, 0x00ddeeff, 0xffffffff,
  ]);
  runGolden({
    canvasWidth: 6,
    canvasHeight: 4,
    initial,
    damage: { rect: { x: 1, y: 1, width: 3, height: 2 }, words: damageWords },
  });
});

test("partial x=1 width=3 damage changes only its target pixels", () => {
  const canvas = new FakeCanvas(7, 4);
  const backend = new Canvas2DBackend(canvas);
  const background = new Uint32Array(7 * 4).fill(0x7f010203);
  const damageRect = { x: 1, y: 1, width: 3, height: 2 };
  const damageWords = new Uint32Array([
    0xff111213, 0x00141516, 0x80171819,
    0x20212223, 0x24252627, 0x28292a2b,
  ]);
  const damagedFrame = frameWithDamage(background, 7, damageRect, damageWords);
  backend.present({ x: 0, y: 0, width: 7, height: 4 }, background);
  backend.present(damageRect, damagedFrame);
  assert.deepEqual(canvas.context.puts.at(-1), {
    x: 1,
    y: 1,
    width: 3,
    height: 2,
    data: rgbaReference(damageWords),
  });
  assertReadback(canvas, canvasReference(7, 4, [
    { x: 0, y: 0, width: 7, height: 4, words: background },
    { ...damageRect, words: damageWords },
  ]));
});

test("resize discards old staging and bounds 1,000 present cycles by current canvas size", () => {
  const canvas = new FakeCanvas(1, 1);
  const backend = new Canvas2DBackend(canvas);
  let largestStaging = 0;
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const width = iteration % 3 === 0 ? 1 : iteration % 3 === 1 ? 17 : 128;
    const height = iteration % 3 === 0 ? 1 : iteration % 3 === 1 ? 9 : 64;
    backend.resize(width, height);
    const words = new Uint32Array(width * height);
    for (let index = 0; index < words.length; index += 1) {
      words[index] = ((iteration & 0xff) << 24) | ((index & 0xff) << 16) | index;
    }
    backend.present({ x: 0, y: 0, width, height }, words);
    assert.equal(canvas.width, width);
    assert.equal(canvas.height, height);
    assert.ok(backend.stagingCapacity <= width * height * 4);
    assert.equal(backend.canvasByteBudget, width * height * 4);
    largestStaging = Math.max(largestStaging, backend.stagingCapacity);
  }
  assert.equal(backend.presentCount, 1_000);
  assert.equal(largestStaging, 128 * 64 * 4);
  assertReadback(canvas, rgbaReference(new Uint32Array([0xe7000000])));
});

test("plain source and browser projection stay byte-identical", () => {
  const source = readFileSync(new URL("../src/sink/canvas2d.js", import.meta.url), "utf8");
  const projection = readFileSync(new URL("../src/sink/canvas2d.ts", import.meta.url), "utf8");
  assert.equal(projection, source);
});

test("invalid damage and pixel counts fail before a Canvas2D write", () => {
  const canvas = new FakeCanvas(4, 4);
  const backend = new Canvas2DBackend(canvas);
  assert.throws(() => backend.present({ x: 1, y: 1, width: 4, height: 1 }, new Uint32Array(4)), RangeError);
  assert.throws(() => backend.present({ x: 0, y: 0, width: 2, height: 2 }, new Uint32Array(3)), RangeError);
  assert.equal(canvas.context.puts.length, 0);
});
