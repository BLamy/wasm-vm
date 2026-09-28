// Deterministic guards for the responsive-latency harness: frame scoring, milestones, PNG output.
// No guest, browser, or product proof.
import assert from "node:assert/strict";
import test from "node:test";
import { inflateSync } from "node:zlib";
import {
  GEOMETRY, PROMPT, assessFrame, assessRow, classifyCells, encodePng, installFrameHook, parseArgs, promptGlyphs, summarize, wordsToRgb,
} from "./omarchy-responsive-latency.mjs";

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

test("pixel-extent milestones fire on the first qualifying frame after arming", () => {
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
    assert.deepEqual(Object.keys(win.__wv.shots), ["firstPixels"]);
    // Enter processed: the whole command, no cursor cell on row 0, output on row 1.
    send((px) => { ink(px, 0, 26, base0Right + 7 * (cells - 1) - 1); ink(px, 1, 26, 26 + 40); });
    assert.deepEqual(Object.keys(win.__wv.shots).sort(), ["firstPixels", "fullPixels", "outputPixels"]);
    const shot = win.__wv.shots.fullPixels;
    assert.equal(shot.px.length, W * H, "milestone frames are copied, not aliased");
    assert.equal(shot.px[(GEOMETRY.rowTop + 5) * W + 26], INK);
  });
});

// Synthetic monospace font: each character gets a distinct 7x17 bitmap; a "torn" glyph keeps only
// its top half, like a frame copied before llvmpipe finished the 64x64 tile row below y=64.
const glyphBits = (c) => { const code = c.charCodeAt(0); return (dx, dy) => ((code * 31 + dx * 7 + dy * 13) % 5) < 2; };
function drawText(px, text, row, start, { torn = false } = {}) {
  for (let j = 0; j < text.length; j++) {
    if (text[j] === " ") continue;
    const bits = glyphBits(text[j]);
    for (let dy = 0; dy < GEOMETRY.rowHeight; dy++) {
      if (torn && dy >= 8) continue;
      for (let dx = 0; dx < GEOMETRY.cell; dx++) {
        if (bits(dx, dy)) px[(GEOMETRY.rowTop + GEOMETRY.rowHeight * row + dy) * W + GEOMETRY.textX0 + GEOMETRY.cell * (start + j) + dx] = INK;
      }
    }
  }
}
const cursor = (px, row, cell) => {
  for (let dy = 0; dy < GEOMETRY.rowHeight; dy++) for (let dx = 0; dx < GEOMETRY.cell; dx++) {
    px[(GEOMETRY.rowTop + GEOMETRY.rowHeight * row + dy) * W + GEOMETRY.textX0 + GEOMETRY.cell * cell + dx] = 0xff7aa2f7;
  }
};

test("cell verdicts compare typed glyphs against the prompt's own glyphs", () => {
  const px = blank(); drawText(px, PROMPT, 0, 0); drawText(px, "echo 7f", 0, PROMPT.length);
  const ref = promptGlyphs(px, W, GEOMETRY);
  assert.deepEqual(Object.keys(ref).sort(), [...new Set(PROMPT.replace(/ /gu, ""))].sort());
  const bg = BG & 0xffffff;
  assert.equal(classifyCells(px, W, bg, ref, "echo 7f z", 0, PROMPT.length, GEOMETRY), "echo ?? _", "digits have no prompt glyph; z is not typed");
  const torn = blank(); drawText(torn, PROMPT, 0, 0); drawText(torn, "echo", 0, PROMPT.length, { torn: true });
  assert.equal(classifyCells(torn, W, bg, ref, "echo", 0, PROMPT.length, GEOMETRY), "XXXX");
});

test("a row is coherent only as a verified prefix, one cursor cell, then blanks", () => {
  assert.deepEqual(assessRow("ec__", "echo"), { prefix: 2, coherent: true, complete: false });
  assert.deepEqual(assessRow("ecX_", "echo"), { prefix: 2, coherent: true, complete: false }, "cursor cell after the prefix");
  assert.deepEqual(assessRow("eXX_", "echo"), { prefix: 1, coherent: false, complete: false });
  assert.deepEqual(assessRow("e_h_", "echo"), { prefix: 1, coherent: false, complete: false }, "a gap is a stale frame");
  assert.deepEqual(assessRow("echo", "echo"), { prefix: 4, coherent: true, complete: true });
  assert.deepEqual(assessRow("??", "12"), { prefix: 2, coherent: true, complete: true });
  assert.equal(assessRow("?? ", "12 ").complete, true);
});

test("verified milestones need a coherent frame; torn frames never count", () => {
  const command = "echo ab", output = "ab";
  assert.equal(assessFrame("X______", "__", command, output).firstEcho, false, "cursor only");
  assert.equal(assessFrame("eX_____", "__", command, output).firstEcho, true);
  assert.equal(assessFrame("echo ab", "X_", command, output).fullEcho, true);
  assert.equal(assessFrame("echo ab", "X_", command, output).output, false);
  assert.equal(assessFrame("echo ab", "ab", command, output).output, true);
  assert.deepEqual(assessFrame("XXXX ab", "ab", command, output), { coherent: false, prefix: 0, outputPrefix: 2, firstEcho: false, fullEcho: false, output: false });
});

test("the frame hook records glyph verdicts and verified milestones once classifiers are installed", () => {
  const controller = fakeController();
  withWindow(controller, (win) => {
    installFrameHook(GEOMETRY);
    const st = win.__wv;
    st.classify = classifyCells; st.assess = assessFrame;
    const command = "echo ab", output = "ab";
    const base = blank(); drawText(base, PROMPT, 0, 0); cursor(base, 0, PROMPT.length);
    st.cfg = { base0Right: 214, base1Count: 0, cells: command.length, command, output, ref: promptGlyphs(base, W, GEOMETRY),
      promptCells: PROMPT.length, armedAt: performance.now() };
    const send = (build) => { const px = blank(); drawText(px, PROMPT, 0, 0); build(px); controller.present({ resourceWidth: W, resourceHeight: H, rect: { x: 0, y: 0, width: W, height: 800 }, pixels: px }); };
    send((px) => { drawText(px, "echo", 0, PROMPT.length, { torn: true }); });
    assert.equal(st.frames.at(-1).coherent, false);
    assert.equal(st.shots.firstEcho, undefined, "a torn echo is not a first echo");
    send((px) => { drawText(px, "ech", 0, PROMPT.length); cursor(px, 0, PROMPT.length + 3); });
    assert.ok(st.shots.firstEcho && !st.shots.fullEcho);
    send((px) => { drawText(px, command, 0, PROMPT.length); drawText(px, output, 1, 0); });
    assert.ok(st.shots.fullEcho && st.shots.output);
    assert.deepEqual(st.frames.at(-1).cells, ["echo a?", "a?"], "b has no prompt reference glyph");
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
