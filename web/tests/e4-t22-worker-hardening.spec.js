// E4-T22g: adversarial browser coverage for the whole-machine worker boundary. The test exercises
// the user-visible terminal path, lifecycle transitions, worker failure cleanup, and the explicit
// main-thread fallback on this machine's Chromium project.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repoRoot, "evidence/e4-t22g");
const evidencePath = path.join(evidenceDir, "worker-hardening-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "worker-hardening-2026-09-03.png");
const STRESS_PAYLOAD = "0123456789".repeat(1_000);
const STRESS_HASH = createHash("sha256").update(STRESS_PAYLOAD, "utf8").digest("hex");
const STRESS_COMMAND =
  "stty -icanon -echo min 1 time 0; printf '\\n__E4T22G_READY_%s\\n' \"$((6*7))\"; " +
  "hash=$(dd bs=1 count=10000 2>/dev/null | sha256sum | cut -d' ' -f1); " +
  "stty sane; printf '__E4T22G_RESULT_%s\\n' \"$hash\"";
const CHUNK_BYTES = 100;
const CHUNK_INTERVAL_MS = 10;
const COMMAND_TIMEOUT_MS = 120_000;
const MARKER_TIMEOUT_MS = 30_000;

function sourceHead() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function fileIdentity(relativePath, parseJson = false) {
  const absolutePath = path.join(repoRoot, relativePath);
  const raw = fs.readFileSync(absolutePath);
  const identity = {
    path: relativePath,
    bytes: raw.byteLength,
    sha256: createHash("sha256").update(raw).digest("hex"),
  };
  if (parseJson) {
    const manifest = JSON.parse(raw.toString("utf8"));
    identity.generated = manifest.generated;
    identity.artifacts = manifest.artifacts;
  }
  return identity;
}

function attachDiagnostics(page) {
  const diagnostics = {
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
  };
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().toLowerCase().includes("favicon")) {
      diagnostics.consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("requestfailed", (request) => {
    if (!request.url().toLowerCase().includes("favicon")) {
      diagnostics.failedRequests.push(
        request.method() + " " + request.url() + ": " + (request.failure()?.errorText || "failed"),
      );
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().toLowerCase().includes("favicon")) {
      diagnostics.httpErrors.push(response.status() + " " + response.url());
    }
  });
  return diagnostics;
}

async function waitForReady(page, url = "/?guest=busybox&nosw&testHooks=1&startPaused=1&jit=0&quantum=20000") {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => globalThis.crossOriginIsolated === true,
    null,
    { timeout: 180_000 },
  );
  await page.waitForFunction(
    () => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl,
    null,
    { timeout: 180_000 },
  );
  const boundary = await page.evaluate(async () => ({
    digest: await window.__linuxCtl.stateDigest(),
    scheduler: await window.__linuxCtl.schedulerStats(),
  }));
  await page.evaluate(() => window.__linux.resume());
  return boundary;
}

