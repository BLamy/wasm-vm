import assert from "node:assert/strict";
import test from "node:test";
import { inspectRecoveryCanvas } from "./e5-t18d-surface.mjs";

function inspect(body, panel, sparse = false) {
  const pixels = new Uint8ClampedArray(128 * 128 * 4);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const value = y < 32 ? panel : body;
    const color = sparse ? (y % 8 === 0 && x % 8 === 0 ? 255 : 0) : value;
    pixels.set([color, color, color, 255], 4 * (y * 128 + x));
  }
  globalThis.document = { getElementById: () => ({ width: 128, height: 128,
    getContext: () => ({ getImageData: () => ({ data: pixels }) }) }) };
  try { return inspectRecoveryCanvas(); } finally { delete globalThis.document; }
}

test("neutral wallpaper with a contrasting panel counts as a desktop", () => {
  const surface = inspect(128, 35);
  assert.equal(surface.colored, 0);
  assert.equal(surface.desktop, true);
});
test("black and flat-gray scanouts do not claim desktop readiness", () => {
  assert.equal(inspect(0, 0).desktop, false);
  assert.equal(inspect(128, 128).desktop, false);
});
test("sparse login text is not confused with a desktop", () => {
  assert.equal(inspect(0, 0, true).desktop, false);
});
