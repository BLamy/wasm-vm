// Pixel-fixture tests for the proof observer itself. These are harness tests, not guest evidence.
import assert from "node:assert/strict";
import test from "node:test";
import { LEFT_PTR } from "../src/input/desktop-cursor-template.js";

const width = 1280, height = 800;
const bytes = new Uint8ClampedArray(width * height * 4);
const marker = { dataset: {}, textContent: "" };
const canvas = {
  width, height,
  getContext: () => ({ getImageData: () => ({ data: bytes }) }),
  getBoundingClientRect: () => ({ left: 80.25, top: 84.5, width, height }),
};
globalThis.document = {
  getElementById: (name) => name === "desktop-canvas" ? canvas : marker,
  documentElement: { dataset: {} },
};
let pointerFrames = 0;
let frame = null;
globalThis.__desktopTerminal = {
  state: () => ({ pointerFrames, pointerFrameSample: frame ? [frame] : [], diagnostics: [] }),
  pointerState: () => ({ mode: "absolute", heldButtons: [] }),
};
globalThis.__desktopController = {
  pause: async () => {}, stateDigest: () => "a".repeat(64),
  fetchStats: () => ({ fetches: 1, bytes: 1 }), isPaused: () => true,
};
await import("../desktop-cursor.js");
const api = globalThis.__desktopCursor;

function fill(left, top, right, bottom, rgb) {
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    bytes.set([...rgb, 255], (y * width + x) * 4);
  }
}
function windowFixture(rect) {
  fill(0, 0, width, height, [150, 150, 150]);
  fill(rect.left, rect.top, rect.right, rect.top + 26, [255, 255, 255]);
  fill(rect.left, rect.top + 26, rect.right, rect.bottom, [35, 35, 35]);
  fill(0, 0, width, 32, [85, 85, 85]);
}
function move(control) {
  pointerFrames++;
  frame = { device: "tablet", source: "pointermove", coordinates: {
    x: Math.round((control.x + 0.25) * 32767 / width),
    y: Math.round((control.y + 0.25) * 32767 / height),
  } };
}

function drawCursor(hotspot) {
  for (let row = 0; row < 16; row++) for (let col = 0; col < 10; col++) {
    const color = LEFT_PTR[row][col];
    if (color === ".") continue;
    const x = hotspot.x - 1 + col, y = hotspot.y - 1 + row, v = color === "W" ? 255 : 0;
    fill(x, y, x + 1, y + 1, [v, v, v]);
  }
}

test("detects both a full titlebar and a panel-occluded second window", () => {
  for (const rect of [
    { left: 115, top: 251, right: 811, bottom: 745 },
    { left: 557, top: 13, right: 1253, bottom: 507 },
    { left: 0, top: 32, right: 1280, bottom: 800 },
  ]) {
    windowFixture(rect);
    assert.deepEqual(api.detectWindowChrome().window, rect);
    assert.ok(api.detectWindowChrome().controls.every((c) => c.y >= 32));
  }
  fill(0, 0, width, height, [150, 150, 150]);
  assert.equal(api.detectWindowChrome(), null);
});

test("cursor-only repaint cannot masquerade as a guest hover highlight", () => {
  windowFixture({ left: 115, top: 251, right: 811, bottom: 745 });
  const c = api.detectWindowChrome().controls[1];
  api.startHover(c);
  move(c);
  fill(c.x, c.y, c.x + 5, c.y + 8, [0, 0, 0]);
  assert.throws(() => api.finishHover(), /guest hover did not align/);
  assert.equal(api.state().hovers.at(-1).highlightMatches, false);
  api.startHover(c);
  move(c);
  fill(c.left, c.top, c.right, c.bottom, [71, 180, 19]);
  drawCursor(c);
  assert.equal(api.finishHover().hovers.at(-1).accepted, true);
});

test("an absent or one-pixel-displaced rendered hotspot refutes an otherwise correct hover", () => {
  for (const delta of [null, { x: 1, y: 0 }, { x: 0, y: -1 }]) {
    windowFixture({ left: 115, top: 251, right: 811, bottom: 745 });
    const c = api.detectWindowChrome().controls[1];
    api.startHover(c);
    move(c);
    fill(c.left, c.top, c.right, c.bottom, [71, 180, 19]);
    if (delta) drawCursor({ x: c.x + delta.x, y: c.y + delta.y });
    assert.throws(() => api.finishHover(), /guest hover did not align/);
    assert.equal(api.state().hovers.at(-1).cursorMatches, false);
  }
});

test("a cursor protruding beyond close cannot break the client body into smaller windows", () => {
  const rect = { left: 115, top: 251, right: 811, bottom: 745 };
  windowFixture(rect);
  const before = api.detectWindowChrome();
  for (let i = 0; i < 24; i++) fill(810 + i, 264 + i, 811 + i, 265 + i, [0, 0, 0]);
  assert.deepEqual(api.detectWindowChrome().window, rect);
  assert.deepEqual(api.detectWindowChrome().controls, before.controls);
});

test("colored close hover cannot shorten the detected titlebar or shift its neighbors", () => {
  const rect = { left: 115, top: 251, right: 811, bottom: 745 };
  windowFixture(rect);
  const before = api.detectWindowChrome();
  const c = before.controls[2];
  fill(c.left, c.top, c.right, c.bottom, [204, 36, 29]);
  const after = api.detectWindowChrome();
  assert.deepEqual(after.window, rect);
  assert.deepEqual(after.controls, before.controls);
  assert.deepEqual(api.hoverHighlights().filter((c) => c.highlighted).map((c) => c.name), ["close"]);
});

test("moving a window is not proof of maximization; the full work area is required", () => {
  const initial = { left: 115, top: 251, right: 811, bottom: 745 };
  windowFixture(initial);
  const c = api.detectWindowChrome().controls[1];
  api.startButton("maximize", c);
  move(c);
  windowFixture({ ...initial, top: 151, bottom: 645 });
  assert.throws(() => api.finishButton(), /maximize button did not hit/);
  assert.equal(api.state().maximizes.at(-1).windowMaximized, false);
  windowFixture(initial);
  api.startButton("maximize", c);
  move(c);
  windowFixture({ left: 0, top: 32, right: 1280, bottom: 800 });
  assert.equal(api.finishButton().maximizes.at(-1).windowMaximized, true);
});

test("a vanished or restorable window is not sufficient close evidence", () => {
  for (const probe of [null, { windowRestored: true, retiredInstructions: 100_000_000 }]) {
    windowFixture({ left: 115, top: 251, right: 811, bottom: 745 });
    const c = api.detectWindowChrome().controls[2];
    api.startButton("close", c);
    move(c);
    fill(0, 0, width, height, [150, 150, 150]);
    assert.throws(() => api.finishButton(probe), /close button did not hit/);
    assert.equal(api.state().closes.at(-1).windowClosed, false);
  }
});

test("final proof exposes the actual pointer state and the verifier's interaction schema", async () => {
  const proof = await api.finishProof();
  assert.equal(proof.pointer.mode, "absolute");
  assert.deepEqual(proof.pointer.heldButtons, []);
  assert.ok(Array.isArray(proof.hovers) && Array.isArray(proof.maximizes) && Array.isArray(proof.closes));
  assert.equal(proof.paused, true);
  assert.equal(proof.stateDigest, "a".repeat(64));
});
