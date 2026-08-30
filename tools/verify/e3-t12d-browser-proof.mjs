#!/usr/bin/env node
// E3-T12d: exact-head browser evidence for the persistent snapshot store.
//
// The repository Playwright Test runner deadlocks on this host's Node 24 before discovering tests,
// so this uses the same Chromium engine through Playwright's raw API. The clean proof deliberately
// runs the production whole-machine Worker. Fault injection uses the explicit ?worker=0 differential
// so the browser page can deterministically terminate the exact IndexedDB transaction under test.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repo, "evidence/epic-3-t12d");
let port = Number(process.env.E3_T12D_PORT || 0);
if (!process.env.E3_T12D_WEB_BASE && port === 0) {
  port = await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}
const base = (process.env.E3_T12D_WEB_BASE || `http://127.0.0.1:${port}`).replace(/\/$/, "");
const headless = process.env.E3_T12D_HEADLESS === "1";
const runFileReload = process.env.E3_T12D_FILE_RELOAD !== "0";
const fileReloadTimeout = Number(process.env.E3_T12D_FILE_RELOAD_TIMEOUT_MS || 1_800_000);
const allowedFaviconUrl = new URL("/favicon.ico", `${base}/`).href;
const evidencePath = path.join(evidenceDir, "browser-storage-2026-08-30.json");
const screenshotPath = path.join(evidenceDir, "browser-storage-2026-08-30.png");

const { chromium } = await import(
  pathToFileURL(path.join(repo, "web/node_modules/playwright/index.mjs")).href,
);

// This seam is installed only in disposable main-thread proof profiles. It never changes the
// production code path; it lets the harness model a tab disappearing after the clear, chunk, or
// commit-marker operation and a real QuotaExceededError at the exact IDB put boundary.
const faultScript = String.raw`(() => {
  const state = { phase: null, signaled: false, seen: null, chunkPuts: 0 };
  const proto = IDBObjectStore.prototype;
  const originalClear = proto.clear;
  const originalPut = proto.put;
  const isSnapshot = (store) => {
    try { return store.transaction?.db?.name?.startsWith("wvsn-") === true; } catch { return false; }
  };
  const signal = (phase, value) => {
    if (state.phase !== phase || state.signaled) return;
    state.signaled = true;
    state.seen = { phase, value, at: performance.now() };
    console.log("[E3-T12D-PHASE] " + phase + ":" + value);
  };
  Object.defineProperty(proto, "clear", {
    configurable: true,
    value(...args) {
      if (isSnapshot(this) && this.name === "chunks") signal("clear", 0);
      return originalClear.apply(this, args);
    },
  });
  Object.defineProperty(proto, "put", {
    configurable: true,
    value(...args) {
      if (isSnapshot(this) && this.name === "chunks") {
        const index = state.chunkPuts++;
        signal("chunk", index);
        if (state.phase === "quota" && !state.quotaInjected) {
          state.quotaInjected = true;
          signal("quota", index);
          try { this.transaction.abort(); } catch {}
          throw new DOMException("E3-T12d deterministic snapshot quota", "QuotaExceededError");
        }
      } else if (isSnapshot(this) && this.name === "meta") {
        signal("meta", 0);
      }
      return originalPut.apply(this, args);
    },
  });
  globalThis.__e3t12dFault = {
    configure(phase) {
      state.phase = phase;
      state.signaled = false;
      state.seen = null;
      state.quotaInjected = false;
      state.chunkPuts = 0;
    },
    seen: () => state.seen,
  };
})();`;

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
  if (process.env.E3_T12D_WEB_BASE) return null;
  const server = spawn("bash", ["tools/serve-dev.sh", String(port)], {
    cwd: repo,
    stdio: ["ignore", "pipe", "inherit"],
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/artifacts-alpine.json`, { cache: "no-store" });
      if (response.ok) return server;
    } catch {}
    await sleep(100);
  }
  server.kill("SIGTERM");
  throw new Error(`dev server did not start at ${base}`);
}

async function closeServer(server) {
  if (!server) return;
  server.kill("SIGTERM");
  await new Promise((resolve) => {
    server.once("exit", resolve);
    setTimeout(resolve, 2_000);
  });
}

async function diagnostics(context, page, label, allErrors) {
  const errors = [];
  const httpErrors = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  cdp.on("Network.responseReceived", (event) => {
    if (event.response.status >= 400) {
      httpErrors.push({ status: event.response.status, url: event.response.url });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.push({ text: message.text(), location: message.location() });
    }
  });
  page.on("pageerror", (error) => {
    errors.push({ text: `pageerror: ${error.message}`, location: null });
  });
  const record = { label, errors, httpErrors };
  allErrors.push(record);
  return record;
}

function realErrors(record) {
  const consoleErrors = record.errors.filter((entry) => {
    const url = entry.location?.url;
    return !(url === allowedFaviconUrl || entry.text.includes("favicon.ico"));
  });
  const badHttp = record.httpErrors.filter((entry) => !(entry.status === 404 && entry.url === allowedFaviconUrl));
  return { consoleErrors, badHttp };
}

async function openContext({ fault = false, label, allErrors }) {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), "wasm-vm-e3t12d-"));
  const context = await chromium.launchPersistentContext(profile, {
    headless,
    args: ["--disable-dev-shm-usage", "--enable-precise-memory-info", "--js-flags=--max-old-space-size=4096"],
    viewport: { width: 1600, height: 1000 },
  });
  if (fault) await context.addInitScript({ content: faultScript });
  const page = context.pages()[0] || await context.newPage();
  const record = await diagnostics(context, page, label, allErrors);
  return { context, profile, page, record };
}

async function closeContext(env) {
  await env.context.close().catch(() => {});
  await fs.rm(env.profile, { recursive: true, force: true });
}

async function loadShell(page, query) {
  await page.goto(`${base}/?${query}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => window.__ready === true && !!window.wvmDemo, null, { timeout: 120_000 });
}

