// Deterministic guards for the responsive-latency harness: frame scoring, milestones, PNG output.
// No guest, browser, or product proof.
import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import { GEOMETRY, encodePng, installFrameHook, parseArgs, summarize, wordsToRgb } from "./omarchy-responsive-latency.mjs";

const W = 1280, H = 832, BG = 0xff1a1b26, INK = 0xffc0caf5;
const blank = () => new Uint32Array(W * H).fill(BG);
// Ink a row band from x0 to x1 (inclusive) the way a glyph run would.
const ink = (px, row, x0, x1) => {
  const y = GEOMETRY.rowTop + GEOMETRY.rowHeight * row + 5;
  for (let x = x0; x <= x1; x++) px[y * W + x] = INK;
};
function fakeController() {
  const delivered = [];
  return { delivered, present(frame) { delivered.push(frame); return true; } };
}
function withWindow(controller, body) {
  const saved = globalThis.window;
  globalThis.window = { __presentation: { controller: () => controller } };
  try { return body(globalThis.window); } finally { globalThis.window = saved; }
}

test("argument parsing requires the pair, kernel and chunk store and rejects unknown flags", () => {
  const opts = parseArgs(["out", "--pair", "p", "--kernel", "k", "--chunks", "c", "--query", "jit=0"]);
  assert.equal(opts.query, "jit=0");
  assert.equal(opts["deadline-s"], "600");
  assert.throws(() => parseArgs(["out", "--pair", "p", "--kernel", "k"]), /--chunks is required/u);
  assert.throws(() => parseArgs(["out", "--pair", "p", "--kernel", "k", "--chunks", "c", "--bogus", "1"]), /unknown argument/u);
  assert.throws(() => parseArgs(["--pair", "p"]), /usage/u);
});

test("the frame hook scores received words and passes every frame through unchanged", () => {
  const controller = fakeController();
  withWindow(controller, (win) => {
    assert.equal(installFrameHook(GEOMETRY), true);
    assert.equal(installFrameHook(GEOMETRY), true, "re-install is idempotent");
    assert.equal(win.__wv.hooks, 1);
    const px = blank(); ink(px, 0, 26, 214);
    const frame = { resourceWidth: W, resourceHeight: H, rect: { x: 0, y: 0, width: W, height: 800 }, pixels: px };
    assert.equal(controller.present(frame), true);
    assert.equal(controller.delivered[0], frame, "the original present receives the same frame object");
    assert.deepEqual(win.__wv.frames[0].rows.map((r) => [r.count, r.right]), [[189, 214], [0, -1]]);
    assert.equal(controller.present({ type: "clear" }), true, "clear frames are delivered, not scored");
    assert.equal(win.__wv.frames.length, 1);
  });
});

test("milestones fire on the first qualifying frame after arming, with the cursor leaving row 0", () => {
  const controller = fakeController();
  withWindow(controller, (win) => {
    installFrameHook(GEOMETRY);
    const send = (build) => { const px = blank(); build(px); controller.present({ resourceWidth: W, resourceHeight: H, rect: { x: 0, y: 0, width: 10, height: 10 }, pixels: px }); };
    const cells = 10, base0Right = 214;
    // A frame before arming never counts, even if it already shows text.
    send((px) => ink(px, 0, 26, base0Right + 7 * cells));
    win.__wv.cfg = { base0Right, base1Count: 0, cells, armedAt: performance.now() };
    send((px) => ink(px, 0, 26, base0Right)); // prompt + cursor only
    assert.deepEqual(Object.keys(win.__wv.shots), []);
    send((px) => ink(px, 0, 26, base0Right + 7)); // first glyph + cursor
    assert.deepEqual(Object.keys(win.__wv.shots), ["firstEcho"]);
    // Enter processed: the whole command, no cursor cell on row 0, output on row 1.
    send((px) => { ink(px, 0, 26, base0Right + 7 * (cells - 1) - 1); ink(px, 1, 26, 26 + 40); });
    assert.deepEqual(Object.keys(win.__wv.shots).sort(), ["firstEcho", "fullEcho", "output"]);
    const shot = win.__wv.shots.fullEcho;
    assert.equal(shot.px.length, W * H, "milestone frames are copied, not aliased");
    assert.equal(shot.px[(GEOMETRY.rowTop + 5) * W + 26], INK);
  });
});

test("frame words decode as little-endian B8G8R8A8 into a valid PNG", () => {
  const rgb = wordsToRgb(new Uint32Array([0xff112233, 0x00a0b0c0]), 2, 1);
  assert.deepEqual([...rgb], [0x11, 0x22, 0x33, 0xa0, 0xb0, 0xc0]);
  const png = encodePng(2, 1, rgb);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.toString("latin1", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 2);
  const idat = png.indexOf("IDAT", 0, "latin1");
  const length = png.readUInt32BE(idat - 4);
  assert.deepEqual([...inflateSync(png.subarray(idat + 4, idat + 4 + length))], [0, ...rgb]);
  assert.throws(() => encodePng(3, 1, rgb));
});

test("summaries ignore non-finite samples", () => {
  assert.deepEqual(summarize([3, NaN, 1, 2, Infinity]), { median: 2, min: 1, max: 3, samples: 3 });
  assert.equal(summarize([]), null);
});
