#!/usr/bin/env node
/**
 * Merge raw captures from bench-runtime-workloads.mjs into the public comparison.
 *
 * This command never synthesizes timings. Every measured environment is copied
 * from a raw JSON capture, while unavailable adapters are represented explicitly
 * with a reason supplied by the operator.
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const SCHEMA = 1;
const KIND = "node-system-workload-comparison-v1";
const REQUIRED_WORKLOAD_IDS = [
  "file-read",
  "file-write",
  "stream-read",
  "stream-copy",
  "server-lifecycle",
  "http-roundtrip",
];

function usage() {
  return `Usage: node tools/merge-runtime-benchmarks.mjs --output=PATH [options]

Options:
  --input=ID=PATH       Add a measured JSON capture. Repeat for each environment.
  --not-run=ID=REASON   Add an explicit unavailable environment. Repeat as needed.
  --output=PATH         Write the public comparison JSON to PATH.
  --help                Show this help.
`;
}

function splitAssignment(value, flag) {
  const separator = value.indexOf("=");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`${flag} expects ID=VALUE, received ${value}`);
  }
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseArguments(argv) {
  const inputs = [];
  const notRun = [];
  let output;
  for (const argument of argv) {
    if (argument === "--help" || argument === "-h") return { help: true };
    if (argument.startsWith("--input=")) {
      const [id, source] = splitAssignment(argument.slice("--input=".length), "--input");
      inputs.push({ id, source });
    } else if (argument.startsWith("--not-run=")) {
      const [id, reason] = splitAssignment(argument.slice("--not-run=".length), "--not-run");
      notRun.push({ id, reason });
    } else if (argument.startsWith("--output=")) {
      output = argument.slice("--output=".length);
      if (!output) throw new Error("--output needs a path");
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (!output) throw new Error("--output is required");
  if (inputs.length === 0) throw new Error("at least one --input is required");
  return { inputs, notRun, output };
}

function sameJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateCapture(capture, id) {
  if (capture?.schema !== SCHEMA || capture.kind !== "node-system-workload-benchmark-v1") {
    throw new Error(`${id}: capture schema or kind is invalid`);
  }
  if (capture.status !== "measured") throw new Error(`${id}: capture is not fully measured`);
  if (capture.environment?.id !== id) {
    throw new Error(`${id}: capture environment ID is ${capture.environment?.id ?? "missing"}`);
  }
  if (!Array.isArray(capture.workloads) || !sameJson(capture.workloads.map((item) => item.id), REQUIRED_WORKLOAD_IDS)) {
    throw new Error(`${id}: workload IDs/order do not match the canonical suite`);
  }
  for (const workload of capture.workloads) {
    if (workload.status !== "measured" || workload.verification?.passed !== true) {
      throw new Error(`${id}: ${workload.id} is not verified`);
    }
    if (!Array.isArray(workload.samples) || workload.samples.length !== capture.policy.samples) {
      throw new Error(`${id}: ${workload.id} sample count does not match policy`);
    }
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const captures = [];
  for (const input of options.inputs) {
    const sourcePath = path.resolve(input.source);
    const capture = JSON.parse(await readFile(sourcePath, "utf8"));
    validateCapture(capture, input.id);
    const environment = {
      ...capture.environment,
      // Raw captures may contain an operator's local absolute executable path. The public
      // comparison keeps the executable identity without publishing a workstation path.
      execPath: capture.environment.execPath ? path.basename(capture.environment.execPath) : null,
    };
    captures.push({
      id: input.id,
      label: input.id,
      status: "measured",
      environment,
      runner: capture.runner,
      policy: capture.policy,
      // Browser captures carry the exact production execution policy and source tab.
      // Preserve it so the public comparison distinguishes measured guest modes from
      // a generic Linux row and remains auditable without publishing host secrets.
      browser: capture.browser ?? null,
      workloads: capture.workloads,
      fixture: capture.fixture,
    });
    if (captures.length > 1) {
      const first = captures[0];
      if (!sameJson(capture.fixture, first.fixture) || !sameJson(capture.policy, first.policy)) {
        throw new Error(`${input.id}: fixture or sampling policy differs from ${first.id}`);
      }
    }
  }

  const ids = new Set(captures.map((capture) => capture.id));
  for (const unavailable of options.notRun) {
    if (ids.has(unavailable.id)) throw new Error(`${unavailable.id}: both measured and not-run were supplied`);
    ids.add(unavailable.id);
  }

  const comparison = {
    schema: SCHEMA,
    kind: KIND,
    publicationStatus: options.notRun.length === 0 ? "complete" : "partial",
    generatedAt: new Date().toISOString(),
    campaign: {
      id: "runtime-workloads-v1",
      scope: "native Node and wasm-vm execution modes",
      method: "same portable Node script, deterministic fixture, warmups, repeated verified samples",
      workloadIds: REQUIRED_WORKLOAD_IDS,
      source: "./bench-runtime-workloads.mjs",
      scriptSha256: captures[0].runner.scriptSha256,
    },
    fixture: captures[0].fixture,
    policy: captures[0].policy,
    environments: captures,
    notRun: options.notRun,
  };
  const outputPath = path.resolve(options.output);
  await writeFile(outputPath, `${JSON.stringify(comparison, null, 2)}\n`);
  process.stdout.write(`RUNTIME_WORKLOAD_COMPARISON=${JSON.stringify({
    output: outputPath,
    publicationStatus: comparison.publicationStatus,
    environments: comparison.environments.map((capture) => capture.id),
    notRun: comparison.notRun,
    fixture: comparison.fixture,
    policy: comparison.policy,
  })}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
