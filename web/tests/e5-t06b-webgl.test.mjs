// E5-T06b — deterministic WebGL2 presentation contract and readback proof.
// Run from the repository root with: node --test web/tests/e5-t06b-webgl.test.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WebGL2Backend } from "../src/sink/webgl.js";

class FakeCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.context = new FakeWebGL2(this);
    this.contextRequests = [];
  }

  getContext(kind, attributes) {
    this.contextRequests.push({ kind, attributes: { ...attributes } });
    assert.equal(kind, "webgl2");
    return this.context;
  }
}

class FakeWebGL2 {
  constructor(canvas) {
    this.canvas = canvas;
    this.VERTEX_SHADER = 1;
    this.FRAGMENT_SHADER = 2;
    this.COMPILE_STATUS = 3;
    this.LINK_STATUS = 4;
    this.ARRAY_BUFFER = 5;
    this.STATIC_DRAW = 6;
    this.FLOAT = 7;
    this.TEXTURE_2D = 8;
    this.TEXTURE_MIN_FILTER = 9;
    this.TEXTURE_MAG_FILTER = 10;
    this.TEXTURE_WRAP_S = 11;
    this.TEXTURE_WRAP_T = 12;
    this.NEAREST = 13;
    this.CLAMP_TO_EDGE = 14;
    this.UNPACK_ALIGNMENT = 15;
    this.UNPACK_ROW_LENGTH = 16;
    this.UNPACK_SKIP_PIXELS = 17;
    this.UNPACK_SKIP_ROWS = 18;
    this.RGBA = 19;
    this.UNSIGNED_BYTE = 20;
    this.TEXTURE0 = 21;
    this.BLEND = 22;
    this.TRIANGLE_STRIP = 23;
    this.NO_ERROR = 0;
    this.shaders = [];
    this.programs = [];
    this.textures = [];
    this.buffers = [];
    this.vertexArrays = [];
    this.shaderSources = { vertex: "", fragment: "" };
    this.pixelStore = new Map();
    this.pixelStoreCalls = [];
    this.subImageCalls = [];
    this.texImageCalls = [];
    this.drawCalls = 0;
    this.deleted = { textures: [], buffers: [], vertexArrays: [], programs: [] };
    this.boundTexture = null;
    this.boundProgram = null;
    this.boundVertexArray = null;
    this.viewportSize = [0, 0, 0, 0];
  }

  createShader(type) {
    const shader = { id: this.shaders.length + 1, type, source: "", compiled: true };
    this.shaders.push(shader);
    return shader;
  }

  shaderSource(shader, source) {
    shader.source = source;
    if (shader.type === this.VERTEX_SHADER) this.shaderSources.vertex = source;
    if (shader.type === this.FRAGMENT_SHADER) this.shaderSources.fragment = source;
  }

  compileShader() {}

  getShaderParameter(shader, parameter) {
    assert.equal(parameter, this.COMPILE_STATUS);
    return shader.compiled;
  }

  getShaderInfoLog() {
    return "";
  }

  deleteShader(shader) {
    shader.deleted = true;
  }

  createProgram() {
    const program = { id: this.programs.length + 1, shaders: [], linked: true };
    this.programs.push(program);
    return program;
  }

  attachShader(program, shader) {
    program.shaders.push(shader);
  }

  linkProgram(program) {
    program.vertexSource = program.shaders.find((shader) => shader.type === this.VERTEX_SHADER)?.source ?? "";
    program.fragmentSource = program.shaders.find((shader) => shader.type === this.FRAGMENT_SHADER)?.source ?? "";
  }

  getProgramParameter(program, parameter) {
    assert.equal(parameter, this.LINK_STATUS);
    return program.linked;
  }

  getProgramInfoLog() {
    return "";
  }

  deleteProgram(program) {
    program.deleted = true;
    this.deleted.programs.push(program);
  }

  createVertexArray() {
    const vertexArray = { id: this.vertexArrays.length + 1 };
    this.vertexArrays.push(vertexArray);
    return vertexArray;
  }

  bindVertexArray(vertexArray) {
    this.boundVertexArray = vertexArray;
  }

