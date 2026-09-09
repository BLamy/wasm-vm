// E5-T18c — CSS-space desktop geometry and half-open window-control hit tests.

import assert from "node:assert/strict";
import test from "node:test";
import { createPointerBridge } from "../src/input/pointer.js";

import {
  DESKTOP_HEIGHT,
  DESKTOP_WIDTH,
  clientPointFromGuest,
  guestPixelFromClient,
  hitTestGuestPixel,
  tabletPointFromGuest,
  westonWindowControls,
} from "../src/input/desktop-geometry.js";

function rect() {
  return { left: 37.25, top: 19.5, width: 997.5, height: 623.75 };
}

test("CSS offsets and fractional scale map guest corners without DPR/backing-store input", () => {
  const bounds = rect();
  for (const dpr of [1, 1.5, 2]) {
    assert.deepEqual(
      guestPixelFromClient(bounds.left, bounds.top, bounds, {
        width: DESKTOP_WIDTH,
        height: DESKTOP_HEIGHT,
        devicePixelRatio: dpr,
        backingWidth: DESKTOP_WIDTH * dpr,
        backingHeight: DESKTOP_HEIGHT * dpr,
      }),
      { x: 0, y: 0 },
    );
    assert.deepEqual(
      guestPixelFromClient(bounds.left + bounds.width, bounds.top + bounds.height, bounds, {
        width: DESKTOP_WIDTH,
        height: DESKTOP_HEIGHT,
        devicePixelRatio: dpr,
        backingWidth: DESKTOP_WIDTH * dpr,
        backingHeight: DESKTOP_HEIGHT * dpr,
      }),
      { x: DESKTOP_WIDTH - 1, y: DESKTOP_HEIGHT - 1 },
    );
  }
});

test("interior guest pixel samples round-trip through fractional canvas offsets", () => {
  const bounds = rect();
  for (const pixel of [
    { x: 0, y: 0 },
    { x: 639, y: 399 },
    { x: 1279, y: 799 },
    { x: 771, y: 251 },
  ]) {
    assert.deepEqual(guestPixelFromClient(
      clientPointFromGuest(pixel, bounds).x,
      clientPointFromGuest(pixel, bounds).y,
      bounds,
    ), pixel);
  }
});

test("tablet coordinates share the production CSS contract at both DPR values", () => {
  const bounds = rect();
  const expected = tabletPointFromGuest({ x: 771, y: 251 }, bounds);
  assert.deepEqual(tabletPointFromGuest({ x: 771, y: 251 }, bounds, { devicePixelRatio: 1 }), expected);
  assert.deepEqual(tabletPointFromGuest({ x: 771, y: 251 }, bounds, { devicePixelRatio: 2 }), expected);
  assert.deepEqual(expected, { x: 19743, y: 10291 });
});

test("window controls use half-open bounds so adjacent pixels do not activate a neighbor", () => {
  const controls = [
    { name: "maximize", left: 760, top: 245, right: 780, bottom: 265 },
    { name: "close", left: 785, top: 245, right: 805, bottom: 265 },
  ];
  assert.equal(hitTestGuestPixel({ x: 759, y: 254 }, controls), null);
  assert.equal(hitTestGuestPixel({ x: 760, y: 245 }, controls)?.name, "maximize");
  assert.equal(hitTestGuestPixel({ x: 779, y: 264 }, controls)?.name, "maximize");
  assert.equal(hitTestGuestPixel({ x: 780, y: 254 }, controls), null);
  assert.equal(hitTestGuestPixel({ x: 785, y: 254 }, controls)?.name, "close");
  assert.equal(hitTestGuestPixel({ x: 805, y: 254 }, controls), null);
});

test("Weston control centers stay tied to the detected window, including a maximized window", () => {
  const centers = (r) => westonWindowControls(r).map(({ name, x, y }) => ({ name, x, y }));
  assert.deepEqual(centers({ left: 118, top: 252, right: 810, bottom: 742 }), [
    { name: "minimize", x: 745, y: 265 },
    { name: "maximize", x: 771, y: 265 },
    { name: "close", x: 797, y: 265 },
  ]);
  assert.deepEqual(centers({ left: 0, top: 80, right: 1280, bottom: 800 }), [
    { name: "minimize", x: 1215, y: 93 },
    { name: "maximize", x: 1241, y: 93 },
    { name: "close", x: 1267, y: 93 },
  ]);
});

test("a second window partly behind the panel targets the exposed titlebar strip", () => {
  const controls = westonWindowControls({ left: 557, top: 13, right: 1253, bottom: 507 });
  assert.deepEqual(controls[1], { name: "maximize", left: 1201, top: 32, right: 1227, bottom: 39, x: 1214, y: 35 });
  assert.equal(hitTestGuestPixel({ x: 1214, y: 31 }, controls), null);
  assert.equal(hitTestGuestPixel({ x: 1214, y: 32 }, controls)?.name, "maximize");
  assert.equal(hitTestGuestPixel({ x: 1227, y: 35 }, controls)?.name, "close");
  assert.equal(hitTestGuestPixel({ x: 1214, y: 39 }, controls), null);
  assert.deepEqual(westonWindowControls({ left: 10, top: 0, right: 700, bottom: 500 }), []);
});

test("the real pointer bridge emits exact tablet coordinates at every adjacent button edge", () => {
  const controls = westonWindowControls({ left: 557, top: 13, right: 1253, bottom: 507 });
  for (const bounds of [rect(), { left: 80.25, top: 84.5, width: 1280, height: 800 }]) {
    const bridge = createPointerBridge({ sendTabletEvent() {}, syncTablet() {}, sendMouseEvent() {}, syncMouse() {} }, { getRect: () => bounds });
    for (const c of controls) {
      for (const pixel of [{ x: c.left - 1, y: c.y }, { x: c.left, y: c.y },
        { x: c.right - 1, y: c.y }, { x: c.right, y: c.y }, { x: c.x, y: c.top - 1 },
        { x: c.x, y: c.top }, { x: c.x, y: c.bottom - 1 }, { x: c.x, y: c.bottom }]) {
        const client = clientPointFromGuest(pixel, bounds);
        const result = bridge.handlePointerMove({ type: "pointermove", clientX: client.x, clientY: client.y });
        assert.equal(result.forwarded, true);
        assert.deepEqual(result.frame.coordinates, { x: Math.round((pixel.x + 0.25) * 32767 / 1280), y: Math.round((pixel.y + 0.25) * 32767 / 800) });
        assert.deepEqual(guestPixelFromClient(client.x, client.y, bounds), pixel);
      }
    }
  }
});
