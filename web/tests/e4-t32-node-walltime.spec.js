// E4-T32 foreground benchmark for the user's exact complaint: a fresh real Node process. E4-T32
// proves that moving the whole machine does not regress interpreter throughput while fixing page
// responsiveness; the stricter absolute Node acceleration budget lives in E4-T34.
// It is opt-in because each same-head matrix leg restores a 768 MiB node-Alpine guest and runs four
// real processes. Run with:
//   python3 ../tools/prepare-e4-t32-node-assets.py /tmp/e4t32-node-assets
//   E4T32_NODE_ASSET_DIR=/tmp/e4t32-node-assets \
//     E4T32_NODE_ASSET_BASE=/e4t32-node-assets E4T32_NODE_BENCH=1 \
//     npx playwright test tests/e4-t32-node-walltime.spec.js
// The acceptance run requires a committed, clean tracked tree. Its append-only six-slot ledger is
// safe to resume with the same command and exact identity after an environment-contaminated attempt;
// use a new E4T32_NODE_EVIDENCE_DIR after any candidate, harness, browser, or host identity change.
import { expect, test } from "@playwright/test";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  E4T32_NODE_MAX_ATTEMPTS_PER_SLOT,
  E4T32_NODE_SLOT_PLAN,
  activeNodeBenchmarkAttempt,
  assertNodeBenchmarkComplete,
  beginNodeBenchmarkAttempt,
  createNodeBenchmarkLedger,
  deriveNodeBenchmarkResults,
  nextNodeBenchmarkSlot,
  nodeBenchmarkSequencePrefix,
  nodeBenchmarkLedgerStatus,
  serializeNodeBenchmarkLedger,
} from "./helpers/e4-t32-node-ledger.mjs";
import {
  acquireSingleWriterLock,
  atomicReplaceJson,
} from "./helpers/e4-t32-node-ledger-store.mjs";
import { createNodeAttemptJournal } from "./helpers/e4-t32-node-attempt-journal.mjs";
import {
  classifyNodeSessionFailure,
  isIgnorableFaviconConsoleError,
  markNodeProductFailure,
  serializeNodeFailure,
} from "./helpers/e4-t32-node-failure.mjs";
import { createNodeBenchmarkIdentity } from "./helpers/e4-t32-node-identity.mjs";
import {
  createNodeProcessOracleSpec,
  validateNodeProcessOracleEvidence,
} from "./helpers/e4-t32-node-oracle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const enabled = process.env.E4T32_NODE_BENCH === "1";
const preflightOnly = process.env.E4T32_CPU_PREFLIGHT_ONLY === "1";
const diagnostic = process.env.E4T32_NODE_DIAG === "1";
const diagnosticProgress = process.env.E4T32_NODE_DIAG_PROGRESS === "1";
const nodeAssetDir = (process.env.E4T32_NODE_ASSET_DIR || "").trim();
const nodeAssetBase = (
  process.env.E4T32_NODE_ASSET_BASE || (nodeAssetDir ? "/e4t32-node-assets" : "")
).replace(/\/+$/, "");
const productionAssetBase = "https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev";
const evidenceDir = path.resolve(
  process.env.E4T32_NODE_EVIDENCE_DIR || path.join(repoRoot, "evidence/e4-t32/node-walltime"),
);
const writeEvidence = async (name, value) => {
  const filePath = path.join(evidenceDir, name);
  await atomicReplaceJson(filePath, value);
  return filePath;
};
const attachEvidence = async (testInfo, name, value) => {
  const filePath = await writeEvidence(name, value);
  await testInfo.attach(name.replace(/\.json$/i, ""), {
    path: filePath,
    contentType: "application/json",
  });
  return filePath;
};
const errorEvidence = serializeNodeFailure;

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stableJson = (value) => {
  const normalize = (entry) => {
    if (Array.isArray(entry)) return entry.map(normalize);
    if (entry && typeof entry === "object") {
      return Object.fromEntries(Object.keys(entry).sort().map((key) => [key, normalize(entry[key])]));
    }
    return entry;
  };
  return JSON.stringify(normalize(value));
};
// SHA-256 of the exact immutable chunk manifest paired with the shipped node-Alpine snapshot.
const expectedNodeManifestSha256 = "ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1";
const requiredVariants = diagnostic
  ? ["main-interp", "worker-interp"]
  : ["main-interp", "worker-interp", "worker-jit512"];
const requestedVariants = (process.env.E4T32_NODE_VARIANTS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
// An environment override may add threshold-screening legs, but cannot accidentally remove the
// same-head baseline, the production worker policy, or the opt-in JIT truth/proof leg.
const variants = [...new Set([...requiredVariants, ...requestedVariants])];

const urls = {
  "main-interp": "/?guest=node-alpine&nosw&worker=0&jit=0",
  "worker-interp": "/?guest=node-alpine&nosw&jit=0",
  "worker-jit32": "/?guest=node-alpine&nosw&jit=1&jitThreshold=32",
  "worker-jit64": "/?guest=node-alpine&nosw&jit=1&jitThreshold=64",
  "worker-jit128": "/?guest=node-alpine&nosw&jit=1&jitThreshold=128",
  "worker-jit256": "/?guest=node-alpine&nosw&jit=1&jitThreshold=256",
  "worker-jit512": "/?guest=node-alpine&nosw&jit=1&jitThreshold=512",
};

const variantUrl = (variant) => {
  const url = urls[variant];
  if (!nodeAssetBase) return url;
  return `${url}&assetBase=${encodeURIComponent(nodeAssetBase)}`;
};

async function nodeBenchmarkIdentity(browser, plan) {
  const playwrightPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "web/node_modules/@playwright/test/package.json"), "utf8"),
  );
  const browserType = browser.browserType();
  const cpuModels = [...new Set(os.cpus().map((cpu) => cpu.model))];
  return createNodeBenchmarkIdentity({
    repoRoot,
    evidenceDir,
    nodeAssetDir,
    expectedNodeManifestSha256,
    plan,
    policy: {
      version: "e4-t32-node-ledger-v2",
      maxAttemptsPerSlot: E4T32_NODE_MAX_ATTEMPTS_PER_SLOT,
      processTimeoutMs: 300_000,
      processesPerSession: 2,
      maxWorkerRegressionRatio: 1.10,
      preflight: {
        warmupsPerRealm: 3,
        warmupIterations: 5_000_000,
        pairs: 8,
        timedIterations: 50_000_000,
        realmRatio: [1 / 1.05, 1.05],
        pairRatio: [1 / 1.10, 1.10],
        requiredPairsWithinBudget: 7,
        minimumMedianMs: 100,
      },
      urls: Object.fromEntries(plan.map((slot) => [slot.id, variantUrl(slot.variant)])),
      nodeAssetBase,
      expectedNodeManifestSha256,
      browserMode: "headed-foreground",
    },
    browserMetadata: {
      type: browserType.name(),
      version: browser.version(),
      executablePath: browserType.executablePath(),
      headless: false,
    },
    playwrightMetadata: { version: playwrightPackage.version },
    hostMetadata: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      machine: typeof os.machine === "function" ? os.machine() : null,
      logicalCpus: os.cpus().length,
      cpuModels,
    },
    runtimeMetadata: { nodeVersion: process.version },
  });
}

