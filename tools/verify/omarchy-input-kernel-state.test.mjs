import assert from "node:assert/strict";
import test from "node:test";
import { INPUT_BUFFER_KERNEL, INPUT_BUFFER_NOTES_COMMAND, INPUT_BUFFER_NOTES_SHA256,
  assertInputKernelNotes, assertInputKernelSource } from "./omarchy-input-kernel-state.mjs";
import { R3_IDENTITIES } from "./omarchy-input-trial.mjs";

test("running kernel fingerprint rejects old kernel, command echo and failed reads", () => {
  const valid = { exit: 0, stdout: `${INPUT_BUFFER_NOTES_SHA256}  /sys/kernel/notes\n` };
  assert.equal(assertInputKernelNotes(valid), INPUT_BUFFER_NOTES_SHA256);
  for (const response of [
    { ...valid, exit: 1 },
    { ...valid, stdout: "a3f7f2a76799a72bbba6af0b4ad7fa6eee9313fa64f3e53f85105f399dfe5e0e  /sys/kernel/notes\n" },
    { ...valid, stdout: `echo ${valid.stdout}` },
    { ...valid, stdout: valid.stdout.replace("/sys/kernel/notes", "/tmp/notes") },
  ]) assert.throws(() => assertInputKernelNotes(response));
});

test("native artifact roles cannot override pinned kernel or base chunks", () => {
  const record = { kind: "input-buffer-native-pair", passed: true, keyboardAcceptance: false,
    kernelNotesSha256: INPUT_BUFFER_NOTES_SHA256, head: "1".repeat(40),
    inputs: { kernel: INPUT_BUFFER_KERNEL, chunkManifest: R3_IDENTITIES.chunkManifest,
      wasm: { sha256: "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916" } },
    kernelObservation: { command: INPUT_BUFFER_NOTES_COMMAND, status: 0,
      output: `${INPUT_BUFFER_NOTES_SHA256}  /sys/kernel/notes` },
    artifacts: { bootSnapshot: { size: 2000, sha256: "2".repeat(64) },
      overlayDelta: { size: 2000, sha256: "3".repeat(64) } } };
  const source = { kernel: INPUT_BUFFER_KERNEL, chunkManifest: R3_IDENTITIES.chunkManifest,
    ...record.artifacts, image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } };
  assertInputKernelSource(source, record);
  for (const role of ["kernel", "chunkManifest"]) {
    const altered = structuredClone(record), served = structuredClone(source);
    served[role] = altered.artifacts[role] = { size: 2000, sha256: "4".repeat(64) };
    assert.throws(() => assertInputKernelSource(served, altered), /only snapshot and delta/u);
  }
});
