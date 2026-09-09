// E5-T16a — candidate-neutral display-server workload/capture contract.

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  WORKLOAD_PHASES,
  TYPING_TEXT,
  buildWorkloadPlan,
  fixtureCapture,
  runDriver,
  stableStringify,
  validateCapture,
} from "../../tools/display-server-workload.mjs";

const toolPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../tools/display-server-workload.mjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorCode(mutator) {
  const value = clone(fixtureCapture());
  mutator(value);
  try {
    validateCapture(value);
  } catch (error) {
    return error.code;
  }
  return null;
}

test("freezes the exact phase, typing, and drag plan", () => {
  const plan = buildWorkloadPlan();
  assert.deepEqual(plan.phases, WORKLOAD_PHASES);
  assert.equal(plan.terminal.typedCharacters, 100);
  assert.equal(plan.terminal.typingText, TYPING_TEXT);
  assert.equal(TYPING_TEXT.length, 100);
  assert.equal(plan.drag.deltaPx, 300);
  assert.equal(plan.drag.steps, 30);
});

test("normalizes cumulative counters and recomputes the summary", () => {
  const result = validateCapture(fixtureCapture());
  assert.equal(result.phases.length, 6);
  assert.equal(result.summary.guestInstructions, 1_014);
  assert.equal(result.summary.uploadedBytes, 2_176);
  assert.equal(result.summary.typingUploadedBytes, 448);
  assert.equal(result.summary.idleWakeupsPerSecond, 3);
  assert.equal(result.observations.errors.length, 0);
  assert.equal(result.sources.peakRssBytes, "guest-proc-status-vmHWM");
  assert.equal(stableStringify(result), stableStringify(validateCapture(clone(fixtureCapture()))));
});

test("rejects missing markers, non-monotonic counters, and workload-shape lies", () => {
  assert.equal(errorCode((value) => value.observations.markerSequence.pop()), "MARKER_SEQUENCE");
  assert.equal(errorCode((value) => { value.phases[2].end.guestInstructions = 0; }), "COUNTER_ORDER");
  assert.equal(errorCode((value) => { value.sources.uploadedBytes = "host-native"; }), "SOURCE_CONTRACT");
  assert.equal(errorCode((value) => { value.phases[3].details.characters = 99; }), "WORKLOAD_SHAPE");
  assert.equal(errorCode((value) => { value.phases[1].outcome = "failed"; }), "PHASE_OUTCOME");
  assert.equal(errorCode((value) => { value.phases[1].end.wallMs = 300; }), "IDLE_INTERVAL");
});

test("driver protocol receives the frozen plan and the harness owns the image digest", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5-t16a-"));
  const imagePath = path.join(directory, "scratch.img");
  const outputPath = path.join(directory, "capture.json");
  await writeFile(imagePath, "deterministic scratch image");
  const moduleUrl = pathToFileURL(toolPath).href;
  const driverSource = [
    `import { fixtureCapture } from ${JSON.stringify(moduleUrl)};`,
    "let input = '';",
    "for await (const chunk of process.stdin) input += chunk;",
    "const capture = fixtureCapture();",
    "capture.plan = JSON.parse(input);",
    "process.stdout.write(JSON.stringify(capture));",
  ].join("\n");
  try {
    const result = await runDriver({
      imagePath,
      outputPath,
      runner: [process.execPath, "--input-type=module", "-e", driverSource],
    });
    const saved = JSON.parse(await readFile(outputPath, "utf8"));
    assert.equal(result.image.sha256, "1e5520b81068cb2d30764a8d87b2aa0e6b04fa817bd2ea41af70b8c12ed573d8");
    assert.deepEqual(saved, result);
    assert.deepEqual(result.plan, buildWorkloadPlan());
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("driver failures are typed and cannot become zero-filled evidence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5-t16a-fail-"));
  const imagePath = path.join(directory, "scratch.img");
  await writeFile(imagePath, "deterministic scratch image");
  try {
    await assert.rejects(
      runDriver({
        imagePath,
        runner: [process.execPath, "-e", "process.stderr.write('candidate stopped before idle'); process.exit(7);"],
      }),
      (error) => error.code === "DRIVER_EXIT" && error.message.includes("candidate stopped before idle"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("a hung driver is bounded and reported as a timeout", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wasm-vm-e5-t16a-timeout-"));
  const imagePath = path.join(directory, "scratch.img");
  await writeFile(imagePath, "deterministic scratch image");
  try {
    await assert.rejects(
      runDriver({
        imagePath,
        timeoutMs: 25,
        runner: [process.execPath, "-e", "setTimeout(() => {}, 10_000);"],
      }),
      (error) => error.code === "DRIVER_TIMEOUT" && error.message.includes("25 ms"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