const nodeLedgerPath = path.join(evidenceDir, "E4T32_NODE_LEDGER_V2.json");
const nodeLedgerLockPath = path.join(evidenceDir, "E4T32_NODE_LEDGER_V2.lock.json");
let activeNodeLedgerLock = null;

test.afterEach(async () => {
  if (!activeNodeLedgerLock) return;
  const lock = activeNodeLedgerLock;
  activeNodeLedgerLock = null;
  await lock.release();
});

const attachAttemptArtifact = async (testInfo, name, filePath) => {
  await testInfo.attach(name.replace(/\.json$/i, ""), {
    path: filePath,
    contentType: "application/json",
  });
};

async function nodeManifestIdentity(page) {
  return page.evaluate(async ({ assetBase, expectedSha256 }) => {
    const base = assetBase || "https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev";
    const url = new URL(`${base.replace(/\/+$/, "")}/chunked-node-alpine/manifest.json`, location.href);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Node chunk manifest fetch failed: HTTP ${response.status} ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const firstChunkSha256 = manifest.chunks?.[0];
    const firstChunkUrl = new URL(`chunks/${firstChunkSha256}.bin`, url);
    const chunkResponse = await fetch(firstChunkUrl, { cache: "no-store" });
    if (!chunkResponse.ok) {
      throw new Error(`Node chunk self-probe failed: HTTP ${chunkResponse.status} ${firstChunkUrl}`);
    }
    const chunkDigest = await crypto.subtle.digest("SHA-256", await chunkResponse.arrayBuffer());
    const firstChunkActualSha256 = [...new Uint8Array(chunkDigest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      url: url.href,
      sha256,
      expectedSha256,
      sameOrigin: url.origin === location.origin,
      version: manifest.version,
      imageLen: manifest.image_len,
      chunkSize: manifest.chunk_size,
      chunkCount: manifest.chunks?.length ?? null,
      uniqueChunkCount: new Set(manifest.chunks ?? []).size,
      firstChunkSha256,
      firstChunkActualSha256,
    };
  }, { assetBase: nodeAssetBase || productionAssetBase, expectedSha256: expectedNodeManifestSha256 });
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const hostCpuSnapshot = () => os.cpus().map((cpu) => ({ ...cpu.times }));
const hostCpuDelta = (before, after) => {
  const perCoreBusyPct = before.map((start, index) => {
    const end = after[index];
    if (!end) return 0;
    const total = Object.keys(start).reduce(
      (sum, key) => sum + Math.max(0, Number(end[key]) - Number(start[key])),
      0,
    );
    const idle = Math.max(0, Number(end.idle) - Number(start.idle));
    return total > 0 ? ((total - idle) / total) * 100 : 0;
  });
  return {
    logicalCpus: perCoreBusyPct.length,
    meanBusyPct: perCoreBusyPct.length
      ? perCoreBusyPct.reduce((sum, value) => sum + value, 0) / perCoreBusyPct.length
      : 0,
    maxBusyPct: Math.max(0, ...perCoreBusyPct),
    perCoreBusyPct,
  };
};

async function cpuRealmPreflight(browser, label, testInfo = null) {
  const cpuBefore = hostCpuSnapshot();
  const page = await browser.newPage();
  let result;
  try {
    await page.goto("about:blank");
    result = await page.evaluate(async () => {
      const kernel = (iterations) => {
        let a = 305419896 | 0;
        let b = -1698898192 | 0;
        for (let i = 0; i < iterations; i += 1) {
          a = (Math.imul(a ^ (i | 0), 1664525) + 1013904223) | 0;
          b = (Math.imul(b + (i | 0), 1103515245) + 12345) | 0;
        }
        return (a ^ b) >>> 0;
      };
      const kernelSource = kernel.toString();
      const workerUrl = URL.createObjectURL(new Blob([
        `const kernel=${kernelSource};onmessage=({data})=>{const started=performance.now();` +
        `const checksum=kernel(data.iterations);postMessage({id:data.id,elapsedMs:performance.now()-started,checksum});};`,
      ], { type: "text/javascript" }));
      const worker = new Worker(workerUrl);
      let sequence = 0;
      const pending = new Map();
      worker.onmessage = ({ data }) => {
        const resolve = pending.get(data.id);
        pending.delete(data.id);
        resolve?.(data);
      };
      const runWorker = (iterations) => new Promise((resolve) => {
        const id = ++sequence;
        pending.set(id, resolve);
        worker.postMessage({ id, iterations });
      });
      const runMain = (iterations) => {
        const started = performance.now();
        const checksum = kernel(iterations);
        return { elapsedMs: performance.now() - started, checksum };
      };
      const warmupsPerRealm = 3;
      const warmupIterations = 5_000_000;
      const pairs = 8;
      const timedIterations = 50_000_000;
      const warmupChecksums = [];
      try {
        for (let i = 0; i < warmupsPerRealm; i += 1) warmupChecksums.push(runMain(warmupIterations).checksum);
        for (let i = 0; i < warmupsPerRealm; i += 1) warmupChecksums.push((await runWorker(warmupIterations)).checksum);
        const samples = [];
        for (let pair = 0; pair < pairs; pair += 1) {
          const order = pair % 2 === 0 ? ["main", "worker"] : ["worker", "main"];
          const measured = {};
          for (const realm of order) {
            measured[realm] = realm === "main"
              ? runMain(timedIterations)
              : await runWorker(timedIterations);
          }
          samples.push({
            pair,
            order,
            samples: measured,
            ratio: measured.worker.elapsedMs / measured.main.elapsedMs,
          });
        }
        const localMedian = (values) => {
          const sorted = [...values].sort((a, b) => a - b);
          const middle = Math.floor(sorted.length / 2);
          return sorted.length % 2
            ? sorted[middle]
            : (sorted[middle - 1] + sorted[middle]) / 2;
        };
        const mainMedianMs = localMedian(samples.map((sample) => sample.samples.main.elapsedMs));
        const workerMedianMs = localMedian(samples.map((sample) => sample.samples.worker.elapsedMs));
        const timedChecksums = samples.flatMap((sample) => [
          sample.samples.main.checksum,
          sample.samples.worker.checksum,
        ]);
        return {
          kernelSource,
          warmupsPerRealm,
          warmupIterations,
          pairs,
          timedIterations,
          mainMedianMs,
          workerMedianMs,
          realmMedianRatio: workerMedianMs / mainMedianMs,
          pairedRatioMedian: localMedian(samples.map((sample) => sample.ratio)),
          // Warmup and timed kernels use different iteration counts, so compare parity within each
          // population. Combining them would reject every valid run even when both realms agree.
          checksumsMatch: new Set(warmupChecksums).size === 1 && new Set(timedChecksums).size === 1,
          samples,
        };
      } finally {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      }
    });
  } finally {
    await page.close();
  }
  const lowerRealmRatio = 1 / 1.05;
  const upperRealmRatio = 1.05;
  const lowerPairRatio = 1 / 1.10;
  const upperPairRatio = 1.10;
  const pairsWithinBudget = result.samples.filter(
    (sample) => sample.ratio >= lowerPairRatio && sample.ratio <= upperPairRatio,
  ).length;
  const pass = result.checksumsMatch &&
    result.mainMedianMs >= 100 && result.workerMedianMs >= 100 &&
    result.realmMedianRatio >= lowerRealmRatio && result.realmMedianRatio <= upperRealmRatio &&
    result.pairedRatioMedian >= lowerRealmRatio && result.pairedRatioMedian <= upperRealmRatio &&
    pairsWithinBudget >= 7;
  const evidence = {
    kind: "e4-t32-window-worker-cpu-preflight",
    label,
    timestamp: new Date().toISOString(),
    rule: {
      lowerRealmRatio,
      upperRealmRatio,
      lowerPairRatio,
      upperPairRatio,
      requiredPairsWithinBudget: 7,
      pairsWithinBudget,
      pass,
    },
    hostCpu: hostCpuDelta(cpuBefore, hostCpuSnapshot()),
    result,
  };
  const evidenceName = `E4T32_CPU_PREFLIGHT_${label.replace(/[^a-z0-9_-]+/gi, "_")}.json`;
  const evidencePath = await writeEvidence(evidenceName, evidence);
  if (testInfo) {
    await testInfo.attach(evidenceName.replace(/\.json$/i, ""), {
      path: evidencePath,
      contentType: "application/json",
    });
  }
  console.log("E4T32_CPU_PREFLIGHT=" + JSON.stringify(evidence));
  if (!pass) {
    const error = new Error(
      `E4T32_ENV_CONTAMINATED ${label}: realm=${result.realmMedianRatio.toFixed(4)} ` +
      `paired=${result.pairedRatioMedian.toFixed(4)} pairs=${pairsWithinBudget}/${result.pairs}`,
    );
    error.code = "E4T32_ENV_CONTAMINATED";
    error.evidence = evidence;
    throw error;
  }
  return evidence;
}

const jitDelta = (before, after) => ({
  compiledBlocks: after.compiledBlocks - before.compiledBlocks,
  executedBlocks: after.executedBlocks - before.executedBlocks,
  retiredViaJit: after.retiredViaJit - before.retiredViaJit,
});

const commandWindow = ({ schedulerBefore, schedulerAfter, fetchBefore, fetchAfter, rpcBefore, rpcAfter }) => {
  const delta = (key) => Number(schedulerAfter?.[key] ?? 0) - Number(schedulerBefore?.[key] ?? 0);
  const slices = delta("slices");
  return {
    slices,
    totalSliceMs: delta("totalSliceMs"),
    averageSliceMs: slices ? delta("totalSliceMs") / slices : 0,
    retiredInstructions: delta("retiredInstructions"),
    requestedInstructions: delta("requestedInstructions"),
    mainThreadYields: delta("mainThreadYields"),
    schedulerYields: delta("schedulerYields"),
    fetchWaits: delta("fetchWaits"),
    fetchRequestedChunks: delta("fetchRequestedChunks"),
    fetchWaitTotalMs: delta("fetchWaitTotalMs"),
    outputCalls: delta("outputCalls"),
    outputBytes: delta("outputBytes"),
    sliceHistogram: (schedulerAfter?.sliceHistogram ?? []).map((bucket, index) => ({
      leMs: bucket.leMs,
      count: bucket.count - Number(schedulerBefore?.sliceHistogram?.[index]?.count ?? 0),
    })),
    fetchedChunks: Number(fetchAfter?.fetches ?? 0) - Number(fetchBefore?.fetches ?? 0),
    fetchedBytes: Number(fetchAfter?.bytes ?? 0) - Number(fetchBefore?.bytes ?? 0),
    rpcCalls: rpcBefore && rpcAfter ? rpcAfter.calls - rpcBefore.calls : 0,
    rpcCompleted: rpcBefore && rpcAfter ? rpcAfter.completed - rpcBefore.completed : 0,
  };
};

async function runNodeProcess(page, sequence, { timeoutMs = 300_000, progressIntervalMs = 0 } = {}) {
  const oracleSpec = createNodeProcessOracleSpec(sequence);
  try {
    return await page.evaluate(async ({ oracleSpec, timeoutMs, progressIntervalMs }) => {
    // The exact Node argv/code remains byte-identical to the user's report. The shell runs that
    // child in the background only so `$!` captures the PID that execs Node, waits for it, then
    // emits a concrete sequence/PID/exit marker that cannot occur in the echoed command source.
    const outputPattern = new RegExp(oracleSpec.outputPatternSource);
    const completionPattern = new RegExp(oracleSpec.completionPatternSource);
    const decoder = new TextDecoder();
    let text = "";
    let firstMs = null;
    let completeMs = null;
    let exit = null;
    const progress = [];
    const started = performance.now();
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let timer;
      let progressTimer = null;
      unsubscribe = window.wvmDemo.onConsole((bytes) => {
        text = (text + decoder.decode(bytes, { stream: true })
          .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
          .replace(/\r/g, "")).slice(-4096);
        // The echoed source contains `console.log(3)`, never a standalone output line containing 3.
        const outputMatch = text.match(outputPattern);
        if (firstMs == null && outputMatch) firstMs = performance.now() - started;
        const match = text.match(completionPattern);
        if (match && completeMs == null && outputMatch?.index < match.index) {
          const nodePid = Number(match[2]);
          const markerExit = Number(match[3]);
          if (!outputMatch || !Number.isSafeInteger(nodePid) || nodePid <= 0 ||
              !Number.isSafeInteger(markerExit) || markerExit < 0 || markerExit > 255) {
            return;
          }
          const outputLine = outputMatch[1];
          const completionMarker = match[1];
          const oracleTranscript = `${outputLine}\n${completionMarker}\n`;
          if (oracleTranscript.length > oracleSpec.maxTranscriptChars ||
              oracleSpec.shellCommand.includes(completionMarker)) {
            unsubscribe();
            clearTimeout(timer);
            if (progressTimer != null) clearInterval(progressTimer);
            reject(new Error(`E4T32_NODE_ORACLE_INVALID ${oracleSpec.sequence}`));
            return;
          }
          completeMs = performance.now() - started;
          exit = markerExit;
          const result = {
            firstMs,
            completeMs,
            stretchMs: firstMs == null ? null : completeMs - firstMs,
            exit,
            sawExpected: firstMs != null,
            nodeSequence: oracleSpec.sequence,
            nodeCommand: oracleSpec.nodeCommand,
            nodePid,
            outputLine,
            completionMarker,
            oracleTranscript,
            progress,
          };
          unsubscribe();
          clearTimeout(timer);
          if (progressTimer != null) clearInterval(progressTimer);
          resolve(result);
          return;
        }
      });
      timer = setTimeout(() => {
        unsubscribe();
        if (progressTimer != null) clearInterval(progressTimer);
        reject(new Error(
          `E4T32_NODE_PROCESS_TIMEOUT ${oracleSpec.sequence}; tail=${text.slice(-500)}`,
        ));
      }, timeoutMs);
      if (progressIntervalMs > 0) {
        const sampleProgress = async () => {
          try {
            // Main-thread methods are direct synchronous calls. Worker methods are explicit coarse
            // RPCs used only by E4T32_NODE_DIAG, never by the timed acceptance matrix.
            const [scheduler, fetch, jit] = await Promise.all([
              window.__linuxCtl.schedulerStats(),
              window.__linuxCtl.fetchStats(),
              window.__linuxCtl.jitStats(),
            ]);
            const sample = { elapsedMs: performance.now() - started, scheduler, fetch, jit };
            progress.push(sample);
            console.log("E4T32_NODE_PROGRESS=" + JSON.stringify({
              sequence: oracleSpec.sequence,
              ...sample,
            }));
          } catch (error) {
            console.log("E4T32_NODE_PROGRESS_ERROR=" + JSON.stringify({
              sequence: oracleSpec.sequence,
              elapsedMs: performance.now() - started,
              error: error?.message || String(error),
            }));
          }
        };
        progressTimer = setInterval(() => void sampleProgress(), progressIntervalMs);
      }
      window.wvmDemo.sendInput(new TextEncoder().encode(oracleSpec.shellCommand + "\r"));
    });
    }, { oracleSpec, timeoutMs, progressIntervalMs });
  } catch (error) {
    if (error?.message?.includes("E4T32_NODE_PROCESS_TIMEOUT")) {
      throw markNodeProductFailure("fresh-node-process", error);
    }
    throw error;
  }
}

