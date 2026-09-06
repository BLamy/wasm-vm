import { readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

const files = {
  sourceMain: new URL("../../../web/main.js", import.meta.url),
  distMain: new URL("../../../web/dist/main.js", import.meta.url),
  distApp: new URL("../../../web/dist/app.html", import.meta.url),
  browser: new URL("fresh-browser/results.json", import.meta.url),
};
const [sourceMain, distMain, distApp, browserText] = await Promise.all(
  Object.values(files).map((file) => readFile(file, "utf8")),
);
const browser = JSON.parse(browserText);

const gateDefinition =
  'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") && _startupQuery.has("perfHooks");';
const samplerStart = sourceMain.indexOf("if (_desktopPerfHooksRequested) {", sourceMain.indexOf("const readSchedulerStats"));
const samplerInstall = sourceMain.indexOf("_desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);");
const samplerBlockEnd = sourceMain.indexOf("window.__workerRpcStats", samplerStart);
const surfaceStart = sourceMain.indexOf("if (_desktopPerfHooksRequested) {");
const surfaceInstall = sourceMain.indexOf("window.__desktopPerf = {");
const surfaceBlockEnd = sourceMain.indexOf("const networkProviderEl", surfaceStart);

const queryTruthTable = [
  "noAutoBoot=1",
  "noAutoBoot=1&testHooks=1",
  "noAutoBoot=1&perfHooks=1",
  "noAutoBoot=1&testHooks=1&perfHooks=1",
].map((query) => {
  const params = new URLSearchParams(query);
  return { query, requested: params.has("testHooks") && params.has("perfHooks") };
});

const checks = {
  sourceDistMainByteEqual: sourceMain === distMain,
  exactDualGateDefinition: sourceMain.includes(gateDefinition),
  noProductionHelperImport: !sourceMain.includes("desktop-perf-hooks.js")
    && !distMain.includes("desktop-perf-hooks.js") && !distApp.includes("desktop-perf-hooks.js"),
  guestCallbackDualGated: sourceMain.includes(
    "guestInstructions: _desktopPerfHooksRequested ? () => _desktopPerfGuestInstructions : undefined,"),
  samplerInstallInsideDualGate: samplerStart >= 0 && samplerInstall > samplerStart
    && samplerInstall < samplerBlockEnd,
  samplerInstallUnique: sourceMain.split(
    "_desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);",
  ).length - 1 === 1,
  samplerCleanupPresent: sourceMain.includes("clearInterval(_desktopPerfStatsTimer);")
    && sourceMain.includes("_desktopPerfGuestInstructions = null;"),
  perfSurfaceInsideDualGate: surfaceStart >= 0 && surfaceInstall > surfaceStart
    && surfaceInstall < surfaceBlockEnd,
  queryTruthTable: isDeepStrictEqual(queryTruthTable.map((entry) => entry.requested),
    [false, false, false, true]),
  retainedBrowserEngines: isDeepStrictEqual(browser.browsers.map((entry) =>
    [entry.browser, entry.version, entry.normalSurface, entry.gatedSurface]), [
    ["chromium", "152.0.7977.76", false, true],
    ["firefox", "132.0", false, true],
  ]),
  retainedBrowserCallsComplete: browser.browsers.every((entry) => isDeepStrictEqual(entry.hookCalls, [
    ["sendTabletEvent", 3, 0, 4],
    ["sendTabletEvent", 3, 1, 5],
    ["syncTablet"],
  ])),
};

const output = {
  exactHead: "0da96f6a5c7f323b986fe41b6f6bfb2508eec834",
  queryTruthTable,
  checks,
  allHeld: Object.values(checks).every(Boolean),
  qualification: "The 50 ms retired-instruction sampler and presentation callback are installed only when both URL gates are present. The pre-existing window.__schedulerStats function remains available on all pages; on normal pages no timer, perf callback, or __desktopPerf surface is installed.",
};
await writeFile(new URL("release-surface-results.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ allHeld: output.allHeld, checks }));
if (!output.allHeld) process.exitCode = 1;
