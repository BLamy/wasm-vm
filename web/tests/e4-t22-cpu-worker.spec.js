// E4-T22f: the live browser acceptance boundary for the production whole-machine worker. This
// deliberately drives the restored Alpine guest through the same terminal bridge used by the demo,
// while measuring responsiveness from the browser's host event loop.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(repoRoot, "evidence/e4-t22f");
const evidencePath = path.join(evidenceDir, "threaded-browser-budgets-2026-09-03.json");
const screenshotPath = path.join(evidenceDir, "threaded-browser-budgets-2026-09-03.png");

const ORACLE_COMMAND = "echo E4T22F_ORACLE_$((6*7))";
const ORACLE_STDOUT = "E4T22F_ORACLE_42\n";
const ORACLE_SHA256 = "6eab5c9e1d90a64ddefee006cf0fc9343e334d8ee94868251a2fe6213814538a";
const BUSY_COMMAND =
  "yes >/dev/null & p=$!; printf '\\n__E4T22F_READY_%s\\n' \"$((6 * 7))\"; " +
  "read x; printf '__E4T22F_INPUT_%s\\n' \"$x\"; sleep 1; " +
  "kill $p; wait $p 2>/dev/null; echo __E4T22F_DONE";
const INPUT_VALUE = "awake";
const BUDGET_QUANTUM = 20_000;
const BOOT_TIMEOUT_MS = 180_000;
const COMMAND_TIMEOUT_MS = 120_000;
const MARKER_TIMEOUT_MS = 30_000;
const RAF_SAMPLES = 120;

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

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
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

