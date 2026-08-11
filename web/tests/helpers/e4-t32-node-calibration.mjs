import { createHash } from "node:crypto";

const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function canonicalJson(value, label = "value", seen = new Set()) {
  if (value === null) return "null";
  switch (typeof value) {
    case "string":
    case "boolean":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) fail("invalid-json", `${label} contains a non-finite number`);
      return JSON.stringify(value);
    case "object": {
      if (seen.has(value)) fail("invalid-json", `${label} contains a cycle`);
      const prototype = Object.getPrototypeOf(value);
      if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
        fail("invalid-json", `${label} must contain only plain JSON values`);
      }
      seen.add(value);
      const encoded = Array.isArray(value)
        ? `[${value.map((entry, index) => canonicalJson(entry, `${label}[${index}]`, seen)).join(",")}]`
        : `{${Object.keys(value).sort().map((key) => (
          `${JSON.stringify(key)}:${canonicalJson(value[key], `${label}.${key}`, seen)}`
        )).join(",")}}`;
      seen.delete(value);
      return encoded;
    }
    default:
      fail("invalid-json", `${label} contains unsupported ${typeof value}`);
  }
}

const cloneJson = (value, label = "value") => JSON.parse(canonicalJson(value, label));
const sameJson = (left, right) => canonicalJson(left) === canonicalJson(right);

export class NodeCpuCalibrationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "NodeCpuCalibrationError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new NodeCpuCalibrationError(code, message);
}

export const E4T32_CPU_KERNEL_SOURCE = `iterations => {
        let a = 305419896 | 0;
        let b = -1698898192 | 0;
        for (let i = 0; i < iterations; i += 1) {
          a = Math.imul(a ^ (i | 0), 1664525) + 1013904223 | 0;
          b = Math.imul(b + (i | 0), 1103515245) + 12345 | 0;
        }
        return (a ^ b) >>> 0;
      }`;

export const E4T32_CPU_CALIBRATION_POLICY = deepFreeze({
  version: "e4-t32-cpu-capacity-v1",
  benchmark: {
    kernelSourceSha256: "69d4e3eeb23297392e80a721e75e4326dc8f9eb5e0fd4fa9a50164a68183e3eb",
    warmupsPerRealm: 3,
    warmupIterations: 5_000_000,
    pairs: 8,
    timedIterations: 50_000_000,
    order: "alternating-main-first",
  },
  relative: {
    realmRatio: [1 / 1.05, 1.05],
    pairRatio: [1 / 1.10, 1.10],
    requiredPairsWithinBudget: 7,
    minimumMedianMs: 100,
  },
  absolute: {
    lowerFactor: 1 / 1.05,
    upperFactor: 1.05,
    mainMedianMs: 329.125,
    workerMedianMs: 329.7250000014901,
  },
  reference: {
    repoPath: "evidence/e4-t32/node-walltime-aca4484/E4T32_NODE_LEDGER_V2.json",
    evidenceCommit: "ab3e6fc4ee68179a197d9f82d3a124a043d9e27d",
    candidateHead: "aca44846c85ea1e07c9c6d7534203fbab3f3b9f5",
    physicalSha256: "787e44783bfe73a1e716661e8e9da5d6e00715b660504970faaae9838c02d130",
    logicalSha256: "f3e584282ebe150fce9e128b126aa6502e6264334c2ad7653a24fd9ad0d1bea0",
    acceptedAttempts: 6,
    samplesPerRealm: 12,
    compatibility: {
      browser: {
        type: "chromium",
        version: "131.0.6778.33",
        headless: false,
        executable: {
          basename: "Chromium",
          bytes: 187_272,
          sha256: "2828493088a7158f2a82439faf470be6dac85cce38c8745e152970eaee3ec3f8",
        },
      },
      playwright: { version: "1.49.1" },
      runtime: { nodeVersion: "v23.11.0" },
      host: {
        platform: "darwin",
        release: "25.2.0",
        arch: "arm64",
        machine: "arm64",
        logicalCpus: 8,
        cpuModels: ["Apple M2"],
      },
    },
  },
});

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const finitePositive = (value, label) => {
  if (!Number.isFinite(value) || value <= 0) fail("invalid-measurement", `${label} must be positive and finite`);
  return value;
};

const unsignedChecksum = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    fail("invalid-measurement", `${label} must be an unsigned 32-bit integer`);
  }
  return value;
};

export function validateCpuCalibrationPolicy(value) {
  const policy = cloneJson(value, "CPU calibration policy");
  if (!sameJson(policy, E4T32_CPU_CALIBRATION_POLICY)) {
    fail("invalid-policy", "CPU calibration policy must exactly match the immutable E4-T32 policy");
  }
  return policy;
}