async function bootFlavor(page, flavor = "alpine", { waitReady = true } = {}) {
  const method = flavor === "node-alpine" ? "bootNodeAlpine" : "bootAlpine";
  const outcome = await page.evaluate((name) => window.wvmDemo[name](), method);
  assert.equal(outcome?.ok, true, `${method} failed: ${JSON.stringify(outcome)}`);
  await page.waitForFunction(() => !!window.__linuxCtl, null, { timeout: 120_000 });
  if (waitReady) {
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: 120_000 });
  }
  return outcome;
}

async function startBootWithoutWaiting(page, flavor = "alpine") {
  const method = flavor === "node-alpine" ? "bootNodeAlpine" : "bootAlpine";
  await page.evaluate((name) => {
    window.__e3t12dBootPromise = window.wvmDemo[name]();
    window.__e3t12dBootPromise.catch(() => {});
  }, method);
  await page.waitForFunction(() => !!window.__linuxCtl, null, { timeout: 120_000 });
}

async function pause(page) {
  await page.evaluate(() => window.__linux.pause());
  await page.waitForFunction(async () => await window.__linux.isPaused(), null, { timeout: 30_000 }).catch(() => {});
}

async function readOverlayState(page) {
  return page.evaluate(async () => {
    const digest = async (value) => {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || []);
      const out = await crypto.subtle.digest("SHA-256", bytes);
      return [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, "0")).join("");
    };
    const request = (req) => new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
    });
    const open = (name) => new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
    const names = (await indexedDB.databases()).map((entry) => entry.name).filter((name) => name?.startsWith("wvov-")).sort();
    const out = [];
    for (const name of names) {
      const db = await open(name);
      try {
        const txn = db.transaction(["blocks", "meta"]);
        const blocks = txn.objectStore("blocks");
        const keys = await request(blocks.getAllKeys());
        const values = await request(blocks.getAll());
        const meta = await request(txn.objectStore("meta").get(0));
        const entries = [];
        for (let i = 0; i < keys.length; i += 1) {
          entries.push({ key: Number(keys[i]), digest: await digest(values[i]) });
        }
        out.push({ name, keys: entries, metaDigest: await digest(meta), blockCount: keys.length });
      } finally {
        db.close();
      }
    }
    return out;
  });
}

async function installMemoryProbe(page) {
  return page.evaluate(() => {
    window.__e3t12dMemory = [];
    window.__e3t12dSnapshotProbe = (phase, value) => {
      const memory = performance.memory;
      window.__e3t12dMemory.push({
        phase,
        value,
        used: memory?.usedJSHeapSize ?? null,
        total: memory?.totalJSHeapSize ?? null,
        at: performance.now(),
      });
    };
    const memory = performance.memory;
    return {
      used: memory?.usedJSHeapSize ?? null,
      total: memory?.totalJSHeapSize ?? null,
      limit: memory?.jsHeapSizeLimit ?? null,
    };
  });
}

