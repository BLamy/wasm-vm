#!/usr/bin/env node
/** Reproducible native-host baseline for the homepage runtime table. */
import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import process from "node:process";

const outputArg = process.argv.indexOf("--output");
const output = outputArg >= 0 ? process.argv[outputArg + 1] : "web/benchmarks.json";
const measurements = Object.fromEntries(
  process.argv.slice(2).filter((arg) => arg.startsWith("--measure=")).map((arg) => {
    const [runtime, value] = arg.slice("--measure=".length).split("=");
    return [runtime, Number(value)];
  }),
);
const iterations = Number(process.env.NODE_BENCH_ITERATIONS || 100_000_000);
const samples = Number(process.env.NODE_BENCH_SAMPLES || 5);
const warmups = Number(process.env.NODE_BENCH_WARMUPS || 2);

function runOnce() {
  const started = performance.now();
  let value = 0;
  for (let i = 0; i < iterations; i += 1) value = (value + i) | 0;
  return { elapsed: performance.now() - started, value };
}

for (let i = 0; i < warmups; i += 1) runOnce();
const timings = Array.from({ length: samples }, () => runOnce().elapsed);
const sorted = [...timings].sort((a, b) => a - b);
const medianMs = sorted[Math.floor(sorted.length / 2)];
const result = {
  runtime: "native-host-node",
  version: process.version,
  arch: process.arch,
  iterations,
  samplesMs: timings,
  medianMs,
  throughputMops: iterations / medianMs / 1000,
  status: "measured",
};

const data = JSON.parse(await readFile(output, "utf8"));
data.updatedAt = new Date().toISOString();
data.fixture.iterations = iterations;
data.native = {
  ...data.native,
  ...result,
  relativeToNative: 1,
  label: data.native?.label || "Native host Node",
  note: "Baseline for every relative number on this machine.",
};
for (const runtime of data.runtimes || []) {
  if (Number.isFinite(measurements[runtime.runtime])) {
    runtime.medianMs = measurements[runtime.runtime];
    runtime.status = "measured";
  }
  if (runtime.status === "measured" && Number.isFinite(runtime.medianMs)) {
    runtime.relativeToNative = runtime.medianMs / medianMs;
    runtime.throughputMops = iterations / runtime.medianMs / 1000;
  }
}
await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
console.log(JSON.stringify(result));
