import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createTextOracle, validateTemplate, findTemplate } from "./e5-t26f-text-oracle.mjs";

const background = [8, 24, 12, 255], ink = [230, 240, 210, 255];
// Synthetic reviewed test raster only: this is not a captured browser token or OCR fixture.
const glyph = ["11110", "10000", "11100", "10000", "11110"];
function raster(rows = glyph) {
  return { width: rows[0].length, height: rows.length,
    rgba: Uint8Array.from(rows.flatMap(row => [...row].flatMap(bit => bit === "1" ? ink : background))) };
}
function frame(width = 24, height = 16) {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < pixels.length; i += 4) pixels.set(background, i);
  return { pixels, width, height, region: { left: 0, top: 0, right: width, bottom: height }, template: raster() };
}
function paste(image, x, y, template = image.template) {
  for (let row = 0; row < template.height; row++) {
    for (let column = 0; column < template.width; column++) {
      if (x + column < 0 || x + column >= image.width || y + row < 0 || y + row >= image.height) continue;
      const src = (row * template.width + column) * 4;
      image.pixels.set(template.rgba.slice(src, src + 4), ((y + row) * image.width + x + column) * 4);
    }
  }
  return image;
}

test("exact full raster matches all placements in deterministic row-major order", () => {
  const input = paste(paste(frame(), 13, 8), 2, 1);
  assert.deepEqual(findTemplate(input), [{ x: 2, y: 1 }, { x: 13, y: 8 }]);
});

test("pinned 72x13 reviewed raster matches an artificial blit, not a browser acceptance claim", () => {
  const retained = JSON.parse(readFileSync(new URL("../../evidence/e5-t26f/resident-text-template.json", import.meta.url), "utf8"));
  const rgba = Buffer.from(retained.rgbaBase64, "base64");
  const digest = "868249728c21a50b44997f9a83499202dafaecdf6e07f345d08e8da8ab5294fc";
  assert.equal(retained.width, 72);
  assert.equal(retained.height, 13);
  assert.equal(retained.text, "e5t26f-aplay");
  assert.equal(retained.rgbaSha256, digest);
  assert.equal(createHash("sha256").update(rgba).digest("hex"), digest);
  const input = frame(180, 50);
  input.template = validateTemplate({ width: retained.width, height: retained.height, rgba });
  input.region = { left: 10, top: 10, right: 170, bottom: 45 };
  assert.deepEqual(findTemplate(input), []);
  paste(input, 30, 20);
  assert.deepEqual(findTemplate(input), [{ x: 30, y: 20 }]);
  input.pixels[((20 + 6) * input.width + 30 + 35) * 4] ^= 1;
  assert.deepEqual(findTemplate(input), [], "one changed raster byte is not the pinned token image");
  assert.equal(createHash("sha256").update(rgba).digest("hex"), digest, "matching never edits the retained template bytes");
});

test("wrong same-size glyph and individual RGBA mismatches do not match", () => {
  const other = raster(["11110", "10000", "11010", "10000", "11110"]);
  assert.deepEqual(findTemplate(paste(frame(), 3, 2, other)), []);
  for (let channel = 0; channel < 4; channel++) {
    const input = paste(frame(), 3, 2);
    input.pixels[((2 + 2) * input.width + 3 + 3) * 4 + channel] ^= 1;
    assert.deepEqual(findTemplate(input), [], `channel ${channel} must be exact`);
  }
});

test("solid templates/transparency refuse; solid frames and cursor-shaped patches are not the glyph", () => {
  assert.throws(() => validateTemplate(raster(["000", "000"])), /solid color/);
  assert.throws(() => validateTemplate(raster(["111", "111"])), /solid color/);
  const translucent = raster(); translucent.rgba[3] = 254;
  assert.throws(() => validateTemplate(translucent), /opaque/);
  assert.deepEqual(findTemplate(frame()), []);
  const cursor = raster(["10000", "11000", "11100", "11110", "10000"]);
  assert.deepEqual(findTemplate(paste(frame(), 3, 2, cursor)), []);
});

test("each ROI boundary excludes any clipped portion; exact inclusive/exclusive bounds include full raster", () => {
  const input = paste(frame(), 4, 3);
  input.region = { left: 4, top: 3, right: 9, bottom: 8 };
  assert.deepEqual(findTemplate(input), [{ x: 4, y: 3 }]);
  for (const changed of [{ left: 5 }, { top: 4 }, { right: 8 }, { bottom: 7 }]) {
    assert.deepEqual(findTemplate({ ...input, region: { ...input.region, ...changed } }), [], JSON.stringify(changed));
  }
});

