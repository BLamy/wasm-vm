#!/usr/bin/env node

// E5-T16a: verify the candidate-neutral display workload/capture contract. This is deliberately
// not a finalist measurement: T16b and T16c must supply real emulator captures through the driver
// protocol frozen here.

import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  WORKLOAD_PHASES,
  WORKLOAD_TASK,
  planSha256,
  runSelfTest,
  stableStringify,
} from "../../tools/display-server-workload.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidencePath = path.join(repo, "evidence/e5-t16a/workload-harness-2026-09-04.json");

const selfTest = runSelfTest();
for (const [name, passed] of Object.entries(selfTest.checks)) {
  if (passed !== true) throw new Error(`self-test check failed: ${name}`);
}

const result = {
  schema: "wasm-vm.e5-t16a.display-server-workload-evidence.v1",
  task: WORKLOAD_TASK,
  command: "make verify-E5-T16a",
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  plan: {
    sha256: planSha256(),
    phaseCount: WORKLOAD_PHASES.length,
    markers: WORKLOAD_PHASES.map((phase) => phase.marker),
    typingCharacters: selfTest.typingCharacters,
    dragDeltaPx: selfTest.dragDeltaPx,
  },
  contract: {
    driverInput: "one canonical plan JSON document on stdin",
    driverOutput: "one complete capture JSON document on stdout",
    imageDigestOwner: "harness",
    target: "riscv64 emulator",
    sources: selfTest.sources ?? {
      guestInstructions: "guest-e4-minstret",
      uploadedBytes: "guest-t09-vm-stats-gpu-bytesUploaded",
      peakRssBytes: "guest-proc-status-vmHWM",
      idleWakeups: "guest-proc-interrupts-idle-delta",
      cursorqEvents: "guest-virtio-gpu-cursorq-trace",
    },
  },
  selfTest,
  scope: { independentMachines: false, webkit: false, hostRr: false },
};

await mkdir(path.dirname(evidencePath), { recursive: true });
await writeFile(evidencePath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`E5T16A_WORKLOAD_HARNESS_OK=${stableStringify({
  planSha256: result.plan.sha256,
  phaseCount: result.plan.phaseCount,
  normalizedSha256: selfTest.normalizedSha256,
  checks: selfTest.checks,
})}\n`);
