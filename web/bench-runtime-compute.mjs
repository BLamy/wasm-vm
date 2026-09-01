#!/usr/bin/env node
/**
 * Portable steady-state Node compute benchmark.
 *
 * This is intentionally a separate campaign from bench-runtime-workloads.mjs.
 * The system suite measures startup, filesystem, streams, and networking. This
 * suite keeps one Node process alive and times only deterministic compute loops
 * so translation and dispatch can amortize over a useful amount of guest work.
 * Allocation and typed-array reset are outside the timed memory loop. Every
 * warmup and measured sample checks a fixed checksum; the published result is
 * therefore not a timing-only claim.
 */

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";

export const BENCHMARK_SCHEMA = 1;
export const BENCHMARK_KIND = "node-steady-state-compute-benchmark-v1";
export const FIXTURE_ID = "runtime-compute-v1";

const DEFAULTS = Object.freeze({
  samples: 7,
  warmups: 2,
  environment: "unknown-node",
  only: null,
});

const ITERATIONS = 1_000_000;
const MEMORY_WORDS = 16_384;
const MEMORY_PASSES = 32;

const EXPECTED_CHECKSUMS = Object.freeze({
  "integer-mix": 1_986_867_034,
  "branch-mix": 2_619_934_272,
  "memory-mix": 2_070_041_300,
});

const WORKLOAD_INFO = Object.freeze([
  {
    id: "integer-mix",
    label: "Integer mix",
    operation: "dependency-heavy Math.imul + 32-bit arithmetic loop",
    workUnits: ITERATIONS,
    unitLabel: "loop iterations",
  },
  {
    id: "branch-mix",
    label: "Branch mix",
    operation: "deterministic data-dependent branches + rotates",
    workUnits: ITERATIONS,
    unitLabel: "loop iterations",
  },
  {
    id: "memory-mix",
    label: "Memory mix",
    operation: "Uint32Array indexed read/modify/write loop",
    workUnits: MEMORY_WORDS * MEMORY_PASSES,
    unitLabel: "typed-array updates",
  },
]);

function round(value) {
  return Number(value.toFixed(3));
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(sortedValues.length * percentileValue) - 1),
  );
  return sortedValues[index];
}