async function runInputStress(page) {
  return page.evaluate(async ({ command, payload, expectedHash, chunkBytes, chunkIntervalMs, timeoutMs }) => {
    const decoder = new TextDecoder();
    let output = "";
    let readyResolve;
    let resultResolve;
    const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
    const resultPromise = new Promise((resolve) => { resultResolve = resolve; });
    const expectedMarker = "__E4T22G_RESULT_" + expectedHash;
    const unsubscribe = window.wvmDemo.onConsole((bytes) => {
      output = (output + decoder.decode(bytes, { stream: true })).slice(-12_000);
      const normalized = output.replace(/\r/g, "");
      if (normalized.includes("__E4T22G_READY_42")) readyResolve();
      if (normalized.includes(expectedMarker)) resultResolve();
    });
    const withTimeout = (promise, label) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + " timed out")), timeoutMs);
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    };
    const work = window.wvmDemo.run(command, timeoutMs);
    try {
      await withTimeout(readyPromise, "stress ready marker");
      const startedAt = performance.now();
      for (let offset = 0; offset < payload.length; offset += chunkBytes) {
        window.wvmDemo.sendInput(
          new TextEncoder().encode(payload.slice(offset, Math.min(offset + chunkBytes, payload.length))),
        );
        await new Promise((resolve) => setTimeout(resolve, chunkIntervalMs));
      }
      window.wvmDemo.sendInput(new Uint8Array([0x0a]));
      const inputDurationMs = performance.now() - startedAt;
      await withTimeout(resultPromise, "stress result marker; tail=" + output.slice(-2_000));
      const durationMs = performance.now() - startedAt;
      const result = await work;
      return {
        result,
        bytesSent: payload.length,
        chunkBytes,
        chunkIntervalMs,
        inputDurationMs,
        durationMs,
        approximateBytesPerSecond: payload.length / (inputDurationMs / 1_000),
        markerTail: output.slice(-3_000),
      };
    } finally {
      unsubscribe();
    }
  }, {
    command: STRESS_COMMAND,
    payload: STRESS_PAYLOAD,
    expectedHash: STRESS_HASH,
    chunkBytes: CHUNK_BYTES,
    chunkIntervalMs: CHUNK_INTERVAL_MS,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
}

async function runLifecycle(page) {
  const first = await page.evaluate(() => window.wvmDemo.run("echo E4T22G_BEFORE_$((6*7))", 30_000));
  expect(first.exit).toBe(0);
  expect(first.stdout).toContain("E4T22G_BEFORE_42");

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.__linux.isPaused()), { timeout: 10_000 }).toBe(true);
  const paused = await page.evaluate(async () => ({
    scheduler: await window.__linuxCtl.schedulerStats(),
    rpc: await window.__linuxCtl.workerRpcStats(),
  }));
  await page.waitForTimeout(500);
  const stillPaused = await page.evaluate(() => window.__linuxCtl.schedulerStats());
  expect(stillPaused.slices).toBe(paused.scheduler.slices);
  expect(stillPaused.retiredInstructions).toBe(paused.scheduler.retiredInstructions);

  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, value: false });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => page.evaluate(() => window.__linux.isPaused()), { timeout: 10_000 }).toBe(false);
  const resumed = await page.evaluate(() => window.wvmDemo.run("echo E4T22G_AFTER_$((6*7))", 30_000));
  expect(resumed.exit).toBe(0);
  expect(resumed.stdout).toContain("E4T22G_AFTER_42");

  // Reload while a real guest RPC is still in flight. The page's unload must not leave the old
  // worker's promise or overlay as the owner of the next boot.
  await page.evaluate(() => {
    window.__e4t22gReloadInFlight = window.wvmDemo
      .run("sleep 1; echo E4T22G_RELOAD_INFLIGHT", 30_000)
      .catch((error) => ({ error: error.message }));
  });
  await page.waitForTimeout(100);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl, null, {
    timeout: 180_000,
  });
  await page.evaluate(() => window.__linux.resume());
  const reloaded = await page.evaluate(async () => {
    const result = await window.wvmDemo.run("echo E4T22G_RELOAD_$((6*7))", 30_000);
    return {
      result,
      backend: document.documentElement.dataset.linuxBackend,
      restored: window.__linuxCtl.restoredFromBootSnapshot(),
      scheduler: await window.__linuxCtl.schedulerStats(),
      rpc: await window.__linuxCtl.workerRpcStats(),
      persist: await window.__linuxCtl.persistStats(),
    };
  });
  expect(reloaded.result.exit).toBe(0);
  expect(reloaded.result.stdout).toContain("E4T22G_RELOAD_42");
  expect(reloaded.backend).toBe("whole-machine-worker");
  expect(reloaded.restored).toBe(true);
  expect(reloaded.rpc.pending).toBe(0);
  expect(reloaded.persist.pendingBytes).toBe(0);
  return { first, paused, stillPaused, resumed, reloaded };
}

