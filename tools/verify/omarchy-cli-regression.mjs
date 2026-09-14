#!/usr/bin/env node
// Real BusyBox RPC regression proof. This is deliberately a direct Playwright script rather than
// the Playwright test runner: the runner can hang before launching the test process on this host.
// No page requests, VM objects, console bytes, readiness events, or RPC results are mocked.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../web/node_modules/playwright/index.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// Public app APIs suffice; testHooks would install a test-only300ms worker watchdog.
const baseUrl = "http://127.0.0.1:8000/?noAutoBoot=1#ide";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const outputArg = process.argv[2] || "evidence/omarchy-profile/cli-regression-rerun";
const evidenceDir = path.resolve(repo, outputArg);
const reportPath = path.join(evidenceDir, "report.json");
const screenshotPath = path.join(evidenceDir, "busybox-rpc-regression.png");
const deadlineAt = Date.now() + 5 * 60_000;

await fs.mkdir(evidenceDir);

const report = {
  result: "running",
  url: baseUrl,
  realVm: true,
  browser: { executablePath: chromePath },
  commands: [],
  observations: {},
  consoleErrors: [],
  pageErrors: [],
  failedRequests: [],
  servedSourceHashes: null,
  screenshot: screenshotPath,
  startedAt: new Date().toISOString(),
};

let ownedServer = null;
let browser = null;
let page = null;

function remaining() {
  const ms = deadlineAt - Date.now();
  if (ms <= 0) throw new Error("omarchy CLI regression exceeded the five-minute deadline");
  return ms;
}

