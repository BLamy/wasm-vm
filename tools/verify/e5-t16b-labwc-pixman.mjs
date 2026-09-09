#!/usr/bin/env node

// E5-T16b: inspect one native labwc/pixman capture. The emulator run itself is owned by the T16a
// driver; this verifier checks that its replay artifacts, renderer proof, and phase values are
// mutually consistent before the result can enter the finalist evidence set.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { validateCapture } from "../../tools/display-server-workload.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IDLE_INSTRUCTION_BUDGET = 0.02;
const capturePath = argument("--capture");
const capture = validateCapture(JSON.parse(await readFile(path.resolve(capturePath), "utf8")));
assert.equal(capture.candidate.id, "labwc-pixman");
assert.equal(capture.candidate.server, "drm");
assert.equal(capture.candidate.wm, "labwc");
assert.equal(capture.candidate.terminal, "foot");
assert.equal(capture.candidate.renderer, "pixman");
assert.deepEqual(capture.observations.markerSequence, capture.phases.map((phase) => phase.marker));

const idle = phase("idle");
const typing = phase("type-100");
const drag = phase("drag-300");
const close = phase("close");
assert.ok(idle.end.wallMs - idle.start.wallMs >= 900, "idle interval is below the T16a floor");
assert.equal(typing.details.characters, 100);
assert.equal(typing.details.frames, 200);
assert.equal(typing.details.rejectedEvents, 0);
assert.ok(typing.end.uploadedBytes >= typing.start.uploadedBytes, "typing upload counter regressed");
assert.deepEqual(
  { axis: drag.details.axis, deltaPx: drag.details.deltaPx, steps: drag.details.steps },
  { axis: "x", deltaPx: 300, steps: 30 },
);
assert.equal(drag.details.frames, 32);
assert.equal(drag.details.rejectedEvents, 0);
assert.equal(close.details.applicationExited, true);

const idleInstructions = idle.end.guestInstructions - idle.start.guestInstructions;
const totalInstructions = capture.summary.guestInstructions;
const idleInstructionRatio = enforceIdleBudget(idle, totalInstructions);

if (process.argv.includes("--self-test")) {
  const mutant = structuredClone(capture);
  const mutantIdle = mutant.phases.find((phase) => phase.id === "idle");
  const originalIdleInstructions = mutantIdle.end.guestInstructions - mutantIdle.start.guestInstructions;
  const targetIdleInstructions = Math.ceil(mutant.summary.guestInstructions * 0.03);
  const delta = targetIdleInstructions - originalIdleInstructions;
  mutantIdle.end.guestInstructions += delta;
  for (const phase of mutant.phases.slice(2)) {
    phase.start.guestInstructions += delta;
    phase.end.guestInstructions += delta;
  }
  mutant.summary.guestInstructions += delta;
  const mutantRatio = idleBudgetRatio(mutantIdle, mutant.summary.guestInstructions);
  assert.ok(mutantRatio > IDLE_INSTRUCTION_BUDGET);
  assert.throws(
    () => enforceIdleBudget(mutantIdle, mutant.summary.guestInstructions),
    /exceeds 2% budget/u,
    "idle-budget mutant was accepted",
  );
  process.stdout.write("E5T16B_SELF_TEST=idle-budget-rejected\n");
}

const evidenceDir = path.join(repo, "evidence/e5-t16b");
const consolePath = path.join(evidenceDir, "labwc-console.log");
const stderrPath = path.join(evidenceDir, "labwc-stderr.log");
const guestEvidencePath = path.join(evidenceDir, "labwc-guest-evidence.txt");
const gpuTracePath = path.join(evidenceDir, "labwc-gpu-trace.log");
const runSummaryPath = path.join(evidenceDir, "labwc-run.json");
const imagePath = path.join(repo, "target/e5-t16b/labwc-image/alpine-rootfs.ext4");
const manifestPath = path.join(repo, "target/e5-t16b/labwc-image/MANIFEST.txt");
const fileManifestPath = path.join(repo, "target/e5-t16b/labwc-image/FILE-MANIFEST.txt");
const [console, stderr, guestEvidence, gpuTrace] = await Promise.all([
  readFile(consolePath, "utf8"),
  readFile(stderrPath, "utf8"),
  readFile(guestEvidencePath, "utf8"),
  readFile(gpuTracePath, "utf8"),
]);
const runSummary = JSON.parse(await readFile(runSummaryPath, "utf8"));
assert.match(console, /E5T16B_LAUNCH WLR_BACKENDS=drm WLR_RENDERER=pixman/u);
assert.doesNotMatch(console, /WLR_RENDERER=(?:gles2|gl2|vulkan)/u);
assert.match(console, /E5T16B_LABWC_STARTED=1/u);
assert.match(console, /E5T16B_FOOT_STARTED=1/u);
assert.match(console, /E5T16B_APP_EXITED=1/u);
assert.match(console, /E5T16B_WM_EXITED=1/u);
assert.match(console, /reboot: Power down/u, "guest did not reach the kernel power-down line");
assert.match(guestEvidence, /^trace retired=\d+$/mu);
assert.match(guestEvidence, /^outcome=Exited\(0\)$/mu, "guest evidence did not record a clean SBI poweroff");
assert.match(gpuTrace, /^records=\d+ dropped=0$/mu);
if (capture.observations.cursorqEvents === 0) {
  assert.match(capture.observations.cursorqStatus ?? "", /^capability-gap:/u);
} else {
  assert.equal(capture.observations.cursorqStatus, "observed");
}