async function readMemory(page) {
  return page.evaluate(() => ({
    samples: window.__e3t12dMemory || [],
    after: performance.memory
      ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize }
      : null,
  }));
}

async function saveSnapshot(page) {
  return page.evaluate(() => window.__snapshotSave());
}

async function snapshotDigest(page) {
  return page.evaluate(async () => {
    const bytes = await window.__snapshotExport();
    if (!bytes) return null;
    const out = await crypto.subtle.digest("SHA-256", bytes);
    return {
      bytes: bytes.byteLength,
      digest: [...new Uint8Array(out)].map((b) => b.toString(16).padStart(2, "0")).join(""),
    };
  });
}

async function cleanWorkerProof(allErrors) {
  const env = await openContext({ label: "clean-worker", allErrors });
  try {
    await loadShell(env.page, "noAutoBoot=1&persist=1");
    const started = Date.now();
    await bootFlavor(env.page);
    const bootMs = Date.now() - started;
    await pause(env.page);
    const before = await env.page.evaluate(() => window.__snapshotDecision());
    assert.equal(before, "missing");
    assert.equal(await saveSnapshot(env.page), true);
    const saved = await snapshotDigest(env.page);
    assert.ok(saved?.bytes > 1_000_000);
    assert.equal(await env.page.evaluate(() => window.__snapshotDecision()), "resume");
    await env.page.screenshot({ path: screenshotPath, fullPage: false });

    await env.page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await env.page.waitForFunction(() => window.__ready === true && !!window.wvmDemo, null, { timeout: 120_000 });
    const reloadStarted = Date.now();
    await bootFlavor(env.page);
    const reloadMs = Date.now() - reloadStarted;
    await pause(env.page);
    assert.equal(await env.page.evaluate(() => window.__snapshotDecision()), "resume");
    return {
      bootMs,
      reloadMs,
      backend: await env.page.evaluate(() => document.documentElement.dataset.linuxBackend),
      saved,
      before,
      afterReload: await env.page.evaluate(() => window.__snapshotDecision()),
    };
  } finally {
    await closeContext(env);
  }
}

async function memoryProof(allErrors) {
  const env = await openContext({ label: "memory-main-thread", allErrors });
  try {
    await loadShell(env.page, "noAutoBoot=1&persist=1&worker=0");
    await bootFlavor(env.page);
    await pause(env.page);
    const baseline = await installMemoryProbe(env.page);
    assert.ok(baseline.used != null, "Chromium precise JS heap metrics are required");
    assert.equal(await saveSnapshot(env.page), true);
    const memory = await readMemory(env.page);
    const used = memory.samples.map((sample) => sample.used).filter((value) => value != null);
    assert.ok(used.length > 0, "snapshot phase probe recorded no JS heap samples");
    const peakUsed = Math.max(...used);
    const saveStart = memory.samples.find((sample) => sample.phase === "save-start");
    const phases = new Set(memory.samples.map((sample) => sample.phase));
    for (const phase of ["save-start", "clear-committed", "chunk-before-put", "chunk-committed", "meta-before", "meta-committed"]) {
      assert.ok(phases.has(phase), `missing snapshot phase ${phase}`);
    }
    assert.ok(saveStart?.value > 1_000_000, "production-sized snapshot was not measured");
    // The documented bound is the staging overhead above the pre-save page heap. The 256 MiB
    // guest memory is baseline runtime state; chunked storage is allowed one bounded 16 MiB txn
    // plus transient JS bookkeeping, and this 32 MiB ceiling is intentionally above that contract.
    const overhead = peakUsed - baseline.used;
    const bound = 32 * 1024 * 1024;
    assert.ok(overhead <= bound, `snapshot staging overhead ${overhead} exceeds ${bound}`);
    return {
      backend: await env.page.evaluate(() => document.documentElement.dataset.linuxBackend),
      baseline,
      peakUsed,
      after: memory.after,
      overhead,
      bound,
      snapshotBytes: saveStart.value,
      sampleCount: memory.samples.length,
      phases: memory.samples,
    };
  } finally {
    await closeContext(env);
  }
}

async function saveBaseline(env) {
  await loadShell(env.page, "noAutoBoot=1&persist=1&worker=0");
  await bootFlavor(env.page);
  await pause(env.page);
  const overlayBefore = await readOverlayState(env.page);
  assert.equal(await saveSnapshot(env.page), true);
  const snapshotBefore = await snapshotDigest(env.page);
  assert.equal(await env.page.evaluate(() => window.__snapshotDecision()), "resume");
  return { overlayBefore, snapshotBefore };
}

