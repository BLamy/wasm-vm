// E4-T39: separate the compiled entry-path terms with one exact Node oracle run per control.
// Every tab restores the same immutable Node image and submits the same command; the controls only
// change the compiled-entry policy (interpreter, JIT, JALR-off, or region-off).
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
const expectedNodeManifestSha256 = "ac6a298883c36d170534a679fd976c5681a20f1fa48ef2d587e6bc124e70b1c1";
const evidencePath = path.join(repoRoot, "evidence/e4-t39/entry-cost-ledger-2026-09-03.json");

const controls = [
  { name: "interpreter", query: "jit=0", jit: false, jalr: true, region: true },
  { name: "jit", query: "jit=1&jitThreshold=512", jit: true, jalr: true, region: true },
  { name: "jalr-off", query: "jit=1&jitThreshold=512&jalr=0", jit: true, jalr: false, region: true },
  { name: "region-off", query: "jit=1&jitThreshold=512", jit: true, jalr: true, region: false },
];

const costKeys = [
  "timerReads",
  "hostEntries",
  "stateCopyCalls",
  "stateCopyBytes",
  "stateCopyNs",
  "engineEntryNs",
  "indirectTableDispatches",
  "authorityChecks",
  "memorySplitExits",
  "deviceBoundaries",
  "deviceBoundaryNs",
];

const delta = (after, before, key) => Number(after?.[key] ?? 0) - Number(before?.[key] ?? 0);

function costDelta(after, before) {
  return Object.fromEntries(costKeys.map((key) => [key, delta(after?.entryCost, before?.entryCost, key)]));
}