test("full rasters at all four frame corners match; partial rasters beyond each frame edge do not", () => {
  for (const [x, y] of [[0, 0], [19, 0], [0, 11], [19, 11]]) {
    assert.deepEqual(findTemplate(paste(frame(), x, y)), [{ x, y }]);
  }
  for (const [x, y] of [[-1, 3], [20, 3], [3, -1], [3, 12]]) {
    assert.deepEqual(findTemplate(paste(frame(), x, y)), []);
  }
});

test("old marker outside ROI is excluded; an absent baseline then fresh exact raster is observable", () => {
  const input = paste(frame(), 0, 0);
  input.region = { left: 10, top: 6, right: 24, bottom: 16 };
  assert.deepEqual(findTemplate(input), []);
  paste(input, 14, 8);
  assert.deepEqual(findTemplate(input), [{ x: 14, y: 8 }]);
  // The caller, not this matcher, must enforce absence/freshness and pin token provenance.
});

test("all four matches returned, fifth match refuses without a truncated success result", () => {
  const input = frame(40, 8);
  for (const x of [0, 7, 14, 21]) paste(input, x, 1);
  assert.deepEqual(findTemplate(input), [0, 7, 14, 21].map(x => ({ x, y: 1 })));
  paste(input, 28, 1);
  assert.throws(() => findTemplate(input), /match overflow/);
});

test("overlapping exact occurrences are not skipped", () => {
  const input = frame(5, 1);
  input.template = raster(["101"]);
  paste(input, 0, 0, raster(["10101"]));
  assert.deepEqual(findTemplate(input), [{ x: 0, y: 0 }, { x: 2, y: 0 }]);
});

test("frame/template geometry rejects zero, fractional, NaN, unsafe, oversized, and coerced inputs", () => {
  for (const value of [undefined, null, NaN, Infinity, -Infinity, -1, 0, 1.5, "5", true, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ["width", "height"]) {
      assert.throws(() => validateTemplate({ ...raster(), [key]: value }), /invalid template/);
      assert.throws(() => findTemplate({ ...frame(), [key]: value }), /invalid frame/);
    }
  }
  for (const [key, value] of [["width", 257], ["height", 33]]) {
    assert.throws(() => validateTemplate({ ...raster(), [key]: value }), /invalid template/);
  }
  for (const [key, value] of [["width", 1281], ["height", 801]]) {
    assert.throws(() => findTemplate({ ...frame(), [key]: value }), /invalid frame/);
  }
  for (const value of [null, undefined, 3, [], "frame"]) {
    assert.throws(() => validateTemplate(value));
    assert.throws(() => findTemplate(value));
  }
});

test("ROI is explicit, integral, nonempty, noninverted, and wholly within the frame", () => {
  for (const region of [undefined, null, [], {},
    { left: -1, top: 0, right: 5, bottom: 5 }, { left: 0, top: -1, right: 5, bottom: 5 },
    { left: 0, top: 0, right: 25, bottom: 5 }, { left: 0, top: 0, right: 5, bottom: 17 },
    { left: 5, top: 0, right: 5, bottom: 5 }, { left: 0, top: 5, right: 5, bottom: 5 },
    { left: 6, top: 0, right: 5, bottom: 5 }, { left: 0, top: 6, right: 5, bottom: 5 }]) {
    assert.throws(() => findTemplate({ ...frame(), region }), /invalid region/);
  }
  for (const key of ["left", "top", "right", "bottom"]) {
    for (const value of [NaN, Infinity, 1.5, "2", undefined]) {
      const input = frame(); input.region[key] = value;
      assert.throws(() => findTemplate(input), /invalid region/);
    }
  }
});

test("byte arrays require exact lengths and integer unsigned bytes without coercion or holes", () => {
  const source = raster();
  for (const bad of [null, {}, "bytes", new Int8Array(source.rgba.length), new Uint16Array(source.rgba.length),
    new Float32Array(source.rgba.length), new DataView(source.rgba.buffer),
    source.rgba.slice(1), new Uint8Array(source.rgba.length + 1)]) {
    assert.throws(() => validateTemplate({ ...source, rgba: bad }));
  }
  for (const bad of [-1, 256, 1.5, NaN, Infinity, "8", undefined, null]) {
    const rgba = Array.from(source.rgba); rgba[0] = bad;
    assert.throws(() => validateTemplate({ ...source, rgba }), /invalid template RGBA byte/);
    const input = frame(); input.pixels = Array.from(input.pixels); input.pixels[0] = bad;
    assert.throws(() => findTemplate(input), /invalid frame RGBA byte/);
  }
  const sparse = Array.from(source.rgba); delete sparse[0];
  assert.throws(() => validateTemplate({ ...source, rgba: sparse }));
  const input = frame();
  assert.throws(() => findTemplate({ ...input, pixels: input.pixels.slice(4) }), /length/);
  assert.throws(() => findTemplate({ ...input, pixels: new Uint8Array(input.pixels.length + 4) }), /length/);
});