async function waitForPhase(page, phase) {
  await page.waitForFunction(
    (wanted) => window.__e3t12dFault?.seen?.()?.phase === wanted,
    phase,
    { timeout: 120_000 },
  );
}

async function replacementDecision(context, allErrors, label) {
  const page = await context.newPage();
  await diagnostics(context, page, label, allErrors);
  await loadShell(page, "noAutoBoot=1&persist=1&worker=0");
  const overlayAfter = await readOverlayState(page);
  await startBootWithoutWaiting(page);
  await pause(page);
  const decision = await page.evaluate(() => window.__snapshotDecision());
  const generation = await page.evaluate(() => window.__snapshotGeneration());
  let resumedDigest = null;
  if (decision === "resume") resumedDigest = await snapshotDigest(page);
  return { page, overlayAfter, decision, generation, resumedDigest };
}

async function killScenario(phase, allErrors) {
  const env = await openContext({ fault: true, label: `kill-${phase}`, allErrors });
  try {
    const baseline = await saveBaseline(env);
    await env.page.evaluate(() => window.__snapshotAdvanceGen());
    await env.page.evaluate((wanted) => window.__e3t12dFault.configure(wanted), phase);
    const marker = waitForPhase(env.page, phase);
    const save = env.page.evaluate(() => window.__snapshotSave()).catch((error) => ({ error: String(error) }));
    await marker;
    const observed = await env.page.evaluate(() => window.__e3t12dFault.seen());
    await env.page.close();
    await save;
    const replacement = await replacementDecision(env.context, allErrors, `after-${phase}`);
    try {
      assert.deepEqual(replacement.overlayAfter, baseline.overlayBefore, `${phase} changed durable overlay state`);
      assert.ok(["resume", "corrupt", "stale"].includes(replacement.decision));
      if (replacement.decision === "resume") {
        assert.deepEqual(replacement.resumedDigest, baseline.snapshotBefore, `${phase} resumed a non-original snapshot`);
      }
      return {
        phase,
        observed,
        decision: replacement.decision,
        generation: replacement.generation,
        overlayPreserved: true,
        safeSelection: replacement.decision === "resume" ? "previous-complete-snapshot" : replacement.decision,
      };
    } finally {
      await replacement.page.close().catch(() => {});
    }
  } finally {
    await closeContext(env);
  }
}

async function quotaScenario(allErrors) {
  const env = await openContext({ fault: true, label: "quota", allErrors });
  try {
    const baseline = await saveBaseline(env);
    await env.page.evaluate(() => window.__snapshotAdvanceGen());
    await env.page.evaluate(() => window.__e3t12dFault.configure("quota"));
    let failure = null;
    try {
      await saveSnapshot(env.page);
    } catch (error) {
      failure = String(error);
    }
    await waitForPhase(env.page, "quota");
    assert.match(failure || "", /QuotaExceededError/);
    const decision = await env.page.evaluate(() => window.__snapshotDecision());
    assert.ok(["resume", "corrupt", "stale"].includes(decision));
    await env.page.evaluate(() => window.__linux.resume());
    const live = await env.page.evaluate(() => window.wvmDemo.run("echo T12D_QUOTA_LIVE", 30_000));
    assert.equal(live.exit, 0);
    assert.match(live.stdout, /T12D_QUOTA_LIVE/);
    await pause(env.page);
    const overlayAfter = await readOverlayState(env.page);
    assert.deepEqual(overlayAfter, baseline.overlayBefore, "quota attack changed durable overlay state");
    return {
      observed: await env.page.evaluate(() => window.__e3t12dFault.seen()),
      failure,
      decision,
      live,
      overlayPreserved: true,
    };
  } finally {
    await closeContext(env);
  }
}