function sha256Text(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function profileSubsystemNs(profile, name) {
  return Number(profile?.subsystems?.find((entry) => entry.name === name)?.ns ?? 0);
}

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
        reject(new Error(`E4T39_NODE_ORACLE_INVALID ${oracleSpec.sequence} ${reason}`));
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
          `E4T39_NODE_PROCESS_TIMEOUT ${oracleSpec.sequence}; rawTailBase64=` +
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

async function manifestIdentity(page) {
  return page.evaluate(async ({ assetBase, expectedSha256 }) => {
    const url = new URL(
      `${assetBase.replace(/\/+$/, "")}/chunked-node-alpine/manifest.json`,
      location.href,
    );
    const response = await fetch(url, { cache: "no-store" });
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
  }, { assetBase: nodeAssetBase, expectedSha256: expectedNodeManifestSha256 });
}

async function runControl(browser, control, index) {
  const page = await browser.newPage();
  const errors = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.status() === 404 && new URL(response.url()).pathname === "/favicon.ico") return;
    if (response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`);
  });
  page.on("console", (message) => {
    if (message.type() !== "error" || message.text().includes("favicon.ico")) return;
    consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const url = `/?guest=node-alpine&nosw&${control.query}` +
      `&region=${control.region ? 1 : 0}&profile=1&testHooks=1&diagnosticStats=1` +
      `&assetBase=${encodeURIComponent(nodeAssetBase)}`;
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
    expect(await page.evaluate(() => document.documentElement.dataset.jitJalr))
      .toBe(String(control.jalr));
    expect(await page.evaluate(() => document.documentElement.dataset.jitRegion))
      .toBe(String(control.region));

    const manifest = await manifestIdentity(page);
    expect(manifest.sha256).toBe(expectedNodeManifestSha256);
    expect(manifest.version).toBe(1);
    expect(manifest.imageLen).toBe(805_306_368);
    expect(manifest.chunkSize).toBe(131_072);
    expect(manifest.chunkCount).toBe(6_144);

    const before = await stats(page);
    expect(before.jit.hasExecutor).toBe(control.jit);
    const run = await runExactNodeProcess(page, `e4t39_${control.name}_${index}`);
    const after = await stats(page);
    const runtimeDigest = await page.evaluate(() => window.__linuxCtl.stateDigest());
    expect(run.exit).toBe(0);
    expect(run.outputLine).toBe("3");
    expect(run.nodeCommand).toBe("node -e 'console.log(3)'");
    expect(runtimeDigest).toMatch(/^[0-9a-f]{64}$/);

    const entryCost = costDelta(after.jit, before.jit);
    if (control.jit) {
      expect(entryCost.hostEntries).toBeGreaterThan(0);
      expect(entryCost.timerReads).toBeGreaterThan(0);
      expect(entryCost.stateCopyCalls).toBeGreaterThan(0);
      expect(entryCost.stateCopyBytes).toBeGreaterThan(0);
      expect(entryCost.engineEntryNs).toBeGreaterThan(0);
      expect(entryCost.memorySplitExits).toBeGreaterThan(0);
      expect(entryCost.deviceBoundaries).toBeGreaterThan(0);
      if (control.jalr && control.region) {
        expect(entryCost.indirectTableDispatches).toBeGreaterThan(0);
        expect(entryCost.authorityChecks).toBeGreaterThan(0);
      }
    } else {
      expect(entryCost).toEqual(Object.fromEntries(costKeys.map((key) => [key, 0])));
    }
    expect(after.jit.jitDynamicChaining).toBe(control.jit && control.jalr);
    expect(after.jit.jitRegionChaining).toBe(control.jit && control.region);

    const profileDelta = {
      totalNs: delta(after.profile, before.profile, "totalNs"),
      jitPauseNs: delta(after.profile.jitPause, before.profile.jitPause, "sumNs"),
      deviceNs: profileSubsystemNs(after.profile, "device") - profileSubsystemNs(before.profile, "device"),
    };
    const checksum = sha256Text(JSON.stringify({ command: run.nodeCommand, output: run.outputLine, exit: run.exit }));
    return {
      name: control.name,
      controls: { jit: control.jit, jalr: control.jalr, region: control.region },
      checksum,
      fixture: {
        command: run.nodeCommand,
        oracleSchema: run.oracleSchema,
        outputGrammar: run.outputGrammar,
        outputLine: run.outputLine,
        exit: run.exit,
        terminalFrame: run.terminalFrame,
      },
      timers: {
        firstCommandBoundaryMs: run.firstMs,
        wallTimeMs: run.completeMs,
        profileDelta,
      },
      runtimeDigest,
      entryCost,
      execution: {
        engineCalls: delta(after.jit, before.jit, "executedBlocks"),
        guestRetired: delta(after.jit, before.jit, "guestRetired"),
        retiredViaJit: delta(after.jit, before.jit, "retiredViaJit"),
      },
      snapshots: { before, after },
      manifest,
      browser: {
        backend: await page.evaluate(() => document.documentElement.dataset.linuxBackend),
        restored: await page.evaluate(() => window.__linux?.restoredFromBootSnapshot?.()),
      },
      errors: [
        ...errors,
        // Chromium may echo the intentionally ignored favicon 404 as a console error; all other
        // response and page errors remain part of the evidence.
        ...consoleErrors.filter(
          (message) => !(message.includes("Failed to load resource") && message.includes("404")),
        ),
      ],
    };
  } finally {
    await page.close();
  }
}

test.describe("E4-T39 compiled entry-path cost ledger", () => {
  test.skip(
    !nodeAssetDir,
    "set E4T32_NODE_ASSET_DIR to the exact immutable Node chunk store",
  );

  test("same Node checksum under interpreter, JIT, JALR-off, and region-off controls", async ({ browser }, testInfo) => {
    test.setTimeout(20 * 60_000);
    const results = [];
    for (const [index, control] of controls.entries()) {
      results.push(await runControl(browser, control, index));
    }
    expect(results.map((result) => result.name)).toEqual(controls.map((control) => control.name));
    expect(new Set(results.map((result) => result.checksum)).size).toBe(1);
    expect(results.every((result) => result.fixture.outputLine === "3" && result.fixture.exit === 0)).toBe(true);
    expect(results.every((result) => result.browser.backend === "whole-machine-worker")).toBe(true);
    expect(results.every((result) => result.browser.restored)).toBe(true);
    expect(results.every((result) => result.timers.firstCommandBoundaryMs > 0)).toBe(true);
    expect(results.every((result) => result.execution.guestRetired > 0)).toBe(true);
    expect(results.every((result) => result.errors.length === 0), JSON.stringify(
      results.map(({ name, errors }) => ({ name, errors })),
    )).toBe(true);

    const byName = Object.fromEntries(results.map((result) => [result.name, result]));
    const jit = byName.jit.entryCost;
    const jalrOff = byName["jalr-off"].entryCost;
    const regionOff = byName["region-off"].entryCost;
    const interpreter = byName.interpreter.entryCost;
    const termDeltas = [
      {
        term: "state-copy",
        unit: "calls",
        control: "region-off",
        delta: regionOff.stateCopyCalls - jit.stateCopyCalls,
        count: jit.stateCopyCalls,
      },
      {
        term: "indirect-table-dispatch",
        unit: "calls",
        control: "jalr-off",
        delta: jit.indirectTableDispatches - jalrOff.indirectTableDispatches,
        count: jit.indirectTableDispatches,
      },
      {
        term: "authority-check",
        unit: "checks",
        control: "jalr-off",
        delta: jit.authorityChecks - jalrOff.authorityChecks,
        count: jit.authorityChecks,
      },
      {
        term: "memory-split-exit",
        unit: "exits",
        control: "interpreter",
        delta: jit.memorySplitExits - interpreter.memorySplitExits,
        count: jit.memorySplitExits,
      },
      {
        term: "device-boundary",
        unit: "imports",
        control: "interpreter",
        delta: jit.deviceBoundaries - interpreter.deviceBoundaries,
        count: jit.deviceBoundaries,
      },
    ];
    const dominantTerm = termDeltas.reduce((best, current) =>
      current.count > best.count ? current : best,
    );
    expect(dominantTerm.count).toBeGreaterThan(0);
    expect(dominantTerm.delta).not.toBe(0);
    expect(termDeltas.some((term) => term.delta !== 0)).toBe(true);

    const evidence = {
      kind: "e4-t39-compiled-entry-cost-ledger-v1",
      recordedAt: new Date().toISOString(),
      source: {
        nodeManifestSha256: expectedNodeManifestSha256,
        nodeAssetBase,
        browserTest: "web/tests/e4-t39-entry-cost-ledger.spec.js",
      },
      controlOrder: controls.map((control) => control.name),
      checksum: byName.jit.checksum,
      dominantTerm,
      termDeltas,
      results,
      adversarialCoverage: {
        controls: "interpreter, JIT, JALR-off, and region-off use the same restored image and exact Node oracle",
        runtimeDigest: "each result records the final guest-RAM digest and first-command boundary",
        retiredOracle: "each result records the guest-retired delta and exact terminal-frame checksum",
      },
    };
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
    await testInfo.attach("e4-t39-entry-cost-ledger", {
      path: evidencePath,
      contentType: "application/json",
    });
    console.log(`E4T39_ENTRY_COST_LEDGER=${JSON.stringify(evidence)}`);
  });
});