export function assertCpuCalibrationCompatibility({ browser, playwright, runtime, host }, policyValue) {
  const policy = validateCpuCalibrationPolicy(policyValue);
  const actual = {
    browser: {
      type: browser?.type,
      version: browser?.version,
      headless: browser?.headless,
      executable: browser?.executable,
    },
    playwright: { version: playwright?.version },
    runtime: { nodeVersion: runtime?.nodeVersion },
    host: {
      platform: host?.platform,
      release: host?.release,
      arch: host?.arch,
      machine: host?.machine,
      logicalCpus: host?.logicalCpus,
      cpuModels: host?.cpuModels,
    },
  };
  if (!sameJson(actual, policy.reference.compatibility)) {
    fail("incompatible-environment", "current browser/runtime/host does not match the capacity reference");
  }
  return cloneJson(actual);
}

function assertReferenceResult(result, policy, label) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    fail("invalid-reference", `${label} has no result object`);
  }
  const benchmark = policy.benchmark;
  if (sha256(String(result.kernelSource)) !== benchmark.kernelSourceSha256 ||
      result.warmupsPerRealm !== benchmark.warmupsPerRealm ||
      result.warmupIterations !== benchmark.warmupIterations ||
      result.pairs !== benchmark.pairs ||
      result.timedIterations !== benchmark.timedIterations) {
    fail("invalid-reference", `${label} benchmark shape differs from the immutable policy`);
  }
  if (!Array.isArray(result.samples) || result.samples.length !== benchmark.pairs) {
    fail("invalid-reference", `${label} does not contain every raw timed pair`);
  }
  const main = [];
  const worker = [];
  const ratios = [];
  const checksums = [];
  for (let index = 0; index < result.samples.length; index += 1) {
    const sample = result.samples[index];
    const expectedOrder = index % 2 === 0 ? ["main", "worker"] : ["worker", "main"];
    if (sample?.pair !== index || !sameJson(sample?.order, expectedOrder)) {
      fail("invalid-reference", `${label} pair ${index} order/index mismatch`);
    }
    const mainMs = finitePositive(sample.samples?.main?.elapsedMs, `${label}.samples[${index}].main`);
    const workerMs = finitePositive(sample.samples?.worker?.elapsedMs, `${label}.samples[${index}].worker`);
    main.push(mainMs);
    worker.push(workerMs);
    checksums.push(
      unsignedChecksum(sample.samples?.main?.checksum, `${label}.samples[${index}].main.checksum`),
      unsignedChecksum(sample.samples?.worker?.checksum, `${label}.samples[${index}].worker.checksum`),
    );
    const ratio = workerMs / mainMs;
    if (sample.ratio !== ratio) fail("invalid-reference", `${label} pair ${index} ratio mismatch`);
    ratios.push(ratio);
  }
  const derived = {
    main: median(main),
    worker: median(worker),
    realmRatio: median(worker) / median(main),
    pairedRatio: median(ratios),
    checksumsMatch: new Set(checksums).size === 1,
  };
  if (result.mainMedianMs !== derived.main || result.workerMedianMs !== derived.worker ||
      result.realmMedianRatio !== derived.realmRatio ||
      result.pairedRatioMedian !== derived.pairedRatio ||
      result.checksumsMatch !== derived.checksumsMatch) {
    fail("invalid-reference", `${label} reported summary differs from raw timed pairs`);
  }
  return derived;
}

export function deriveCpuCalibrationReferenceMedians(
  ledgerValue,
  policyValue = E4T32_CPU_CALIBRATION_POLICY,
) {
  const policy = validateCpuCalibrationPolicy(policyValue);
  const ledger = cloneJson(ledgerValue, "capacity reference ledger");
  const accepted = ledger.events?.filter(
    (event) => event?.type === "attempt-finished" && event.outcome === "accepted",
  ) ?? [];
  if (accepted.length !== policy.reference.acceptedAttempts) {
    fail("invalid-reference", "capacity reference accepted-attempt count mismatch");
  }
  const main = [];
  const worker = [];
  for (const event of accepted) {
    for (const phase of ["preCalibration", "postCalibration"]) {
      const result = assertReferenceResult(event[phase]?.evidence?.result, policy, `${event.attemptId}.${phase}`);
      main.push(result.main);
      worker.push(result.worker);
    }
  }
  if (main.length !== policy.reference.samplesPerRealm || worker.length !== policy.reference.samplesPerRealm) {
    fail("invalid-reference", "capacity reference sample count mismatch");
  }
  const derived = { mainMedianMs: median(main), workerMedianMs: median(worker) };
  if (derived.mainMedianMs !== policy.absolute.mainMedianMs ||
      derived.workerMedianMs !== policy.absolute.workerMedianMs) {
    fail("invalid-reference", "capacity reference derived medians mismatch");
  }
  return derived;
}