async function runNodeResponsivenessProbe(page, sequence) {
  try {
    return await page.evaluate(async ({ sequence }) => {
    const probeValue = `PROBE_${sequence}`;
    // This is deliberately outside the timed sample. Node itself emits its concrete PID only after
    // startup; only then do we send terminal input and a cheap RPC while that child remains alive.
    const command =
      `node -e 'console.log("__NODE_LOAD_"+process.pid);const end=Date.now()+5000;while(Date.now()<end){}' & np=$!; ` +
      `read probe; printf '\\n__NODE_INPUT_%s\\n' "$probe"; wait "$np"; rc=$?; ` +
      `printf '\\n__NODE_PROBE_DONE_%s_%s\\n' "$$" "$rc"`;
    if (/[\r\n]/.test(command)) throw new Error("Node responsiveness command contains an embedded line terminator");
    const decoder = new TextDecoder();
    let text = "";
    let armedAt = null;
    let inputMs = null;
    let rpcMs = null;
    let rpcError = null;
    let exit = null;
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let timer;
      const maybeResolve = () => {
        if (exit == null || inputMs == null || rpcMs == null) return;
        unsubscribe();
        clearTimeout(timer);
        resolve({ inputMs, rpcMs, rpcError, exit });
      };
      unsubscribe = window.wvmDemo.onConsole((bytes) => {
        text += decoder.decode(bytes, { stream: true })
          .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
          .replace(/\r/g, "");
        if (armedAt == null && /__NODE_LOAD_[0-9]+\n/.test(text)) {
          armedAt = performance.now();
          window.__linuxCtl.schedulerStats().then(
            () => {
              rpcMs = performance.now() - armedAt;
              maybeResolve();
            },
            (error) => {
              rpcError = error?.message || String(error);
              rpcMs = performance.now() - armedAt;
              maybeResolve();
            },
          );
          window.wvmDemo.sendInput(new TextEncoder().encode(probeValue + "\r"));
        }
        if (armedAt != null && inputMs == null && text.includes(`__NODE_INPUT_${probeValue}\n`)) {
          inputMs = performance.now() - armedAt;
          maybeResolve();
        }
        const match = text.match(/__NODE_PROBE_DONE_[0-9]+_([0-9]+)\n/);
        if (match && exit == null) {
          exit = Number(match[1]);
          maybeResolve();
        }
      });
      timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`E4T32_NODE_RESPONSIVENESS_TIMEOUT ${sequence}; tail=${text.slice(-500)}`));
      }, 180_000);
      window.wvmDemo.sendInput(new TextEncoder().encode(command + "\r"));
    });
    }, { sequence });
  } catch (error) {
    if (error?.message?.includes("E4T32_NODE_RESPONSIVENESS_TIMEOUT")) {
      throw markNodeProductFailure("node-responsiveness", error);
    }
    throw error;
  }
}