async function runKillAndFallback(page) {
  await page.goto("/?guest=busybox&nosw&testHooks=1&jit=0&startPaused=1", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl, null, {
    timeout: 180_000,
  });
  await page.evaluate(() => window.__linux.resume());
  await page.evaluate(() => {
    const controller = window.__linuxCtl;
    window.__e4t22gKilledController = controller;
    window.__e4t22gKillSettlements = Promise.allSettled([
      controller.stateDigest(),
      controller.whenDone,
    ]);
    window.__linuxWorkerForTest.terminate();
  });
  await expect(page.locator("#status")).toContainText("linux worker fatal", { timeout: 30_000 });
  await expect(page.locator("#status")).toContainText("?worker=0", { timeout: 30_000 });
  const killed = await page.evaluate(async () => ({
    settlements: await window.__e4t22gKillSettlements,
    future: await window.__e4t22gKilledController.resume().then(
      () => "resolved",
      (error) => error.message,
    ),
    guestUp: window.wvmDemo.isGuestUp(),
    workers: window.__e4t22gWorkerEvents,
  }));
  expect(killed.settlements.map((entry) => entry.status)).toEqual(["rejected", "rejected"]);
  expect(killed.future).toContain("heartbeat timed out");
  expect(killed.guestUp).toBe(false);
  expect(killed.workers.terminated).toBeGreaterThanOrEqual(1);

  await page.goto("/?guest=busybox&worker=0&nosw&testHooks=1&jit=0&startPaused=1", {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => window.wvmDemo?.isGuestReady?.() === true && window.__linuxCtl, null, {
    timeout: 180_000,
  });
  const fallback = await page.evaluate(async () => {
    await window.__linux.resume();
    const result = await window.wvmDemo.run("echo E4T22G_FALLBACK_$((6*7))", 30_000);
    return {
      result,
      backend: document.documentElement.dataset.linuxBackend,
      jitPolicy: document.documentElement.dataset.jitPolicy,
      workers: window.__e4t22gWorkerEvents,
      rpc: typeof window.__linuxCtl.workerRpcStats === "function"
        ? await window.__linuxCtl.workerRpcStats()
        : null,
    };
  });
  expect(fallback.result.exit).toBe(0);
  expect(fallback.result.stdout).toContain("E4T22G_FALLBACK_42");
  expect(fallback.backend).toBe("main-thread");
  expect(fallback.jitPolicy).toBe("forced-off");
  expect(fallback.workers.constructed).toBe(0);
  return { killed, fallback };
}

test("worker hardening preserves input ordering and lifecycle cleanup", async ({ browser, browserName, page }) => {
  test.setTimeout(600_000);
  fs.mkdirSync(evidenceDir, { recursive: true });
  await page.addInitScript(() => {
    const NativeWorker = globalThis.Worker;
    globalThis.__e4t22gWorkerEvents = { constructed: 0, terminated: 0 };
    globalThis.Worker = class CountingWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes("linux-worker.js")) globalThis.__e4t22gWorkerEvents.constructed += 1;
      }
      terminate() {
        globalThis.__e4t22gWorkerEvents.terminated += 1;
        return super.terminate();
      }
    };
  });
  const diagnostics = attachDiagnostics(page);

  const bootBoundary = await waitForReady(page);
  const stress = await runInputStress(page);
  expect(stress.result.exit).toBe(0);
  expect(stress.result.stdout).toContain("__E4T22G_RESULT_" + STRESS_HASH);
  expect(stress.result.stdout).toContain("10000");
  expect(stress.bytesSent).toBe(10_000);
  expect(stress.inputDurationMs).toBeGreaterThanOrEqual(900);
  expect(stress.inputDurationMs).toBeLessThan(3_000);
  expect(stress.approximateBytesPerSecond).toBeGreaterThan(8_000);
  expect(stress.approximateBytesPerSecond).toBeLessThan(12_000);
  expect(stress.durationMs).toBeLessThan(MARKER_TIMEOUT_MS);

  const lifecycle = await runLifecycle(page);
  const kill = await runKillAndFallback(page);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  expect(diagnostics.consoleErrors).toEqual([]);
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.failedRequests).toEqual([]);
  expect(diagnostics.httpErrors).toEqual([]);

  const finalState = await page.evaluate(async () => ({
    backend: document.documentElement.dataset.linuxBackend,
    guest: document.documentElement.dataset.linuxGuest,
    digest: await window.__linuxCtl.stateDigest(),
    scheduler: await window.__linuxCtl.schedulerStats(),
    persist: await window.__linuxCtl.persistStats(),
  }));
  const evidence = {
    task: "E4-T22g",
    sourceHead: sourceHead(),
    recordedAt: new Date().toISOString(),
    browser: {
      name: browserName,
      version: browser.version(),
    },
    origin: "http://localhost:" + (process.env.PLAYWRIGHT_PORT || "8133"),
    controls: {
      guest: "busybox",
      worker: "default whole-machine worker",
      jit: 0,
      startPaused: true,
      nosw: true,
      testHooks: true,
      quantum: 20_000,
      stressChunkBytes: CHUNK_BYTES,
      stressChunkIntervalMs: CHUNK_INTERVAL_MS,
    },
    runtimeDigest: bootBoundary.digest,
    firstCommandBoundary: {
      command: STRESS_COMMAND,
      readyMarker: "__E4T22G_READY_42",
      resultMarker: "__E4T22G_RESULT_" + STRESS_HASH,
      runtimeDigest: bootBoundary.digest,
      pausedScheduler: bootBoundary.scheduler,
    },
    stress: {
      expectedBytes: 10_000,
      expectedSha256: STRESS_HASH,
      checksum: STRESS_HASH,
      chunkBytes: CHUNK_BYTES,
      chunkIntervalMs: CHUNK_INTERVAL_MS,
      result: stress,
    },
    lifecycle,
    kill,
    finalState,
    diagnostics,
    assertions: {
      orderedTenKilobyteInput: true,
      backgroundForegroundStable: true,
      reloadLeavesNoPendingRpcOrOverlayWrites: true,
      workerKillRejectsPendingAndFutureCalls: true,
      mainThreadFallbackUsable: true,
    },
    deployArtifactIdentity: {
      servedManifest: fileIdentity("web/artifacts.json", true),
      manifests: [
        fileIdentity("web/dist/artifacts.json", true),
        fileIdentity("web/dist/artifacts-alpine.json", true),
        fileIdentity("web/dist/artifacts-node-alpine.json", true),
      ],
      serviceWorker: fileIdentity("web/dist/sw.js"),
      tasks: fileIdentity("web/dist/tasks.json"),
    },
    waivers: [
      "WebKit is outside this directed proof.",
      "Independent-machine execution is outside this directed proof.",
      "The current whole-machine worker does not use a shared guest-memory control block; E4-T22d covers the raw shared-buffer/WFI proof.",
    ],
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log("[e4-t22g evidence] " + evidencePath);
  console.log(JSON.stringify({
    sourceHead: evidence.sourceHead,
    stress: {
      bytes: stress.bytesSent,
      durationMs: stress.durationMs,
      rate: stress.approximateBytesPerSecond,
    },
    lifecycle: {
      pausedSlices: lifecycle.paused.scheduler.slices,
      reloadedPendingRpc: lifecycle.reloaded.rpc.pending,
      reloadedPendingBytes: lifecycle.reloaded.persist.pendingBytes,
    },
    kill: {
      settlements: kill.killed.settlements.map((entry) => entry.status),
      fallbackBackend: kill.fallback.backend,
    },
  }));
});
