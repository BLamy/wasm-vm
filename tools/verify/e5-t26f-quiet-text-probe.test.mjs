// Execute the scratch driver's actual helpers; never import its browser-launching entry point.
// Native calibration + artificial subsequent frames prove harness predicates, not a guest run.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { createTextOracle } from "./e5-t26f-text-oracle.mjs";
import { guestProfileRequested } from "./e5-t26f-guest-profile.mjs";
import { residentFixtureRequested } from "./e5-t26f-resident-proof.mjs";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const source = readFileSync(new URL("./e5-t26f-quiet-text-probe.mjs", import.meta.url), "utf8");
function between(startMarker, endMarker) {
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `actual source boundary missing: ${startMarker}`);
  return source.slice(start, end);
}
const commandSource = between("async function typeQuietTextCommand()", "async function waitForDesktopReady(");
const titlebarSource = between("function readTopmostDragTitlebar()", "function observedDragTranslation(");
const typingSource = between("const shiftedPhysicalKey =", "async function typeCommand(");
const guards = between("function diagnosticOptions(", "const DIAGNOSTIC_OWNER =");
const boundary = source.match(/const postRestoreStart = firstRestore.completedAt;\s+milestones.postRestoreStart = postRestoreStart;/u)?.[0];
const cap = source.match(/assert\.ok\(postRestoreEnd - postRestoreStart <= 2_000, "post-restore interaction exceeded 2 seconds"\);/u)?.[0];
assert.ok(boundary && cap, "original restore clock and literal final cap must remain");
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const reviewedTextFile = path.join(repo, "evidence/e5-t26f/resident-text-template.json");
const reviewedTextBytes = readFileSync(reviewedTextFile), reviewedText = JSON.parse(reviewedTextBytes);
const textTemplate = { width: reviewedText.width, height: reviewedText.height,
  rgba: Array.from(Buffer.from(reviewedText.rgbaBase64, "base64")) };
const pngBytes = readFileSync(path.join(repo, reviewedText.source.png));
const { PNG } = createRequire(import.meta.url)("../../web/node_modules/playwright-core/lib/utilsBundle.js");
const native = PNG.sync.read(pngBytes);
const upper = { left: 557, right: 1253, top: 13, bottom: 39 };
const roi = { left: 557, right: 1253, top: 39, bottom: 239 };
const fresh = { x: 650, y: 150 };
const json = value => JSON.parse(JSON.stringify(value));

