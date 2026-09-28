#!/usr/bin/env node
// Bounded real-Omarchy floating-point/JIT profile. Diagnostic evidence only; this is not a
// desktop acceptance test and never substitutes guest counters with host-side estimates.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const distRoot = path.join(repoRoot, "web", "dist");
const releaseRoot = path.join(repoRoot, "releases");
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const output = path.resolve(process.argv[2] || "evidence/omarchy-profile/fp-profile");
const screenshotPath = path.join(output, "omarchy-fp-profile.png");
const reportPath = path.join(output, "report.json");
const profileUrl = "http://127.0.0.1";
const profileWindowMs = 60_000;
const startedAt = new Date().toISOString();

await fs.mkdir(output, { recursive: false });

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"],
]);
const inside = (root, candidate) => candidate === root || candidate.startsWith(`${root}${path.sep}`);

function servedPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { status: 400 };
  }
  if (decoded.includes("\0")) return { status: 400 };
  const release = decoded.startsWith("/releases/");
  const root = release ? releaseRoot : distRoot;
  const relative = release ? decoded.slice("/releases/".length) : decoded === "/" ? "app.html" : decoded.replace(/^\/+/, "");
  const filename = path.resolve(root, relative);
  return inside(root, filename) ? { root, filename } : { status: 403 };
}

async function serve(request, response) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const resolved = servedPath(new URL(request.url || "/", profileUrl).pathname);
  if (resolved.status) {
    response.writeHead(resolved.status);
    response.end();
    return;
  }
  let stat;
  try {
    stat = await fs.stat(resolved.filename);
  } catch {
    response.writeHead(404);
    response.end();
    return;
  }
  if (!stat.isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  const [realRoot, realFile] = await Promise.all([
    fs.realpath(resolved.root),
    fs.realpath(resolved.filename),
  ]);
  if (!inside(realRoot, realFile)) {
    response.writeHead(403);
    response.end();
    return;
  }
  response.writeHead(200, {
    "Content-Length": stat.size,
    "Content-Type": mimeTypes.get(path.extname(resolved.filename).toLowerCase()) || "application/octet-stream",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Cache-Control": "no-store",
  });
  if (request.method === "HEAD") response.end();
  else response.end(await fs.readFile(resolved.filename));
}

const server = createServer((request, response) => {
  void serve(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end();
  });
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert.ok(address && typeof address === "object", "profile server did not bind");
const url = `http://127.0.0.1:${address.port}/app.html?guest=omarchy&desktop=1&profile=1&jit=1&omarchyDivider=64#ide`;

const report = {
  result: "running",
  scope: "bounded diagnostic only; not desktop acceptance",
  realVm: true,
  url,
  requested: { profile: true, jit: true, divider: 64, profileWindowMs },
  startedAt,
  screenshot: screenshotPath,
  sourceHashes: {},
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
};

let browser = null;
let page = null;

function numericLeaves(value, prefix = "", result = {}) {
  if (typeof value === "number" && Number.isFinite(value)) {
    result[prefix || "value"] = value;
  } else if (Array.isArray(value)) {
    value.forEach((item, index) => numericLeaves(item, `${prefix}[${index}]`, result));
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      numericLeaves(item, prefix ? `${prefix}.${key}` : key, result);
    }
  }
  return result;
}

function numericDelta(before, after) {
  const left = numericLeaves(before);
  const right = numericLeaves(after);
  const delta = {};
  for (const [key, value] of Object.entries(right)) {
    if (typeof left[key] === "number") delta[key] = value - left[key];
  }
  return delta;
}

function fpLeaves(value) {
  const all = numericLeaves(value);
  return Object.fromEntries(Object.entries(all).filter(([key]) => /(?:^|[.\[ ])(?:fp|fpu|float|floating|softfloat)(?:$|[.\]\d])/iu.test(key)));
}

function profileRegionDelta(before, after) {
  const previous = new Map((before?.regions || []).map((region) => [region.pc, region.samples]));
  return (after?.regions || [])
    .map((region) => ({
      pc: region.pc,
      samples: Math.max(0, region.samples - (previous.get(region.pc) || 0)),
    }))
    .filter((region) => region.samples > 0)
    .sort((a, b) => b.samples - a.samples);
}

function subsystemDelta(before, after) {
  const previous = new Map((before?.subsystems || []).map((item) => [item.name, item.ns]));
  return (after?.subsystems || [])
    .map((item) => ({ name: item.name, ns: Math.max(0, item.ns - (previous.get(item.name) || 0)) }))
    .filter((item) => item.ns > 0);
}

