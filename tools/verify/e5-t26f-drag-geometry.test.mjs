import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { assertWindowMoved } from "../../web/bench/desktop-perf.js";

// Execute the frozen runner callbacks, not a copy of the detector or the runner.
const runner = readFileSync(new URL("./e5-t26f-browser-roundtrip.mjs", import.meta.url), "utf8");
const start = runner.indexOf("function readTopmostDragTitlebar() {");
const end = runner.indexOf("async function proveAndPauseDrag(before) {", start);
assert.ok(start >= 0 && end > start, "actual drag helper extraction boundaries exist");
const helpers = new vm.Script(`${runner.slice(start, end)}\n({ readTopmostDragTitlebar, observedDragTranslation });`);
const WIDTH = 1280, HEIGHT = 800;
const UPPER = { left: 559, right: 1253, top: 13, bottom: 39 };

function blank() {
  return new Uint8ClampedArray(WIDTH * HEIGHT * 4).fill(255);
}

function paint(data, left, top, right, bottom, shade = 20) {
  for (let y = Math.max(0, top); y < Math.min(HEIGHT, bottom); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(WIDTH, right); x += 1) {
      const i = (y * WIDTH + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = shade;
      data[i + 3] = 255;
    }
  }
}

function overlapping(translation = 0) {
  const data = blank();
  paint(data, 0, 0, WIDTH, 32); // Dark desktop panel is not a window.
  paint(data, 115, 277, 809, 748); // Lower Foot body.
  paint(data, 559 + translation, 39, 1253 + translation, 510); // Upper Foot body.
  return data;
}

function detector(data) {
  assert.ok(data instanceof Uint8ClampedArray);
  assert.equal(data.length, WIDTH * HEIGHT * 4);
  let reads = 0;
  const callbacks = helpers.runInNewContext({
    assertWindowMoved,
    performance: { now: () => 123.25 },
    document: {
      getElementById(id) {
        assert.equal(id, "desktop-canvas");
        return {
          width: WIDTH, height: HEIGHT,
          getContext(kind) {
            assert.equal(kind, "2d");
            return {
              getImageData(...args) {
                assert.deepEqual(args, [0, 0, WIDTH, HEIGHT]);
                reads += 1;
                return { data };
              },
            };
          },
        };
      },
    },
  });
  const result = callbacks.readTopmostDragTitlebar();
  assert.equal(reads, 1);
  assert.equal(result.at, 123.25);
  return {
    titlebar: result.titlebar === null ? null : { ...result.titlebar },
    translation: callbacks.observedDragTranslation,
  };
}

test("overlapping Foot bodies select upper left 559, never merged lower left 115", () => {
  assert.deepEqual(detector(overlapping()).titlebar, UPPER);
});

test("80px translation preserves titlebar row and left edge with right clipping", () => {
  const before = detector(overlapping());
  const after = detector(overlapping(80));
  assert.deepEqual(after.titlebar, { ...UPPER, left: 639, right: WIDTH });
  assert.deepEqual(before.translation(before.titlebar, after.titlebar), {
    deltaX: 80, displacementPx: 80,
  });
});

test("dark panel rows 0..31 are excluded even without any window", () => {
  const data = blank();
  paint(data, 0, 0, WIDTH, 32);
  assert.equal(detector(data).titlebar, null);
  assert.deepEqual(detector(overlapping()).titlebar, UPPER);
});

test("blank canvas and fewer than 32 contiguous body rows reject", () => {
  assert.equal(detector(blank()).titlebar, null);
  const data = blank();
  paint(data, 559, 39, 1253, 70); // Only 31 contiguous qualifying rows.
  paint(data, 559, 71, 1253, 102); // Cannot bridge the intervening blank row.
  assert.equal(detector(data).titlebar, null);
});

test("cursor outliers on eight rows do not shift the 24-row modal edges", () => {
  const data = overlapping();
  paint(data, 540, 41, 548, 49);
  paint(data, 1260, 41, 1268, 49);
  assert.deepEqual(detector(data).titlebar, UPPER);
});