async function runNodeVariantSession(browser, {
  variant,
  passIndex,
  sequencePrefix,
  processCount = 2,
  progressIntervalMs = 0,
}) {
  let page = null;
  let session = null;
  let sessionError = null;
  const errors = [];
  const productionR2Requests = [];
  try {
    page = await browser.newPage();
    page.on("console", (message) => {
      const entry = {
        type: message.type(),
        text: message.text(),
        url: message.location().url,
      };
      if (entry.type === "error" && !isIgnorableFaviconConsoleError(entry)) errors.push(entry.text);
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).hostname.endsWith("r2.dev")) {
        productionR2Requests.push(request.url());
      }
    });
    await page.goto(variantUrl(variant));
    try {
      await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
    } catch (error) {
      if (error?.name === "TimeoutError") throw markNodeProductFailure("guest-ready", error);
      throw error;
    }
    try {
      await page.waitForFunction(() => window.__linuxCtl, null, { timeout: 30_000 });
    } catch (error) {
      if (error?.name === "TimeoutError") throw markNodeProductFailure("controller-ready", error);
      throw error;
    }
    await page.bringToFront();
    const browserPresentation = await page.evaluate(() => ({
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      userAgent: navigator.userAgent,
    }));
    expect(browserPresentation.visibilityState).toBe("visible");
    expect(browserPresentation.hasFocus, "timed browser page must hold document focus").toBe(true);
    expect(browserPresentation.userAgent, "timed acceptance cannot run in HeadlessChrome")
      .not.toContain("HeadlessChrome");
    const restored = await page.evaluate(() => window.__linux?.restoredFromBootSnapshot?.());
    expect(restored, `${variant} pass ${passIndex} must use the shipped Node snapshot`).toBe(true);
    const bootIdentity = await page.evaluate(async () => {
      const manifest = await fetch("./artifacts-node-alpine.json").then((response) => response.json());
      return {
        kernelSha256: manifest.artifacts?.kernel?.sha256 ?? null,
        bootSnapshotSha256: manifest.artifacts?.bootSnapshot?.sha256 ?? null,
        overlayDeltaSha256: manifest.artifacts?.overlayDelta?.sha256 ?? null,
      };
    });
    expect(bootIdentity.kernelSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bootIdentity.bootSnapshotSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(bootIdentity.overlayDeltaSha256).toMatch(/^[0-9a-f]{64}$/);
    const liveNodeManifest = await nodeManifestIdentity(page);
    expect(liveNodeManifest.sha256, `${variant} must use the snapshot-paired Node base`)
      .toBe(expectedNodeManifestSha256);
    expect(liveNodeManifest.version).toBe(1);
    expect(liveNodeManifest.imageLen).toBe(805_306_368);
    expect(liveNodeManifest.chunkSize).toBe(131_072);
    expect(liveNodeManifest.chunkCount).toBe(6_144);
    expect(liveNodeManifest.firstChunkActualSha256).toBe(liveNodeManifest.firstChunkSha256);
    if (nodeAssetBase) {
      expect(liveNodeManifest.sameOrigin, "CPU parity assets must be local/same-origin").toBe(true);
      expect(productionR2Requests, "local CPU parity must make zero production-R2 requests").toEqual([]);
    }
    const initialFetch = await page.evaluate(() => window.__chunkedStats());
    expect(initialFetch.prefetch.profileEntries, `${variant} must not use the plain-Alpine profile`)
      .toBe(0);
    await page.evaluate(() => {
      const sample = { active: true, gaps: [] };
      window.__e4t32Raf = sample;
      let previous = performance.now();
      const frame = (now) => {
        sample.gaps.push(now - previous);
        previous = now;
        if (sample.active) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });

    const jitBefore = await page.evaluate(() => window.__jitStats());
    const runs = [];
    for (let index = 0; index < processCount; index += 1) {
      const sequence = `${sequencePrefix}_${index}`;
      const schedulerBefore = await page.evaluate(() => window.__schedulerStats());
      const fetchBefore = await page.evaluate(() => window.__chunkedStats());
      const rpcBefore = await page.evaluate(() => window.__workerRpcStats());
      const processJitBefore = await page.evaluate(() => window.__jitStats());
      const run = await runNodeProcess(page, sequence, {
        timeoutMs: 300_000,
        progressIntervalMs,
      });
      const processJitAfter = await page.evaluate(() => window.__jitStats());
      const rpcAfter = await page.evaluate(() => window.__workerRpcStats());
      const schedulerAfter = await page.evaluate(() => window.__schedulerStats());
      const fetchAfter = await page.evaluate(() => window.__chunkedStats());
      expect(run.sawExpected).toBe(true);
      expect(run.exit).toBe(0);
      expect(run.nodeCommand).toBe("node -e 'console.log(3)'");
      expect(run.nodeSequence).toBe(sequence);
      expect(run.outputLine).toBe("3");
      expect(run.completionMarker).toBe(
        `__E4T32_NODE_DONE_${sequence}_${run.nodePid}_${run.exit}`,
      );
      expect(run.oracleTranscript).toBe(`3\n${run.completionMarker}\n`);
      expect(run.oracleTranscript.length).toBeLessThanOrEqual(512);
      validateNodeProcessOracleEvidence(run);
      run.jitBefore = processJitBefore;
      run.jitAfter = processJitAfter;
      run.jitDelta = jitDelta(processJitBefore, processJitAfter);
      run.commandWindow = commandWindow({
        schedulerBefore,
        schedulerAfter,
        fetchBefore,
        fetchAfter,
        rpcBefore,
        rpcAfter,
      });
      runs.push(run);
    }
    expect(runs.every((run) => Number.isSafeInteger(run.nodePid) && run.nodePid > 0),
      `${variant} pass ${passIndex} must record positive Node PIDs`).toBe(true);
    expect(new Set(runs.map((run) => run.nodePid)).size,
      `${variant} pass ${passIndex} fresh processes must have distinct Node PIDs`).toBe(runs.length);
    const responsivenessProbe = variant === "worker-interp" && passIndex === 0
      ? await runNodeResponsivenessProbe(page, sequencePrefix)
      : null;
    if (responsivenessProbe) expect(responsivenessProbe.exit).toBe(0);
    const jitAfter = await page.evaluate(() => window.__jitStats());
    if (nodeAssetBase) {
      expect(productionR2Requests, "timed local parity must make zero production-R2 requests")
        .toEqual([]);
    }
    session = {
      variant,
      passIndex,
      sequencePrefix,
      runs,
      responsivenessProbe,
      backend: await page.evaluate(() => document.documentElement.dataset.linuxBackend),
      browserPresentation,
      restored,
      bootIdentity,
      liveNodeManifest,
      productionR2Requests,
      jitBefore,
      jitAfter,
      scheduler: await page.evaluate(() => window.__schedulerStats()),
      fetch: await page.evaluate(() => window.__chunkedStats()),
      rpc: await page.evaluate(() => window.__workerRpcStats()),
      raf: await page.evaluate(() => {
        const sample = window.__e4t32Raf;
        sample.active = false;
        const gaps = sample.gaps.toSorted((a, b) => a - b);
        return {
          samples: gaps.length,
          p99Ms: gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * 0.99))] ?? 0,
          maxMs: gaps.at(-1) ?? 0,
        };
      }),
      errors,
    };
    expect(errors, `${variant} pass ${passIndex} console/page errors`).toEqual([]);
  } catch (error) {
    sessionError = error?.matcherResult
      ? markNodeProductFailure("product-assertion", error)
      : error;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (error) {
        if (sessionError) error.e4t32PriorFailure = serializeNodeFailure(sessionError);
        sessionError = error;
      }
    }
  }
  if (sessionError) {
    sessionError.e4t32SessionEvidence = {
      errors,
      productionR2Requests,
      stagedSession: session,
    };
    throw sessionError;
  }
  if (!session) throw new Error(`${variant} pass ${passIndex} produced no session result`);
  return session;
}

