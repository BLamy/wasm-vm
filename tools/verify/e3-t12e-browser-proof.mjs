#!/usr/bin/env node
// E3-T12e: direct Chromium proof for the Docker-tab save → reload → resume path.
// The harness uses the same raw Playwright API as the other long browser proofs because the
// repository's Playwright Test runner deadlocks before discovery on this host's Node 24.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const web = path.join(repo, "web");
const evidenceDir = path.join(repo, "evidence", "e3-t12e");
const evidencePath = path.join(evidenceDir, "docker-tab-instant-resume-browser.json");
const screenshotPath = path.join(evidenceDir, "docker-tab-instant-resume-browser.png");
const requestedBase = process.env.E3_T12E_BASE_URL?.replace(/\/$/, "") || null;
let port = Number(process.env.E3_T12E_PORT || 0);
const bootTimeout = Number(process.env.E3_T12E_BOOT_TIMEOUT_MS || 900_000);
const reloadBudget = Number(process.env.E3_T12E_RELOAD_BUDGET_MS || 3_000);
const commandTimeout = Number(process.env.E3_T12E_COMMAND_TIMEOUT_MS || 120_000);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mark = (message) => console.error(`[e3-t12e] ${message}`);

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

if (!requestedBase && port === 0) port = await allocatePort();
const base = requestedBase || `http://127.0.0.1:${port}`;
const favicon = new URL("/favicon.ico", `${base}/`).href;
let server = null;

async function startServer() {
  if (requestedBase) return;
  server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    stdio: ["ignore", "pipe", "inherit"],
    detached: true,
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/artifacts-alpine.json`, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error(`dev server did not start at ${base}`);
}

async function stopServer() {
  if (!server) return;
  try { process.kill(-server.pid, "SIGTERM"); } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  await sleep(300);
}

async function staticAudit() {
  const read = async (name) => fs.readFile(path.join(repo, name), "utf8");
  const pairs = [["web/main.js", "web/dist/main.js"], ["web/ide.js", "web/dist/ide.js"]];
  const parity = [];
  for (const [sourceName, distName] of pairs) {
    const [source, dist] = await Promise.all([read(sourceName), read(distName)]);
    assert.equal(dist, source, `${sourceName} and ${distName} differ`);
    parity.push({ source: sourceName, dist: distName, equal: true, digest: sha256(source) });
  }
  const ide = await read("web/ide.js");
  const main = await read("web/main.js");
  for (const source of [ide, main]) {
    assert.doesNotMatch(source, /(?:T12E_BEFORE_42|T12E_AFTER_42)/,
      "production source contains a canned guest marker");
  }
  for (const required of ["snapshotStatus", "snapshotSave", "ide-dk-save-resume", "save-resume"]) {
    assert.ok(ide.includes(required) || main.includes(required), `missing ${required}`);
  }
  return { parity, cannedMarkers: false };
}

const staticEvidence = await staticAudit();
const { chromium } = await import(
  pathToFileURL(path.join(web, "node_modules", "playwright", "index.mjs")).href,
);
const chromePath = process.env.E3_T12E_CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = {
  headless: process.env.E3_T12E_HEADED !== "1",
  args: ["--disable-dev-shm-usage", "--disable-gpu", "--js-flags=--max-old-space-size=4096"],
};
try {
  await fs.access(chromePath);
  launchOptions.executablePath = chromePath;
} catch {}

const query = new URLSearchParams({
  guest: "node-alpine",
  noAutoBoot: "1",
  testHooks: "1",
  nosw: "1",
  worker: "0",
  jit: "0",
  persist: "1",
});
const url = `${base}/?${query}#ide`;
const browser = await chromium.launch(launchOptions);
const profile = await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e3t12e-"));
const context = await chromium.launchPersistentContext(profile, {
  ...launchOptions,
  viewport: { width: 1600, height: 1000 },
});
const page = context.pages()[0] || await context.newPage();
const consoleErrors = [];
const failedRequests = [];
page.on("console", (message) => {
  if (message.type() === "error" && !message.text().includes("favicon.ico")) {
    consoleErrors.push({ text: message.text(), location: message.location() });
  }
});
page.on("pageerror", (error) => consoleErrors.push({ text: `pageerror: ${error.message}` }));
page.on("requestfailed", (request) => {
  if (request.url() !== favicon) {
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText || "unknown" });
  }
});

