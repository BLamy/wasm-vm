#!/usr/bin/env node
// E5-T25a: the perf injector is an explicit bench module, not a production app import/surface.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
assert.match(main, /testHooks.*perfHooks|perfHooks.*testHooks/s);
assert.match(main, /guestInstructions:\s*_desktopPerfHooksRequested\s*\?\s*\(\)\s*=>\s*_desktopPerfGuestInstructions/);
assert.match(main, /const retired = stats\?\.retiredInstructions;\s*if \(typeof retired === "number" && Number\.isSafeInteger\(retired\) && retired >= 0\)/s);
assert.match(main, /if \(_desktopPerfHooksRequested\) \{[\s\S]*?setInterval\(sampleGuestInstructions, 50\)/);
assert.match(main, /clearInterval\(_desktopPerfStatsTimer\)/);
console.log(JSON.stringify({
  productionImport: false,
  productionPageSurface: false,
  hookVersion: "e5-t25a-v1",
  sourceDistByteParity: true,
  samplerLifecycle: "dual-gated-type-checked-and-cleared",
}));
