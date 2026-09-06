import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (name) => readFile(path.join(repo, name), "utf8");
const [audit, main, app, hooks] = await Promise.all([
  read("tools/verify/e5-t25a-release-audit.mjs"), read("web/main.js"),
  read("web/dist/app.html"), read("web/bench/desktop-perf-hooks.js"),
]);
const mutations = {
  dualGate: [
    'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") && _startupQuery.has("perfHooks");',
    'const _desktopPerfHooksRequested = _startupQuery.has("testHooks") || _startupQuery.has("perfHooks");',
  ],
  strictGuard: [
    'if (typeof retired === "number" && Number.isSafeInteger(retired) && retired >= 0) {',
    "if (true) {",
  ],
  samplerSetup: [
    "void sampleGuestInstructions();\n      _desktopPerfStatsTimer = setInterval(sampleGuestInstructions, 50);",
    "void sampleGuestInstructions();\n      _desktopPerfStatsTimer = null;",
  ],
  timerNulling: [
    "clearInterval(_desktopPerfStatsTimer);\n    _desktopPerfStatsTimer = null;",
    "clearInterval(_desktopPerfStatsTimer);",
  ],
  baselineReset: [
    "  _desktopPerfGuestInstructions = null;\n  // Quota/read-only controls",
    "  // sabotaged attribution reset\n  // Quota/read-only controls",
  ],
};
const results = {};
for (const [name, [needle, replacement]] of Object.entries(mutations)) {
  if (!main.includes(needle)) throw new Error(`missing mutation needle: ${name}`);
  const root = await mkdtemp(path.join(tmpdir(), "e5-t25a-r5-audit-"));
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
      [path.join(root, "tools/verify/e5-t25a-release-audit.mjs")], { encoding: "utf8" });
    results[name] = { exitCode: run.status, rejected: run.status !== 0,
      diagnostic: run.stderr.split("\n").find((line) => line.includes("AssertionError")) ?? "" };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const output = { exactHead: "57c2cc828c151c830ebd7a377dc29d7bf898566d",
  allRejected: Object.values(results).every((v) => v.rejected), results };
await writeFile(new URL("release-audit-sabotage-results.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output));
if (!output.allRejected) process.exitCode = 1;