for (const side of ["left", "right"]) {
  test(`ambiguous ${side} edge rejects instead of choosing a tied mode`, () => {
    const data = overlapping();
    if (side === "left") paint(data, 540, 39, 559, 55);
    else paint(data, 1253, 39, 1268, 55);
    assert.equal(detector(data).titlebar, null);
  });
}

test("23 agreeing rows are insufficient for a stable edge", () => {
  const data = overlapping();
  paint(data, 540, 39, 559, 48);
  assert.equal(detector(data).titlebar, null);
});

test("actual translation guard rejects stale, absent, wrong-row and unrelated movement", () => {
  const { titlebar: before, translation } = detector(overlapping());
  const stale = detector(overlapping()).titlebar;
  assert.equal(translation(before, stale), null);
  assert.equal(translation(before, null), null);
  assert.equal(translation(null, before), null);
  assert.equal(translation(before, { ...before, left: 639, top: 251, bottom: 277 }), null);
  for (const delta of [-80, 63, 97]) {
    assert.equal(translation(before, { ...before, left: before.left + delta }), null);
  }
});

function retainedCanvas(run) {
  const require = createRequire(import.meta.url);
  const { PNG } = require("../../web/node_modules/playwright-core/lib/utilsBundle.js");
  const png = PNG.sync.read(readFileSync(new URL(
    `../../evidence/e5-t26f/completion/run-${run}/failure-drag-guest-translation.png`,
    import.meta.url,
  )));
  assert.equal(png.width, 1425);
  assert.equal(png.height, 1146);
  const rgba = (x, y) => [...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4)];
  // Retained screenshot only: cyan focus outline is 2px with a 2px offset.
  // Its anchors establish the canvas crop at (80,85), not an inferred window crop.
  for (const y of [81, 82]) {
    for (let x = 76; x <= 1363; x += 1) {
      assert.deepEqual(rgba(x, y), [83, 212, 255, 255]);
    }
    assert.notDeepEqual(rgba(75, y), [83, 212, 255, 255]);
    assert.notDeepEqual(rgba(1364, y), [83, 212, 255, 255]);
  }
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    const offset = ((85 + y) * png.width + 80) * 4;
    data.set(png.data.subarray(offset, offset + WIDTH * 4), y * WIDTH * 4);
  }
  return data;
}

test("retained 19fbc770 PNG crop detects actual upper left 557, not merged left 115", () => {
  assert.deepEqual(detector(retainedCanvas("19fbc770")).titlebar, {
    left: 557, right: 1253, top: 13, bottom: 39,
  });
});

test("real 0f467689 crop proves the exact 19fbc770-to-panel-clamped drag transition", () => {
  const before = detector(retainedCanvas("19fbc770"));
  const after = detector(retainedCanvas("0f467689"));
  assert.deepEqual(before.titlebar, { left: 557, right: 1253, top: 13, bottom: 39 });
  assert.deepEqual(after.titlebar, { left: 644, right: 1280, top: 32, bottom: 58 });
  assert.deepEqual(before.translation(before.titlebar, after.titlebar), {
    deltaX: 87, displacementPx: 87,
  });
});

test("non-panel vertical jumps reject independently of horizontal movement and height", () => {
  const { titlebar: before, translation } = detector(overlapping());
  for (const top of [15, 20, 30, 34]) {
    assert.equal(translation(before, {
      ...before, left: before.left + 80, top, bottom: top + 26,
    }), null, `top ${top} is neither the original row nor the 32px panel clamp`);
  }
  const belowPanel = { ...before, top: 50, bottom: 76 };
  assert.equal(translation(belowPanel, {
    ...belowPanel, left: belowPanel.left + 80, top: 32, bottom: 58,
  }), null, "a window already below the panel cannot jump upward to the panel");
});

test("height changes reject independently at both the original and panel-clamped row", () => {
  const { titlebar: before, translation } = detector(overlapping());
  for (const top of [before.top, 32]) {
    for (const height of [24, 28]) {
      assert.equal(translation(before, {
        ...before, left: before.left + 80, top, bottom: top + height,
      }), null, `height ${height} exceeds the 1px tolerance at allowed top ${top}`);
    }
  }
});