const summarizeNodeResults = (results) => {
  for (const result of Object.values(results)) {
    const coldRuns = result.sessions.map((session) => session.runs[0]);
    const subsequentRuns = result.sessions.flatMap((session) => session.runs.slice(1));
    result.runs = result.sessions.flatMap((session) => session.runs);
    result.firstMedianMs = median(result.runs.map((run) => run.firstMs));
    result.completeMedianMs = median(result.runs.map((run) => run.completeMs));
    result.firstAfterRestoreMedianMs = median(coldRuns.map((run) => run.firstMs));
    result.completeAfterRestoreMedianMs = median(coldRuns.map((run) => run.completeMs));
    result.subsequentFirstMedianMs = subsequentRuns.length
      ? median(subsequentRuns.map((run) => run.firstMs))
      : null;
    result.subsequentFirstMaxMs = subsequentRuns.length
      ? Math.max(...subsequentRuns.map((run) => run.firstMs))
      : null;
    result.stretchMaxMs = Math.max(...result.runs.map((run) => run.stretchMs));
    result.jitDelta = result.runs.reduce((delta, run) => ({
      compiledBlocks: delta.compiledBlocks + run.jitDelta.compiledBlocks,
      executedBlocks: delta.executedBlocks + run.jitDelta.executedBlocks,
      retiredViaJit: delta.retiredViaJit + run.jitDelta.retiredViaJit,
    }), { compiledBlocks: 0, executedBlocks: 0, retiredViaJit: 0 });
  }
  return results;
};

