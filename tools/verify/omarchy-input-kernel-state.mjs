import assert from "node:assert/strict";
import { R3_IDENTITIES, remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";

// AQ's independently verified kernel; uname/config alone cannot distinguish it.
export const INPUT_BUFFER_KERNEL = Object.freeze({ size: 24208896,
  sha256: "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d" });
export const INPUT_BUFFER_NOTES_SHA256 = "7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f";
export const INPUT_BUFFER_NOTES_COMMAND = "sha256sum /sys/kernel/notes";

export function assertInputKernelNotes(response) {
  assert.equal(response?.exit, 0, "running kernel notes were not readable");
  assert.match(response.stdout, new RegExp(`^${INPUT_BUFFER_NOTES_SHA256} +/sys/kernel/notes\\s*$`, "u"),
    "running kernel is not the verified input-buffer kernel");
  return INPUT_BUFFER_NOTES_SHA256;
}

export function assertInputKernelProvenance(record) {
  assert.equal(record?.kind, "input-buffer-native-pair");
  assert.equal(record.passed, true);
  assert.equal(record.keyboardAcceptance, false);
  assert.equal(record.kernelNotesSha256, INPUT_BUFFER_NOTES_SHA256);
  assert.equal(record.inputs.kernel.size, INPUT_BUFFER_KERNEL.size);
  assert.equal(record.inputs.kernel.sha256, INPUT_BUFFER_KERNEL.sha256);
  assertInputKernelNotes({ exit: record.kernelObservation.status, stdout: record.kernelObservation.output });
  assert.equal(record.kernelObservation.command, INPUT_BUFFER_NOTES_COMMAND);
  assert.equal(record.inputs.chunkManifest.sha256, R3_IDENTITIES.chunkManifest.sha256);
  assert.equal(record.inputs.chunkManifest.size, R3_IDENTITIES.chunkManifest.size);
  assert.equal(record.inputs.wasm.sha256, "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916");
  assert.match(record.head, /^[a-f0-9]{40}$/u);
  assert.deepEqual(Object.keys(record.artifacts).sort(), ["bootSnapshot", "overlayDelta"],
    "native pair must contain only snapshot and delta artifact roles");
  for (const role of ["bootSnapshot", "overlayDelta"]) {
    assert.match(record.artifacts[role].sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(record.artifacts[role].size) && record.artifacts[role].size > 1000);
  }
  assert.ok(![R3_IDENTITIES.bootSnapshot.sha256, "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75"]
    .includes(record.artifacts.bootSnapshot.sha256), "old-kernel RAM pair is forbidden");
  return record;
}

export function assertInputKernelSource(source, record) {
  assertInputKernelProvenance(record);
  for (const [role, expected] of Object.entries({ kernel: INPUT_BUFFER_KERNEL,
    chunkManifest: R3_IDENTITIES.chunkManifest, bootSnapshot: record.artifacts.bootSnapshot,
    overlayDelta: record.artifacts.overlayDelta })) {
    assert.equal(source?.[role]?.size, expected.size, `${role}: wrong input-kernel size`);
    assert.equal(source?.[role]?.sha256, expected.sha256, `${role}: wrong input-kernel bytes`);
  }
  assert.deepEqual(source.image, { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 });
}

export async function requestInputKernelNotes(exec, deadline, report) {
  const row = report.inputKernelIdentity = { command: INPUT_BUFFER_NOTES_COMMAND,
    startedAt: new Date().toISOString(), deadlineAt: new Date(deadline).toISOString(), status: "reading" };
  try {
    row.response = await withinTrialDeadline(() => exec(INPUT_BUFFER_NOTES_COMMAND, remainingTrialMs(deadline)),
      deadline, "input kernel identity");
    row.respondedAt = new Date().toISOString();
    row.sha256 = assertInputKernelNotes(row.response);
    row.status = "verified";
  } catch (error) { row.status = "unproven"; row.error = String(error); throw error; }
}
