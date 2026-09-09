import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const repo = new URL("../../../", import.meta.url);
const rel = (path) => new URL(path, repo);
const entries = [
  ["workerBrowserJson", "evidence/e5-t25a/browser/results.json",
    "f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e"],
  ["workerBrowserPng", "evidence/e5-t25a/browser/chromium-gated.png",
    "7b77d08efbfeab64b9a46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547"],
  ["demoJson", "evidence/e5-t25a/demo/demo-suite.json",
    "48fd7146cefc6ba84976f9d8a602ada2a4d032b6033e3360d06d375434206572"],
  ["demoPng", "evidence/e5-t25a/demo/demo-suite.png",
    "08f0868eab3a05b160505ce9c8596a0783374b7216a2c8b02b2d252983f62513"],
  ["freshBrowserJson", "evidence/e5-t25a/verifier-r2/fresh-browser/results.json",
    "f82cf35bb1c0db9e425b6bbfc37a5117304be424e1f9318777e1dc165a273d4e"],
  ["freshBrowserPng", "evidence/e5-t25a/verifier-r2/fresh-browser/chromium-gated.png",
    "7b77d08efbfeab64a9b46cf6b3617c86b1e81afd90781a24bf4c2b02893f5547"],
];
const buffers = {};
const hashes = {};
for (const [name, path, expected] of entries) {
  const bytes = await readFile(rel(path));
  buffers[name] = bytes;
  const observed = createHash("sha256").update(bytes).digest("hex");
  hashes[name] = { path, expected, observed, held: observed === expected };
}

const demo = JSON.parse(buffers.demoJson.toString("utf8"));
const browser = JSON.parse(buffers.freshBrowserJson.toString("utf8"));
const gateLog = await readFile(new URL("make-verify.log", import.meta.url), "utf8");
const checks = {
  allHashesHeld: Object.values(hashes).every((entry) => entry.held),
  workerFreshBrowserJsonByteEqual: buffers.workerBrowserJson.equals(buffers.freshBrowserJson),
  workerFreshBrowserPngByteEqual: buffers.workerBrowserPng.equals(buffers.freshBrowserPng),
  demoScreenshotInternalHashHeld: demo.screenshotSha256 === hashes.demoPng.observed,
  demo126of126: demo.metrics?.["metric-pass"] === "126"
    && demo.metrics?.["metric-fail"] === "0" && demo.metrics?.["metric-done"] === "126",
  demoNoBrowserOrHttpErrors: demo.errors?.length === 0 && demo.httpErrors?.length === 0,
  demoNoNonFaviconConsoleErrors: !demo.consoleLog?.some((entry) =>
    entry.type === "error" && !String(entry.url).endsWith("/favicon.ico")),
  gateEightPassedNoSkipped: gateLog.includes("ℹ tests 8") && gateLog.includes("ℹ pass 8")
    && gateLog.includes("ℹ fail 0") && gateLog.includes("ℹ skipped 0"),
  gateReleaseAuditHeld: gateLog.includes(
    '{"productionImport":false,"productionPageSurface":false,"hookVersion":"e5-t25a-v1"}'),
  gateBrowserResultsHeld: browser.browsers.length === 2 && browser.browsers.every((entry) =>
    entry.normalSurface === false && entry.gatedSurface === true
    && entry.hookCalls.at(-1)?.[0] === "syncTablet"),
};
const output = {
  exactHead: "0da96f6a5c7f323b986fe41b6f6bfb2508eec834",
  hashes,
  demo: {
    metrics: demo.metrics,
    errors: demo.errors,
    httpErrors: demo.httpErrors,
    faviconErrors: demo.consoleLog.filter((entry) =>
      entry.type === "error" && String(entry.url).endsWith("/favicon.ico")).length,
  },
  browsers: browser.browsers.map((entry) => ({
    browser: entry.browser,
    version: entry.version,
    normalSurface: entry.normalSurface,
    gatedSurface: entry.gatedSurface,
    hookCalls: entry.hookCalls,
  })),
  checks,
  allHeld: Object.values(checks).every(Boolean),
};
await writeFile(new URL("integrity-results.json", import.meta.url), `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify({ allHeld: output.allHeld, checks }));
if (!output.allHeld) process.exitCode = 1;