const logNodeLeg = (variant, session, attemptId = null) => {
  console.log("E4T32_NODE_LEG=" + JSON.stringify({
    variant,
    passIndex: session.passIndex,
    attemptId,
    runs: session.runs.map(({
      firstMs,
      completeMs,
      stretchMs,
      exit,
      nodeCommand,
      nodeSequence,
      nodePid,
      outputLine,
      completionMarker,
      oracleTranscript,
      jitDelta: delta,
      commandWindow: windowStats,
    }) => ({
      firstMs,
      completeMs,
      stretchMs,
      exit,
      nodeCommand,
      nodeSequence,
      nodePid,
      outputLine,
      completionMarker,
      oracleTranscript,
      jitDelta: delta,
      commandWindow: windowStats,
    })),
    responsivenessProbe: session.responsivenessProbe,
    backend: session.backend,
    browserPresentation: session.browserPresentation,
    restored: session.restored,
    bootIdentity: session.bootIdentity,
    liveNodeManifest: session.liveNodeManifest,
    productionR2Requests: session.productionR2Requests,
    scheduler: session.scheduler,
    raf: session.raf,
    cpuPreflight: session.cpuPreflight,
    errors: session.errors,
  }));
};

const assertFinalNodeResults = (results) => {
  for (const [variant, result] of Object.entries(results)) {
    expect(result.sessions.flatMap((session) => session.errors), variant).toEqual([]);
  }
  const baseline = results["main-interp"];
  const worker = results["worker-interp"];
  expect(baseline, "matrix needs main-interp baseline").toBeTruthy();
  expect(worker, "matrix needs worker-interp parity leg").toBeTruthy();
  expect(results["worker-jit512"], "matrix needs an opt-in JIT truth/proof leg").toBeTruthy();
  expect(baseline.sessions.every((session) => session.backend === "main-thread")).toBe(true);
  expect(worker.sessions.every((session) => session.backend === "whole-machine-worker")).toBe(true);
  for (const session of [...baseline.sessions, ...worker.sessions]) {
    expect(session.jitBefore.hasExecutor).toBe(false);
    expect(session.jitAfter.hasExecutor).toBe(false);
  }
  // E4-T32 holds both the four-process sample and the first process after each fresh restore to
  // same-head parity. The absolute Node acceleration budget remains E4-T34's runtime seam.
  expect(worker.firstMedianMs).toBeLessThanOrEqual(baseline.firstMedianMs * 1.10);
  expect(worker.completeMedianMs).toBeLessThanOrEqual(baseline.completeMedianMs * 1.10);
  expect(worker.firstAfterRestoreMedianMs).toBeLessThanOrEqual(baseline.firstAfterRestoreMedianMs * 1.10);
  expect(worker.completeAfterRestoreMedianMs).toBeLessThanOrEqual(baseline.completeAfterRestoreMedianMs * 1.10);
  expect(worker.stretchMaxMs).toBeLessThanOrEqual(baseline.stretchMaxMs * 1.10);
  for (const session of worker.sessions) {
    expect(session.scheduler.maxQuantum).toBeLessThanOrEqual(500_000);
    expect(session.scheduler.yieldMode).toBe("scheduler.postTask");
    expect(session.rpc.maxMs).toBeLessThanOrEqual(2_000);
    expect(session.raf.samples).toBeGreaterThan(100);
    expect(session.raf.p99Ms).toBeLessThanOrEqual(20);
  }
  const loadProbe = worker.sessions.find((session) => session.responsivenessProbe)?.responsivenessProbe;
  expect(loadProbe, "worker-interp needs a concurrent input/RPC probe under real Node load").toBeTruthy();
  expect(loadProbe.rpcError).toBeNull();
  expect(loadProbe.inputMs).toBeLessThanOrEqual(2_000);
  expect(loadProbe.rpcMs).toBeLessThanOrEqual(2_000);

  for (const [variant, result] of Object.entries(results)) {
    if (!variant.startsWith("worker-jit")) continue;
    expect(result.sessions.every((session) => session.backend === "whole-machine-worker"), variant).toBe(true);
    expect(result.sessions.every((session) => session.jitBefore.hasExecutor), variant).toBe(true);
    expect(result.sessions.every((session) => session.jitAfter.hasExecutor), variant).toBe(true);
    expect(result.jitDelta.executedBlocks, variant).toBeGreaterThan(0);
    expect(result.jitDelta.retiredViaJit, variant).toBeGreaterThan(0);
    for (const session of result.sessions) {
      expect(session.scheduler.yieldMode, variant).toBe("scheduler.postTask");
      expect(session.raf.p99Ms, variant).toBeLessThanOrEqual(20);
      // Current compiledBlocks is cache residency. Per-command execution and retirement deltas are
      // the truthful proof; the focused JIT browser test separately proves fresh compilation.
      for (const run of session.runs) {
        expect(run.jitDelta.executedBlocks, variant).toBeGreaterThan(0);
        expect(run.jitDelta.retiredViaJit, variant).toBeGreaterThan(0);
      }
    }
  }
};

const nodeEventSummary = (event) => event ? {
  eventId: event.eventId,
  attemptId: event.attemptId,
  slotId: event.slotId,
  outcome: event.outcome ?? null,
  reason: event.reason ?? null,
} : null;

const rawNodeAggregate = (ledger, identity) => ({
  kind: "e4-t32-node-walltime-aggregate-v2",
  complete: nodeBenchmarkLedgerStatus(ledger) === "complete",
  ledgerStatus: nodeBenchmarkLedgerStatus(ledger),
  identity,
  ledgerSha256: sha256Bytes(Buffer.from(serializeNodeBenchmarkLedger(ledger))),
  lastEvent: nodeEventSummary(ledger.events.at(-1)),
  // This derivation reads accepted events only. Failed or contaminated fast samples remain in the
  // append-only ledger but can never enter timing medians.
  results: deriveNodeBenchmarkResults(ledger),
});

async function persistNonAcceptedNodeOutcome(testInfo, ledger, identity, event) {
  const aggregate = rawNodeAggregate(ledger, identity);
  await attachEvidence(testInfo, "E4T32_NODE_AGGREGATE.json", aggregate);
  const outcome = {
    kind: "e4-t32-node-walltime-attempt-outcome-v2",
    identitySha256: identity.identitySha256,
    aggregateSha256: sha256Bytes(Buffer.from(stableJson(aggregate))),
    ledgerStatus: aggregate.ledgerStatus,
    event,
  };
  await attachEvidence(testInfo, "E4T32_NODE_LAST_NONACCEPTED.json", outcome);
  if (event.outcome === "refuted") {
    const verdict = {
      kind: "e4-t32-node-walltime-verdict-v2",
      verdict: "refuted",
      scope: "measured-session",
      aggregateSha256: outcome.aggregateSha256,
      event,
    };
    await attachEvidence(testInfo, "E4T32_NODE_VERDICT_REFUTED.json", verdict);
    console.log("E4T32_NODE_VERDICT=" + JSON.stringify(verdict));
  }
  return { aggregate, outcome };
}