function fixture({ now = 1700, baselineFocus = true, baselineRed = 0, before, after } = {}) {
  const f = { now, polls: 0, reads: 0, disposed: 0, calls: [], phases: [],
    pixels: Uint8ClampedArray.from(native.data), state: {
      frameCount: 40, keyboardFrames: 2, keyboardEvents: 2, pointerFrames: 4,
      keyboardFrameSample: [{ code: "ShiftLeft", value: 1 }, { code: "ShiftLeft", value: 0 }],
      keyboardEventSample: [{ code: "ShiftLeft", type: "keydown" }, { code: "ShiftLeft", type: "keyup" }],
      surface: { redPixels: baselineRed }, focuses: [{ accepted: true }], active: {} },
    milestones: {} };
  f.blit = (x = fresh.x, y = fresh.y, rgba = textTemplate.rgba) => {
    for (let row = 0; row < textTemplate.height; row++) {
      const offset = row * textTemplate.width * 4;
      f.pixels.set(rgba.slice(offset, offset + textTemplate.width * 4), ((y + row) * native.width + x) * 4);
    }
  };
  const canvas = { width: native.width, height: native.height, getContext(kind) {
    assert.equal(kind, "2d");
    return { getImageData(...args) {
      assert.deepEqual(args, [0, 0, native.width, native.height]); f.reads++;
      return { data: f.pixels };
    } };
  } };
  const document = { activeElement: null, getElementById(id) { assert.equal(id, "desktop-canvas"); return canvas; } };
  f.blur = () => { document.activeElement = null; };
  function transition(key, value) {
    const code = key === "Enter" ? key : `Key${key.toUpperCase()}`;
    f.calls.push({ code, value, at: f.now });
    f.state.keyboardFrameSample.push({ code, value }); f.state.keyboardFrames++;
    f.state.keyboardEventSample.push({ code, type: value ? "keydown" : "keyup" }); f.state.keyboardEvents++;
  }
  async function press(key, options) {
    assert.equal(options.delay, 5, "physical key hold stays 5ms");
    transition(key, 1); f.now += options.delay; transition(key, 0);
  }
  const window = { __desktopTerminal: {
    beginCommand(command, marker) {
      assert.equal(command, "play"); assert.equal(marker, "e5t26f-post-aplay");
      f.state.active.command = { command, marker, visualDiffPixels: 1154, terminalMarkerSeen: false };
    },
    focus() { if (baselineFocus) document.activeElement = canvas; },
    state: () => f.state,
    finishCommand() { assert.fail("quiet text proof must not call the old area-based command finisher"); },
  } };
  const page = {
    evaluate: async (callback, argument) => callback(argument),
    keyboard: { press, type: async (character, options) => press(character, options),
      down: () => assert.fail("play has no modifier"), up: () => assert.fail("play has no modifier") },
    waitForTimeout: async ms => { assert.equal(ms, 5); f.now += ms; },
    waitForFunction: async (callback, argument, options) => {
      assert.deepEqual(options, vm.runInContext("({timeout:120_000,polling:50})", context));
      // Three deterministic polls substitute for waiting 120 seconds in a Node helper test.
      // They never manufacture the callback's result or bypass its actual pixel matcher.
      f.state.frameCount++;
      if (after) after(f); else f.blit();
      for (let poll = 0; poll < 3; poll++) {
        f.polls++; f.now += options.polling;
        const value = callback(argument);
        if (value) return { jsonValue: async () => value, dispose: async () => { f.disposed++; } };
      }
      const error = new Error("bounded fake wait: actual predicate stayed false"); error.name = "TimeoutError";
      throw error;
    },
  };
  const context = vm.createContext({ assert, path, repo, sha256, reviewedTextFile, reviewedTextBytes,
    reviewedText, textTemplate, page, window, document, milestones: f.milestones,
    firstRestore: { completedAt: 1000 }, performance: { now: () => f.now },
    phaseProgress: (phase, event = "start") => f.phases.push({ phase, event, at: f.now }) });
  f.api = vm.runInContext(`${titlebarSource}\n${typingSource}\n${commandSource}\n${boundary}\n
    window.__e5FTextOracle = (${createTextOracle.toString()})();
    window.__e5FReadTitlebar = readTopmostDragTitlebar;
    ({ run: typeQuietTextCommand, titlebar: readTopmostDragTitlebar,
       assertCap: end => { const postRestoreEnd = end; ${cap} } });`, context);
  if (before) before(f);
  return f;
}

test("pin the actual native PNG and reviewed raster; upper ROI excludes the real old marker", () => {
  assert.equal(sha256(pngBytes), "f524daa892cdc6e79a4e6dfabe2a30f59345abfcb7648f73e1d4b92fca925fbe");
  assert.equal(reviewedText.source.pngSha256, sha256(pngBytes));
  assert.deepEqual([native.width, native.height, textTemplate.width, textTemplate.height], [1280, 800, 72, 13]);
  assert.equal(sha256(Buffer.from(textTemplate.rgba)), "868249728c21a50b44997f9a83499202dafaecdf6e07f345d08e8da8ab5294fc");
  const oracle = createTextOracle(), input = { pixels: native.data, width: native.width, height: native.height, template: textTemplate };
  assert.deepEqual(oracle.findTemplate({ ...input, region: { left: 115, top: 355, right: 187, bottom: 368 } }), [{ x: 115, y: 355 }]);
  assert.deepEqual(oracle.findTemplate({ ...input, region: roi }), []);
  assert.deepEqual(json(fixture().api.titlebar().titlebar), upper);
});