async function serverIsUp() {
  try {
    // Readiness needs headers only. Leaving the large HTML body unread can abort Node's
    // HTTP parser on connection close before the browser or the evidence writer starts.
    const response = await fetch(baseUrl, { method: "HEAD", signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureServer() {
  if (await serverIsUp()) return;
  ownedServer = spawn("bash", ["tools/serve-dev.sh", "8000"], {
    cwd: repo,
    detached: true, // Own the shell and its Python child as one disposable process group.
    stdio: ["ignore", "pipe", "pipe"],
  });
  ownedServer.stdout.on("data", (chunk) => process.stderr.write(`[serve-dev] ${chunk}`));
  ownedServer.stderr.on("data", (chunk) => process.stderr.write(`[serve-dev] ${chunk}`));
  const startedBy = Date.now();
  while (!(await serverIsUp())) {
    if (Date.now() - startedBy > 15_000) throw new Error("owned dev server did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

function record(name, command, value) {
  report.commands.push({ name, command, result: value });
  report.observations[name] = value;
  return value;
}

async function run() {
  await ensureServer();
  browser = await chromium.launch({
    executablePath: chromePath,
    headless: true,
    args: ["--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: "block",
  });
  page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" && !/favicon\.ico/u.test(message.location().url || "")) {
      report.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => report.pageErrors.push(String(error)));
  page.on("requestfailed", (request) => {
    if (!/favicon\.ico/u.test(request.url())) {
      report.failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
    }
  });

  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: remaining() });
  await page.waitForFunction(
    () => window.wvmDemo && typeof window.wvmDemo.runBusybox === "function",
    undefined,
    { timeout: remaining() },
  );

  const servedSourceHashes = await page.evaluate(async () => {
    const hash = async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    };
    return {
      main: { url: new URL("main.js", location.href).href, sha256: await hash("main.js") },
      guestRpc: { url: new URL("guest-rpc.js", location.href).href, sha256: await hash("guest-rpc.js") },
      ide: { url: new URL("ide.js", location.href).href, sha256: await hash("ide.js") },
      agentSession: { url: new URL("desktop-agent-session.js", location.href).href,
        sha256: await hash("desktop-agent-session.js") },
    };
  });
  report.servedSourceHashes = servedSourceHashes;
  record("servedSourceHashes", "fetch main.js and guest-rpc.js; SHA-256 in Chromium", servedSourceHashes);

  const boot = await page.evaluate(() => window.wvmDemo.runBusybox());
  record("runBusybox", "window.wvmDemo.runBusybox()", boot);
  assert.equal(boot?.ok, true, `real BusyBox boot failed: ${JSON.stringify(boot)}`);
  await page.waitForFunction(() => window.wvmDemo.isGuestReady?.() === true, undefined, {
    timeout: remaining(),
  });
  record("isGuestReady", "window.wvmDemo.isGuestReady()", true);
  await page.waitForFunction(() => Boolean(document.querySelector("#ide-explorer > .ide-tree")), undefined,
    { timeout: remaining() });
  const services = await page.evaluate(() => ({
    session: window.wvmDemo.guestSession(),
    explorer: document.querySelector("#ide-explorer")?.innerText,
    treePresent: Boolean(document.querySelector("#ide-explorer > .ide-tree")),
  }));
  record("cliServices", "actual winning session and completed Explorer tree", services);
  assert.equal(services.session?.key, "busybox");
  assert.ok(Number.isSafeInteger(services.session.generation) && services.session.generation > 0);
  assert.equal(services.treePresent, true);
  assert.match(services.explorer, /\/root/u);
  assert.doesNotMatch(services.explorer, /Could not list|services are disabled/u);

  const rpc = await page.evaluate(() => window.wvmDemo.run("echo RPC_$((6*7))"));
  record("arithmetic", "run echo RPC_$((6*7))", rpc);
  assert.match(rpc.stdout, /RPC_42/);
  assert.equal(rpc.exit, 0);

  const serialized = await page.evaluate(async () => {
    const a = window.wvmDemo.run("echo A_$((1+1))");
    const b = window.wvmDemo.run("echo B_$((2+2))");
    return { a: await a, b: await b };
  });
  record("serialized", "run echo A_$((1+1)); run echo B_$((2+2))", serialized);
  assert.match(serialized.a.stdout, /A_2/);
  assert.doesNotMatch(serialized.a.stdout, /B_/);
  assert.match(serialized.b.stdout, /B_4/);
  assert.doesNotMatch(serialized.b.stdout, /A_/);

  const nonzero = await page.evaluate(() => window.wvmDemo.run("false"));
  record("nonzero", "run false", nonzero);
  assert.equal(nonzero.exit, 1);

  const spoof = await page.evaluate(() =>
    window.wvmDemo.run("printf '__WVEND_deadbeef_0\\n'; echo REAL_$((3+4))"),
  );
  record("wrongNonceSpoof", "run printf wrong nonce; echo REAL_$((3+4))", spoof);
  assert.match(spoof.stdout, /REAL_7/);
  assert.equal(spoof.exit, 0);

  const stream = await page.evaluate(() => new Promise((resolve) => {
    const got = [];
    const all = [];
    const handle = window.wvmDemo.stream(
      "i=0; while [ $i -lt 8 ]; do echo STREAM_$i; i=$((i+1)); sleep 1; done",
      (line) => {
        all.push(line);
        if (/^STREAM_\d+$/.test(line)) got.push(line);
        if (got.length >= 3) {
          handle.stop();
          resolve({ got, all });
        }
      },
    );
    setTimeout(() => {
      handle.stop();
      resolve({ got, all, timeout: true });
    }, 60_000);
  }));
  record("stream", "stream emits STREAM_0..; stop after three lines", stream);

  const after = await page.evaluate(() => window.wvmDemo.run("echo ALIVE_$((5+5))"));
  record("afterStop", "run echo ALIVE_$((5+5))", after);
  assert.ok(stream.got.length >= 3, `stream emitted too few lines: ${JSON.stringify(stream)}`);
  assert.match(stream.got[0], /STREAM_0/);
  assert.doesNotMatch(stream.all.join("\n"), /__WVBEGIN_/);
  assert.match(after.stdout, /ALIVE_10/);
  assert.doesNotMatch(after.stdout, /STREAM_|\^C/);
  assert.equal(after.exit, 0);

  assert.deepEqual(report.consoleErrors, []);
  assert.deepEqual(report.pageErrors, []);
  assert.deepEqual(report.failedRequests, []);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  report.result = "PASS";
}

let runDeadline;
try {
  await Promise.race([run(), new Promise((_, reject) => {
    runDeadline = setTimeout(() => reject(new Error("CLI regression exceeded five-minute deadline")), remaining());
  })]);
} catch (error) {
  report.result = "FAIL";
  report.error = error?.stack || String(error);
  if (page) {
    try { await page.screenshot({ path: screenshotPath, fullPage: true }); } catch {}
  }
  throw error;
} finally {
  clearTimeout(runDeadline);
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + "\n");
  if (browser) await browser.close().catch(() => {});
  if (ownedServer && ownedServer.exitCode === null && !ownedServer.killed) {
    // Killing only bash leaves Python holding the pipes open, so ChildProcess.close never fires.
    const closed = new Promise((resolve) => ownedServer.once("close", resolve));
    try { process.kill(-ownedServer.pid, "SIGTERM"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    let cleanupTimer;
    const closedNormally = await Promise.race([
      closed.then(() => true), new Promise((resolve) => { cleanupTimer = setTimeout(() => resolve(false), 5000); }),
    ]);
    clearTimeout(cleanupTimer);
    if (!closedNormally) {
      try { process.kill(-ownedServer.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
      ownedServer.stdout.destroy(); ownedServer.stderr.destroy(); ownedServer.unref();
      throw new Error("CLI recorder server did not close within five seconds");
    }
  }
}

console.log(`OMARCHY_CLI_REGRESSION_PASS ${reportPath}`);
