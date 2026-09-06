import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const runnerPath = "tools/verify/e5-t25b-browser.mjs";
const runner = readFileSync(runnerPath, "utf8");
const perf = readFileSync("web/bench/desktop-perf.js", "utf8");
const distPerf = readFileSync("web/dist/bench/desktop-perf.js", "utf8");
const releaseAudit = readFileSync("tools/verify/e5-t25b-release-audit.mjs", "utf8");

function uniqueIndex(text, token) {
  const first = text.indexOf(token);
  assert.ok(first >= 0, `missing token: ${token}`);
  assert.equal(text.indexOf(token, first + token.length), -1, `token is not unique: ${token}`);
  return first;
}

const loop = runner.slice(
  uniqueIndex(runner, "for (let index = 0; index < 5; index += 1)"),
  uniqueIndex(runner, "const aggregate = aggregateDragRuns(runs)"),
);
const orderedTokens = [
  "const chrome = await page.evaluate(() => window.__desktopCursor.detectWindowChrome())",
  "const before = await page.evaluate(async () =>",
  "await page.mouse.down()",
  "for (const point of pathPoints)",
  "await page.mouse.up()",
  "const after = await page.evaluate(async () =>",
  "const chromeAfter = await page.evaluate(() => window.__desktopCursor.detectWindowChrome())",
  "const displacement = assertWindowMoved(chrome.titlebar, chromeAfter.titlebar, { direction })",
  "const run = summarizeDragRun({",
  "runs.push({",
];
let previous = -1;
for (const token of orderedTokens) {
  const index = loop.indexOf(token);
  assert.ok(index > previous, `browser-loop order failed at: ${token}`);
  previous = index;
}

for (const token of [
  "windowBefore: chrome.titlebar",
  "windowAfter: chromeAfter.titlebar",
  "windowDisplacementX: displacement.deltaX",
  "windowDisplacementPx: displacement.displacementPx",
]) assert.equal(loop.split(token).length - 1, 1, `retention token count: ${token}`);

assert.match(runner, /waitForFunction\(\(\) => window\.__desktopCursor\?\.detectWindowChrome\?\.\(\) !== null, null, \{ timeout: timeoutMs \}\)/);
assert.equal(perf, distPerf, "source/dist performance module drift");
assert.match(perf, /DRAG_MIN_WINDOW_DISPLACEMENT_PX\s*=\s*100/);
assert.match(perf, /if \(displacementPx < minimum\)/);
assert.match(perf, /Math\.sign\(deltaX\) !== direction/);
assert.match(releaseAudit, /assertWindowMoved\\\(chrome\\\.titlebar, chromeAfter\\\.titlebar/);
assert.match(releaseAudit, /windowDisplacementPx: displacement\\\.displacementPx/);

const postFixDelta = execFileSync("git", [
  "diff", "--unified=0", "b179d9cca04aac461c2e4588ae59d05307827556..HEAD", "--", runnerPath,
], { encoding: "utf8" });
assert.match(postFixDelta, /timeout: 60_000/);
assert.match(postFixDelta, /timeout: timeoutMs/);
assert.equal(postFixDelta.includes("assertWindowMoved"), false, "readiness commit changed displacement wiring");

console.log(JSON.stringify({
  head: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  browserLoopOrder: orderedTokens,
  retainedGeometry: true,
  aggregationOccursAfterLoop: true,
  sourceDistPerfByteParity: true,
  releaseAuditChecksIntegrationToken: true,
  releaseAuditChecksRetainedDisplacement: true,
  releaseAuditLimitation: "regex tokens only; this verifier separately checked unique ordering and dataflow",
  readinessTimeoutUsesConfiguredBound: true,
  postFixHeadDeltaIsReadinessOnly: true,
}, null, 2));