test("actual helper accepts a fresh exact raster plus physical play sequence; stores raw evidence before result", async () => {
  const f = fixture();
  const result = await f.api.run();
  assert.deepEqual(json(result.matches), [fresh]);
  assert.deepEqual(json(f.milestones.quietText.baseline.region), roi);
  assert.deepEqual(json(result.baselineMatches), []);
  assert.equal(result.command, "play"); assert.equal(result.marker, "e5t26f-post-aplay");
  assert.equal(result.text, "e5t26f-aplay"); assert.equal(result.accepted, true);
  assert.equal(result.oracle, "fresh-exact-reviewed-raster");
  assert.equal(result.inputSequenceMatch, true); assert.equal(result.terminalMarkerSeen, true);
  assert.equal(result.redMarkerSeen, false); assert.equal(result.visualDiffPixels, 1154);
  assert.deepEqual([result.keyboardFrames, result.domEvents], [10, 10]);
  assert.deepEqual(f.calls, ["KeyP", "KeyL", "KeyA", "KeyY", "Enter"].flatMap((code, index) => [
    { code, value: 1, at: 1700 + index * 10 }, { code, value: 0, at: 1705 + index * 10 } ]));
  assert.equal(f.milestones.quietText.acceptance, false);
  assert.equal(f.milestones.quietText.templateFileSha256, sha256(reviewedTextBytes));
  assert.equal(f.milestones.quietText.observed.observedAt, result.observedAt);
  assert.equal(f.milestones.quietText.result, result);
  assert.equal(f.disposed, 1);
  assert.deepEqual(f.phases.at(-1), { phase: "quiet-text:exact-raster", event: "done", at: f.now });
});

test("same-size wrong glyph, clipped partial, and unchanged old-token-only canvas cannot finish", async () => {
  const wrong = [...textTemplate.rgba];
  for (let y = 0; y < textTemplate.height; y++) for (let x = 0; x < textTemplate.width; x++) {
    const destination = (y * textTemplate.width + x) * 4;
    const from = (y * textTemplate.width + textTemplate.width - x - 1) * 4;
    wrong.splice(destination, 4, ...textTemplate.rgba.slice(from, from + 4));
  }
  for (const after of [f => f.blit(fresh.x, fresh.y, wrong), f => f.blit(roi.right - 36, fresh.y), () => {}]) {
    const f = fixture({ after });
    await assert.rejects(f.api.run(), /actual predicate stayed false/);
    assert.equal(f.polls, 3); assert.equal(f.milestones.quietText.result, undefined);
  }
});

test("stale baseline raster refuses before physical typing; a raster on an unadvanced frame also refuses", async () => {
  const baseline = fixture({ before: f => f.blit() });
  await assert.rejects(baseline.api.run(), /already present/);
  assert.equal(baseline.calls.length, 0); assert.deepEqual(json(baseline.milestones.quietText.baseline.matches), [fresh]);
  const staleFrame = fixture({ after: f => { f.blit(); f.state.frameCount = 40; } });
  await assert.rejects(staleFrame.api.run(), /actual predicate stayed false/);
  assert.equal(staleFrame.milestones.quietText.result, undefined);
});

test("missing topmost window and actual changed window pixels refuse", async () => {
  const missing = fixture({ before: f => f.pixels.fill(255) });
  await assert.rejects(missing.api.run(), /missing actual topmost titlebar/);
  assert.equal(missing.calls.length, 0);
  const moved = fixture({ after: f => {
    f.blit();
    for (let y = 39; y < 71; y++) f.pixels.set([20, 20, 20, 255], (y * native.width + 556) * 4);
  } });
  await assert.rejects(moved.api.run(), /upper titlebar moved/);
  assert.equal(moved.milestones.quietText.result, undefined);
});

test("two exact matches in the active ROI refuse ambiguity", async () => {
  const f = fixture({ after: f => { f.blit(); f.blit(750, 175); } });
  await assert.rejects(f.api.run(), /ambiguous success text/);
  assert.equal(f.milestones.quietText.result, undefined);
});

test("missing or reordered keyup/down frame/event sequences refuse despite an exact glyph", async () => {
  for (const alter of [
    state => { state.keyboardFrameSample.pop(); },
    state => { state.keyboardEventSample.pop(); },
    state => { state.keyboardFrameSample[2].value = 0; },
    state => { state.keyboardFrameSample[3].code = "KeyX"; },
    state => { state.keyboardEventSample[2].type = "keyup"; },
    state => { [state.keyboardEventSample[2], state.keyboardEventSample[3]] = [state.keyboardEventSample[3], state.keyboardEventSample[2]]; },
  ]) {
    const f = fixture({ after: f => { f.blit(); alter(f.state); } });
    await assert.rejects(f.api.run(), { name: "AssertionError" });
    assert.ok(f.milestones.quietText.observed, "failed raw sequences retained before assertion");
    assert.equal(f.milestones.quietText.result, undefined); assert.equal(f.disposed, 1);
  }
});

