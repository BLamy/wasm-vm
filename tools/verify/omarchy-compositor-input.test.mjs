import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeInputEvents, assertOriginalInputGeometry } from "./omarchy-compositor-input-capture.mjs";

test("literal RV64 events preserve signed values, drops, and incomplete bytes", () => {
  assert.deepEqual(decodeInputEvents("0100000000000000020000000000000001001e0001000000"), {
    events: [{ seconds: "1", microseconds: "2", type: 1, code: 30, value: 1 }], trailingHex: "" });
  assert.deepEqual(decodeInputEvents("0300000000000000040000000000000000000300000000000500000000000000060000000000000001001e00ffffffffa5"), {
    events: [{ seconds: "3", microseconds: "4", type: 0, code: 3, value: 0 },
      { seconds: "5", microseconds: "6", type: 1, code: 30, value: -1 }], trailingHex: "a5" });
  assert.deepEqual(decodeInputEvents(""), { events: [], trailingHex: "" });
  for (const hex of ["1", "zz", "0A", "00 "]) assert.throws(() => decodeInputEvents(hex));
});

test("damage rectangles remain bounded independently of original display dimensions", () => {
  const state = { width: 1280, height: 800, fixedViewport: true, gpu: { width: 1280, height: 800 },
    latest: { resourceWidth: 1280, resourceHeight: 832, rect: { x: 10, y: 36, width: 118, height: 28 } },
    framesReceived: 3, successfulPresents: 3 };
  assertOriginalInputGeometry(state);
  for (const mutate of [s => s.width = 640, s => s.gpu.height = 400, s => s.latest.resourceHeight = 800,
    s => s.latest.rect.x = -1, s => s.latest.rect.width = 0, s => s.latest.rect.height = 801,
    s => s.latest.rect.y = .5, s => s.fixedViewport = false, s => s.framesReceived = 0]) {
    const attack = structuredClone(state); mutate(attack); assert.throws(() => assertOriginalInputGeometry(attack));
  }
});