const waitFor = (predicate, arg, timeout) => page.waitForFunction(predicate, arg, {
  timeout,
  polling: 200,
});
const state = () => page.evaluate(() => window.__dockerStateForTest?.());
const run = (command) => page.evaluate(({ command, timeout }) =>
  window.wvmDemo.run(command, timeout), { command, timeout: commandTimeout });

async function waitForReady({ timeout = bootTimeout, waitGuest = true, waitDocker = true } = {}) {
  await page.waitForFunction(() => window.__ready === true && !!window.wvmDemo, null, {
    timeout: 120_000,
  });
  const bootStarted = Date.now();
  const outcome = await page.evaluate(() => window.wvmDemo.bootNodeAlpine());
  assert.equal(outcome?.ok, true, `node-alpine boot failed: ${JSON.stringify(outcome)}`);
  await page.waitForFunction(() => !!window.__linuxCtl, null, { timeout: 120_000 });
  if (waitGuest) {
    await waitFor(() => window.wvmDemo?.isGuestReady?.() === true, undefined, timeout);
  }
  if (waitDocker) {
    await page.locator("#ide-act-docker").click();
    await page.locator("#ide-dk-runtime").waitFor({ state: "visible", timeout: 30_000 });
    await waitFor(() => {
      const docker = window.__dockerStateForTest?.();
      return docker?.runtime === "available" && docker?.catalogStatus === "available";
    }, undefined, timeout);
    await waitFor(() => {
      const snapshot = window.__dockerStateForTest?.().snapshot;
      return snapshot && !["unknown", "checking", "saving"].includes(snapshot.status);
    }, undefined, 60_000);
  }
  return { bootMs: Date.now() - bootStarted };
}

async function controllerState() {
  return page.evaluate(async () => ({
    restored: Boolean(window.__linux?.restoredFromBootSnapshot?.()),
    decision: await window.__snapshotDecision(),
    generation: await window.__snapshotGeneration(),
    digest: await window.__linuxCtl?.stateDigest?.() ?? null,
    paused: await window.__linux?.isPaused?.(),
  }));
}

async function snapshotStatus() {
  return page.evaluate(() => window.wvmDemo.snapshotStatus());
}

const result = {
  generatedAt: new Date().toISOString(),
  base,
  url,
  browser: { name: browser.browserType().name(), version: browser.version() },
  staticAudit: staticEvidence,
  stages: {},
  errors: { console: consoleErrors, requests: failedRequests },
};

