// Synthetic attacks on the retained collector logic. These are not browser evidence.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./clock-fast-path-benchmark.mjs", import.meta.url), "utf8");
const frozen = JSON.parse(readFileSync(new URL(
  "../../evidence/omarchy-profile/clock-investigation-r1/final/control/report.json", import.meta.url), "utf8"));

// Execute the actual collector statements without launching its expensive producer.
// Exact anchors make a collector refactor fail visibly until this test is adapted.
function statements(start, end) {
  assert.equal(source.split(start).length, 2);
  const after = source.slice(source.indexOf(start));
  assert.ok(after.includes(end));
  return after.slice(0, after.indexOf(end));
}
const median = statements("const median = values =>", "\nconst roots =");
const checkBrowser = new Function("assert", "report", median + "\n" +
  statements("  for (const row of report.browser) {", "  const speedup = report.browser.find"));
const classify = new Function("report",
  statements("  const speedup = report.browser.find", "  assert.deepEqual(report.errors, []);") +
  "\nreturn report.performance;");

test("identical browser bytes cannot pass the speed gate even with favorable timing noise", () => {
  for (const speedup of [0.98, 1, 1.5]) {
    const report = { identicalBrowserBinary: true, browser: [
      { config: { fast: true, jit: false, divider: 64 }, speedup },
    ] };
    assert.deepEqual(classify(report), {
      cachedDivider64Speedup: speedup, decision: "unchanged-runtime-control", acceptanceHeld: false,
    });
  }
  for (const [speedup, decision, acceptanceHeld] of [[0.98, "rejected", false],
    [1, "rejected", false], [1.5, "candidate-faster", true]]) {
    const report = { identicalBrowserBinary: false, browser: [
      { config: { fast: true, jit: false, divider: 64 }, speedup },
    ] };
    assert.deepEqual(classify(report), { cachedDivider64Speedup: speedup, decision, acceptanceHeld });
  }
});

test("matching arms with an off-by-one clock still fail the independent retirement oracle", () => {
  checkBrowser(assert, structuredClone(frozen));
  const report = structuredClone(frozen);
  const row = report.browser.find(r => r.config.fast && !r.config.jit && r.config.divider === 64);
  for (const run of [...row.warmups, ...row.pairs.flatMap(p => p.runs)]) run.clock.mtime = "62813";
  assert.throws(() => checkBrowser(assert, report), /62813[\s\S]*62812/);
});

test("matching arms cannot substitute an armed executor for compiled retirements", () => {
  const report = structuredClone(frozen);
  const row = report.browser.find(r => r.config.jit);
  for (const run of [...row.warmups, ...row.pairs.flatMap(p => p.runs)]) {
    assert.equal(run.jit.hasExecutor, true);
    run.jit.retiredViaJit = 0;
  }
  assert.throws(() => checkBrowser(assert, report), /retiredViaJit/);
});
