import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const repo = new URL("../../../", import.meta.url);
const expected = {
  "evidence/e5-t25a/browser/results.json":
    "f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e",
  "evidence/e5-t25a/browser/chromium-gated.png":
    "7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547",
  "evidence/e5-t25a/demo/demo-suite.json":
    "0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd",
  "evidence/e5-t25a/demo/demo-suite.png":
    "aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1",
};
const artifacts = {};
for (const [path, expectedSha256] of Object.entries(expected)) {
  const bytes = await readFile(new URL(path, repo));
  const observedSha256 = createHash("sha256").update(bytes).digest("hex");
  artifacts[path] = { expectedSha256, observedSha256, held: observedSha256 === expectedSha256 };
}
const browser = JSON.parse(await readFile(new URL("evidence/e5-t25a/browser/results.json", repo)));
const demo = JSON.parse(await readFile(new URL("evidence/e5-t25a/demo/demo-suite.json", repo)));
const retainedSurfaces = JSON.parse(await readFile(new URL(
  "evidence/e5-t25a/verifier-r2/surface-results.json", repo)));
const task = await readFile(new URL(
  "tasks/epic-5-the-window/E5-T25a-desktop-perf-instrumentation.md", repo), "utf8");
const observedHead = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: new URL(".", repo), encoding: "utf8",
}).trim();
const checks = {
  exactHead: observedHead === "57c2cc828c151c830ebd7a377dc29d7bf898566d",
  hashesRecompute: Object.values(artifacts).every((v) => v.held),
  browserVersions: JSON.stringify(browser.browsers.map((v) => [v.browser, v.version]))
    === JSON.stringify([["chromium", "152.0.7977.76"], ["firefox", "132.0"]]),
  browserNormalOffFullOn: browser.browsers.every((v) => v.normalSurface === false
    && v.gatedSurface === true && v.hookCalls.at(-1)?.[0] === "syncTablet"),
  retainedSourceDistFourQueryIsolation: retainedSurfaces.results.length === 16
    && retainedSurfaces.results.every((entry) => {
      const full = entry.query.includes("testHooks=1") && entry.query.includes("perfHooks=1");
      return entry.observed.hasPerf === full
        && entry.observed.presentationHasRecordSink === full
        && entry.observed.attributionCallbackInstalled === full
        && entry.helperAutomaticallyRequested === false && entry.scopedErrors.length === 0;
    }),
  demo126of126: demo.metrics?.["metric-pass"] === "126"
    && demo.metrics?.["metric-fail"] === "0" && demo.metrics?.["metric-done"] === "126",
  demoErrorsEmpty: demo.errors?.length === 0 && demo.httpErrors?.length === 0,
  demoScreenshotSelfHash: demo.screenshotSha256
    === artifacts["evidence/e5-t25a/demo/demo-suite.png"].observedSha256,
  workerLogFullPngDigest: task.includes(
    "7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547"),
  workerLogCurrentDemoDigests: task.includes(
    "0b786e88c8ead85e509d1b1dd09213072816f2b4d3bc35c78563b3be5cc568fd")
    && task.includes("aaef2ebff2f8abcd6ed9e825831f4299eba5914bae80cf28d8762450b9c37ab1"),
};
const output = { exactHead: observedHead, artifacts, checks,
  allHeld: Object.values(checks).every(Boolean),
  browser: browser.browsers.map((v) => ({ browser: v.browser, version: v.version,
    normalSurface: v.normalSurface, gatedSurface: v.gatedSurface, hookCalls: v.hookCalls })),
  retainedSurfaceInspection: { priorHead: retainedSurfaces.exactHead,
    cases: retainedSurfaces.results.length,
    qualification: "Retained browser cases establish actual Chromium/Firefox source/dist four-query behavior; exact-head source/dist parity and the exact query conjunction are independently re-established by static-audit.mjs." },
  demo: { metrics: demo.metrics, errors: demo.errors, httpErrors: demo.httpErrors },
};
await writeFile(new URL("integrity-results.json", import.meta.url),
  `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ allHeld: output.allHeld, checks }));
if (!output.allHeld) process.exitCode = 1;