try {
  await startServer();
  const firstBootStarted = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const firstBoot = await waitForReady();
  const firstBootMs = Date.now() - firstBootStarted;
  const initial = await state();
  assert.equal(initial.runtime, "available");
  assert.ok(initial.catalog?.length > 0, "Docker catalog must come from the guest");
  assert.ok(initial.snapshot, "Docker view must expose resume state");
  assert.equal(initial.snapshot.status, "ready");
  assert.equal(initial.snapshot.decision, "missing");
  result.stages.initial = {
    bootMs: firstBootMs,
    controllerMs: firstBoot.bootMs,
    runtime: initial.runtime,
    catalogCount: initial.catalog.length,
    snapshot: initial.snapshot,
    restoredFromBootSnapshot: await page.evaluate(() => window.__linux.restoredFromBootSnapshot()),
  };
  mark(`Docker runtime ready in ${firstBootMs}ms`);

  const before = await run("printf T12E_BEFORE_42 > /root/t12e-resume-state && sync");
  assert.equal(before.exit, 0, `pre-save guest command failed: ${before.stdout}`);
  const beforeRead = await run("cat /root/t12e-resume-state");
  assert.equal(beforeRead.exit, 0);
  assert.equal(beforeRead.stdout.trim(), "T12E_BEFORE_42");

  const saveButton = page.locator("#ide-dk-save-resume");
  await saveButton.waitFor({ state: "visible", timeout: 30_000 });
  assert.equal(await saveButton.isDisabled(), false, "Save resume must be enabled for Alpine");
  const saveStarted = Date.now();
  await saveButton.click();
  await waitFor(() => {
    const snapshot = window.__dockerStateForTest?.().snapshot;
    return snapshot?.status === "ready" && snapshot.decision === "resume";
  }, undefined, 300_000);
  const saved = await state();
  const savedStatus = await snapshotStatus();
  const savedController = await controllerState();
  assert.equal(saved.snapshot.decision, "resume");
  mark(`post-save UI decision=${saved.snapshot.decision}, controller decision=${savedStatus.decision}, generation=${saved.snapshot.generation}/${savedStatus.generation}`);
  assert.ok(Number.isFinite(saved.snapshot.generation));
  result.stages.save = {
    elapsedMs: Date.now() - saveStarted,
    ui: saved.snapshot,
    api: savedStatus,
    stateDigest: savedController.digest,
    generation: savedController.generation,
    paused: savedController.paused,
  };
  mark(`coherent resume snapshot saved at generation ${saved.snapshot.generation}`);

  const reloadStarted = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  const firstReloadBoot = await waitForReady();
  const reloadMs = Date.now() - reloadStarted;
  const resumed = await state();
  const resumedStatus = await snapshotStatus();
  const firstRestore = await controllerState();
  assert.equal(resumed.runtime, "available");
  assert.equal(resumed.snapshot.decision, "resume");
  assert.equal(resumedStatus.decision, "resume");
  assert.equal(resumedStatus.restored, true, "reload must report a restored machine");
  assert.equal(resumed.snapshot.generation, saved.snapshot.generation);
  assert.ok(reloadMs < reloadBudget, `reload-to-usable took ${reloadMs}ms (budget ${reloadBudget}ms)`);

  const after = await run("cat /root/t12e-resume-state && printf '\\nT12E_AFTER_42\\n'");
  assert.equal(after.exit, 0, `post-resume guest command failed: ${after.stdout}`);
  assert.match(after.stdout, /T12E_BEFORE_42/);
  assert.match(after.stdout, /T12E_AFTER_42/);
  result.stages.reload = {
    elapsedMs: reloadMs,
    budgetMs: reloadBudget,
    controllerMs: firstReloadBoot.bootMs,
    state: resumed.snapshot,
    api: resumedStatus,
    stateDigest: firstRestore.digest,
    restored: firstRestore.restored,
    generation: firstRestore.generation,
    restoredFile: "T12E_BEFORE_42",
    secondCommand: after,
  };
  mark(`reload restored the guest in ${reloadMs}ms and the second command read the saved file`);

  // Re-open the same tab a second time without changing the overlay. The saved snapshot must still
  // be coherent, and the same guest file must be readable again; this catches a one-shot restore
  // flag or an in-memory-only snapshot state that cannot survive two sequential reloads.
  await page.evaluate(() => window.__linuxCtl.pause());
  const secondReloadStarted = Date.now();
  await page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
  const secondReloadBoot = await waitForReady();
  const secondReloadMs = Date.now() - secondReloadStarted;
  const secondResumed = await state();
  const secondRestore = await controllerState();
  assert.equal(secondResumed.snapshot.decision, "resume");
  assert.equal(secondRestore.restored, true, "second reload must still use the saved snapshot");
  assert.equal(secondRestore.decision, "resume");
  assert.equal(secondRestore.generation, saved.snapshot.generation);
  assert.ok(secondReloadMs < reloadBudget, `second reload-to-usable took ${secondReloadMs}ms (budget ${reloadBudget}ms)`);
  const secondRead = await run("cat /root/t12e-resume-state");
  assert.equal(secondRead.exit, 0);
  assert.equal(secondRead.stdout.trim(), "T12E_BEFORE_42");
  result.stages.secondReload = {
    elapsedMs: secondReloadMs,
    budgetMs: reloadBudget,
    controllerMs: secondReloadBoot.bootMs,
    state: secondResumed.snapshot,
    controller: secondRestore,
    read: secondRead,
  };
  mark(`second sequential reload restored in ${secondReloadMs}ms with the same file and generation`);

  // A real overlay write advances the durable disk generation. The saved RAM snapshot must become
  // stale, and the visible Check control must expose the cold-path decision rather than claiming a
  // false fast restore. This is intentionally decision-level: a third cold boot would only repeat
  // the already-proven cold fallback and would make the acceptance gate needlessly host-lengthy.
  const staleWrite = await run("printf T12E_AFTER_WRITE_42 > /root/t12e-after-write && sync && cat /root/t12e-after-write");
  assert.equal(staleWrite.exit, 0);
  await page.evaluate(() => window.__linuxCtl.pause());
  await page.evaluate(() => window.__persist());
  const staleDecision = await page.evaluate(() => window.__snapshotDecision());
  assert.equal(staleDecision, "stale");
  await page.locator("#ide-dk-check-resume").click();
  await waitFor(() => window.__dockerStateForTest?.().snapshot?.decision === "stale", undefined, 30_000);
  const stale = await state();
  assert.equal(stale.snapshot.decision, "stale");
  assert.equal(staleWrite.stdout.trim(), "T12E_AFTER_WRITE_42");
  result.stages.stale = {
    decision: staleDecision,
    ui: stale.snapshot,
    write: staleWrite,
    persistStats: await page.evaluate(() => window.__persistStats?.() ?? null),
  };
  mark("overlay write changed the durable generation and the UI exposed stale/cold-path state");

  // Retire the live controller, then construct a fresh controller with the scheduler held paused.
  // The old snapshot remains in IndexedDB but is stale, so the loader must report a cold machine
  // rather than restoring it. Holding the scheduler prevents a long interpreted cold boot from
  // obscuring this exact branch decision.
  assert.equal(await page.evaluate(() => window.__retireLinuxControllerForTest()), true);
  const coldQuery = new URLSearchParams(query);
  coldQuery.set("startPaused", "1");
  const coldUrl = `${base}/?${coldQuery}#ide`;
  await page.goto(coldUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const coldStarted = Date.now();
  const coldBoot = await waitForReady({ waitGuest: false, waitDocker: false });
  const cold = await controllerState();
  const coldPath = {
    controllerMs: Date.now() - coldStarted,
    bootMs: coldBoot.bootMs,
    restored: cold.restored,
    decision: cold.decision,
    generation: cold.generation,
    paused: cold.paused,
    guestReady: await page.evaluate(() => window.wvmDemo.isGuestReady()),
    bootState: await page.evaluate(() => window.__linuxBootStateForTest()),
  };
  assert.equal(coldPath.restored, false, "stale snapshot incorrectly took the fast restore path");
  assert.equal(coldPath.decision, "stale");
  assert.equal(coldPath.generation, stale.snapshot.generation);
  assert.equal(coldPath.paused, true);
  assert.equal(coldPath.guestReady, false, "cold-path probe unexpectedly advertised a usable restored guest");
  result.stages.coldPath = coldPath;
  mark(`stale snapshot selected cold path at controller-ready in ${coldPath.controllerMs}ms`);

  await page.screenshot({ path: screenshotPath, fullPage: true });
  assert.deepEqual(consoleErrors, [], `unexpected console errors: ${JSON.stringify(consoleErrors)}`);
  assert.deepEqual(failedRequests, [], `unexpected failed requests: ${JSON.stringify(failedRequests)}`);
  result.outcome = "passed";
} finally {
  result.errors = { console: consoleErrors, requests: failedRequests };
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await fs.rm(profile, { recursive: true, force: true }).catch(() => {});
  await stopServer().catch(() => {});
}

await fs.mkdir(evidenceDir, { recursive: true });
const finalEvidence = {
  ...result,
  runtimeHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  screenshot: {
    path: path.relative(repo, screenshotPath),
    sha256: sha256(await fs.readFile(screenshotPath)),
  },
};
await fs.writeFile(evidencePath, `${JSON.stringify(finalEvidence, null, 2)}\n`);
console.log(JSON.stringify(finalEvidence, null, 2));
