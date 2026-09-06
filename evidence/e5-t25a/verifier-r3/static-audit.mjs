import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const repo = new URL("../../../", import.meta.url);
const read = async (path) => readFile(new URL(path, repo), "utf8");
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
  if (from < 0 || to < 0) throw new Error(`missing audit boundary: ${start} -> ${end}`);
  return text.slice(from, to);
};

const gate =
  'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") && _startupQuery.has("perfHooks");';
const cacheBlock = between(main, "const readSchedulerStats = async () => {", "window.__schedulerStats");
const samplerBlock = between(main, "const readSchedulerStats = async () => {", "window.__workerRpcStats");
const teardownBlock = between(main, "function clearLinuxOwnerUi", "function clearLinuxControllerOwner");
const surfaceBlock = between(main, "if (_desktopPerfHooksRequested) {\n  try {\n    window.__desktopPerf", "const networkProviderEl");
const guard = 'if (typeof retired === "number" && Number.isSafeInteger(retired) && retired >= 0) {';
const assignment = "_desktopPerfGuestInstructions = retired;";
const install = "_desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);";

const checks = {
  sourceDistMainByteParity: main === distMain,
  sourceDistPresentationByteParity: presentation === distPresentation,
  helperProjectionByteParity: helper === helperTs,
  exactDualGateUnique: count(main, gate) === 1,
  cacheGuardUnique: count(main, guard) === 1,
  cacheAssignmentUnique: count(main, assignment) === 1,
  cacheGuardOwnsAssignment: cacheBlock.indexOf(guard) >= 0
    && cacheBlock.indexOf(assignment) > cacheBlock.indexOf(guard),
  cacheReadsRawValueWithoutCoercion: cacheBlock.includes("const retired = stats?.retiredInstructions;")
    && !cacheBlock.includes("Number(stats?.retiredInstructions)"),
  samplerSetupInsideExactGate: samplerBlock.includes("if (_desktopPerfHooksRequested) {")
    && samplerBlock.includes("if (linuxCtl !== ctlForRelease) return;")
    && samplerBlock.includes("void sampleGuestInstructions();")
    && samplerBlock.includes(install),
  samplerInstallUnique: count(main, install) === 1,
  teardownClearsInterval: teardownBlock.includes("clearInterval(_desktopPerfStatsTimer);")
    && teardownBlock.includes("_desktopPerfStatsTimer = null;"),
  teardownResetsBaseline: teardownBlock.includes("_desktopPerfGuestInstructions = null;"),
  perfSurfaceInsideDualGate: surfaceBlock.includes("window.__desktopPerf = {")
    && surfaceBlock.startsWith("if (_desktopPerfHooksRequested)"),
  noProductionHelperImport: !main.includes("desktop-perf-hooks.js")
    && !distMain.includes("desktop-perf-hooks.js") && !app.includes("desktop-perf-hooks.js"),
  sourceSinkStrictGuard: presentation.includes(
    'if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {'),
};

const queryTruthTable = ["", "testHooks=1", "perfHooks=1", "testHooks=1&perfHooks=1"]
  .map((query) => {
    const params = new URLSearchParams(query);
    return { query, enabled: params.has("testHooks") && params.has("perfHooks") };
  });
checks.queryTruthTable = JSON.stringify(queryTruthTable.map((entry) => entry.enabled))
  === JSON.stringify([false, false, false, true]);

// Evaluate the submitted release audit's own regex strength without changing the tree.
const auditRegexFindings = {
  dualGateRegexCanMatchUnrelatedTokens:
    /testHooks.*perfHooks|perfHooks.*testHooks/s.test('const a = "testHooks"; const b = "perfHooks";'),
  samplerRegexCanCrossAClosedGate:
    /if \(_desktopPerfHooksRequested\) \{[\s\S]*?setInterval\(sampleGuestInstructions, 50\)/
      .test("if (_desktopPerfHooksRequested) {}\nsetInterval(sampleGuestInstructions, 50)"),
  cleanupRegexDoesNotRequireHandleOrBaselineReset:
    /clearInterval\(_desktopPerfStatsTimer\)/.test("clearInterval(_desktopPerfStatsTimer)"),
  submittedAuditContainsOnlyClearAssertion:
    audit.includes('assert.match(main, /clearInterval\\(_desktopPerfStatsTimer\\)/);')
      && !audit.includes("_desktopPerfStatsTimer = null")
      && !audit.includes("_desktopPerfGuestInstructions = null"),
};

const output = {
  exactHead: "a1c25437bed33910218eece228a77b230abfb8e9",
  checks,
  allHeld: Object.values(checks).every(Boolean),
  queryTruthTable,
  auditRegexFindings,
  qualification: "The submitted release audit has three over-broad lifecycle regexes. This verifier audit instead checks unique exact gate/guard/install strings inside bounded owner blocks, ordered assignment ownership, source/dist bytes, teardown handle nulling, and baseline reset. Because main.js cannot be booted without the forbidden listener/Linux owner path in this sandbox, setup and teardown receive a deterministic static-audit waiver rather than an execution claim.",
  sourceHashes: {
    main: createHash("sha256").update(main).digest("hex"),
    distMain: createHash("sha256").update(distMain).digest("hex"),
    presentation: createHash("sha256").update(presentation).digest("hex"),
    distPresentation: createHash("sha256").update(distPresentation).digest("hex"),
  },
};
await writeFile(new URL("static-audit-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ allHeld: output.allHeld, checks, auditRegexFindings }));
if (!output.allHeld) process.exitCode = 1;
