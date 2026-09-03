// E4-T38: compare the three browser residency screens with the exact E4-T32 Node oracle.
// This is intentionally a small, one-process-per-policy capture: each fresh tab restores the same
// Node image, applies exactly one JIT residency policy at boot, and submits the byte-identical
// `node -e 'console.log(3)'` command once.
import { expect, test } from "@playwright/test";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNodeOracleFrameCollector,
  createNodeProcessOracleEvidence,
  createNodeProcessOracleSpec,
  validateNodeProcessOracleEvidence,
} from "./helpers/e4-t32-node-oracle.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const nodeAssetDir = (process.env.E4T32_NODE_ASSET_DIR || "").trim();
const nodeAssetBase = (process.env.E4T32_NODE_ASSET_BASE || "/e4t32-node-assets").replace(/\/+$/, "");
const policies = ["repack-off", "cap-256", "cap-1024"];
const expectedNodeManifestSha256 = "ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1";
const evidencePath = path.join(repoRoot, "evidence/e4-t38/residency-policy-2026-09-03.json");

const delta = (after, before, key) => Number(after?.[key] ?? 0) - Number(before?.[key] ?? 0);

const readSha256 = (filePath) => createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

async function stats(page) {
  return page.evaluate(async () => {
    const [jit, profile, scheduler] = await Promise.all([
      window.__linuxCtl.jitStats(),
      window.__linuxCtl.profileStats(),
      window.__linuxCtl.schedulerStats(),
    ]);
    return { jit, profile, scheduler };
  });
}

async function runExactNodeProcess(page, sequence) {
  const oracleSpec = createNodeProcessOracleSpec(sequence);
  const collectorFactorySource = createNodeOracleFrameCollector.toString();
  const captured = await page.evaluate(async ({ oracleSpec, collectorFactorySource }) => {
    const collectorFactory = new Function(`return (${collectorFactorySource})`)();
    const collector = collectorFactory(oracleSpec);
    const byteText = (bytes) => {
      let value = "";
      for (let offset = 0; offset < bytes.length; offset += 128) {
        value += String.fromCharCode(...bytes.subarray(offset, offset + 128));
      }
      return value;
    };
    const base64Bytes = (bytes) => btoa(byteText(bytes));
    let firstMs = null;
    const started = performance.now();
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {};
      let timer;
      let settled = false;
      const cleanup = () => {
        unsubscribe();
        clearTimeout(timer);
      };
      const rejectOracle = (reason) => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`E4T38_NODE_ORACLE_INVALID ${oracleSpec.sequence} ${reason}`));
      };
      unsubscribe = window.wvmDemo.onConsole((bytes) => {
        if (settled) return;
        const event = collector.push(bytes);
        if (event.outputCompletedNow && firstMs == null) firstMs = performance.now() - started;
        if (event.status === "invalid") {
          rejectOracle(event.reason);
          return;
        }
        if (event.status === "complete") {
          if (firstMs == null || !Number.isSafeInteger(event.nodePid) || event.nodePid <= 0 ||
              !Number.isSafeInteger(event.exit) || event.exit < 0 || event.exit > 255) {
            rejectOracle("invalid-derived-fields");
            return;
          }
          settled = true;
          cleanup();
          resolve({
            firstMs,
            completeMs: performance.now() - started,
            capturedNodePid: event.nodePid,
            capturedExit: event.exit,
            terminalFrameBase64: base64Bytes(event.frame),
          });
        }
      });
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(
          `E4T38_NODE_PROCESS_TIMEOUT ${oracleSpec.sequence}; rawTailBase64=` +
          base64Bytes(collector.diagnosticTail()),
        ));
      }, 300_000);
      window.wvmDemo.sendInput(new TextEncoder().encode(oracleSpec.shellCommand + "\r"));
    });
  }, { oracleSpec, collectorFactorySource });

  const oracle = createNodeProcessOracleEvidence(
    Buffer.from(captured.terminalFrameBase64, "base64"),
    oracleSpec,
  );
  expect(captured.capturedNodePid).toBe(oracle.nodePid);
  expect(captured.capturedExit).toBe(oracle.exit);
  const { capturedNodePid: _pid, capturedExit: _exit, terminalFrameBase64: _frame, ...timing } = captured;
  const result = { ...timing, ...oracle };
  validateNodeProcessOracleEvidence(result);
  return result;
}

