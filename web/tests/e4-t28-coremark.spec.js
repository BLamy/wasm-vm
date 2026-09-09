// E4-T28c: run the committed Linux CoreMark ELF through the real browser guest. The binary is
// uploaded over the production WVFT bridge after a fresh Node-Alpine restore, so this path exercises
// the guest kernel, file-agent, filesystem, shell, RISC-V executor, and the CoreMark self-check. It
// deliberately does not accept a host-side score or a guessed iteration count.
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const rows = "#term .xterm-rows";
const coremarkPath = path.join(repoRoot, "bench/guest/coremark.rv64");
const coremarkBytes = fs.readFileSync(coremarkPath);
const coremarkSha256 = createHash("sha256").update(coremarkBytes).digest("hex");
const expectedCoremarkSha256 = "4db593b8110e588b4fba7e526d3b838365cc5ad50ae6cd1592be2dc483a08937";
const expectedNodeManifestSha256 = "ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1";
const productionAssetBase = "https://pub-ee599ce692e44e29868ebfa96dd9c7fd.r2.dev";
const workloadId = "e4-t28c-coremark-browser-v1";
const expectedIterations = 6000;
const expectedSeedCrc = 0xe9f5;
const requestedSamples = Math.max(1, Math.min(3, Number(process.env.E4T28C_SAMPLES || 3)));

const controls = Object.freeze({
  jit: Object.freeze({
    name: "jit",
    query: "jit=1&jitThreshold=512&jitResidency=repack-off&jalr=1&region=1&quantum=100000",
    jit: true,
    threshold: 512,
    residency: "repack-off",
    jalr: true,
    region: true,
    interpreter: "fast",
  }),
  interpreter: Object.freeze({
    name: "interpreter",
    query: "jit=0&slowInterp=1&jalr=1&region=1&quantum=100000",
    jit: false,
    threshold: 512,
    residency: "disabled",
    jalr: true,
    region: true,
    interpreter: "legacy",
  }),
});
const selectedControlNames = (process.env.E4T28C_CONTROLS || "jit,interpreter")
  .split(",")
  .map((name) => name.trim())
  .filter((name, index, names) => controls[name] && names.indexOf(name) === index);
const selectedControls = selectedControlNames.length > 0
  ? selectedControlNames.map((name) => controls[name])
  : [controls.jit, controls.interpreter];
const evidencePath = path.join(repoRoot, "evidence/e4-t28c/coremark-browser-2026-09-03.json");

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sha256File(relativePath) {
  return sha256Bytes(fs.readFileSync(path.join(repoRoot, relativePath)));
}

function gitHead() {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function medianResult(results) {
  const sorted = [...results].sort((a, b) => a.score - b.score);
  return sorted[Math.floor(sorted.length / 2)];
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`
  )).join(",")}}`;
}

function ledgerEntryHash(entry) {
  return sha256Bytes(Buffer.from(canonicalJson(entry), "utf8"));
}

function loadLevel3BrowserBaseline() {
  const ledger = JSON.parse(fs.readFileSync(path.join(repoRoot, "bench/ledger.json"), "utf8"));
  const matches = ledger.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.baseline === "level3-interpreter" &&
      entry.engine === "browser" && entry.bench === "coremark" &&
      entry.config?.workloadId === workloadId && entry.config?.jit === false);
  if (matches.length === 0) return null;
  const { entry, index } = matches.at(-1);
  return {
    ledgerPath: "bench/ledger.json",
    ledgerSha256: sha256File("bench/ledger.json"),
    entryIndex: index,
    rowSha256: ledgerEntryHash(entry),
    entry,
  };
}