test("shared, resizable, and detached byte storage refuses rather than observing unstable bytes", () => {
  const template = raster();
  const shared = new Uint8Array(new SharedArrayBuffer(template.rgba.length)); shared.set(template.rgba);
  assert.throws(() => validateTemplate({ ...template, rgba: shared }), /shared\/resizable/);
  const input = frame();
  assert.throws(() => findTemplate({ ...input, pixels: new Uint8Array(new SharedArrayBuffer(input.pixels.length)) }), /shared\/resizable/);
  const resizable = new ArrayBuffer(template.rgba.length, { maxByteLength: template.rgba.length * 2 });
  if (resizable.resizable) assert.throws(() => validateTemplate({ ...template, rgba: new Uint8Array(resizable) }), /shared\/resizable/);
  structuredClone(template.rgba.buffer, { transfer: [template.rgba.buffer] });
  assert.throws(() => validateTemplate(template), /length/);
});

test("validation owns immutable template bytes; matching preserves all inputs and has no retained state", () => {
  const original = raster(), snapshot = Array.from(original.rgba);
  const template = validateTemplate(original);
  assert.deepEqual(Array.from(original.rgba), snapshot);
  original.rgba.fill(0); original.width = 1;
  assert.deepEqual(template.rgba, snapshot);
  assert.equal(template.width, 5);
  assert.throws(() => { template.rgba[0] = 0; }, TypeError);
  assert.throws(() => { template.width = 1; }, TypeError);
  const input = frame(); input.template = template; paste(input, 2, 3);
  const before = structuredClone(input);
  const matches = findTemplate(input); matches[0].x = 99; matches.push({ x: 0, y: 0 });
  assert.deepEqual(input, before);
  assert.deepEqual(findTemplate(input), [{ x: 2, y: 3 }]);
  const bytes = new Uint8Array(input.pixels.length + 8); bytes.set(input.pixels, 4);
  assert.deepEqual(findTemplate({ ...input, pixels: bytes.subarray(4, -4) }), [{ x: 2, y: 3 }]);
});

test("maximum allowed dimensions work without widening fixed limits", () => {
  const input = frame(1280, 800);
  input.template = raster(Array.from({ length: 32 }, () => "1" + "0".repeat(255)));
  paste(input, 1024, 768);
  input.region = { left: 1024, top: 768, right: 1280, bottom: 800 };
  assert.deepEqual(findTemplate(input), [{ x: 1024, y: 768 }]);
});

test("adversarial late mismatches exhaust a fixed comparison budget and fail closed", () => {
  const input = frame(1280, 800);
  for (let y = 0; y < input.height; y++) {
    for (let x = 0; x < input.width; x++) input.pixels.set(x % 2 ? ink : background, (y * input.width + x) * 4);
  }
  input.template = raster(Array.from({ length: 32 }, () => "01".repeat(128)));
  input.template.rgba[input.template.rgba.length - 4] = 100; // Both anchors fit, final pixel never does.
  assert.throws(() => findTemplate(input), /comparison work limit/);
});

test("factory serializes without imports, timers, DOM, or global installation", () => {
  const context = vm.createContext({});
  const before = vm.runInContext("Reflect.ownKeys(globalThis)", context);
  const oracle = vm.runInContext(`(${createTextOracle.toString()})()`, context);
  const input = paste(frame(), 2, 3);
  input.pixels = Array.from(input.pixels); input.template.rgba = Array.from(input.template.rgba);
  assert.deepEqual(JSON.parse(JSON.stringify(oracle.findTemplate(input))), [{ x: 2, y: 3 }]);
  assert.deepEqual(vm.runInContext("Reflect.ownKeys(globalThis)", context), before);
  const isolated = createTextOracle();
  assert.deepEqual(isolated.findTemplate(input), [{ x: 2, y: 3 }]);
});