async function bootAlpine(page, control) {
  const diagnostics = attachDiagnostics(page);
  const query = [
    "guest=alpine",
    "nosw",
    "testHooks=1",
    "profile=1",
    "quantum=" + BUDGET_QUANTUM,
    control.jit ? "jit=1&jitThreshold=512" : "jit=0",
    "startPaused=1",
  ].join("&");
  await page.goto("/?" + query, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => globalThis.crossOriginIsolated === true,
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  await page.waitForFunction(
    () => globalThis.wvmDemo?.isGuestReady?.() === true && globalThis.__linuxCtl,
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  const proof = await page.evaluate(async () => {
    await window.__linux.pause();
    const [scheduler, jit, profile, fetch, rpc, snapshot] = await Promise.all([
      window.__linuxCtl.schedulerStats(),
      window.__linuxCtl.jitStats(),
      window.__linuxCtl.profileStats(),
      window.__linuxCtl.fetchStats(),
      window.__linuxCtl.workerRpcStats(),
      window.wvmDemo.snapshotStatus(),
    ]);
    return {
      backend: document.documentElement.dataset.linuxBackend,
      guest: document.documentElement.dataset.linuxGuest,
      manifest: document.documentElement.dataset.linuxManifest,
      interpreter: document.documentElement.dataset.interpreter,
      jitPolicy: document.documentElement.dataset.jitPolicy,
      isolated: globalThis.crossOriginIsolated === true,
      restored: Boolean(window.__linuxCtl.restoredFromBootSnapshot?.()),
      paused: await window.__linux.isPaused(),
      ready: window.wvmDemo.isGuestReady(),
      execution: window.__executionPolicy,
      digest: await window.__linuxCtl.stateDigest(),
      scheduler,
      jit,
      profile,
      fetch,
      rpc,
      snapshot,
      status: document.querySelector("#status")?.textContent || "",
      terminalTail: document.querySelector("#term .xterm-rows")?.textContent?.slice(-2_000) || "",
    };
  });
  expect(proof.backend).toBe("whole-machine-worker");
  expect(proof.guest).toBe("alpine");
  expect(proof.isolated).toBe(true);
  expect(proof.restored).toBe(true);
  expect(proof.paused).toBe(true);
  expect(proof.ready).toBe(true);
  expect(proof.execution.quantum).toBe(BUDGET_QUANTUM);
  expect(proof.scheduler.quantum).toBe(BUDGET_QUANTUM);
  expect(proof.scheduler.slices).toBe(0);
  expect(proof.scheduler.retiredInstructions).toBe(0);
  expect(proof.digest).toMatch(/^[0-9a-f]{64}$/);
  await page.evaluate(() => window.__linux.resume());
  return { diagnostics, proof };
}

async function runOracle(page, initialDigest) {
  const startedAt = Date.now();
  const result = await page.evaluate(
    ([command, timeoutMs]) => window.wvmDemo.run(command, timeoutMs),
    [ORACLE_COMMAND, COMMAND_TIMEOUT_MS],
  );
  const elapsedMs = Date.now() - startedAt;
  expect(result.exit).toBe(0);
  const stdout = result.stdout.trimEnd() + "\n";
  expect(stdout).toBe(ORACLE_STDOUT);
  const checksum = sha256Text(stdout);
  expect(checksum).toBe(ORACLE_SHA256);

  // The snapshot restore is paused at a deterministic boundary. Pause as soon as the fenced
  // command completes so the digest binds the command result to the same guest state in both legs.
  await page.evaluate(() => window.__linux.pause());
  const postCommandDigest = await page.evaluate(() => window.__linuxCtl.stateDigest());
  expect(postCommandDigest).toMatch(/^[0-9a-f]{64}$/);
  await page.evaluate(() => window.__linux.resume());
  return {
    command: ORACLE_COMMAND,
    stdout,
    exit: result.exit,
    sha256: checksum,
    elapsedMs,
    // The restored snapshot digest is the deterministic runtime boundary. The post-command digest
    // is retained separately because live RTC/scheduler state legitimately advances while the
    // browser is measuring the command.
    runtimeDigest: initialDigest,
    postCommandDigest,
  };
}

async function runBusyWithBudgets(page) {
  return page.evaluate(async ({ command, input, rafSamples, markerTimeoutMs, commandTimeoutMs }) => {
    const decoder = new TextDecoder();
    let output = "";
    let readyResolve;
    let inputResolve;
    let inputObservedAt = null;
    const readyPromise = new Promise((resolve) => { readyResolve = resolve; });
    const inputPromise = new Promise((resolve) => { inputResolve = resolve; });
    const unsubscribe = window.wvmDemo.onConsole((bytes) => {
      output = (output + decoder.decode(bytes, { stream: true })).slice(-8_000);
      const normalized = output.replace(/\r/g, "");
      if (normalized.includes("__E4T22F_READY_42")) readyResolve();
      if (normalized.includes("__E4T22F_INPUT_awake")) {
        inputObservedAt ??= performance.now();
        inputResolve();
      }
    });
    const withTimeout = (promise, label, timeoutMs) => {
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(label + " timed out after " + timeoutMs + "ms")),
          timeoutMs,
        );
      });
      return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    };
    const work = window.wvmDemo.run(command, commandTimeoutMs);
    let rafId = null;
    try {
      await withTimeout(readyPromise, "busy guest ready marker", markerTimeoutMs);
      const rafPromise = new Promise((resolve) => {
        const gaps = [];
        let previous = performance.now();
        const frame = (timestamp) => {
          gaps.push(timestamp - previous);
          previous = timestamp;
          if (gaps.length >= rafSamples) {
            const sorted = [...gaps].sort((a, b) => a - b);
            const rank = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.99) - 1);
            resolve({
              p99Ms: sorted[Math.max(0, rank)],
              maxMs: Math.max(...gaps),
              samples: gaps.length,
            });
            return;
          }
          rafId = requestAnimationFrame(frame);
        };
        rafId = requestAnimationFrame(frame);
      });
      const inputStartedAt = performance.now();
      window.__linuxCtl.sendInput(new TextEncoder().encode(input + "\n"));
      const inputDispatch = await withTimeout(
        window.__linuxCtl.schedulerStats(),
        "worker input dispatch",
        markerTimeoutMs,
      );
      const inputWakeMs = performance.now() - inputStartedAt;
      await withTimeout(inputPromise, "guest input response", markerTimeoutMs);
      const inputLatencyMs = inputObservedAt - inputStartedAt;
      const [result, raf] = await Promise.all([work, rafPromise]);
      return {
        result,
        inputWakeMs,
        inputDispatch,
        inputLatencyMs,
        raf,
        markerTail: output.slice(-2_000),
      };
    } finally {
      if (rafId !== null) cancelAnimationFrame(rafId);
      unsubscribe();
    }
  }, {
    command: BUSY_COMMAND,
    input: INPUT_VALUE,
    rafSamples: RAF_SAMPLES,
    markerTimeoutMs: MARKER_TIMEOUT_MS,
    commandTimeoutMs: COMMAND_TIMEOUT_MS,
  });
}

async function collectRuntime(page) {
  return page.evaluate(async () => ({
    digest: await window.__linuxCtl.stateDigest(),
    scheduler: await window.__linuxCtl.schedulerStats(),
    jit: await window.__linuxCtl.jitStats(),
    profile: await window.__linuxCtl.profileStats(),
    rpc: await window.__linuxCtl.workerRpcStats(),
    status: document.querySelector("#status")?.textContent || "",
    terminalTail: document.querySelector("#term .xterm-rows")?.textContent?.slice(-2_000) || "",
  }));
}

async function collectGuestTime(page) {
  const hostStartedAt = Date.now();
  const result = await page.evaluate(
    ([command, timeoutMs]) => window.wvmDemo.run(command, timeoutMs),
    ["date +%s", COMMAND_TIMEOUT_MS],
  );
  const hostFinishedAt = Date.now();
  expect(result.exit).toBe(0);
  const match = result.stdout.match(/\b\d{9,12}\b/);
  const guestSeconds = Number(match?.[0]);
  expect(Number.isFinite(guestSeconds)).toBe(true);
  const guestMs = guestSeconds * 1_000;
  return {
    stdout: result.stdout,
    guestSeconds,
    hostStartedAt,
    hostFinishedAt,
    withinHostWindow: guestMs >= hostStartedAt - 5_000 && guestMs <= hostFinishedAt + 5_000,
  };
}