async function nodeManifestIdentity(page) {
  return page.evaluate(async ({ assetBase, expectedSha256 }) => {
    const url = new URL(`${assetBase}/chunked-node-alpine/manifest.json`);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`node manifest HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const sha256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const manifest = JSON.parse(new TextDecoder().decode(bytes));
    const firstChunkSha256 = manifest.chunks?.[0];
    if (!/^[0-9a-f]{64}$/.test(firstChunkSha256 || "")) throw new Error("invalid first node chunk hash");
    const firstChunkResponse = await fetch(new URL(`chunks/${firstChunkSha256}.bin`, url), {
      cache: "no-store",
    });
    if (!firstChunkResponse.ok) throw new Error(`node first chunk HTTP ${firstChunkResponse.status}`);
    const firstChunkDigest = await crypto.subtle.digest("SHA-256", await firstChunkResponse.arrayBuffer());
    const firstChunkActualSha256 = [...new Uint8Array(firstChunkDigest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return {
      url: url.href,
      sha256,
      expectedSha256,
      version: manifest.version,
      imageLen: manifest.image_len,
      chunkSize: manifest.chunk_size,
      chunkCount: manifest.chunks?.length ?? null,
      firstChunkSha256,
      firstChunkActualSha256,
    };
  }, { assetBase: productionAssetBase, expectedSha256: expectedNodeManifestSha256 });
}

async function pageStats(page) {
  return page.evaluate(async () => {
    const [jit, profile, scheduler] = await Promise.all([
      window.__linuxCtl.jitStats(),
      window.__linuxCtl.profileStats(),
      window.__linuxCtl.schedulerStats(),
    ]);
    return { jit, profile, scheduler };
  });
}

function waitForUpload(page, name) {
  return page.waitForFunction(
    (transferName) => window.__wasmVmFileTransferUI.snapshot().some((item) =>
      item.name === transferName && ["complete", "error", "partial"].includes(item.state)),
    name,
    { timeout: 300_000, polling: 1_000 },
  );
}

async function uploadCoremark(page, name) {
  await page.setInputFiles("#file-transfer-input", {
    name,
    mimeType: "application/x-elf",
    buffer: coremarkBytes,
  });
  await waitForUpload(page, name);
  const transfer = await page.evaluate((transferName) =>
    window.__wasmVmFileTransferUI.snapshot().find((item) => item.name === transferName), name);
  expect(transfer, JSON.stringify(transfer)).toMatchObject({ state: "complete", total: coremarkBytes.length });

  const guestPath = `/var/lib/wasm-vm/transfer/inbox/${name}`;
  const check = await page.evaluate(async (path) => {
    const result = await window.wvmDemo.exec(`chmod 0755 '${path}' && sha256sum '${path}'`, 60_000, {
      quiet: true,
    });
    return result;
  }, guestPath);
  expect(check.exit, check.stdout).toBe(0);
  const hashMatch = check.stdout.match(new RegExp(`^([0-9a-f]{64})\\s+.*\\/${name.replaceAll(".", "\\.")}\\s*$`, "m"));
  expect(hashMatch, `guest CoreMark hash output: ${check.stdout}`).toBeTruthy();
  expect(hashMatch[1]).toBe(coremarkSha256);
  return { guestPath, transfer, hashOutput: check.stdout.trim() };
}

function parseCoremark(stdout, token) {
  const result = {
    token,
    validation: stdout.includes("Correct operation validated. See README.md for run and reporting rules."),
    seedCrc: null,
    size: null,
    totalTimeSecs: null,
    iterationsPerSec: null,
    iterations: null,
    rawTail: stdout.slice(-4_000),
  };
  const size = stdout.match(/CoreMark Size\s*:\s*(\d+)/);
  const total = stdout.match(/Total time \(secs\)\s*:\s*([0-9.]+)/);
  const itsec = stdout.match(/Iterations\/Sec\s*:\s*([0-9.]+)/);
  const iterations = stdout.match(/Iterations\s*:\s*(\d+)/);
  const seed = stdout.match(/seedcrc\s*:\s*(0x[0-9a-fA-F]+)/);
  result.size = size ? Number(size[1]) : null;
  result.totalTimeSecs = total ? Number(total[1]) : null;
  result.iterationsPerSec = itsec ? Number(itsec[1]) : null;
  result.iterations = iterations ? Number(iterations[1]) : null;
  result.seedCrc = seed ? Number.parseInt(seed[1], 16) : null;
  expect(result.validation, `CoreMark validation missing; output=${result.rawTail}`).toBe(true);
  expect(result.seedCrc).toBe(expectedSeedCrc);
  expect(result.iterations).toBe(expectedIterations);
  expect(result.totalTimeSecs).toBeGreaterThanOrEqual(10);
  expect(result.iterationsPerSec).toBeGreaterThan(0);
  return result;
}

async function runCoremark(page, guestPath, token) {
  const outputPath = `/tmp/${token}.out`;
  const command = [
    `rm -f '${outputPath}'`,
    `'${guestPath}' >'${outputPath}' 2>&1`,
    "rc=$?",
    `printf 'T28C_COREMARK_RC_${token}_%s\\n' \"$rc\"`,
    `cat '${outputPath}'`,
    `rm -f '${outputPath}'`,
  ].join("; ");
  const captured = await page.evaluate(async (shellCommand) => {
    const started = performance.now();
    const result = await window.wvmDemo.exec(shellCommand, 2_400_000, { quiet: true });
    return { ...result, hostElapsedMs: performance.now() - started };
  }, command);
  expect(captured.exit, captured.stdout).toBe(0);
  const rcMatch = captured.stdout.match(new RegExp(`T28C_COREMARK_RC_${token}_(\\d+)`));
  expect(rcMatch, captured.stdout.slice(-2_000)).toBeTruthy();
  expect(Number(rcMatch[1])).toBe(0);
  const result = parseCoremark(captured.stdout, token);
  return {
    command: `'${guestPath}'`,
    result,
    hostElapsedMs: captured.hostElapsedMs,
  };
}

function bunResult() {
  try {
    const version = execFileSync("bun", ["--version"], { cwd: repoRoot, encoding: "utf8" }).trim();
    return {
      status: "available-not-run",
      gating: false,
      version,
      reason: "Bun is not a substitute for the pinned CoreMark Linux ELF in this Chromium-only proof.",
    };
  } catch (error) {
    return { status: "unavailable", gating: false, reason: `bun executable unavailable: ${error.code || "not-found"}` };
  }
}

async function runControl(browser, control, sample, testInfo) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const requestErrors = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() === 404 && new URL(response.url()).pathname === "/favicon.ico") return;
    if (response.status() >= 400) requestErrors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon.ico")) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  try {
    const url = `/?guest=node-alpine&nosw&persist=1&profile=1&testHooks=1&diagnosticStats=1&${control.query}`;
    await page.goto(url);
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
    await page.waitForFunction(() => window.__linuxCtl, null, { timeout: 30_000 });
    await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = await window.wvmDemo.exec("true", 30_000, { quiet: true });
      if (result.exit !== 0) throw new Error(`guest readiness command exited ${result.exit}`);
    });
    expect(await page.evaluate(() => window.__linux?.restoredFromBootSnapshot?.())).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.linuxBackend)).toBe("whole-machine-worker");
    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.jitThreshold)).toBe("512");
    expect(await page.evaluate(() => document.documentElement.dataset.jitResidency))
      .toBe(control.jit ? "repack-off" : "disabled");
    expect(await page.evaluate(() => document.documentElement.dataset.jitJalr)).toBe("true");
    expect(await page.evaluate(() => document.documentElement.dataset.jitRegion)).toBe("true");
    expect(await page.evaluate(() => document.documentElement.dataset.interpreter)).toBe(control.interpreter);
    await page.waitForFunction(
      async () => (await window.__fileTransferReady()).some(Boolean),
      null,
      { timeout: 300_000, polling: 1_000 },
    );
    const manifest = await nodeManifestIdentity(page);
    expect(manifest.sha256).toBe(expectedNodeManifestSha256);
    expect(manifest.version).toBe(1);
    expect(manifest.imageLen).toBe(805_306_368);
    expect(manifest.chunkSize).toBe(131_072);
    expect(manifest.chunkCount).toBe(6_144);
    expect(manifest.firstChunkActualSha256).toBe(manifest.firstChunkSha256);

    const beforeUpload = await pageStats(page);
    const name = `coremark-t28c-${control.name}-${sample}.rv64`;
    const upload = await uploadCoremark(page, name);
    // The uploaded ELF did not exist while the restored boot image was loaded, so its translated
    // pages cannot have been warmed by the restore. Capture the actual workload boundary after the
    // upload and before the first instruction of CoreMark.
    const before = await pageStats(page);
    const token = `t28c_${control.name}_${sample}`;
    const coremark = await runCoremark(page, upload.guestPath, token);
    const after = await pageStats(page);
    const runtimeDigest = await page.evaluate(() => window.__linuxCtl.stateDigest());
    expect(runtimeDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(coremark.result.validation).toBe(true);
    expect(requestErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.dataset.nodeWarmup)).toBe("disabled");
    await page.screenshot({ path: testInfo.outputPath(`e4-t28c-${control.name}-${sample}.png`), fullPage: true });
    return {
      name: control.name,
      sample,
      query: control.query,
      controls: {
        jit: control.jit,
        threshold: control.threshold,
        residency: control.residency,
        jalr: control.jalr,
        region: control.region,
        interpreter: control.interpreter,
      },
      backend: await page.evaluate(() => document.documentElement.dataset.linuxBackend),
      coldProfile: {
        persist: true,
        newContext: true,
        nodeWarmupQuery: "absent",
        nodeWarmupState: await page.evaluate(() => document.documentElement.dataset.nodeWarmup),
        beforeUpload,
      },
      upload: {
        name,
        total: upload.transfer.total,
        sent: upload.transfer.done,
        guestPath: upload.guestPath,
        hostSha256: coremarkSha256,
        guestSha256: coremarkSha256,
        hashOutput: upload.hashOutput,
      },
      jitBefore: before.jit,
      jitAfter: after.jit,
      schedulerBefore: before.scheduler,
      schedulerAfter: after.scheduler,
      coremark,
      guestElapsedMs: coremark.result.totalTimeSecs * 1000,
      hostElapsedMs: coremark.hostElapsedMs,
      clockCrossCheck: {
        boundary: "after fresh restore and ELF upload; before CoreMark command through RPC completion",
        guestElapsedMs: coremark.result.totalTimeSecs * 1000,
        hostElapsedMs: coremark.hostElapsedMs,
        hostToGuestRatio: coremark.hostElapsedMs / (coremark.result.totalTimeSecs * 1000),
        relativeDifference: Math.abs(coremark.hostElapsedMs / (coremark.result.totalTimeSecs * 1000) - 1),
        withinTwoPercent: Math.abs(coremark.hostElapsedMs / (coremark.result.totalTimeSecs * 1000) - 1) <= 0.02,
      },
      runtimeDigest,
      nodeManifest: manifest,
      requestErrors,
      consoleErrors,
    };
  } finally {
    await context.close();
  }
}

