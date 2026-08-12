import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  E4T32_CPU_KERNEL_SOURCE,
  E4T32_CPU_CALIBRATION_POLICY,
  assertCpuCalibrationCompatibility,
  deriveCpuCalibrationReferenceMedians,
  evaluateCpuCalibrationEvidence,
  validateCpuCalibrationPolicy,
  validatePersistedCpuCalibration,
  verifyCpuCalibrationReferenceLedger,
} from "./helpers/e4-t32-node-calibration.mjs";
import { cpuCalibrationFixture } from "./helpers/e4-t32-node-calibration-fixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clone = (value) => structuredClone(value);
const expectCode = (fn, code) => assert.throws(fn, (error) => error?.code === code);

test("live preflight executes and persists the exact immutable kernel/config", () => {
  const source = fs.readFileSync(path.join(repoRoot, "web/tests/e4-t32-node-walltime.spec.js"), "utf8");
  assert.equal(
    createHash("sha256").update(E4T32_CPU_KERNEL_SOURCE).digest("hex"),
    E4T32_CPU_CALIBRATION_POLICY.benchmark.kernelSourceSha256,
  );
  assert.match(source, /page\.evaluate\(async \(\{ kernelSource, benchmark \}\) =>/);
  assert.match(source, /const kernel = \(0, eval\)\(`\(\$\{kernelSource\}\)`\)/);
  assert.match(source, /kernelSource: E4T32_CPU_KERNEL_SOURCE/);
  assert.match(source, /benchmark: E4T32_CPU_CALIBRATION_POLICY\.benchmark/);
});

test("immutable reference ledger verifies physical/logical digests and ordinary medians", () => {
  const bytes = fs.readFileSync(path.join(repoRoot, E4T32_CPU_CALIBRATION_POLICY.reference.repoPath));
  const verified = verifyCpuCalibrationReferenceLedger(bytes);
  assert.equal(verified.physicalSha256, E4T32_CPU_CALIBRATION_POLICY.reference.physicalSha256);
  assert.deepEqual(verified.derived, {
    mainMedianMs: 329.125,
    workerMedianMs: 329.7250000014901,
  });
  const tampered = Buffer.concat([bytes, Buffer.from("\n")]);
  expectCode(() => verifyCpuCalibrationReferenceLedger(tampered), "reference-physical-digest");

  const ledger = JSON.parse(bytes);
  const firstAccepted = ledger.events.find(
    (event) => event.type === "attempt-finished" && event.outcome === "accepted",
  );
  firstAccepted.preCalibration.evidence.result.samples[0].samples.main.elapsedMs += 1;
  expectCode(() => deriveCpuCalibrationReferenceMedians(ledger), "invalid-reference");

  const forgedSummary = JSON.parse(bytes);
  forgedSummary.events.find(
    (event) => event.type === "attempt-finished" && event.outcome === "accepted",
  ).preCalibration.evidence.result.mainMedianMs += 1;
  expectCode(() => deriveCpuCalibrationReferenceMedians(forgedSummary), "invalid-reference");
});

test("both realms are independently admitted at reciprocal absolute boundaries", () => {
  const { absolute } = E4T32_CPU_CALIBRATION_POLICY;
  for (const factor of [absolute.lowerFactor, absolute.upperFactor]) {
    const calibration = cpuCalibrationFixture({
      mainMedianMs: absolute.mainMedianMs * factor,
      workerMedianMs: absolute.workerMedianMs * factor,
    });
    assert.equal(calibration.clean, true);
    assert.equal(calibration.evidence.rule.absolute.main.pass, true);
    assert.equal(calibration.evidence.rule.absolute.worker.pass, true);
  }
  assert.equal(cpuCalibrationFixture({
    mainMedianMs: absolute.mainMedianMs * absolute.lowerFactor - 0.001,
    workerMedianMs: absolute.workerMedianMs,
  }).clean, false);
  assert.equal(cpuCalibrationFixture({
    mainMedianMs: absolute.mainMedianMs,
    workerMedianMs: absolute.workerMedianMs * absolute.upperFactor + 0.001,
  }).clean, false);
});

test("equal slow realms fail absolute capacity even when all relative rules pass", () => {
  for (const [mainMedianMs, workerMedianMs] of [[388.15, 392.25], [491.65, 496.35]]) {
    const calibration = cpuCalibrationFixture({ mainMedianMs, workerMedianMs });
    assert.equal(calibration.evidence.rule.relative.pass, true);
    assert.equal(calibration.evidence.rule.absolute.pass, false);
    assert.equal(calibration.clean, false);
  }
});

test("persisted verdict and summaries are recomputed instead of trusted", () => {
  const forgedClean = cpuCalibrationFixture({ clean: false, label: "forged" });
  forgedClean.clean = true;
  expectCode(
    () => validatePersistedCpuCalibration(forgedClean, E4T32_CPU_CALIBRATION_POLICY),
    "derived-verdict-mismatch",
  );

  const forgedRule = cpuCalibrationFixture({ label: "rule" });
  forgedRule.evidence.rule.absolute.main.actualMedianMs += 1;
  expectCode(
    () => validatePersistedCpuCalibration(forgedRule, E4T32_CPU_CALIBRATION_POLICY),
    "derived-verdict-mismatch",
  );

  const forgedMedian = cpuCalibrationFixture({ label: "median" });
  forgedMedian.evidence.result.mainMedianMs += 1;
  expectCode(
    () => evaluateCpuCalibrationEvidence(forgedMedian.evidence, E4T32_CPU_CALIBRATION_POLICY),
    "invalid-measurement",
  );
});

test("raw warmup, sample order, and policy mutations fail closed", () => {
  const missingWarmup = cpuCalibrationFixture({ label: "warmup" });
  missingWarmup.evidence.result.warmupChecksums.pop();
  expectCode(
    () => evaluateCpuCalibrationEvidence(missingWarmup.evidence, E4T32_CPU_CALIBRATION_POLICY),
    "invalid-measurement",
  );
  const wrongOrder = cpuCalibrationFixture({ label: "order" });
  wrongOrder.evidence.result.samples[0].order.reverse();
  expectCode(
    () => evaluateCpuCalibrationEvidence(wrongOrder.evidence, E4T32_CPU_CALIBRATION_POLICY),
    "invalid-measurement",
  );
  const changedPolicy = clone(E4T32_CPU_CALIBRATION_POLICY);
  changedPolicy.absolute.upperFactor += 0.01;
  expectCode(() => validateCpuCalibrationPolicy(changedPolicy), "invalid-policy");
});

test("reference compatibility is exact and identity-bound", () => {
  const compatible = clone(E4T32_CPU_CALIBRATION_POLICY.reference.compatibility);
  assert.deepEqual(assertCpuCalibrationCompatibility(compatible, E4T32_CPU_CALIBRATION_POLICY), compatible);
  compatible.host.cpuModels = ["Apple M4"];
  expectCode(
    () => assertCpuCalibrationCompatibility(compatible, E4T32_CPU_CALIBRATION_POLICY),
    "incompatible-environment",
  );
});