export function verifyCpuCalibrationReferenceLedger(rawBytes, policyValue = E4T32_CPU_CALIBRATION_POLICY) {
  const policy = validateCpuCalibrationPolicy(policyValue);
  const bytes = typeof rawBytes === "string" ? Buffer.from(rawBytes) : Buffer.from(rawBytes);
  if (sha256(bytes) !== policy.reference.physicalSha256) {
    fail("reference-physical-digest", "capacity reference ledger physical SHA-256 mismatch");
  }
  let ledger;
  try {
    ledger = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    fail("invalid-reference", `capacity reference ledger is invalid JSON: ${error.message}`);
  }
  if (sha256(Buffer.from(canonicalJson(ledger))) !== policy.reference.logicalSha256) {
    fail("reference-logical-digest", "capacity reference ledger logical SHA-256 mismatch");
  }
  if (ledger.identity?.candidate?.head !== policy.reference.candidateHead) {
    fail("invalid-reference", "capacity reference ledger candidate head mismatch");
  }
  assertCpuCalibrationCompatibility({
    browser: ledger.identity?.harness?.browser,
    playwright: ledger.identity?.harness?.playwright,
    runtime: ledger.identity?.harness?.runtime,
    host: ledger.identity?.host,
  }, policy);
  const oldPreflight = ledger.identity?.policy?.preflight;
  const benchmark = policy.benchmark;
  for (const field of ["warmupsPerRealm", "warmupIterations", "pairs", "timedIterations"]) {
    if (oldPreflight?.[field] !== benchmark[field]) {
      fail("invalid-reference", `capacity reference policy ${field} mismatch`);
    }
  }
  const derived = deriveCpuCalibrationReferenceMedians(ledger, policy);
  return {
    ...cloneJson(policy.reference),
    derived,
  };
}

function recomputeResult(resultValue, policy) {
  const result = cloneJson(resultValue, "CPU calibration result");
  const benchmark = policy.benchmark;
  if (sha256(String(result.kernelSource)) !== benchmark.kernelSourceSha256) {
    fail("invalid-measurement", "CPU calibration kernel source mismatch");
  }
  for (const field of ["warmupsPerRealm", "warmupIterations", "pairs", "timedIterations"]) {
    if (result[field] !== benchmark[field]) {
      fail("invalid-measurement", `CPU calibration ${field} must equal ${benchmark[field]}`);
    }
  }
  if (!Array.isArray(result.warmupChecksums) ||
      result.warmupChecksums.length !== benchmark.warmupsPerRealm * 2) {
    fail("invalid-measurement", "CPU calibration must persist every warmup checksum");
  }
  result.warmupChecksums.forEach((value, index) => unsignedChecksum(value, `warmupChecksums[${index}]`));
  if (!Array.isArray(result.samples) || result.samples.length !== benchmark.pairs) {
    fail("invalid-measurement", `CPU calibration requires exactly ${benchmark.pairs} timed pairs`);
  }
  const mainElapsed = [];
  const workerElapsed = [];
  const timedChecksums = [];
  const ratios = [];
  for (let index = 0; index < result.samples.length; index += 1) {
    const sample = result.samples[index];
    const expectedOrder = index % 2 === 0 ? ["main", "worker"] : ["worker", "main"];
    if (sample?.pair !== index || !sameJson(sample?.order, expectedOrder)) {
      fail("invalid-measurement", `CPU calibration pair ${index} order/index mismatch`);
    }
    const mainSample = sample.samples?.main;
    const workerSample = sample.samples?.worker;
    const mainMs = finitePositive(mainSample?.elapsedMs, `samples[${index}].main.elapsedMs`);
    const workerMs = finitePositive(workerSample?.elapsedMs, `samples[${index}].worker.elapsedMs`);
    mainElapsed.push(mainMs);
    workerElapsed.push(workerMs);
    timedChecksums.push(
      unsignedChecksum(mainSample?.checksum, `samples[${index}].main.checksum`),
      unsignedChecksum(workerSample?.checksum, `samples[${index}].worker.checksum`),
    );
    const ratio = workerMs / mainMs;
    if (sample.ratio !== ratio) fail("invalid-measurement", `CPU calibration pair ${index} ratio mismatch`);
    ratios.push(ratio);
  }
  const summary = {
    mainMedianMs: median(mainElapsed),
    workerMedianMs: median(workerElapsed),
  };
  summary.realmMedianRatio = summary.workerMedianMs / summary.mainMedianMs;
  summary.pairedRatioMedian = median(ratios);
  summary.checksumsMatch = new Set(result.warmupChecksums).size === 1 &&
    new Set(timedChecksums).size === 1;
  for (const field of [
    "mainMedianMs",
    "workerMedianMs",
    "realmMedianRatio",
    "pairedRatioMedian",
    "checksumsMatch",
  ]) {
    if (result[field] !== summary[field]) {
      fail("invalid-measurement", `CPU calibration reported ${field} does not match raw samples`);
    }
  }
  return { result, ratios, summary };
}