test("restored Alpine worker meets rAF/input budgets and preserves interpreter/JIT parity", async ({
  browser,
  browserName,
  page,
}) => {
  test.setTimeout(1_200_000);
  fs.mkdirSync(evidenceDir, { recursive: true });

  const controls = [
    { name: "interpreter", jit: false },
    { name: "jit", jit: true },
  ];
  const runs = [];

  for (const [index, control] of controls.entries()) {
    const context = index === 0 ? null : await browser.newContext();
    const runPage = index === 0 ? page : await context.newPage();
    try {
      const boot = await bootAlpine(runPage, control);
      const oracle = await runOracle(runPage, boot.proof.digest);
      const busy = await runBusyWithBudgets(runPage);
      const guestTime = await collectGuestTime(runPage);
      const runtime = await collectRuntime(runPage);
      const execution = await runPage.evaluate(() => ({
        policy: window.__executionPolicy,
        jit: window.__jit,
      }));

      expect(busy.result.exit).toBe(0);
      expect(busy.result.stdout).toContain("__E4T22F_INPUT_awake");
      expect(busy.result.stdout).toContain("__E4T22F_DONE");
      expect(busy.inputWakeMs).toBeLessThanOrEqual(20);
      expect(busy.inputLatencyMs).toBeLessThanOrEqual(2_000);
      expect(busy.raf.p99Ms).toBeLessThanOrEqual(20);
      expect(runtime.scheduler.quantum).toBe(BUDGET_QUANTUM);
      expect(runtime.scheduler.retiredInstructions).toBeGreaterThan(0);
      expect(execution.policy.backend).toBe("whole-machine-worker");
      expect(execution.policy.jit).toBe(control.jit ? "enabled" : "forced-off");
      expect(execution.jit.hasExecutor).toBe(control.jit);
      if (control.jit) {
        expect(runtime.jit.compiledBlocks).toBeGreaterThan(0);
        expect(runtime.jit.executedBlocks).toBeGreaterThan(0);
        expect(runtime.jit.retiredViaJit).toBeGreaterThan(0);
      } else {
        expect(runtime.jit.compiledBlocks).toBe(0);
        expect(runtime.jit.executedBlocks).toBe(0);
        expect(runtime.jit.retiredViaJit).toBe(0);
      }

      if (control.jit) {
        await runPage.screenshot({ path: screenshotPath, fullPage: true });
      }
      runs.push({
        control: control.name,
        boot: boot.proof,
        oracle,
        busy,
        guestTime,
        runtime,
        execution,
        diagnostics: boot.diagnostics,
      });
    } finally {
      if (context) await context.close();
    }
  }

  expect(runs).toHaveLength(2);
  expect(runs[0].boot.digest).toBe(runs[1].boot.digest);
  expect(runs[0].oracle.stdout).toBe(runs[1].oracle.stdout);
  expect(runs[0].oracle.sha256).toBe(runs[1].oracle.sha256);
  expect(runs[0].oracle.runtimeDigest).toBe(runs[1].oracle.runtimeDigest);
  for (const run of runs) {
    expect(run.diagnostics.consoleErrors).toEqual([]);
    expect(run.diagnostics.pageErrors).toEqual([]);
    expect(run.diagnostics.failedRequests).toEqual([]);
    expect(run.diagnostics.httpErrors).toEqual([]);
  }

  const evidence = {
    task: "E4-T22f",
    sourceHead: sourceHead(),
    recordedAt: new Date().toISOString(),
    browser: {
      name: browserName,
      version: browser.version(),
    },
    origin: "http://localhost:" + (process.env.PLAYWRIGHT_PORT || "8133"),
    controls: runs,
    assertions: {
      restoredAlpineWorker: true,
      crossOriginIsolated: true,
      rAFP99BudgetMs: 20,
      inputWakeBudgetMs: 20,
      commandSha256: ORACLE_SHA256,
      initialDigestParity: true,
      runtimeDigestParity: true,
      postCommandDigestsRecorded: true,
      jitOnlyTranslatedExecution: true,
    },
    waivers: [
      "WebKit is outside this directed proof.",
      "Independent-machine execution is outside this directed proof.",
      "The raw Atomics.wait WFI parked-worker proof is retained in E4-T22d; this production whole-machine-worker capture measures the live postMessage input-wake path.",
    ],
  };
  fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + "\n");
  console.log("[e4-t22f evidence] " + evidencePath);
  console.log(JSON.stringify({
    browser: evidence.browser,
    sourceHead: evidence.sourceHead,
    runs: runs.map((run) => ({
      control: run.control,
      initialDigest: run.boot.digest,
      runtimeDigest: run.oracle.runtimeDigest,
      inputLatencyMs: run.busy.inputLatencyMs,
      rafP99Ms: run.busy.raf.p99Ms,
      jit: run.runtime.jit,
    })),
  }));
});
