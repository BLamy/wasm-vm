#!/usr/bin/env node
// E5-T25a: the perf injector is an explicit bench module, not a production app import/surface.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
function blockBetween(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to >= 0 && to > from, `missing audit block: ${start} -> ${end}`);
  return text.slice(from, to);
}

const [main, distMain, app, hooks] = await Promise.all([
  readFile(path.join(repo, "web/main.js"), "utf8"),
  readFile(path.join(repo, "web/dist/main.js"), "utf8"),
  readFile(path.join(repo, "web/dist/app.html"), "utf8"),
  readFile(path.join(repo, "web/bench/desktop-perf-hooks.js"), "utf8"),
]);

assert.equal(main.includes("desktop-perf-hooks.js"), false);
assert.equal(distMain.includes("desktop-perf-hooks.js"), false);
assert.equal(app.includes("desktop-perf-hooks.js"), false);
assert.equal(main, distMain);
assert.match(hooks, /DESKTOP_PERF_HOOK_VERSION\s*=\s*["']e5-t25a-v1/);
const gate = 'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") && _startupQuery.has("perfHooks");';
const schedulerBlock = blockBetween(main, "const readSchedulerStats = async () => {", "window.__schedulerStats = readSchedulerStats;");
const samplerBlock = blockBetween(main,
  "if (_desktopPerfHooksRequested) {\n      const sampleGuestInstructions = async () => {",
  "window.__workerRpcStats");
const teardownBlock = blockBetween(main, "function clearLinuxOwnerUi", "function clearLinuxControllerOwner");
const surfaceBlock = blockBetween(main,
  "if (_desktopPerfHooksRequested) {\n  try {\n    window.__desktopPerf",
  "const networkProviderEl");
assert.equal(main.split(gate).length - 1, 1);
assert.match(surfaceBlock, /window.__desktopPerf = \{/);
assert.match(main, /guestInstructions: _desktopPerfHooksRequested\s*\?\s*\(\)\s*=>\s*_desktopPerfGuestInstructions/);
assert.match(schedulerBlock, /const retired = stats\?\.retiredInstructions;/);
assert.match(schedulerBlock, /if \(typeof retired === "number" && Number\.isSafeInteger\(retired\) && retired >= 0\) \{\s*_desktopPerfGuestInstructions = retired;/s);
assert.match(samplerBlock, /void sampleGuestInstructions\(\);\s*_desktopPerfStatsTimer = setInterval\(sampleGuestInstructions, 50\);/s);
assert.match(teardownBlock, /clearInterval\(_desktopPerfStatsTimer\);\s*_desktopPerfStatsTimer = null;\s*\}/s);
assert.match(teardownBlock, /_desktopPerfGuestInstructions = null;/);
console.log(JSON.stringify({
  productionImport: false,
  productionPageSurface: false,
  hookVersion: "e5-t25a-v1",
  sourceDistByteParity: true,
  samplerLifecycle: "dual-gated-type-checked-and-cleared",
}));