async function twoTabRace(allErrors) {
  const env = await openContext({ label: "two-tab-writer", allErrors });
  try {
    await loadShell(env.page, "noAutoBoot=1&persist=1&worker=0");
    await bootFlavor(env.page);
    await pause(env.page);
    const before = await readOverlayState(env.page);
    const second = await env.context.newPage();
    await diagnostics(env.context, second, "two-tab-contender", allErrors);
    await loadShell(second, "noAutoBoot=1&persist=1&worker=0");
    await startBootWithoutWaiting(second);
    const writerState = await second.evaluate(async () => ({
      readOnly: await window.__linuxCtl.readOnly(),
      persistResult: await window.__persist(),
      persistStats: await window.__persistStats(),
    }));
    assert.equal(writerState.readOnly, true, "second tab acquired the writer lock");
    assert.equal(writerState.persistResult, 0);
    await second.close();
    const after = await readOverlayState(env.page);
    assert.deepEqual(after, before, "read-only contender changed the overlay");
    const firstState = await env.page.evaluate(async () => ({
      readOnly: await window.__linuxCtl.readOnly(),
      decision: await window.__snapshotDecision(),
    }));
    assert.equal(firstState.readOnly, false);
    await env.page.close();
    const takeover = await env.context.newPage();
    await diagnostics(env.context, takeover, "two-tab-takeover", allErrors);
    await loadShell(takeover, "noAutoBoot=1&persist=1&worker=0");
    await startBootWithoutWaiting(takeover);
    assert.equal(await takeover.evaluate(() => window.__linuxCtl.readOnly()), false);
    await takeover.close();
    return { first: firstState, contender: writerState, overlayPreserved: true, takeoverWriter: true };
  } finally {
    await closeContext(env);
  }
}

async function postReloadGuestFile(allErrors) {
  const env = await openContext({ label: "post-reload-file", allErrors });
  try {
    await loadShell(env.page, "guest=node-alpine&noAutoBoot=1&persist=1");
    await bootFlavor(env.page, "node-alpine");
    await pause(env.page);
    assert.equal(await saveSnapshot(env.page), true);
    assert.equal(await env.page.evaluate(() => window.__snapshotDecision()), "resume");
    await env.page.evaluate(() => window.__linux.resume());
    const write = await env.page.evaluate(() => window.wvmDemo.run(
      "printf T12D_RELOAD_FILE > /root/t12d-reload-file && sync",
      120_000,
    ));
    assert.equal(write.exit, 0);
    await pause(env.page);
    await env.page.evaluate(() => window.__persist());
    const generation = await env.page.evaluate(() => window.__snapshotGeneration());
    assert.ok(generation > 0);
    await env.page.reload({ waitUntil: "domcontentloaded", timeout: 120_000 });
    await env.page.waitForFunction(() => window.__ready === true && !!window.wvmDemo, null, { timeout: 120_000 });
    const started = Date.now();
    await bootFlavor(env.page, "node-alpine", { waitReady: false });
    await env.page.waitForFunction(() => window.wvmDemo?.isGuestReady?.(), null, { timeout: fileReloadTimeout });
    const coldBootMs = Date.now() - started;
    const decision = await env.page.evaluate(() => window.__snapshotDecision());
    const read = await env.page.evaluate(() => window.wvmDemo.run("cat /root/t12d-reload-file", 120_000));
    assert.equal(read.exit, 0);
    assert.match(read.stdout, /T12D_RELOAD_FILE/);
    return { generation, coldBootMs, decision, read };
  } finally {
    await closeContext(env);
  }
}

const server = await waitForServer();
await fs.mkdir(evidenceDir, { recursive: true });
const allErrors = [];
const startedAt = Date.now();
let evidence;
try {
  const clean = await cleanWorkerProof(allErrors);
  const memory = await memoryProof(allErrors);
  const kill = {};
  for (const phase of ["clear", "chunk", "meta"]) kill[phase] = await killScenario(phase, allErrors);
  const quota = await quotaScenario(allErrors);
  const race = await twoTabRace(allErrors);
  const fileReload = runFileReload ? await postReloadGuestFile(allErrors) : { skipped: true };
  const diagnosticsSummary = allErrors.map((record) => ({
    label: record.label,
    ...realErrors(record),
  }));
  assert.deepEqual(diagnosticsSummary.flatMap((record) => record.consoleErrors), []);
  assert.deepEqual(diagnosticsSummary.flatMap((record) => record.badHttp), []);
  evidence = {
    task: "E3-T12d",
    runtimeHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
    base,
    browser: await (async () => {
      const version = await chromium.launch({ headless: true }).then(async (browser) => {
        const value = browser.version();
        await browser.close();
        return value;
      });
      return version;
    })(),
    elapsedMs: Date.now() - startedAt,
    clean,
    memory,
    interruption: kill,
    quota,
    twoTab: race,
    fileReload,
    diagnostics: diagnosticsSummary,
  };
  await fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await closeServer(server);
}

if (!evidence) process.exitCode = 1;