function writeEvidence(value) {
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`);
}

test.describe("E4-T28c browser CoreMark uplift", () => {
  test("cold CoreMark validates in the guest under JIT and an interpreter control", async ({ browser }, testInfo) => {
    test.setTimeout(4 * 60 * 60_000);
    expect(coremarkSha256).toBe(expectedCoremarkSha256);
    const baseline = loadLevel3BrowserBaseline();
    const resultSets = {};
    for (const control of selectedControls) {
      resultSets[control.name] = [];
      for (let sample = 0; sample < requestedSamples; sample += 1) {
        resultSets[control.name].push(await runControl(browser, control, sample, testInfo));
      }
    }
    const jitResults = resultSets.jit || [];
    const interpreterResults = resultSets.interpreter || [];
    expect(jitResults.length > 0 || interpreterResults.length > 0).toBe(true);
    for (const result of [...jitResults, ...interpreterResults]) {
      expect(result.coremark.result.validation).toBe(true);
      expect(result.coremark.result.iterations).toBe(expectedIterations);
      expect(result.coremark.result.seedCrc).toBe(expectedSeedCrc);
    }

    const jitMedian = jitResults.length > 0 ? medianResult(jitResults) : null;
    const interpreterMedian = interpreterResults.length > 0 ? medianResult(interpreterResults) : null;
    if (jitMedian) {
      expect(jitMedian.jitAfter.hasExecutor).toBe(true);
      expect(jitMedian.jitAfter.executedBlocks - jitMedian.jitBefore.executedBlocks).toBeGreaterThan(0);
      expect(jitMedian.jitAfter.retiredViaJit - jitMedian.jitBefore.retiredViaJit).toBeGreaterThan(0);
    }
    if (interpreterMedian) {
      expect(interpreterMedian.jitAfter.hasExecutor).toBe(false);
      expect(interpreterMedian.jitAfter.retiredViaJit - interpreterMedian.jitBefore.retiredViaJit).toBe(0);
    }

    const jitScore = jitResults.length > 0 ? median(jitResults.map((item) => item.coremark.result.iterationsPerSec)) : null;
    const interpreterScore = interpreterResults.length > 0
      ? median(interpreterResults.map((item) => item.coremark.result.iterationsPerSec))
      : null;
    const baselineScore = baseline?.entry.score ?? interpreterScore;
    const ratio = jitScore != null && baselineScore != null ? jitScore / baselineScore : null;
    if (baseline && ratio != null) expect(ratio).toBeGreaterThanOrEqual(10);

    const candidate = gitHead();
    const evidence = {
      schema_version: 1,
      schema: "e4-t28c-coremark-browser-result-v1",
      generatedAt: new Date().toISOString(),
      candidate: {
        commit: candidate,
        source: "git HEAD",
        workingTree: "tracked test result is emitted after the browser run",
      },
      build: {
        flags: {
          wasm: "wasm-pack build crates/wasm --target web --release",
          browser: "make web-build",
          guest: "-static -O2 -g0 -march=rv64gc -mabi=lp64d",
        },
        coremarkBinary: "bench/guest/coremark.rv64",
        coremarkBinarySha256: coremarkSha256,
        coremarkIterations: expectedIterations,
      },
      baseline: {
        kind: "ledgered-level3-browser-interpreter",
        workloadId,
        metric: "CoreMark iterations/sec",
        requiredRatio: 10,
        reference: baseline,
        liveInterpreterMedianIterationsPerSec: interpreterScore,
        candidateMedianIterationsPerSec: jitScore,
        ratio,
        speedGateEvaluated: baseline != null,
        speedGateSatisfied: ratio != null ? ratio >= 10 : false,
      },
      controls: selectedControls,
      fresh_profile: {
        requestedSamples,
        actualSamples: Object.fromEntries(Object.entries(resultSets).map(([name, values]) => [name, values.length])),
        newContextPerSample: true,
        persist: true,
        siteDataClearedByConstruction: true,
        nodeWarmupQuery: "absent",
        warmups: 0,
        webkit: "excluded by user direction",
        independentMachines: "excluded by user direction",
      },
      headers: {
        served: {
          crossOriginOpenerPolicy: "same-origin",
          crossOriginEmbedderPolicy: "require-corp",
        },
        deployContract: {
          path: "web/_headers",
          sha256: sha256File("web/_headers"),
          crossOriginOpenerPolicy: "same-origin",
          crossOriginEmbedderPolicy: "credentialless",
        },
      },
      artifacts: {
        servedManifest: {
          path: "web/artifacts-node-alpine.json",
          sha256: sha256File("web/artifacts-node-alpine.json"),
        },
        nodeChunkManifest: {
          url: `${productionAssetBase}/chunked-node-alpine/manifest.json`,
          sha256: expectedNodeManifestSha256,
        },
      },
      browser: {
        project: "chromium",
        configuredFirefox: "not configured",
        errors: Object.fromEntries(Object.entries(resultSets).map(([name, values]) => [
          name,
          values.flatMap((value) => value.consoleErrors.concat(value.requestErrors)),
        ])),
      },
      workload: {
        id: workloadId,
        binary: "bench/guest/coremark.rv64",
        binarySha256: coremarkSha256,
        expectedIterations,
        expectedSeedCrc: "0xe9f5",
        validationLine: "Correct operation validated. See README.md for run and reporting rules.",
        response: "real uploaded Linux ELF executed in the guest; no host-side score",
      },
      results: resultSets,
      bun: bunResult(),
      verdict: {
        harnessPass: true,
        coremarkValidation: true,
        candidateMedianIterationsPerSec: jitScore,
        interpreterMedianIterationsPerSec: interpreterScore,
        ratio,
        speedGateEvaluated: baseline != null,
        speedGateSatisfied: ratio != null ? ratio >= 10 : false,
        guestHostWithinTwoPercent: [...jitResults, ...interpreterResults]
          .every((result) => result.clockCrossCheck.withinTwoPercent),
        note: baseline
          ? "The immutable browser Level-3 baseline was present and the ratio was evaluated."
          : "No exact ledgered browser Level-3 CoreMark row exists; the live interpreter median is recorded as a non-immutable control and the 10x gate remains a typed evidence gap.",
      },
    };
    writeEvidence(evidence);
    console.log(`E4T28C_RESULT=${JSON.stringify({
      evidencePath: "evidence/e4-t28c/coremark-browser-2026-09-03.json",
      evidenceSha256: sha256Bytes(Buffer.from(JSON.stringify(evidence, null, 2) + "\n", "utf8")),
      candidate,
      requestedSamples,
      actualSamples: evidence.fresh_profile.actualSamples,
      jitMedianIterationsPerSec: jitScore,
      interpreterMedianIterationsPerSec: interpreterScore,
      baselineIterationsPerSec: baselineScore,
      ratio,
      guestHostWithinTwoPercent: evidence.verdict.guestHostWithinTwoPercent,
    })}`);
  });
});
