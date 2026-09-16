// Synthetic schema/source boundary tests; these do not claim a guest ran.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { assertInputKernelSource } from "../../../tools/verify/omarchy-input-kernel-state.mjs";
const candidate = { size: 24208896, sha256: "3cf8bed0d9a9941a6f2f81b7c8de86cefcba3e4e6bd5e5846bd395714a25642d" };
const oldKernel = { size: 24208896, sha256: "af7c4e471ed4dabdbe5a2717d81cc034b511d2b0f7706de66ad9e84e078c7cce" };
const notes = "7117bfaf56cad575a6473084a94e6e2976cc08b598b5fbbe7d9d3142d238d55f";
const chunks = { size: 1097812, sha256: "5f6a080986a423e5d77d2ec794eee3e42359ccc7d8a5fd23071a7420f4f23d44" };
const native = { kind: "input-buffer-native-pair", passed: true, keyboardAcceptance: false,
  head: "c2cbcfd0d0d8b18ccc0d109363eca370c2dbf847", kernelNotesSha256: notes,
  kernelObservation: { command: "sha256sum /sys/kernel/notes", status: 0, output: `${notes}  /sys/kernel/notes\n` },
  inputs: { kernel: candidate, chunkManifest: chunks,
    wasm: { sha256: "36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916" } },
  artifacts: { bootSnapshot: { size: 10001, sha256: "a".repeat(64) }, overlayDelta: { size: 10002, sha256: "b".repeat(64) } } };
const source = { kernel: candidate, chunkManifest: chunks, ...native.artifacts,
  image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } };
assertInputKernelSource(source, native);
const cases = [
  ["different served kernel", (s, n) => s.kernel = oldKernel],
  ["changed served snapshot", (s, n) => s.bootSnapshot.sha256 = "c".repeat(64)],
  ["changed served delta", (s, n) => s.overlayDelta.sha256 = "d".repeat(64)],
  ["different served chunks", (s, n) => s.chunkManifest.sha256 = "e".repeat(64)],
  ["wrong served image geometry", (s, n) => s.image.chunkSize = 131072],
  ["failed native capture", (s, n) => n.passed = false],
  ["native input acceptance pollution", (s, n) => n.keyboardAcceptance = true],
  ["failed native kernel read", (s, n) => n.kernelObservation.status = 1],
  ["old native notes", (s, n) => n.kernelObservation.output = "a3f7f2a76799a72bbba6af0b4ad7fa6eee9313fa64f3e53f85105f399dfe5e0e  /sys/kernel/notes\n"],
  ["unbound native head", (s, n) => n.head = "HEAD"],
  ["AJ pair substituted in source and record", (s, n) => s.bootSnapshot.sha256 = n.artifacts.bootSnapshot.sha256 = "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75"],
  ["R3 pair substituted in source and record", (s, n) => s.bootSnapshot.sha256 = n.artifacts.bootSnapshot.sha256 = "2231a21eb8ebc8d3965d1352a3523501faebc87bda31e2c8dc184320219235f5"],
  ["unexpected artifact key overrides pinned kernel", (s, n) => { n.artifacts.kernel = oldKernel; s.kernel = oldKernel; }],
  ["unexpected artifact key overrides pinned chunks", (s, n) => { n.artifacts.chunkManifest = { ...chunks, sha256: "e".repeat(64) }; s.chunkManifest = n.artifacts.chunkManifest; }],
];
const attacks = cases.map(([name, edit]) => {
  const s = structuredClone(source), n = structuredClone(native); edit(s, n);
  let error;
  try { assertInputKernelSource(s, n); } catch (e) { error = String(e); }
  return { name, rejected: Boolean(error), error: error ?? null };
});
const bytes = await fs.readFile(new URL("../../../tools/verify/omarchy-input-kernel-state.mjs", import.meta.url));
console.log(JSON.stringify({ purpose: "synthetic-source-binding-only", positiveAccepted: true,
  sourceSha256: createHash("sha256").update(bytes).digest("hex"), attacks }, null, 2));
assert.ok(attacks.every(row => row.rejected), "identity substitution accepted at source guard");
