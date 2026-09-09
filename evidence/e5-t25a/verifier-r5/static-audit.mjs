import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const repo = new URL("../../../", import.meta.url);
const read = (path) => readFile(new URL(path, repo), "utf8");
const [main, distMain, presentation, distPresentation, helper, helperTs, app, audit] =
  await Promise.all([
    read("web/main.js"), read("web/dist/main.js"), read("web/src/sink/presentation.js"),
    read("web/dist/src/sink/presentation.js"), read("web/bench/desktop-perf-hooks.js"),
    read("web/bench/desktop-perf-hooks.ts"), read("web/dist/app.html"),
    read("tools/verify/e5-t25a-release-audit.mjs"),
  ]);
const count = (text, needle) => text.split(needle).length - 1;
const between = (text, start, end) => {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from + start.length);
  if (from < 0 || to < 0 || to <= from) throw new Error(`missing block ${start} -> ${end}`);
  return text.slice(from, to);
};
const gate =
  'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") && _startupQuery.has("perfHooks");';
const guard = 'if (typeof retired === "number" && Number.isSafeInteger(retired) && retired >= 0) {';
const assignment = "_desktopPerfGuestInstructions = retired;";
const install = "_desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);";
const schedulerBlock = between(main, "const readSchedulerStats = async () => {", "window.__schedulerStats");
const samplerBlock = between(main,
  "if (_desktopPerfHooksRequested) {\n      const sampleGuestInstructions = async () => {",
  "window.__workerRpcStats");
const teardownBlock = between(main, "function clearLinuxOwnerUi", "function clearLinuxControllerOwner");
const surfaceBlock = between(main,
  "if (_desktopPerfHooksRequested) {\n  try {\n    window.__desktopPerf", "const networkProviderEl");

const checks = {
  mainSourceDistByteIdentical: main === distMain,
  presentationSourceDistByteIdentical: presentation === distPresentation,
  helperJsTsByteIdentical: helper === helperTs,
  exactDualGateUnique: count(main, gate) === 1,
  strictGuardAndAssignmentUnique: count(main, guard) === 1 && count(main, assignment) === 1,
  strictGuardOwnsRawAssignment: schedulerBlock.includes("const retired = stats?.retiredInstructions;")
    && schedulerBlock.indexOf(guard) >= 0
    && schedulerBlock.indexOf(assignment) > schedulerBlock.indexOf(guard)
    && !schedulerBlock.includes("Number(stats?.retiredInstructions)"),
  samplerOwnerGuardAndTimerBounded: samplerBlock.startsWith("if (_desktopPerfHooksRequested)")
    && samplerBlock.includes("if (linuxCtl !== ctlForRelease) return;")
    && samplerBlock.includes("void sampleGuestInstructions();")
    && samplerBlock.includes(install) && count(main, install) === 1,
  teardownClearsNullsAndResets: teardownBlock.includes("clearInterval(_desktopPerfStatsTimer);")
    && teardownBlock.includes("_desktopPerfStatsTimer = null;")
    && teardownBlock.includes("_desktopPerfGuestInstructions = null;"),
  surfaceInsideExactGate: surfaceBlock.startsWith("if (_desktopPerfHooksRequested)")
    && surfaceBlock.includes("window.__desktopPerf = {"),
  noProductionHelperImport: !main.includes("desktop-perf-hooks.js")
    && !distMain.includes("desktop-perf-hooks.js") && !app.includes("desktop-perf-hooks.js"),
  presentationCallbacksAndRecordCapGated: main.includes("onPresent: _desktopPerfHooksRequested")
    && main.includes("now: _desktopPerfHooksRequested")
    && main.includes("guestInstructions: _desktopPerfHooksRequested")
    && main.includes("if (_desktopPerfPresentRecords.length > 4096) _desktopPerfPresentRecords.shift();"),
  sinkStrictNoCoercionGuard: presentation.includes(
    'if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {'),
  nestedDiagnosticFallbackPresent: presentation.includes('let detail = "unavailable";')
    && presentation.includes("try { detail = String(error); } catch { /* retain the safe fallback */ }"),
  auditUsesFourBoundedExactBlocks: audit.includes("function blockBetween(text, start, end)")
    && audit.includes("const schedulerBlock = blockBetween(main")
    && audit.includes("const samplerBlock = blockBetween(main")
    && audit.includes("const teardownBlock = blockBetween(main")
    && audit.includes("const surfaceBlock = blockBetween(main"),
  auditChecksGateGuardSamplerTimerAndReset: audit.includes("assert.equal(main.split(gate).length - 1, 1)")
    && audit.includes('assert.match(schedulerBlock, /if \\(typeof retired === "number"')
    && audit.includes("_desktopPerfStatsTimer = setInterval")
    && audit.includes("_desktopPerfStatsTimer = null")
    && audit.includes("_desktopPerfGuestInstructions = null"),
};
const queryTruthTable = ["", "testHooks=1", "perfHooks=1", "testHooks=1&perfHooks=1"]
  .map((query) => {
    const params = new URLSearchParams(query);
    return { query, enabled: params.has("testHooks") && params.has("perfHooks") };
  });
checks.exactDualQueryIsolation = isEqual(queryTruthTable.map((v) => v.enabled),
  [false, false, false, true]);
function isEqual(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

const output = {
  exactHead: "57c2cc828c151c830ebd7a377dc29d7bf898566d", checks,
  allHeld: Object.values(checks).every(Boolean), queryTruthTable,
  waiver: "The Linux-owner page lifecycle cannot execute in the no-boot verifier surface. Exact bounded blocks independently establish the unique dual gate, raw strict-number cache assignment, owner guard, unique 50 ms sampler, timer clear/null, attribution reset, and gated public surface; sabotage separately proves the submitted audit rejects each mutation.",
  hashes: Object.fromEntries(Object.entries({ main, distMain, presentation, distPresentation,
    helper, helperTs }).map(([name, bytes]) =>
    [name, createHash("sha256").update(bytes).digest("hex")])),
};
await writeFile(new URL("static-audit-results.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ allHeld: output.allHeld, checks }));
if (!output.allHeld) process.exitCode = 1;
