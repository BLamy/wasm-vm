#!/usr/bin/env node
// Synthetic harness tests only. wireFixture never boots a guest, drives a browser, or writes evidence.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { EXPECTED, boundReference, uniqueAssets, validateBaseline, validateBuiltReport, validateNativeEvidence, validatePreparation } from "./omarchy-thread-measurement.mjs";
import { instance, wireFixture } from "./omarchy-thread-wire-fixture.mjs";

const expectedCandidate = Object.freeze({
  candidateSha256: EXPECTED.candidateSha256,
  chunkManifestSha256: "a".repeat(64),
  snapshotSha256: "b".repeat(64),
  deltaSha256: "d".repeat(64),
  pid: instance.pid,
  instance: instance.instance,
});

function builtReport(overrides = {}) {
  const fixture = wireFixture();
  fixture.report.candidate = {
    localOnly: true,
    source: {
      kind: "local-only-candidate",
      chunkManifest: { sha256: expectedCandidate.chunkManifestSha256 },
      kernel: { sha256: EXPECTED.kernelSha256 },
      bootSnapshot: { sha256: expectedCandidate.snapshotSha256 },
      overlayDelta: { sha256: expectedCandidate.deltaSha256 },
      image: { imageLen: EXPECTED.imageSize, chunkSize: EXPECTED.chunkSize, chunkCount: EXPECTED.chunkCount },
    },
    manifest: {
      artifacts: {
        kernel: { sha256: EXPECTED.kernelSha256 },
        bootSnapshot: { sha256: expectedCandidate.snapshotSha256 },
        overlayDelta: { sha256: expectedCandidate.deltaSha256 },
      },
      chunkedImage: { sha256: expectedCandidate.chunkManifestSha256 },
    },
  };
  return { ...fixture.report, ...overrides };
}

test("actual preparation receipt validates", async () => {
  const receipt = JSON.parse(await fs.readFile("evidence/omarchy-profile/thread-r1/preparation-receipt.json", "utf8"));
  assert.equal(validatePreparation(receipt), receipt);
});

test("held LP1 baseline validates at its frozen digest", async () => {
  await validateBaseline({
    lpNumThreads: "1",
    inputDeadlineMs: EXPECTED.inputDeadlineMs,
    reportPath: "evidence/omarchy-profile/softpipe-r1/baseline-built-r2/report.json",
    reportSha256: "88496d6e239c36348e72d3c62a41c66b342071c3a4c08c81a8586de69e63ccc7",
  });
});

test("synthetic wire fixture classifies negative input without claiming a product fix", () => {
  const result = validateBuiltReport(builtReport(), expectedCandidate);
  assert.deepEqual(result, { outcome: "measured-negative-input", taskGate: false, keyboardVerified: false });
});

test("seals deduplicate immutable chunks but reject conflicting/reference identities", () => {
  const record = { path: 'target/test-chunk', sha256: 'a'.repeat(64), size: 16 };
  assert.deepEqual(uniqueAssets([record, { ...record, role: 'loaded-resource' }]), [record]);
  assert.throws(() => uniqueAssets([record, { ...record, sha256: 'b'.repeat(64) }]), /SHA-256 mismatch/);
  assert.equal(boundReference([record], record), record);
  assert.throws(() => boundReference([record], { ...record, size: 32 }), /size mismatch/);
  assert.throws(() => boundReference([record], { ...record, path: 'unsealed' }), /not sealed/);
});

test("the actual incomplete LP0 native capture remains unproven", async () => {
  const serial = await fs.readFile('evidence/omarchy-profile/thread-r1/native-serial.log', 'utf8');
  const log = await fs.readFile('evidence/omarchy-profile/thread-r1/native-capture.log', 'utf8');
  assert.throws(() => validateNativeEvidence({ serial, log }), /incomplete probe capture_52/);
});

test("native synthetic fixture is not promoted without host renderer binding", () => {
  assert.throws(() => validateNativeEvidence({ serial: "", log: "OMARCHY_DESKTOP_OBSERVATION {}\nOMARCHY_RENDERER_OBSERVATION {}" }),
    /no completed probes/u);
});

test("rejects incomplete trusted DOM sequence", () => {
  const report = builtReport();
  report.inputEvents = report.inputEvents.slice(0, -1);
  assert.throws(() => validateBuiltReport(report, expectedCandidate), /DOM keyboard event count/u);
});

test("rejects wrong evdev worker arguments", () => {
  const report = builtReport();
  const call = report.workerTraffic.find((row) => row.type === "worker-call" && row.method === "sendKeyboardEvent");
  call.args = [1, 999, 1];
  assert.throws(() => validateBuiltReport(report, expectedCandidate), /evdev arguments/u);
});

test("rejects reused nonce filename", () => {
  const report = builtReport();
  report.keyboard.guestFile = `/tmp/desktop-keys-${report.keyboard.nonce}`;
  assert.throws(() => validateBuiltReport(report, expectedCandidate), /reuses the typed nonce/u);
});

test("rejects blank GL log claimed as active-renderer validation", () => {
  const report = builtReport();
  report.observations.find((row) => row.renderer).renderer.activeRendererValidated = true;
  assert.throws(() => validateBuiltReport(report, expectedCandidate), /blank log cannot identify/u);
});

test("rejects changed renderer PID", () => {
  const report = builtReport();
  report.observations.find((row) => row.renderer).renderer.instance = { ...instance, pid: 999 };
  assert.throws(() => validateBuiltReport(report, expectedCandidate), /stale or unbound/u);
});

test("rejects readback deadline that is not bound to the recorded timer", () => {
  const report = builtReport();
  report.keyboard.deadlineAt = new Date(Date.parse(report.keyboard.readbackStartedAt) + 119999).toISOString();
  assert.throws(() => validateBuiltReport(report, expectedCandidate), /deadline is not bound/u);
});