const sha256File = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");
assert.equal(runSummary.image.sha256, capture.image.sha256, "run summary input image digest disagrees with the harness");
assert.equal(runSummary.capture.image.sha256, capture.image.sha256, "run summary capture digest disagrees with the harness");
assert.equal(runSummary.imagePostRun.id, capture.image.id, "run summary post-run image id is stale");
assert.match(runSummary.imagePostRun.sha256, /^[0-9a-f]{64}$/u, "run summary post-run image digest is malformed");
const verification = {
  task: "E5-T16b",
  command: "make verify-E5-T16b",
  capture: path.relative(repo, capturePath),
  image: {
    path: path.relative(repo, imagePath),
    sha256: capture.image.sha256,
    postRunSha256: runSummary.imagePostRun.sha256,
    packageManifest: path.relative(repo, manifestPath),
    packageManifestSha256: await sha256File(manifestPath),
    fileManifest: path.relative(repo, fileManifestPath),
    fileManifestSha256: await sha256File(fileManifestPath),
  },
  renderer: { backend: "drm", renderer: "pixman", proof: "E5T16B_LAUNCH" },
  idle: { durationMs: idle.end.wallMs - idle.start.wallMs, guestInstructions: idleInstructions, totalGuestInstructions: totalInstructions, instructionRatio: idleInstructionRatio, budget: "<=2% unless charter justification" },
  typing: { characters: typing.details.characters, uploadedBytes: typing.end.uploadedBytes - typing.start.uploadedBytes },
  drag: { axis: drag.details.axis, deltaPx: drag.details.deltaPx, steps: drag.details.steps },
  cursorq: { events: capture.observations.cursorqEvents, status: capture.observations.cursorqStatus ?? "not-reported" },
  artifacts: {
    console: { path: path.relative(repo, consolePath), sha256: await sha256File(consolePath) },
    stderr: { path: path.relative(repo, stderrPath), sha256: await sha256File(stderrPath) },
    guestEvidence: { path: path.relative(repo, guestEvidencePath), sha256: await sha256File(guestEvidencePath) },
    gpuTrace: { path: path.relative(repo, gpuTracePath), sha256: await sha256File(gpuTracePath) },
  },
};
const output = path.join(evidenceDir, "labwc-verification.json");
await writeFile(output, `${JSON.stringify(verification, null, 2)}\n`);
process.stdout.write(`E5T16B_VERIFIED=${JSON.stringify({
  capture: path.relative(repo, capturePath),
  imageSha256: capture.image.sha256,
  typingUploadedBytes: verification.typing.uploadedBytes,
  cursorqEvents: verification.cursorq.events,
  idleInstructionRatio,
})}\n`);

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name} requires a path`);
  return process.argv[index + 1];
}

function phase(id) {
  const value = capture.phases.find((item) => item.id === id);
  assert.ok(value, `missing phase ${id}`);
  return value;
}

function enforceIdleBudget(idlePhase, totalGuestInstructions) {
  const ratio = idleBudgetRatio(idlePhase, totalGuestInstructions);
  assert.ok(
    ratio <= IDLE_INSTRUCTION_BUDGET,
    `idle instruction ratio ${ratio} exceeds 2% budget and has no charter justification`,
  );
  return ratio;
}

function idleBudgetRatio(idlePhase, totalGuestInstructions) {
  const idleGuestInstructions = idlePhase.end.guestInstructions - idlePhase.start.guestInstructions;
  const ratio = totalGuestInstructions === 0 ? 0 : idleGuestInstructions / totalGuestInstructions;
  assert.ok(Number.isFinite(ratio), "idle instruction ratio is not finite");
  return ratio;
}