test.describe("E4-T32 real Node foreground wall time", () => {
  test.skip(
    !enabled || preflightOnly,
    "set E4T32_NODE_BENCH=1 for the expensive same-head matrix (without preflight-only mode)",
  );

  test("same-head worker interpreter parity plus truthful JIT/scheduler evidence", async ({ browser }, testInfo) => {
    test.setTimeout(45 * 60_000);
    if (!diagnostic) {
      expect(nodeAssetBase, "the parity matrix requires E4T32_NODE_ASSET_BASE").toBeTruthy();
      expect(
        requestedVariants,
        "the accepted matrix has a fixed six-slot plan; use E4T32_NODE_DIAG for screening variants",
      ).toEqual([]);
    }
    for (const variant of variants) {
      if (!urls[variant]) throw new Error(`unknown E4T32_NODE_VARIANT: ${variant}`);
    }
    if (diagnostic) {
      const results = Object.fromEntries(
        variants.map((variant) => [variant, { sessions: [], runs: [] }]),
      );
      const order = process.env.E4T32_NODE_DIAG_WORKER_FIRST === "1"
        ? [...variants].reverse()
        : variants;
      for (const variant of order) {
        const label = `diagnostic_${variant.replaceAll("-", "_")}_${randomUUID()}`;
        const before = await cpuRealmPreflight(browser, `${label}_before`, testInfo);
        let session = null;
        let sessionError = null;
        let after = null;
        let postflightError = null;
        try {
          session = await runNodeVariantSession(browser, {
            variant,
            passIndex: 0,
            sequencePrefix: label,
            processCount: 1,
            progressIntervalMs: diagnosticProgress ? 10_000 : 0,
          });
        } catch (error) {
          sessionError = error;
        } finally {
          try {
            after = await cpuRealmPreflight(browser, `${label}_after`, testInfo);
          } catch (error) {
            postflightError = error;
          }
        }
        if (postflightError) {
          if (sessionError) postflightError.cause = sessionError;
          throw postflightError;
        }
        if (sessionError) throw sessionError;
        session.cpuPreflight = { before, after };
        results[variant].sessions.push(session);
        logNodeLeg(variant, session);
      }
      summarizeNodeResults(results);
      await attachEvidence(testInfo, "E4T32_NODE_DIAGNOSTIC_RESULTS.json", results);
      expect(results["main-interp"].sessions.every((session) => session.backend === "main-thread")).toBe(true);
      expect(results["worker-interp"].sessions.every(
        (session) => session.backend === "whole-machine-worker",
      )).toBe(true);
      if (nodeAssetBase) {
        const baseline = results["main-interp"];
        const worker = results["worker-interp"];
        expect(worker.firstMedianMs).toBeLessThanOrEqual(baseline.firstMedianMs * 1.10);
        expect(worker.completeMedianMs).toBeLessThanOrEqual(baseline.completeMedianMs * 1.10);
      }
      return;
    }

    const identity = await nodeBenchmarkIdentity(browser, E4T32_NODE_SLOT_PLAN);
    activeNodeLedgerLock = await acquireSingleWriterLock(nodeLedgerLockPath, {
      pid: process.pid,
      runId: randomUUID(),
      identitySha256: identity.identitySha256,
      startedAt: new Date().toISOString(),
    });
    if (activeNodeLedgerLock.recoveredLockPath) {
      console.log("E4T32_NODE_STALE_LOCK_RECOVERED=" + JSON.stringify({
        staleLock: activeNodeLedgerLock.recoveredLockPath,
        owner: activeNodeLedgerLock.owner,
      }));
    }
    const journal = createNodeAttemptJournal({ evidenceDir, ledgerPath: nodeLedgerPath, identity });
    let ledger;
    if (fs.existsSync(nodeLedgerPath)) {
      ledger = await journal.loadLedger();
      await journal.healEventSidecars(ledger);
    } else {
      ledger = createNodeBenchmarkLedger(identity);
      await journal.persistLedger(ledger);
    }
    const interrupted = activeNodeBenchmarkAttempt(ledger);
    if (interrupted) {
      const recovered = await journal.recoverOpenAttempt(ledger, interrupted);
      ledger = recovered.ledger;
      await attachAttemptArtifact(testInfo, recovered.event.artifactName, recovered.artifact.filePath);
      console.log("E4T32_NODE_RECOVERY=" + JSON.stringify({
        attemptId: interrupted.attemptId,
        recoveredCompletePhases: recovered.recoveredCompletePhases,
        outcome: recovered.event.outcome,
        reason: recovered.event.reason,
        ledgerStatus: nodeBenchmarkLedgerStatus(ledger),
      }));
      if (recovered.event.outcome !== "accepted") {
        await persistNonAcceptedNodeOutcome(testInfo, ledger, identity, recovered.event);
        throw new Error(
          `E4T32_ATTEMPT_RECOVERED_${recovered.event.outcome.toUpperCase().replaceAll("-", "_")}: ` +
          `${interrupted.attemptId}; ledger=${nodeBenchmarkLedgerStatus(ledger)}`,
        );
      }
    }

    const resumedStatus = nodeBenchmarkLedgerStatus(ledger);
    const resumedLastEvent = ledger.events.at(-1) ?? null;
    if (resumedLastEvent?.type === "attempt-finished" && resumedLastEvent.outcome !== "accepted") {
      // Heal evidence even when an inconclusive attempt left the ledger resumable. Otherwise a
      // crash after closing that attempt's index entry could silently skip its outcome on retry.
      await persistNonAcceptedNodeOutcome(testInfo, ledger, identity, resumedLastEvent);
    }
    if (resumedStatus !== "running" && resumedStatus !== "complete") {
      const terminalEvent = resumedLastEvent;
      if (!terminalEvent || terminalEvent.type !== "attempt-finished") {
        throw new Error(`E4T32_NODE_LEDGER_TERMINAL ${resumedStatus} has no terminal event`);
      }
      // A prior process may have died after the authoritative closed index was fsynced but before
      // its aggregate/verdict convenience artifacts were published. Heal those idempotently before
      // surfacing the terminal result; terminal ledgers can never be resumed into another sample.
      throw new Error(
        `E4T32_NODE_LEDGER_TERMINAL: ${resumedStatus}; ` +
        `attempt=${terminalEvent.attemptId}; reason=${terminalEvent.reason}`,
      );
    }

    while (nodeBenchmarkLedgerStatus(ledger) === "running") {
      const slot = nextNodeBenchmarkSlot(ledger);
      if (!slot) throw new Error("running ledger has no next benchmark slot");
      const identityBeforeAttempt = await nodeBenchmarkIdentity(browser, E4T32_NODE_SLOT_PLAN);
      if (stableJson(identityBeforeAttempt) !== stableJson(identity)) {
        throw new Error(
          `E4T32_LEDGER_IDENTITY_MISMATCH before ${slot.id}; use a new evidence directory`,
        );
      }
      const attemptId = `${identity.identitySha256.slice(0, 12)}:${slot.id}:${slot.attemptsUsed + 1}:${randomUUID()}`;
      const begun = beginNodeBenchmarkAttempt(ledger, {
        attemptId,
        slotId: slot.id,
        identity,
      });
      // Reserve the attempt in the atomic index before calibration. A killed Playwright process
      // therefore consumes one of the declared three attempts instead of silently cherry-picking.
      const persistedBegun = await journal.persistBegunAttempt(begun);
      ledger = persistedBegun.ledger;
      const startedArtifact = persistedBegun.artifact;
      await attachAttemptArtifact(testInfo, begun.event.artifactName, startedArtifact.filePath);

      const label = nodeBenchmarkSequencePrefix(begun.event);
      let preCalibration = null;
      let harnessError = null;
      try {
        const evidence = await cpuRealmPreflight(browser, `${label}_before`, testInfo);
        preCalibration = { clean: true, evidence };
      } catch (error) {
        if (error.code === "E4T32_ENV_CONTAMINATED") {
          preCalibration = {
            clean: false,
            evidence: error.evidence,
            error: errorEvidence(error),
          };
        } else {
          harnessError = errorEvidence(error);
        }
      }
      const preArtifact = await journal.writePre(begun.event, { preCalibration, harnessError });
      await attachAttemptArtifact(testInfo, path.basename(preArtifact.relativeName), preArtifact.filePath);

      let session = null;
      let sessionError = null;
      let postCalibration = null;
      let sessionArtifact = null;
      let postArtifact = null;
      if (preCalibration?.clean && harnessError === null) {
        try {
          session = await runNodeVariantSession(browser, {
            variant: slot.variant,
            passIndex: slot.passIndex,
            sequencePrefix: label,
          });
        } catch (error) {
          const classified = classifyNodeSessionFailure(error);
          sessionError = {
            ...classified.sessionError,
            evidence: error.e4t32SessionEvidence ?? null,
          };
          if (classified.harnessError) {
            harnessError = {
              ...classified.harnessError,
              evidence: error.e4t32SessionEvidence ?? null,
            };
          }
        }
        sessionArtifact = await journal.writeSession(begun.event, { session, sessionError });
        await attachAttemptArtifact(
          testInfo,
          path.basename(sessionArtifact.relativeName),
          sessionArtifact.filePath,
        );
        try {
          const evidence = await cpuRealmPreflight(browser, `${label}_after`, testInfo);
          postCalibration = { clean: true, evidence };
        } catch (error) {
          if (error.code === "E4T32_ENV_CONTAMINATED") {
            postCalibration = {
              clean: false,
              evidence: error.evidence,
              error: errorEvidence(error),
            };
          } else {
            harnessError ??= errorEvidence(error);
          }
        }
        let identityAfterVerified = false;
        try {
          const identityAfterAttempt = await nodeBenchmarkIdentity(browser, E4T32_NODE_SLOT_PLAN);
          if (stableJson(identityAfterAttempt) !== stableJson(identity)) {
            throw new Error(`candidate identity changed while measuring ${slot.id}`);
          }
          identityAfterVerified = true;
        } catch (error) {
          harnessError = {
            ...errorEvidence(error),
            code: "E4T32_IDENTITY_DRIFT",
          };
        }
        postArtifact = await journal.writePost(begun.event, {
          postCalibration,
          harnessError,
          identityAfterVerified,
        });
        await attachAttemptArtifact(testInfo, path.basename(postArtifact.relativeName), postArtifact.filePath);
      }

      if (session) {
        session.cpuPreflight = {
          before: preCalibration.evidence,
          after: postCalibration?.evidence ?? null,
        };
      }
      const finished = await journal.finishAndPersist(ledger, {
        attemptId,
        preCalibration,
        postCalibration,
        session,
        sessionError,
        harnessError,
      });
      ledger = finished.ledger;
      await attachAttemptArtifact(testInfo, finished.event.artifactName, finished.artifact.filePath);
      console.log("E4T32_NODE_ATTEMPT=" + JSON.stringify({
        attemptId,
        slot,
        outcome: finished.event.outcome,
        reason: finished.event.reason,
        ledgerStatus: nodeBenchmarkLedgerStatus(ledger),
      }));

      if (finished.event.outcome === "accepted") {
        logNodeLeg(slot.variant, session, attemptId);
        continue;
      }
      await persistNonAcceptedNodeOutcome(testInfo, ledger, identity, finished.event);
      const status = nodeBenchmarkLedgerStatus(ledger);
      if (finished.event.outcome === "refuted") {
        throw new Error(
          `E4T32_PRODUCT_REFUTED ${slot.id}: ${finished.event.reason}; attempt=${attemptId}`,
        );
      }
      if (finished.event.outcome === "harness-error") {
        throw new Error(
          `E4T32_HARNESS_ERROR ${slot.id}: attempt=${attemptId}; no retry is permitted`,
        );
      }
      const mixed = finished.event.outcome === "mixed-inconclusive";
      const code = mixed ? "E4T32_MIXED_INCONCLUSIVE" : "E4T32_ENV_CONTAMINATED";
      throw new Error(
        `${code} ${slot.id}: attempt=${attemptId}; ledger=${status}; ` +
        (status === "environment-inconclusive"
          ? "three declared attempts were inconclusive"
          : "rerun the same frozen candidate to retry the earliest incomplete slot"),
      );
    }

    const ledgerStatus = nodeBenchmarkLedgerStatus(ledger);
    if (ledgerStatus !== "complete") {
      throw new Error(`E4T32_NODE_LEDGER_TERMINAL: ${ledgerStatus}; no product verdict is valid`);
    }
    const results = summarizeNodeResults(assertNodeBenchmarkComplete(ledger));
    const finalEvidence = {
      kind: "e4-t32-node-walltime-aggregate-v2",
      complete: true,
      ledgerStatus,
      identity,
      ledgerSha256: sha256Bytes(Buffer.from(serializeNodeBenchmarkLedger(ledger))),
      lastEvent: nodeEventSummary(ledger.events.at(-1)),
      results,
    };
    await attachEvidence(testInfo, "E4T32_NODE_AGGREGATE.json", finalEvidence);
    await testInfo.attach("E4T32_NODE_LEDGER_V2", {
      path: nodeLedgerPath,
      contentType: "application/json",
    });
    console.log("E4T32_NODE_AGGREGATE=" + JSON.stringify(finalEvidence));
    try {
      assertFinalNodeResults(results);
    } catch (error) {
      const refutedEvidence = {
        kind: "e4-t32-node-walltime-verdict-v2",
        verdict: "refuted",
        aggregateSha256: sha256Bytes(Buffer.from(stableJson(finalEvidence))),
        error: errorEvidence(error),
      };
      await attachEvidence(testInfo, "E4T32_NODE_VERDICT_REFUTED.json", refutedEvidence);
      console.log("E4T32_NODE_VERDICT=" + JSON.stringify(refutedEvidence));
      throw error;
    }
    const passedEvidence = {
      ...finalEvidence,
      kind: "e4-t32-node-walltime-verdict-v2",
      verdict: "passed",
    };
    await attachEvidence(testInfo, "E4T32_NODE_RESULTS.json", passedEvidence);
    console.log("E4T32_NODE_RESULTS=" + JSON.stringify(passedEvidence));
  });
});

test("E4-T32 Window vs DedicatedWorker CPU environment preflight", async ({ browser }, testInfo) => {
  test.skip(!preflightOnly, "set E4T32_CPU_PREFLIGHT_ONLY=1 for the standalone calibration");
  test.setTimeout(120_000);
  await cpuRealmPreflight(browser, "standalone", testInfo);
});
