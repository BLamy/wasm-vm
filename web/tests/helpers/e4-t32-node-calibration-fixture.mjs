import {
  E4T32_CPU_CALIBRATION_POLICY,
  E4T32_CPU_KERNEL_SOURCE,
  evaluateCpuCalibrationEvidence,
} from "./e4-t32-node-calibration.mjs";

export function cpuCalibrationFixture({
  label = "fixture",
  clean = true,
  mainMedianMs = clean ? E4T32_CPU_CALIBRATION_POLICY.absolute.mainMedianMs : 492,
  workerMedianMs = clean ? E4T32_CPU_CALIBRATION_POLICY.absolute.workerMedianMs : 496,
} = {}) {
  const checksum = 1_572_596_680;
  const samples = Array.from({ length: E4T32_CPU_CALIBRATION_POLICY.benchmark.pairs }, (_, pair) => {
    const order = pair % 2 === 0 ? ["main", "worker"] : ["worker", "main"];
    return {
      pair,
      order,
      samples: {
        main: { elapsedMs: mainMedianMs, checksum },
        worker: { id: pair + 1, elapsedMs: workerMedianMs, checksum },
      },
      ratio: workerMedianMs / mainMedianMs,
    };
  });
  return evaluateCpuCalibrationEvidence({
    kind: "e4-t32-window-worker-cpu-preflight",
    label,
    timestamp: "2026-08-10T00:00:00.000Z",
    hostCpu: { logicalCpus: 8, meanBusyPct: 0, maxBusyPct: 0, perCoreBusyPct: Array(8).fill(0) },
    result: {
      kernelSource: E4T32_CPU_KERNEL_SOURCE,
      warmupsPerRealm: E4T32_CPU_CALIBRATION_POLICY.benchmark.warmupsPerRealm,
      warmupIterations: E4T32_CPU_CALIBRATION_POLICY.benchmark.warmupIterations,
      pairs: E4T32_CPU_CALIBRATION_POLICY.benchmark.pairs,
      timedIterations: E4T32_CPU_CALIBRATION_POLICY.benchmark.timedIterations,
      warmupChecksums: Array(
        E4T32_CPU_CALIBRATION_POLICY.benchmark.warmupsPerRealm * 2,
      ).fill(checksum),
      mainMedianMs,
      workerMedianMs,
      realmMedianRatio: workerMedianMs / mainMedianMs,
      pairedRatioMedian: workerMedianMs / mainMedianMs,
      checksumsMatch: true,
      samples,
    },
  });
}
