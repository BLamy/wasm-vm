import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export const GPU_TRANSFER_RUNTIME_FILES = [
  "crates/core/src/dev/virtio/gpu/resources.rs",
  "crates/core/src/dev/virtio/gpu/mod.rs",
  "web/dist/pkg/wasm_vm_wasm_bg.wasm",
];

export function assertGpuTransferRuntime(record, actual) {
  assert.equal(record.task, "E5.5-T03at");
  assert.deepEqual(Object.keys(record.files).sort(), [...GPU_TRANSFER_RUNTIME_FILES].sort());
  assert.deepEqual(Object.keys(actual).sort(), [...GPU_TRANSFER_RUNTIME_FILES].sort());
  for (const file of GPU_TRANSFER_RUNTIME_FILES) {
    assert.match(record.files[file].sha256, /^[a-f0-9]{64}$/u);
    assert.ok(Number.isSafeInteger(record.files[file].size) && record.files[file].size > 0);
    assert.deepEqual(actual[file], record.files[file], `wrong frozen GPU runtime: ${file}`);
  }
  return record.files["web/dist/pkg/wasm_vm_wasm_bg.wasm"].sha256;
}

export async function loadGpuTransferRuntime(repo) {
  const record = JSON.parse(await fs.readFile(path.join(repo, "tools/verify/omarchy-gpu-transfer-runtime.json"), "utf8"));
  const actual = Object.fromEntries(await Promise.all(GPU_TRANSFER_RUNTIME_FILES.map(async file => {
    const bytes = await fs.readFile(path.join(repo, file));
    return [file, { size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }];
  })));
  return { record, wasmSha256: assertGpuTransferRuntime(record, actual) };
}