async function runPolicy(browser, policy, passIndex) {
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() === 404 && new URL(response.url()).pathname === "/favicon.ico") {
      return;
    }
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error" || message.text().includes("favicon.ico")) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const url =
      `/?guest=node-alpine&nosw&jit=1&jitThreshold=512&jitResidency=${encodeURIComponent(policy)}` +
      `&profile=1&testHooks=1&diagnosticStats=1&assetBase=${encodeURIComponent(nodeAssetBase)}`;
    await page.goto(url);
    await page.waitForFunction(() => window.wvmDemo?.isGuestReady(), null, { timeout: 180_000 });
    await page.waitForFunction(() => window.__linuxCtl, null, { timeout: 30_000 });
    await page.bringToFront();
    const settled = await page.evaluate(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return window.wvmDemo.exec("true", 30_000, { quiet: true });
    });
    expect(settled.exit).toBe(0);
    expect(await page.evaluate(() => window.__linux?.restoredFromBootSnapshot?.())).toBe(true);
    expect(await page.evaluate(() => document.documentElement.dataset.linuxBackend))
      .toBe("whole-machine-worker");
    expect(await page.evaluate(() => document.documentElement.dataset.jitResidency)).toBe(policy);

    const manifestIdentity = await page.evaluate(async ({ expectedSha256 }) => {
      const base = new URLSearchParams(location.search).get("assetBase");
      const manifestUrl = new URL(
        `${base.replace(/\/+$/, "")}/chunked-node-alpine/manifest.json`,
        location.href,
      );
      const response = await fetch(manifestUrl, { cache: "no-store" });
      if (!response.ok) throw new Error(`Node manifest fetch failed: HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha256 = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const manifest = JSON.parse(new TextDecoder().decode(bytes));
      return {
        sha256,
        expectedSha256,
        version: manifest.version,
        imageLen: manifest.image_len,
        chunkSize: manifest.chunk_size,
        chunkCount: manifest.chunks?.length ?? null,
      };
    }, { expectedSha256: expectedNodeManifestSha256 });
    expect(manifestIdentity.sha256).toBe(expectedNodeManifestSha256);
    expect(manifestIdentity.version).toBe(1);
    expect(manifestIdentity.imageLen).toBe(805_306_368);
    expect(manifestIdentity.chunkSize).toBe(131_072);
    expect(manifestIdentity.chunkCount).toBe(6_144);

    const before = await stats(page);
    expect(before.jit.hasExecutor).toBe(true);
    expect(before.jit.jitResidencyPolicy).toBe(policy);
    const run = await runExactNodeProcess(page, `e4t38_${policy.replaceAll("-", "_")}_${passIndex}`);
    const after = await stats(page);
    expect(run.exit).toBe(0);
    expect(run.outputLine).toBe("3");
    expect(run.nodeCommand).toBe("node -e 'console.log(3)'");

    const jitDelta = {
      submittedMembers: delta(after.jit, before.jit, "jitSubmittedMembers"),
      compilePauseNs: delta(after.jit, before.jit, "jitCompilePauseNs"),
      evictions: delta(after.jit, before.jit, "jitCacheEvictions"),
      retranslations: delta(after.jit, before.jit, "jitCacheRetranslations"),
      executedBlocks: delta(after.jit, before.jit, "executedBlocks"),
      directChainEntries: delta(after.jit, before.jit, "directChainEntries"),
      retiredViaJit: delta(after.jit, before.jit, "retiredViaJit"),
      guestRetired: delta(after.jit, before.jit, "guestRetired"),
    };
    const logicalBlocksPerEngineCall = jitDelta.executedBlocks === 0
      ? 0
      : jitDelta.directChainEntries === 0
        ? 1
        : jitDelta.directChainEntries / jitDelta.executedBlocks;
    const jitRetiredShare = jitDelta.guestRetired === 0
      ? 0
      : jitDelta.retiredViaJit / jitDelta.guestRetired;
    const profileDelta = {
      submittedMembers: delta(after.profile.jitPause, before.profile.jitPause, "totalSubmittedBlocks"),
      compilePauseNs: delta(after.profile.jitPause, before.profile.jitPause, "sumNs"),
    };
    expect(profileDelta.submittedMembers).toBe(jitDelta.submittedMembers);
    expect(profileDelta.compilePauseNs).toBe(jitDelta.compilePauseNs);
    expect(jitDelta.executedBlocks).toBeGreaterThan(0);
    expect(jitDelta.retiredViaJit).toBeGreaterThan(0);
    expect(jitDelta.guestRetired).toBeGreaterThan(0);

    return {
      policy,
      fixture: {
        command: run.nodeCommand,
        oracleSchema: run.oracleSchema,
        outputGrammar: run.outputGrammar,
        outputLine: run.outputLine,
        nodePid: run.nodePid,
        terminalFrame: run.terminalFrame,
      },
      wallTimeMs: run.completeMs,
      firstOutputMs: run.firstMs,
      stretchMs: run.stretchMs,
      residency: {
        policy: after.jit.jitResidencyPolicy,
        liveModules: after.jit.jitCacheBatches,
        cap: after.jit.jitResidencyCap,
        codeBytes: after.jit.jitCacheCodeBytes,
      },
      churn: {
        evictions: jitDelta.evictions,
        retranslations: jitDelta.retranslations,
        submittedMembers: jitDelta.submittedMembers,
        compilePauseNs: jitDelta.compilePauseNs,
        compilePauseSamples: delta(after.jit, before.jit, "jitCompilePauseSamples"),
      },
      execution: {
        engineCalls: jitDelta.executedBlocks,
        logicalBlocksPerEngineCall,
        guestRetired: jitDelta.guestRetired,
        retiredViaJit: jitDelta.retiredViaJit,
        jitRetiredShare,
      },
      snapshots: { before, after, profileDelta },
      manifestIdentity,
      browser: {
        backend: await page.evaluate(() => document.documentElement.dataset.linuxBackend),
        restored: await page.evaluate(() => window.__linux?.restoredFromBootSnapshot?.()),
      },
      errors: [
        ...errors,
        // The demo intentionally has no favicon; the response listener above still makes every
        // non-favicon HTTP failure fatal, so discard only Chromium's generic 404 console echo.
        ...consoleErrors.filter(
          (message) => !(message.includes("Failed to load resource") && message.includes("404")),
        ),
      ],
    };
  } finally {
    await page.close();
  }
}

test.describe("E4-T38 JIT residency policy ledger", () => {
  test.skip(
    !nodeAssetDir,
    "set E4T32_NODE_ASSET_DIR to the exact immutable Node chunk store",
  );

  test("same Node bytes under repack-off, cap-256, and cap-1024", async ({ browser }, testInfo) => {
    test.setTimeout(20 * 60_000);
    const results = [];
    for (const [index, policy] of policies.entries()) {
      results.push(await runPolicy(browser, policy, index));
    }
    expect(results.map((result) => result.policy)).toEqual(policies);
    expect(new Set(results.map((result) => result.fixture.command))).toEqual(
      new Set(["node -e 'console.log(3)'"]),
    );
    expect(results.every((result) => result.browser.backend === "whole-machine-worker")).toBe(true);
    expect(results.every((result) => result.browser.restored)).toBe(true);
    expect(
      results.every((result) => result.errors.length === 0),
      JSON.stringify(results.map(({ policy, errors }) => ({ policy, errors }))),
    ).toBe(true);
    expect(results.map((result) => result.residency.cap)).toEqual([24, 256, 1024]);
    expect(results.every((result) => result.churn.submittedMembers > 0)).toBe(true);
    expect(results.every((result) => result.execution.jitRetiredShare > 0)).toBe(true);

    const evidence = {
      kind: "e4-t38-jit-residency-policy-ledger-v1",
      recordedAt: new Date().toISOString(),
      source: {
        nodeManifestSha256: expectedNodeManifestSha256,
        nodeAssetBase,
        browserTest: "web/tests/e4-t38-residency-policy.spec.js",
      },
      policyOrder: policies,
      results,
      adversarialCoverage: {
        smallestCacheChurn: "wasm-pack test --node crates/wasm --test jit_browser_parity -- --ignored browser_handles_remain_bounded_across_retranslation_churn",
        samePageInvalidation: [
          "browser_inline_static_code_store_cuts_link_before_target_reuse",
          "browser_inline_static_link_unlinks_and_rearms_after_target_reinstall",
        ],
      },
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach("e4-t38-residency-policy-ledger", {
      path: evidencePath,
      contentType: "application/json",
    });
    console.log(`E4T38_RESIDENCY_LEDGER=${JSON.stringify(evidence)}`);
  });
});