  deleteVertexArray(vertexArray) {
    vertexArray.deleted = true;
    this.deleted.vertexArrays.push(vertexArray);
  }

  createBuffer() {
    const buffer = { id: this.buffers.length + 1 };
    this.buffers.push(buffer);
    return buffer;
  }

  bindBuffer(_target, buffer) {
    this.boundBuffer = buffer;
  }

  bufferData(_target, data) {
    this.boundBuffer.data = new Float32Array(data);
  }

  deleteBuffer(buffer) {
    buffer.deleted = true;
    this.deleted.buffers.push(buffer);
  }

  getAttribLocation() {
    return 0;
  }

  getUniformLocation(program, name) {
    return { program, name };
  }

  enableVertexAttribArray() {}

  vertexAttribPointer() {}

  createTexture() {
    const texture = { id: this.textures.length + 1, width: 0, height: 0, data: new Uint8Array(0) };
    this.textures.push(texture);
    return texture;
  }

  bindTexture(_target, texture) {
    this.boundTexture = texture;
  }

  texParameteri() {}

  pixelStorei(parameter, value) {
    this.pixelStore.set(parameter, value);
    this.pixelStoreCalls.push({ parameter, value });
  }

  texImage2D(...args) {
    const [, , , width, height] = args;
    assert.ok(this.boundTexture);
    this.boundTexture.width = width;
    this.boundTexture.height = height;
    this.boundTexture.data = new Uint8Array(width * height * 4);
    this.texImageCalls.push({ width, height });
  }