export function evaluateCpuCalibrationEvidence(evidenceValue, policyValue = E4T32_CPU_CALIBRATION_POLICY) {
  const policy = validateCpuCalibrationPolicy(policyValue);
  const evidence = cloneJson(evidenceValue, "CPU calibration evidence");
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    fail("invalid-measurement", "CPU calibration evidence must be an object");
  }
  const persistedRule = evidence.rule;
  const persistedReference = evidence.reference;
  delete evidence.rule;
  delete evidence.reference;
  const { result, ratios, summary } = recomputeResult(evidence.result, policy);
  evidence.result = result;
  const relative = policy.relative;
  const absolute = policy.absolute;
  const pairsWithinBudget = ratios.filter(
    (ratio) => ratio >= relative.pairRatio[0] && ratio <= relative.pairRatio[1],
  ).length;
  const mainRatio = summary.mainMedianMs / absolute.mainMedianMs;
  const workerRatio = summary.workerMedianMs / absolute.workerMedianMs;
  const mainInBand = mainRatio >= absolute.lowerFactor && mainRatio <= absolute.upperFactor;
  const workerInBand = workerRatio >= absolute.lowerFactor && workerRatio <= absolute.upperFactor;
  const relativePass = summary.checksumsMatch &&
    summary.mainMedianMs >= relative.minimumMedianMs &&
    summary.workerMedianMs >= relative.minimumMedianMs &&
    summary.realmMedianRatio >= relative.realmRatio[0] &&
    summary.realmMedianRatio <= relative.realmRatio[1] &&
    summary.pairedRatioMedian >= relative.realmRatio[0] &&
    summary.pairedRatioMedian <= relative.realmRatio[1] &&
    pairsWithinBudget >= relative.requiredPairsWithinBudget;
  const absolutePass = mainInBand && workerInBand;
  const rule = {
    policyVersion: policy.version,
    relative: {
      ...cloneJson(relative),
      pairsWithinBudget,
      pass: relativePass,
    },
    absolute: {
      lowerFactor: absolute.lowerFactor,
      upperFactor: absolute.upperFactor,
      main: {
        referenceMedianMs: absolute.mainMedianMs,
        lowerMs: absolute.mainMedianMs * absolute.lowerFactor,
        upperMs: absolute.mainMedianMs * absolute.upperFactor,
        actualMedianMs: summary.mainMedianMs,
        ratio: mainRatio,
        pass: mainInBand,
      },
      worker: {
        referenceMedianMs: absolute.workerMedianMs,
        lowerMs: absolute.workerMedianMs * absolute.lowerFactor,
        upperMs: absolute.workerMedianMs * absolute.upperFactor,
        actualMedianMs: summary.workerMedianMs,
        ratio: workerRatio,
        pass: workerInBand,
      },
      pass: absolutePass,
    },
    pass: relativePass && absolutePass,
  };
  const reference = cloneJson(policy.reference);
  if (persistedRule !== undefined && !sameJson(persistedRule, rule)) {
    fail("derived-verdict-mismatch", "persisted CPU calibration rule differs from raw evidence");
  }
  if (persistedReference !== undefined && !sameJson(persistedReference, reference)) {
    fail("reference-mismatch", "persisted CPU calibration reference differs from identity policy");
  }
  return {
    clean: rule.pass,
    evidence: { ...evidence, reference, rule },
  };
}

export function validatePersistedCpuCalibration(
  calibrationValue,
  policyValue,
  { optional = false, label = "CPU calibration" } = {},
) {
  if (calibrationValue === null && optional) return null;
  if (!calibrationValue || typeof calibrationValue !== "object" || Array.isArray(calibrationValue)) {
    fail("invalid-calibration", `${label} must be an object`);
  }
  const calibration = cloneJson(calibrationValue, label);
  const evaluated = evaluateCpuCalibrationEvidence(calibration.evidence, policyValue);
  if (calibration.clean !== evaluated.clean) {
    fail("derived-verdict-mismatch", `${label}.clean differs from raw evidence`);
  }
  if (!sameJson(calibration, evaluated)) {
    fail("derived-verdict-mismatch", `${label} contains noncanonical or unverified fields`);
  }
  return evaluated;
}