test("baseline focus, completion focus, and recorded window focus are independently required", async () => {
  const baseline = fixture({ baselineFocus: false });
  await assert.rejects(baseline.api.run(), { name: "AssertionError" });
  assert.equal(baseline.calls.length, 0);
  for (const alter of [f => f.blur(), f => { f.state.focuses = []; }, f => { f.state.focuses[0].accepted = false; }]) {
    const f = fixture({ after: f => { f.blit(); alter(f); } });
    await assert.rejects(f.api.run(), { name: "AssertionError" });
    assert.ok(f.milestones.quietText.observed); assert.equal(f.milestones.quietText.result, undefined);
  }
});

test("new red failure marker cannot be overridden by an exact success glyph", async () => {
  const f = fixture({ baselineRed: 5, after: f => { f.blit(); f.state.surface.redPixels = 24; } });
  await assert.rejects(f.api.run(), /guest failure marker/);
  assert.equal(f.milestones.quietText.observed.redPixels, 24);
  assert.equal(f.milestones.quietText.result, undefined);
});

test("physical 5ms play is charged to the original restore T0; literal two-second cap remains exact", async () => {
  const f = fixture({ now: 2990 });
  await f.api.run();
  assert.equal(f.milestones.postRestoreStart, 1000);
  assert.equal(f.now, 3085, "45ms physical input plus the simulated 50ms observation stays on the same clock");
  assert.doesNotThrow(() => f.api.assertCap(3000));
  assert.throws(() => f.api.assertCap(3000.001), /exceeded 2 seconds/);
  assert.throws(() => f.api.assertCap(f.now), /exceeded 2 seconds/);
  assert.doesNotMatch(commandSource, /postRestoreStart\s*=|postRestoreEnd\s*=/u);
  assert.equal(source.match(/const postRestoreStart = firstRestore.completedAt;/gu)?.length, 1);
  assert.match(source, /const postRestoreEnd = await page\.evaluate\(\(\) => performance\.now\(\)\);\s+milestones\.postRestoreEnd = postRestoreEnd;/u);
  assert.match(source, /assert\.equal\(postRestoreCommand, "play"\);\s+assert\.equal\(postRestoreKeyDelayMs, 5\);\s+const postAudioCommand = await typeQuietTextCommand\(\);/u);
  const gesture = between("  await page.mouse.move(focusClient.x, focusClient.y);", "  const postRestoreCursor = await waitForRestoredCursor(");
  assert.ok(gesture.indexOf("await page.waitForTimeout(350)") < gesture.indexOf("await page.mouse.down()"));
  assert.match(gesture, /"locked", "audio unlocked before the delayed click"/u);
  assert.doesNotMatch(gesture, /keyboard|typePhysicalText/u);
});

test("actual scratch admission is resident reuse only and rejects every profiling/tuning/command flag, even empty", () => {
  const env = { E5_T26F_FIXTURE: "resident-aplay-v1", E5_T26F_DIAGNOSTIC: "reuse",
    E5_T26F_DIAGNOSTIC_PROFILE: "/private/tmp/e5-t26f-test-profile", E5_T26F_DIAGNOSTIC_PORT: "61631" };
  const select = overrides => vm.runInNewContext(`${guards}\n({diagnostic,postRestoreCommand,postRestoreKeyDelayMs});`,
    { assert, path, residentFixtureRequested, guestProfileRequested, process: { env: overrides } });
  const selected = select(env);
  assert.equal(selected.diagnostic.mode, "reuse");
  assert.equal(selected.postRestoreCommand, "play"); assert.equal(selected.postRestoreKeyDelayMs, 5);
  assert.throws(() => select({}));
  for (const mode of [undefined, "", "create", "REUSE"]) assert.throws(() => select({ ...env, E5_T26F_DIAGNOSTIC: mode }));
  assert.throws(() => select({ ...env, E5_T26F_FIXTURE: undefined }));
  for (const key of ["COMPLETE", "COMMAND", "CPU", "LATENCY", "GUEST_PROFILE", "JIT", "RESIDENCY", "GUEST_CLOCK", "ICOUNT_DIVIDER", "KEY_DELAY_MS"]) {
    for (const value of ["", "1", null]) assert.throws(() => select({ ...env, [`E5_T26F_DIAGNOSTIC_${key}`]: value }));
  }
  assert.throws(() => select({ ...env, E5_T26F_DIAGNOSTIC_COMMAND: "times;play;times" }));
});