  texSubImage2D(...args) {
    const [, , x, y, width, height, , , source] = args;
    assert.ok(this.boundTexture);
    const rowLength = this.pixelStore.get(this.UNPACK_ROW_LENGTH) || width;
    const skipPixels = this.pixelStore.get(this.UNPACK_SKIP_PIXELS) || 0;
    const skipRows = this.pixelStore.get(this.UNPACK_SKIP_ROWS) || 0;
    this.subImageCalls.push({ x, y, width, height, source });
    for (let row = 0; row < height; row += 1) {
      const sourceOffset = ((skipRows + row) * rowLength + skipPixels) * 4;
      const targetOffset = ((y + row) * this.boundTexture.width + x) * 4;
      this.boundTexture.data.set(source.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
    }
  }

  deleteTexture(texture) {
    texture.deleted = true;
    this.deleted.textures.push(texture);
  }

  viewport(x, y, width, height) {
    this.viewportSize = [x, y, width, height];
  }

  useProgram(program) {
    this.boundProgram = program;
  }

  activeTexture() {}

  uniform1i() {}

  disable() {}

  drawArrays() {
    assert.ok(this.boundProgram);
    assert.ok(this.boundTexture);
    this.drawCalls += 1;
    const texture = this.boundTexture;
    const flipY = this.boundProgram.vertexSource.includes("0.5 - a_position.y * 0.5");
    const swizzle = this.boundProgram.fragmentSource.includes(".bgra");
    this.framebuffer = new Uint8ClampedArray(this.canvas.width * this.canvas.height * 4);
    for (let screenY = 0; screenY < this.canvas.height; screenY += 1) {
      const textureY = flipY ? screenY : texture.height - screenY - 1;
      for (let screenX = 0; screenX < this.canvas.width; screenX += 1) {
        const sourceOffset = (textureY * texture.width + screenX) * 4;
        const targetOffset = (screenY * this.canvas.width + screenX) * 4;
        const raw = texture.data;
        this.framebuffer[targetOffset] = raw[sourceOffset + (swizzle ? 2 : 0)];
        this.framebuffer[targetOffset + 1] = raw[sourceOffset + 1];
        this.framebuffer[targetOffset + 2] = raw[sourceOffset + (swizzle ? 0 : 2)];
        this.framebuffer[targetOffset + 3] = raw[sourceOffset + 3];
      }
    }
  }

  readPixels(x, y, width, height, _format, _type, target) {
    assert.ok(this.framebuffer);
    for (let row = 0; row < height; row += 1) {
      const sourceY = this.canvas.height - y - row - 1;
      const sourceOffset = (sourceY * this.canvas.width + x) * 4;
      const targetOffset = row * width * 4;
      target.set(this.framebuffer.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
    }
  }

  getError() {
    return this.NO_ERROR;
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

function frameWithDamage(baseWords, width, rect, damageWords) {
  const frame = new Uint32Array(baseWords);
  for (let row = 0; row < rect.height; row += 1) {
    const sourceOffset = row * rect.width;
    const targetOffset = (rect.y + row) * width + rect.x;
    frame.set(damageWords.subarray(sourceOffset, sourceOffset + rect.width), targetOffset);
  }
  return frame;
}

function expectedFrame(width, height, patches) {
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

function readbackTopToBottom(gl, width, height) {
  const bottomUp = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bottomUp);
  const topDown = new Uint8ClampedArray(bottomUp.length);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = (height - row - 1) * width * 4;
    const targetOffset = row * width * 4;
    topDown.set(bottomUp.subarray(sourceOffset, sourceOffset + width * 4), targetOffset);
  }
  return topDown;
}

function assertReadback(canvas, expected) {
  assert.deepEqual([...readbackTopToBottom(canvas.context, canvas.width, canvas.height)], [...expected]);
}

function runGolden({ canvasWidth, canvasHeight, initial, damage = null }) {
  const canvas = new FakeCanvas(canvasWidth, canvasHeight);
  const backend = new WebGL2Backend(canvas);
  const fullRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  backend.present(fullRect, initial);
  const patches = [{ ...fullRect, words: initial }];
  if (damage !== null) {
    const damagedFrame = frameWithDamage(initial, canvasWidth, damage.rect, damage.words);
    backend.present(damage.rect, damagedFrame);
    patches.push({ ...damage.rect, words: damage.words });
  }
  assertReadback(canvas, expectedFrame(canvasWidth, canvasHeight, patches));
  assert.equal(canvas.context.getError(), canvas.context.NO_ERROR);
  backend.dispose();
}

test("golden pattern 1: one-pixel frame is vertically oriented and swizzled", () => {
  runGolden({
    canvasWidth: 1,
    canvasHeight: 1,
    initial: new Uint32Array([0x11223344]),
  });
});

test("golden pattern 2: multi-row frame preserves row order", () => {
  runGolden({
    canvasWidth: 3,
    canvasHeight: 2,
    initial: new Uint32Array([
      0xff0000ff, 0x80402010, 0x7fabcdef,
      0x01020304, 0xa5b6c7d8, 0x00ffeedd,
    ]),
  });
});

test("golden pattern 3: alpha-zero and opaque pixels survive the shader", () => {
  runGolden({
    canvasWidth: 4,
    canvasHeight: 1,
    initial: new Uint32Array([0x00112233, 0xff445566, 0x00000000, 0xffffffff]),
  });
});

test("golden pattern 4: odd-width texture has no row shear", () => {
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

test("golden pattern 5: partial damage matches the Canvas2D oracle", () => {
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

test("partial x=1 width=3 upload uses full-frame stride and leaves surrounding pixels", () => {
  const canvas = new FakeCanvas(7, 4);
  const backend = new WebGL2Backend(canvas);
  const background = new Uint32Array(7 * 4).fill(0x7f010203);
  const damageRect = { x: 1, y: 1, width: 3, height: 2 };
  const damageWords = new Uint32Array([
    0xff111213, 0x00141516, 0x80171819,
    0x20212223, 0x24252627, 0x28292a2b,
  ]);
  const damagedFrame = frameWithDamage(background, 7, damageRect, damageWords);
  backend.present({ x: 0, y: 0, width: 7, height: 4 }, background);
  backend.present(damageRect, damagedFrame);
  const upload = canvas.context.subImageCalls.at(-1);
  assert.deepEqual({ x: upload.x, y: upload.y, width: upload.width, height: upload.height }, {
    x: 1,
    y: 1,
    width: 3,
    height: 2,
  });
  assert.equal(upload.source instanceof Uint8Array, true);
  assert.equal(upload.source.byteLength, 7 * 4 * 4);
  assert.equal(upload.source.buffer instanceof SharedArrayBuffer, false);
  assert.ok(canvas.context.pixelStoreCalls.some(({ parameter, value }) =>
    parameter === canvas.context.UNPACK_ROW_LENGTH && value === 7));
  assert.equal(canvas.context.pixelStore.get(canvas.context.UNPACK_ROW_LENGTH), 0);
  assert.equal(canvas.context.pixelStore.get(canvas.context.UNPACK_SKIP_PIXELS), 0);
  assert.equal(canvas.context.pixelStore.get(canvas.context.UNPACK_SKIP_ROWS), 0);
  assertReadback(canvas, expectedFrame(7, 4, [
    { x: 0, y: 0, width: 7, height: 4, words: background },
    { ...damageRect, words: damageWords },
  ]));
  backend.dispose();
});

test("SharedArrayBuffer input is bulk-copied and transparent pixels do not blend with old data", () => {
  const canvas = new FakeCanvas(2, 2);
  const backend = new WebGL2Backend(canvas);
  const shared = new SharedArrayBuffer(2 * 2 * Uint32Array.BYTES_PER_ELEMENT);
  const frame = new Uint32Array(shared);
  frame.set([0xffffffff, 0xff000000, 0x00010203, 0x80112233]);
  backend.present({ x: 0, y: 0, width: 2, height: 2 }, frame);
  assertReadback(canvas, rgbaReference(frame));
  assert.equal(backend.stagingCapacity, 2 * 2 * 4);
  assert.equal(canvas.context.subImageCalls.at(-1).source.buffer instanceof SharedArrayBuffer, false);
  backend.dispose();
});

test("unavailable WebGL2 and non-word sources fail closed before an upload", () => {
  const unavailableCanvas = {
    width: 1,
    height: 1,
    getContext: () => null,
  };
  assert.throws(() => new WebGL2Backend(unavailableCanvas), TypeError);

  const canvas = new FakeCanvas(2, 2);
  const backend = new WebGL2Backend(canvas);
  assert.throws(() => backend.present(
    { x: 0, y: 0, width: 2, height: 2 },
    new Uint8Array(2 * 2 * 4),
  ), TypeError);
  assert.equal(canvas.context.subImageCalls.length, 0);
  backend.dispose();
});

test("1,000 alternating texture sizes keep staging bounded and dispose GL objects", () => {
  const canvas = new FakeCanvas(1, 1);
  const backend = new WebGL2Backend(canvas);
  let largestStaging = 0;
  for (let iteration = 0; iteration < 1_000; iteration += 1) {
    const width = iteration % 3 === 0 ? 1 : iteration % 3 === 1 ? 17 : 128;
    const height = iteration % 3 === 0 ? 1 : iteration % 3 === 1 ? 9 : 64;
    backend.resize(width, height);
    const frame = new Uint32Array(width * height);
    frame.fill(((iteration & 0xff) << 24) | 0x00010203);
    backend.present({ x: 0, y: 0, width, height }, frame);
    assert.ok(backend.stagingCapacity <= width * height * 4);
    assert.equal(backend.canvasByteBudget, width * height * 4);
    largestStaging = Math.max(largestStaging, backend.stagingCapacity);
  }
  assert.equal(backend.presentCount, 1_000);
  assert.equal(largestStaging, 128 * 64 * 4);
  const texture = canvas.context.textures[0];
  backend.dispose();
  assert.equal(texture.deleted, true);
  assert.equal(canvas.context.deleted.textures.length, 1);
  assert.equal(canvas.context.deleted.buffers.length, 1);
  assert.equal(canvas.context.deleted.vertexArrays.length, 1);
  assert.equal(canvas.context.deleted.programs.length, 1);
  assert.equal(backend.stagingCapacity, 0);
  assert.throws(() => backend.present({ x: 0, y: 0, width: 1, height: 1 }, new Uint32Array([0])), Error);
});

test("plain source and browser projection stay byte-identical", () => {
  const source = readFileSync(new URL("../src/sink/webgl.js", import.meta.url), "utf8");
  const projection = readFileSync(new URL("../src/sink/webgl.ts", import.meta.url), "utf8");
  assert.equal(projection, source);
});
