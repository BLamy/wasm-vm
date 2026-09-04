#!/usr/bin/env node
// E5-T06c: repeatable local Chromium benchmark for the Canvas2D/WebGL2 presentation paths.
// The benchmark page owns the timed work; this harness owns browser profiles, validation, and
// the evidence envelope. WebKit and independent-machine runs are intentionally outside this task.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence", "e5-t06c");
const requestedBase = process.env.E5_T06C_BASE_URL?.replace(/\/$/, "") || null;
const requestedPort = Number(process.env.E5_T06C_PORT || 0);
const samples = Number(process.env.E5_T06C_SAMPLES || 300);
const warmups = Number(process.env.E5_T06C_WARMUPS || 30);
const outputPath = parseOutputPath(process.argv.slice(2));
let port = requestedPort;
let server = null;

function parseOutputPath(args) {
  const index = args.indexOf("--output");
  if (index >= 0) {
    if (!args[index + 1]) throw new Error("--output requires a path");
    return path.resolve(repo, args[index + 1]);
  }
  const equals = args.find((arg) => arg.startsWith("--output="));
  return equals ? path.resolve(repo, equals.slice("--output=".length)) : null;
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function allocatePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function startServer() {
  if (requestedBase) return;
  if (port === 0) port = await allocatePort();
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    stdio: ["ignore", "ignore", "inherit"],
    detached: true,
  });
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/artifacts.json`, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`dev server did not start at ${base}`);
}

async function stopServer() {
  if (!server) return;
  const child = server;
  server = null;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await sleep(300);
  child.unref();
}

function validateCell(cell) {
  for (const field of ["id", "browser", "backend", "workload", "sampleCount", "copiesPerFrame", "copyModel", "status"]) {
    assert.ok(Object.hasOwn(cell, field), `benchmark cell is missing ${field}`);
  }
  assert.equal(cell.status, "ok", `${cell.id} did not complete`);
  assert.ok(cell.backend === "canvas2d" || cell.backend === "webgl2");
  assert.ok(cell.workload === "full-frame" || cell.workload === "damage-64x64");
  assert.ok(Number.isInteger(cell.sampleCount) && cell.sampleCount >= samples,
    `${cell.id} has only ${cell.sampleCount} samples`);
  assert.equal(cell.warmupFrames, warmups);
  assert.equal(cell.copiesPerFrame, 2);
  for (const field of ["minMs", "maxMs", "meanMs", "p50Ms", "p95Ms", "stdevMs", "totalMs"]) {
    assert.ok(Number.isFinite(cell[field]), `${cell.id} has invalid ${field}`);
  }
  assert.ok(cell.p95Ms >= cell.p50Ms, `${cell.id} has p95 below p50`);
}

function validateBenchmark(run, profile) {
  assert.equal(run.schema, 1);
  assert.equal(run.kind, "present-path-benchmark-v1");
  assert.equal(run.profile, profile.name);
  assert.ok(run.browser && typeof run.browser.name === "string");
  assert.equal(run.policy.sampleFrames, samples);
  assert.equal(run.policy.warmupFrames, warmups);
  assert.equal(run.policy.copiesPerFrame, 2);
  assert.equal(run.cells.length, 8, "expected two resolutions, two backends, and two workloads");
  for (const cell of run.cells) validateCell(cell);
  const damage = run.cells.filter((cell) => cell.width === 1280 && cell.height === 800 && cell.workload === "damage-64x64");
  assert.equal(damage.length, 2);
  assert.ok(["canvas2d", "webgl2"].includes(run.decision.defaultBackend));
  assert.equal(run.decision.workload, "damage-64x64");
  assert.equal(run.decision.resolution.width, 1280);
  assert.equal(run.decision.resolution.height, 800);
  assert.ok(run.decision.marginMs >= 0);
}

function attachErrorCapture(page, errors) {
  page.on("console", (message) => {
    if (message.type() !== "error" || message.location().url.includes("/favicon.ico")) return;
    errors.console.push({ text: message.text(), location: message.location() });
  });
  page.on("pageerror", (error) => errors.page.push(error.message));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/favicon.ico")) return;
    errors.requests.push({
      url: request.url(),
      failure: request.failure()?.errorText || "unknown",
    });
  });
}

async function runProfile(browser, base, profile, screenshotPath = null) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: profile.deviceScaleFactor,
  });
  const page = await context.newPage();
  const errors = { console: [], page: [], requests: [] };
  attachErrorCapture(page, errors);
  const benchmarkUrl = `${base}/bench/present-bench.html?profile=${encodeURIComponent(profile.name)}`;
  let backgroundPage = null;
  let cdp = null;
  try {
    await page.goto(benchmarkUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => window.presentBenchReady === true, null, { timeout: 30_000 });
    if (profile.cpuThrottleRate) {
      cdp = await context.newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.cpuThrottleRate });
    }
    if (profile.backgrounded) {
      backgroundPage = await context.newPage();
      await backgroundPage.goto("about:blank", { waitUntil: "domcontentloaded" });
      await backgroundPage.bringToFront();
      await sleep(100);
    }
    const benchmark = await page.evaluate(({ requestedSamples, requestedWarmups, profileName }) => (
      window.runPresentBench({ samples: requestedSamples, warmups: requestedWarmups, profile: profileName })
    ), { requestedSamples: samples, requestedWarmups: warmups, profileName: profile.name });
    validateBenchmark(benchmark, profile);
    if (screenshotPath) {
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    assert.deepEqual(errors, { console: [], page: [], requests: [] },
      `${profile.name} emitted browser errors: ${JSON.stringify(errors)}`);
    return {
      benchmark,
      observation: {
        requestedDevicePixelRatio: profile.deviceScaleFactor,
        observedDevicePixelRatio: benchmark.browser.devicePixelRatio,
        backgroundRequested: profile.backgrounded,
        backgroundedObserved: benchmark.browser.visibilityState === "hidden",
        visibilityState: benchmark.browser.visibilityState,
        cpuThrottleRate: profile.cpuThrottleRate || 1,
      },
      errors,
      screenshot: screenshotPath,
    };
  } finally {
    await cdp?.detach().catch(() => {});
    await backgroundPage?.close().catch(() => {});
    await context.close();
  }
}

function ranking(run) {
  return {
    defaultBackend: run.benchmark.decision.defaultBackend,
    fallbackBackend: run.benchmark.decision.fallbackOrder[1],
    marginMs: run.benchmark.decision.marginMs,
    marginPercent: run.benchmark.decision.marginPercent,
  };
}

const profiles = [
  { name: "baseline", deviceScaleFactor: 1, backgrounded: false, cpuThrottleRate: 1 },
  { name: "dpr2", deviceScaleFactor: 2, backgrounded: false, cpuThrottleRate: 1 },
  { name: "backgrounded", deviceScaleFactor: 1, backgrounded: true, cpuThrottleRate: 1 },
  { name: "cpu4x", deviceScaleFactor: 1, backgrounded: false, cpuThrottleRate: 4 },
];

const result = {
  task: "E5-T06c",
  schema: 1,
  command: "node tools/verify/e5-t06c-present-bench.mjs",
  generatedAt: new Date().toISOString(),
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  base: null,
  browser: null,
  baseline: null,
  adversarial: {},
  ranking: null,
  errors: { console: [], page: [], requests: [] },
};

const requestedChrome = process.env.E5_T06C_CHROME_PATH || null;
const { chromium } = await import(pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href);
const launchOptions = {
  headless: process.env.E5_T06C_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--use-angle=swiftshader"],
};
if (requestedChrome) launchOptions.executablePath = requestedChrome;

let browser = null;
try {
  await startServer();
  result.base = requestedBase || `http://127.0.0.1:${port}`;
  browser = await chromium.launch(launchOptions);
  result.browser = {
    name: "Chromium",
    version: browser.version(),
    executablePath: requestedChrome || "Playwright Chromium",
  };
  const screenshotPath = outputPath ? path.join(evidenceDir, "present-bench-baseline.png") : null;
  for (const profile of profiles) {
    const run = await runProfile(browser, result.base, profile,
      profile.name === "baseline" ? screenshotPath : null);
    const errorKeys = ["console", "page", "requests"];
    for (const key of errorKeys) result.errors[key].push(...run.errors[key].map((error) => ({ profile: profile.name, ...error })));
    if (profile.name === "baseline") result.baseline = run;
    else result.adversarial[profile.name] = run;
  }
  assert.ok(result.baseline, "baseline profile did not run");
  const baselineRanking = ranking(result.baseline);
  result.ranking = {
    baseline: baselineRanking,
    adversarial: Object.fromEntries(Object.entries(result.adversarial).map(([name, run]) => {
      const current = ranking(run);
      return [name, { ...current, rankingChanged: current.defaultBackend !== baselineRanking.defaultBackend }];
    })),
  };
  assert.deepEqual(result.errors, { console: [], page: [], requests: [] },
    `browser errors occurred: ${JSON.stringify(result.errors)}`);
  if (outputPath) {
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`wrote ${outputPath}`);
    console.log(JSON.stringify(result.ranking));
  } else {
    console.log(JSON.stringify(result));
  }
} finally {
  await browser?.close().catch(() => {});
  await stopServer();
}