async function hashServedFiles() {
  for (const filename of ["main.js", "loader.js", "guest-rpc.js", "pkg/wasm_vm_wasm_bg.wasm"]) {
    const response = await fetch(new URL(`/${filename}`, url));
    assert.equal(response.status, 200, `served ${filename} returned HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    report.sourceHashes[filename] = {
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
}

async function sample(label) {
  const sample = await page.evaluate(async (sampleLabel) => {
    const controller = window.__linuxCtl;
    if (!controller || typeof controller.profileStats !== "function") throw new Error("real profileStats RPC unavailable");
    if (typeof window.__jitStats !== "function") throw new Error("real __jitStats unavailable");
    if (typeof window.__schedulerStats !== "function") throw new Error("real __schedulerStats unavailable");
    const [profile, jit, scheduler] = await Promise.all([
      controller.profileStats(),
      window.__jitStats(),
      window.__schedulerStats(),
    ]);
    if (!profile || !jit || !scheduler) throw new Error("real profile/JIT/scheduler sample was empty");
    return { label: sampleLabel, capturedAt: new Date().toISOString(), profile, jit, scheduler };
  }, label);
  return sample;
}

async function run() {
  await hashServedFiles();
  browser = await chromium.launch({
    headless: true,
    executablePath: chromePath,
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    globalThis.__fpProfileEvidence = { desktopReady: false };
    addEventListener("wvm:desktop-ready", () => { globalThis.__fpProfileEvidence.desktopReady = true; });
  });
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/u.test(message.location().url || "")) report.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (!/favicon\.ico/u.test(request.url())) report.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
  });

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 300_000 });
  await page.waitForFunction(
    () => globalThis.__fpProfileEvidence?.desktopReady === true && globalThis.wvmDemo?.isGuestReady?.() === true && Boolean(globalThis.__linuxCtl),
    undefined,
    { timeout: 300_000 },
  );
  report.machineReadyAt = new Date().toISOString();
  report.executionPolicy = await page.evaluate(() => ({
    dataset: {
      backend: document.documentElement.dataset.linuxBackend,
      jitPolicy: document.documentElement.dataset.jitPolicy,
      jitThreshold: document.documentElement.dataset.jitThreshold,
      interpreter: document.documentElement.dataset.interpreter,
    },
    execution: window.__executionPolicy || null,
    jit: window.__jit || null,
  }));
  report.before = await sample("before");
  await page.waitForTimeout(profileWindowMs);
  report.after = await sample("after");
  await page.screenshot({ path: screenshotPath, timeout: 30_000 });
  report.screenshotSha256 = createHash("sha256").update(await fs.readFile(screenshotPath)).digest("hex");

  const beforeProfile = report.before.profile;
  const afterProfile = report.after.profile;
  const profileDelta = numericDelta(beforeProfile, afterProfile);
  const fpBefore = fpLeaves(report.before);
  const fpAfter = fpLeaves(report.after);
  report.findings = {
    dynamicFpCounters: Object.keys(fpAfter).length
      ? { available: true, before: fpBefore, after: fpAfter, delta: numericDelta(fpBefore, fpAfter) }
      : { available: false, before: fpBefore, after: fpAfter, note: "The sampled built profile/JIT/scheduler surfaces expose no FP-specific numeric counter." },
    profileCost: {
      totalNsDelta: (afterProfile.totalNs || 0) - (beforeProfile.totalNs || 0),
      sampleCountDelta: (afterProfile.sampleCount || 0) - (beforeProfile.sampleCount || 0),
      walkCountDelta: (afterProfile.walkCount || 0) - (beforeProfile.walkCount || 0),
      subsystemNsDelta: subsystemDelta(beforeProfile, afterProfile),
      numericDeltas: profileDelta,
    },
    hotRegions: profileRegionDelta(beforeProfile, afterProfile),
    jitDeltas: numericDelta(report.before.jit, report.after.jit),
    schedulerDeltas: numericDelta(report.before.scheduler, report.after.scheduler),
  };
  report.result = "captured";
}

let failure = null;
try {
  await run();
} catch (error) {
  failure = error;
  report.result = "failed";
  report.error = error.stack || String(error);
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  if (browser) await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}

if (failure) {
  console.error(report.error);
  process.exitCode = 1;
} else {
  const finding = report.findings;
  console.log(JSON.stringify({
    result: report.result,
    evidence: output,
    machineReadyAt: report.machineReadyAt,
    profileWindowMs,
    dynamicFpCounters: finding.dynamicFpCounters,
    hotRegions: finding.hotRegions.slice(0, 5),
    profileCost: finding.profileCost,
    jitDeltas: finding.jitDeltas,
    schedulerDeltas: finding.schedulerDeltas,
    consoleErrors: report.consoleErrors,
  }, null, 2));
}
