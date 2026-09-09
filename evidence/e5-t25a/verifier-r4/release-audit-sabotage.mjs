import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name) => readFile(path.join(repo, name), "utf8");
const [audit, main, app, hooks] = await Promise.all([
  read("tools/verify/e5-t25a-release-audit.mjs"),
  read("web/main.js"),
  read("web/dist/app.html"),
  read("web/bench/desktop-perf-hooks.js"),
]);

const exact = {
  gate: 'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") && _startupQuery.has("perfHooks");',
  guard: 'if (typeof retired === "number" && Number.isSafeInteger(retired) && retired >= 0) {',
  sampler: "void sampleGuestInstructions();\n      _desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);",
  timerNull: "clearInterval(_desktopPerfStatsTimer);\n    _desktopPerfStatsTimer = null;",
  baselineReset: "  _desktopPerfGuestInstructions = null;\n  // Quota/read-only controls",
};

const mutations = {
  dualGate: [exact.gate,
    'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") || _startupQuery.has("perfHooks");'],
  strictCacheGuard: [exact.guard, "if (true) {"],
  samplerSetup: [exact.sampler,
    "void sampleGuestInstructions();\n      _desktopPerfStatsTimer = null;"],
  timerNulling: [exact.timerNull, "clearInterval(_desktopPerfStatsTimer);"],
  baselineReset: [exact.baselineReset, "  // sabotaged baseline reset\n  // Quota/read-only controls"],
};

const results = {};
for (const [name, [needle, replacement]] of Object.entries(mutations)) {
  if (!main.includes(needle)) throw new Error(`missing sabotage needle: ${name}`);
  const root = await mkdtemp(path.join(tmpdir(), "e5-t25a-audit-"));
  try {
    await Promise.all([
      mkdir(path.join(root, "tools/verify"), { recursive: true }),
      mkdir(path.join(root, "web/dist"), { recursive: true }),
      mkdir(path.join(root, "web/bench"), { recursive: true }),
    ]);
    const mutated = main.replace(needle, replacement);
    await Promise.all([
      writeFile(path.join(root, "tools/verify/e5-t25a-release-audit.mjs"), audit),
      writeFile(path.join(root, "web/main.js"), mutated),
      writeFile(path.join(root, "web/dist/main.js"), mutated),
      writeFile(path.join(root, "web/dist/app.html"), app),
      writeFile(path.join(root, "web/bench/desktop-perf-hooks.js"), hooks),
    ]);
    const run = spawnSync(process.execPath,
      [path.join(root, "tools/verify/e5-t25a-release-audit.mjs")],
      { encoding: "utf8" });
    results[name] = {
      exitCode: run.status,
      rejected: run.status !== 0,
      diagnostic: run.stderr.split("\n").find((line) => line.includes("AssertionError")) ?? "",
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const allRejected = Object.values(results).every((entry) => entry.rejected);
const output = {
  exactHead: "f7cee38b5aa93b00509e60d7dd103f5e5c21bfe3",
  allRejected,
  results,
};
await writeFile(new URL("release-audit-sabotage-results.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output));
if (!allRejected) process.exitCode = 1;
