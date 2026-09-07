#!/usr/bin/env node
// E5-T25c: prove the latency harness is opt-in, exact-head, and byte-identical in the deploy projection.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const [terminal, distTerminal, perf, distPerf, perfTs, distPerfTs, presentation, distPresentation, roadmap, distRoadmap, browserRunner, makefile] = await Promise.all([
  readFile(path.join(repo, "web/desktop-terminal.js"), "utf8"),
  readFile(path.join(repo, "web/dist/desktop-terminal.js"), "utf8"),
  readFile(path.join(repo, "web/bench/desktop-perf.js"), "utf8"),
  readFile(path.join(repo, "web/dist/bench/desktop-perf.js"), "utf8"),
  readFile(path.join(repo, "web/bench/desktop-perf.ts"), "utf8"),
  readFile(path.join(repo, "web/dist/bench/desktop-perf.ts"), "utf8"),
  readFile(path.join(repo, "web/src/sink/presentation.js"), "utf8"),
  readFile(path.join(repo, "web/dist/src/sink/presentation.js"), "utf8"),
  readFile(path.join(repo, "web/roadmap.js"), "utf8"),
  readFile(path.join(repo, "web/dist/roadmap.js"), "utf8"),
  readFile(path.join(repo, "tools/verify/e5-t25c-browser.mjs"), "utf8"),
  readFile(path.join(repo, "Makefile"), "utf8"),
]);

assert.equal(terminal, distTerminal, "desktop terminal source/dist drifted");
assert.equal(perf, distPerf, "desktop performance source/dist drifted");
assert.equal(perfTs, distPerfTs, "desktop performance TypeScript projection drifted");
assert.equal(presentation, distPresentation, "presentation source/dist drifted");
assert.equal(roadmap, distRoadmap, "roadmap source/dist drifted");

assert.equal(terminal.split('const desktopPerfHooksRequested = query.has("testHooks") && query.has("perfHooks");').length - 1, 1);
assert.equal(terminal.split('const desktopLatencyHooksRequested = desktopPerfHooksRequested && query.has("latencyHooks");').length - 1, 1);
assert.match(terminal, /scheduleFrames: desktopLatencyHooksRequested/);
assert.match(terminal, /requestAnimationFrame: desktopLatencyHooksRequested \? delayedRequestAnimationFrame : undefined/);
assert.match(terminal, /setPresentDelay: \(milliseconds\) =>/);
assert.match(terminal, /latencyHooks: desktopLatencyHooksRequested/);
assert.match(terminal, /discardedPending/);
assert.match(presentation, /discardPending\(\)/);

assert.match(perf, /KEY_LATENCY_HARNESS_VERSION\s*=\s*["']e5-t25c-v1/);
assert.match(perf, /KEY_LATENCY_TRIAL_COUNT\s*=\s*100/);
assert.match(perf, /KEY_LATENCY_WARMUP_COUNT\s*=\s*10/);
assert.match(perf, /PRESENT_DELAY_CALIBRATION_MS\s*=\s*100/);
assert.match(perf, /findFirstIntersectingPresent/);
assert.match(perf, /KEY_LATENCY_MEASUREMENT/);
assert.match(perf, /focused !== true/);
assert.match(perf, /nextInputAt/);
assert.match(perf, /record\.drawn !== true/);
assert.match(perf, /rectanglesIntersect/);
assert.match(perf, /rafVsyncErrorBoundMs/);
assert.match(perf, /histogram/);
assert.match(perf, /calibratePresentDelay/);
assert.match(perfTs, /export \* from "\.\/desktop-perf\.js"/);

assert.match(browserRunner, /const head = headOutput\.trim\(\)/);
assert.match(browserRunner, /E5_T25C_REQUIRE_HEAD/);
assert.match(browserRunner, /KEY_LATENCY_TRIAL_COUNT \+ KEY_LATENCY_WARMUP_COUNT/);
assert.match(browserRunner, /findFirstIntersectingPresent/);
assert.match(browserRunner, /runAdversarialInputChecks/);
assert.match(browserRunner, /focused: before\.focused/);
assert.match(browserRunner, /nextInputAt: secondAt/);
assert.match(browserRunner, /await page\.waitForTimeout\(30_000\)/);
assert.match(browserRunner, /window\.__desktopTerminal\.focus\(\)/);
assert.match(browserRunner, /recordVideo: \{ dir: out/);
assert.match(browserRunner, /Page\.startScreencast/);
assert.match(browserRunner, /Page\.screencastFrame/);
assert.match(browserRunner, /recordedScreenFrames/);
assert.match(browserRunner, /screen-capture-first\.png/);
assert.match(browserRunner, /withinOneDisplayFrame/);
assert.match(browserRunner, /PRESENT_DELAY_CALIBRATION_MS/);
assert.match(browserRunner, /assert\.deepEqual\(errors, \[\], "browser console errors"\)/);
assert.match(browserRunner, /assert\.deepEqual\(httpErrors, \[\], "browser HTTP errors"\)/);

assert.match(roadmap, /Measured focused-key input-to-photon latency/);
assert.match(roadmap, /E5-T25c: 100 post-warm-up focused key trials/);
assert.match(makefile, /e5-t25c-assets/);

console.log(JSON.stringify({
  sourceDistByteParity: true,
  latencyModuleByteParity: true,
  typescriptProjectionParity: true,
  roadmapParity: true,
  dualGate: "testHooks+perfHooks, then latencyHooks",
  trials: 100,
  warmup: 10,
  knownDelayCalibrationMs: 100,
  evidence: "headed Chromium video + screenshot + exact-head JSON",
}));
