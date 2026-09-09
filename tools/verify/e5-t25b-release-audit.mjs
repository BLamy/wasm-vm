#!/usr/bin/env node
// E5-T25b: prove the headed drag harness is opt-in and source/dist projections cannot drift.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function blockBetween(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `missing audit block: ${start} -> ${end}`);
  return text.slice(from, to);
}

const [terminal, distTerminal, perf, distPerf, perfHooks, distPerfHooks, perfTs, distPerfTs, html, distHtml, browserRunner] = await Promise.all([
  readFile(path.join(repo, "web/desktop-terminal.js"), "utf8"),
  readFile(path.join(repo, "web/dist/desktop-terminal.js"), "utf8"),
  readFile(path.join(repo, "web/bench/desktop-perf.js"), "utf8"),
  readFile(path.join(repo, "web/dist/bench/desktop-perf.js"), "utf8"),
  readFile(path.join(repo, "web/bench/desktop-perf-hooks.js"), "utf8"),
  readFile(path.join(repo, "web/dist/bench/desktop-perf-hooks.js"), "utf8"),
  readFile(path.join(repo, "web/bench/desktop-perf.ts"), "utf8"),
  readFile(path.join(repo, "web/dist/bench/desktop-perf.ts"), "utf8"),
  readFile(path.join(repo, "web/desktop-cursor.html"), "utf8"),
  readFile(path.join(repo, "web/dist/desktop-cursor.html"), "utf8"),
  readFile(path.join(repo, "tools/verify/e5-t25b-browser.mjs"), "utf8"),
]);
assert.equal(terminal, distTerminal);
assert.equal(perf, distPerf);
assert.equal(perfHooks, distPerfHooks);
assert.equal(perfTs, distPerfTs);
assert.equal(html, distHtml);
assert.equal(terminal.split('const desktopPerfHooksRequested = query.has("testHooks") && query.has("perfHooks");').length - 1, 1);
assert.equal(terminal.split('import("./bench/desktop-perf-hooks.js")').length - 1, 1);
assert.equal(terminal.includes('import { createDesktopPerfInput'), false);
assert.match(perf, /DESKTOP_PERF_HARNESS_VERSION\s*=\s*["']e5-t25b-v1/);
assert.match(perf, /DRAG_MOVE_COUNT\s*=\s*300/);
assert.match(perfTs, /export \* from "\.\/desktop-perf\.js"/);

const surface = blockBetween(terminal,
  "if (desktopPerfHooksRequested) {\n  globalThis.__desktopPerf",
  "const bootPromise");
assert.match(surface, /version: "e5-t25b-v1"/);
assert.match(surface, /presentDurations: \(\) => \[\.\.\.desktopPerfPresentDurations\]/);
assert.match(surface, /scheduler: async \(\) =>/);

const loader = blockBetween(terminal,
  "if (desktopPerfHooksRequested) {\n    import(\"./bench/desktop-perf-hooks.js\")",
  "keyboardBridge = createKeyboardBridge");
assert.match(loader, /createDesktopPerfInput\(controller, \{ enabled: true \}\)/);
assert.match(loader, /setInterval\(sampleGuestInstructions, 50\)/);
assert.match(loader, /typeof retired === "number" && Number\.isSafeInteger\(retired\)/);

assert.match(browserRunner, /const head = headOutput\.trim\(\)/);
assert.match(browserRunner, /pointerFramesBefore: before\.pointerFrames/);
assert.match(browserRunner, /pointerFramesDelta/);
assert.match(browserRunner, /schedulerBefore: before\.scheduler/);
assert.match(browserRunner, /schedulerAfter: after\.scheduler/);
assert.match(browserRunner, /presentDurationsMs: after\.presentDurationsMs/);
assert.match(browserRunner, /records: after\.records/);
assert.match(browserRunner, /assertWindowMoved\(chrome\.titlebar, chromeAfter\.titlebar, \{ direction \}\)/);
assert.match(browserRunner, /windowDisplacementPx: displacement\.displacementPx/);

const teardown = blockBetween(terminal, "function clearDesktopPerf", "function onOutput");
assert.match(teardown, /clearInterval\(desktopPerfStatsTimer\)/);
assert.match(teardown, /desktopPerfStatsTimer = null/);
assert.match(teardown, /desktopPerfGuestInstructions = null/);

console.log(JSON.stringify({
  sourceDistByteParity: true,
  perfModuleByteParity: true,
  pageParity: true,
  exactDualGate: true,
  dynamicHelperImport: "dual-gated",
  harnessVersion: "e5-t25b-v1",
  dragMoves: 300,
  samplerLifecycle: "installed-and-cleared",
  recordRetention: "raw-presents-scheduler-counters-and-pointer-deltas",
}));