function summarize(samples, workUnits) {
  const elapsed = samples.map((sample) => sample.elapsedMs).sort((a, b) => a - b);
  const total = elapsed.reduce((sum, value) => sum + value, 0);
  const mean = total / elapsed.length;
  const variance =
    elapsed.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    elapsed.length;
  const medianMs = percentile(elapsed, 0.5);

  return {
    sampleCount: elapsed.length,
    minMs: elapsed[0],
    maxMs: elapsed[elapsed.length - 1],
    meanMs: round(mean),
    medianMs,
    p95Ms: percentile(elapsed, 0.95),
    stdevMs: round(Math.sqrt(variance)),
    workUnits,
    workUnitsPerSec:
      medianMs > 0 ? round(workUnits / (medianMs / 1000)) : null,
  };
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer, received ${value}`);
  }
  return parsed;
}

function parseArguments(argv) {
  const options = { ...DEFAULTS };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }

    const separator = argument.indexOf("=");
    const key = separator === -1 ? argument.slice(2) : argument.slice(2, separator);
    const value = separator === -1 ? argv[++index] : argument.slice(separator + 1);
    if (value === undefined || value === "") {
      throw new Error(`missing value for --${key}`);
    }

    switch (key) {
      case "environment":
        options.environment = value;
        break;
      case "samples":
        options.samples = parsePositiveInteger(value, "--samples");
        break;
      case "warmups":
        options.warmups = parsePositiveInteger(value, "--warmups");
        break;
      case "only":
        options.only = value.split(",").map((item) => item.trim()).filter(Boolean);
        break;
      case "output":
        options.output = value;
        break;
      default:
        throw new Error(`unknown option: --${key}`);
    }
  }

  return options;
}

function helpText() {
  return `Usage: node web/bench-runtime-compute.mjs [options]

Runs the portable steady-state Node compute suite and writes detailed JSON.
The process is started before timing; each timed sample is only the compute loop.

Options:
  --environment=ID       Environment label stored in the result (default: ${DEFAULTS.environment})
  --samples=N            Measured samples per workload (default: ${DEFAULTS.samples})
  --warmups=N            Warmup samples per workload (default: ${DEFAULTS.warmups})
  --only=ID,ID           Run a subset of workload IDs
  --output=PATH          Write JSON to PATH; otherwise print the full JSON
  --help                 Show this help

Workloads: ${WORKLOAD_INFO.map((workload) => workload.id).join(", ")}
`;
}

function integerMix() {
  let a = 0x13579bdf >>> 0;
  let b = 0x2468ace0 >>> 0;
  let c = 0x9e3779b9 >>> 0;
  for (let index = 0; index < ITERATIONS; index += 1) {
    a = (Math.imul(a ^ index, 1_664_525) + 1_013_904_223) >>> 0;
    b = (Math.imul(b ^ (a >>> 13), 1_103_515_245) + c) >>> 0;
    c = (c + ((a ^ b) >>> ((index & 15) + 1))) >>> 0;
  }
  return (a ^ b ^ c) >>> 0;
}

function branchMix() {
  let state = 0x12345678 >>> 0;
  let score = 0x9e3779b9 >>> 0;
  for (let index = 0; index < ITERATIONS; index += 1) {
    state = Math.imul(state ^ index, 747_796_405) >>> 0;
    const shift = (index & 15) + 1;
    const rotated = (state >>> shift) | (state << (32 - shift));
    if ((state & 0x80000000) !== 0) {
      score = (score + (rotated ^ index)) >>> 0;
    } else {
      score = (score ^ (rotated + 0x7f4a7c15)) >>> 0;
    }
    if ((state & 7) === 0) {
      state = (state ^ (score >>> 3)) >>> 0;
    }
  }
  return (state ^ score) >>> 0;
}

function resetMemory(words) {
  for (let index = 0; index < words.length; index += 1) {
    words[index] = Math.imul(index, 0x9e3779b9) >>> 0;
  }
}

function memoryMix(words) {
  let checksum = 0;
  const mask = words.length - 1;
  for (let pass = 0; pass < MEMORY_PASSES; pass += 1) {
    for (let index = 0; index < words.length; index += 1) {
      const target = (index * 13 + pass * 7) & mask;
      const neighbor = words[(target + 1) & mask];
      const next =
        (words[target] + Math.imul(target ^ pass, 0x9e3779b9)) >>> 0;
      words[target] = (next ^ (neighbor >>> 1)) >>> 0;
      checksum = (checksum + words[target]) >>> 0;
    }
  }
  return (checksum ^ words[0] ^ words[mask]) >>> 0;
}

function createWorkloads() {
  const words = new Uint32Array(MEMORY_WORDS);
  return [
    {
      ...WORKLOAD_INFO[0],
      expectedChecksum: EXPECTED_CHECKSUMS[WORKLOAD_INFO[0].id],
      run: integerMix,
    },
    {
      ...WORKLOAD_INFO[1],
      expectedChecksum: EXPECTED_CHECKSUMS[WORKLOAD_INFO[1].id],
      run: branchMix,
    },
    {
      ...WORKLOAD_INFO[2],
      expectedChecksum: EXPECTED_CHECKSUMS[WORKLOAD_INFO[2].id],
      prepare: () => resetMemory(words),
      run: () => memoryMix(words),
    },
  ];
}

async function environmentMetadata(environment) {
  const cpus = typeof os.cpus === "function" ? os.cpus() : [];
  return {
    id: environment,
    nodeVersion: process.version ?? null,
    versions: process.versions ?? {},
    platform: process.platform ?? null,
    arch: process.arch ?? null,
    osRelease: typeof os.release === "function" ? os.release() : null,
    execPath: process.execPath ?? null,
    logicalCpus: cpus.length || null,
  };
}

async function sha256File(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export async function runBenchmark(rawOptions = {}) {
  const options = { ...DEFAULTS, ...rawOptions };
  const selectedIds = options.only ? new Set(options.only) : null;
  const unknownIds = selectedIds
    ? [...selectedIds].filter((id) => !WORKLOAD_INFO.some((workload) => workload.id === id))
    : [];
  if (unknownIds.length > 0) {
    throw new Error(`unknown workload ID(s): ${unknownIds.join(", ")}`);
  }

  const scriptPath = fileURLToPath(import.meta.url);
  const scriptSha256 = await sha256File(scriptPath);
  const startedAt = new Date().toISOString();
  const results = [];

  for (const workload of createWorkloads()) {
    if (selectedIds && !selectedIds.has(workload.id)) continue;
    const samples = [];
    for (let index = 0; index < options.warmups + options.samples; index += 1) {
      workload.prepare?.();
      const started = performance.now();
      const checksum = workload.run();
      const elapsedMs = round(performance.now() - started);
      if (checksum !== workload.expectedChecksum) {
        throw new Error(
          `${workload.id}: checksum mismatch, expected ${workload.expectedChecksum}, received ${checksum}`,
        );
      }
      if (index >= options.warmups) {
        samples.push({
          sample: index - options.warmups,
          elapsedMs,
          checksum,
          workUnits: workload.workUnits,
          verification: "passed",
        });
      }
    }
    results.push({
      id: workload.id,
      label: workload.label,
      operation: workload.operation,
      unitLabel: workload.unitLabel,
      workloadClass: "steady-state-compute",
      timedRegion: "compute loop only; process startup and memory preparation excluded",
      status: "measured",
      expectedChecksum: workload.expectedChecksum,
      samples,
      summary: summarize(samples, workload.workUnits),
      verification: {
        sampleCount: samples.length,
        passed: samples.every((sample) => sample.verification === "passed"),
      },
    });
  }

  return {
    schema: BENCHMARK_SCHEMA,
    kind: BENCHMARK_KIND,
    status: "measured",
    generatedAt: startedAt,
    environment: await environmentMetadata(options.environment),
    runner: {
      source: "web/bench-runtime-compute.mjs",
      scriptSha256,
      command: ["node", "web/bench-runtime-compute.mjs", ...process.argv.slice(2)],
    },
    fixture: {
      id: FIXTURE_ID,
      iterations: ITERATIONS,
      memoryWords: MEMORY_WORDS,
      memoryPasses: MEMORY_PASSES,
      expectedChecksums: EXPECTED_CHECKSUMS,
    },
    policy: {
      samples: options.samples,
      warmups: options.warmups,
      timedRegion: "steady-state loop only; one long-lived process per run",
    },
    workloads: results,
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await runBenchmark(options);
  const serialized = `${JSON.stringify(result, null, 2)}\n`;
  if (options.output) {
    const output = path.resolve(options.output);
    await writeFile(output, serialized);
    const summary = {
      schema: result.schema,
      kind: result.kind,
      status: result.status,
      environment: result.environment,
      fixture: result.fixture,
      workloads: result.workloads.map((workload) => ({
        id: workload.id,
        status: workload.status,
        summary: workload.summary,
        verification: workload.verification,
      })),
      output,
    };
    process.stdout.write(`COMPUTE_BENCHMARK_RESULT=${JSON.stringify(summary)}\n`);
  } else {
    process.stdout.write(serialized);
  }
}

const invokedDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}
