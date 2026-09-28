import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const head = process.argv[2];
assert.match(head ?? '', /^[a-f0-9]{40}$/u);
const { GPU_TRANSFER_RUNTIME_FILES, assertGpuTransferRuntime } = await import(pathToFileURL(`${process.cwd()}/tools/verify/omarchy-gpu-transfer-runtime.mjs`));
const { auditInputKernelResponse } = await import(pathToFileURL(`${process.cwd()}/tools/verify/omarchy-input-kernel-response-audit.mjs`));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBytes = file => execFileSync('git', ['show', `${head}:${file}`], { maxBuffer: 6000000 });
const record = JSON.parse(gitBytes('tools/verify/omarchy-gpu-transfer-runtime.json'));
const actual = {};
for (const file of GPU_TRANSFER_RUNTIME_FILES) {
  const bytes = gitBytes(file);
  actual[file] = { size: bytes.length, sha256: sha(bytes) };
  assert.deepEqual(await fs.readFile(file), bytes, `working source differs from frozen head: ${file}`);
}
assert.equal(assertGpuTransferRuntime(record, actual), actual['web/dist/pkg/wasm_vm_wasm_bg.wasm'].sha256);
const attacks = [];
const reject = (name, mutation) => {
  const copy = { record: structuredClone(record), actual: structuredClone(actual) };
  mutation(copy);
  assert.throws(() => assertGpuTransferRuntime(copy.record, copy.actual), name);
  attacks.push({ name, rejected: true });
};
for (const file of GPU_TRANSFER_RUNTIME_FILES) {
  reject(`changed bytes: ${file}`, copy => { copy.actual[file].sha256 = '0'.repeat(64); });
  reject(`changed size: ${file}`, copy => { copy.actual[file].size++; });
  reject(`missing actual: ${file}`, copy => { delete copy.actual[file]; });
  reject(`missing frozen: ${file}`, copy => { delete copy.record.files[file]; });
}
reject('extra actual role', copy => { copy.actual.extra = actual[GPU_TRANSFER_RUNTIME_FILES[0]]; });
reject('extra frozen role', copy => { copy.record.files.extra = actual[GPU_TRANSFER_RUNTIME_FILES[0]]; });
reject('wrong task', copy => { copy.record.task = 'E5.5-T03as'; });
reject('AO WASM substituted for corrected runtime', copy => {
  copy.actual['web/dist/pkg/wasm_vm_wasm_bg.wasm'].sha256 = '36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916';
});
for (const size of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '1602266']) {
  reject(`invalid size ${size}`, copy => {
    copy.record.files[GPU_TRANSFER_RUNTIME_FILES[0]].size = size;
    copy.actual[GPU_TRANSFER_RUNTIME_FILES[0]].size = size;
  });
}
for (const digest of ['f'.repeat(63), 'f'.repeat(65), 'F'.repeat(64), 'g'.repeat(64)]) {
  reject(`invalid digest ${digest.slice(0, 4)} length ${digest.length}`, copy => {
    copy.record.files[GPU_TRANSFER_RUNTIME_FILES[0]].sha256 = digest;
    copy.actual[GPU_TRANSFER_RUNTIME_FILES[0]].sha256 = digest;
  });
}
const asReport = JSON.parse(await fs.readFile('evidence/omarchy-profile/input-kernel-response-r2/desktop/report.json'));
const asAudit = auditInputKernelResponse(asReport, asReport.trial.head);
assert.equal(asAudit.input.machineAcceptance, true);
const wrongAs = structuredClone(asReport);
// The default entry point must still bind the historical AO runtime; only the
// explicitly selected AT route accepts the new, source-bound WASM manifest.
const oldWasm = '36b4f1ccf9e1437f687eae552aca3290fab7c555dfd7fa9fac6cc3862d87a916';
const newWasm = actual['web/dist/pkg/wasm_vm_wasm_bg.wasm'].sha256;
const text = JSON.stringify(wrongAs).replaceAll(oldWasm, newWasm);
assert.throws(() => auditInputKernelResponse(JSON.parse(text), asReport.trial.head));
attacks.push({ name: 'default AS audit rejects corrected-runtime substitution', rejected: true });
console.log(JSON.stringify({ passed: true, head, files: actual, attacks, historicalAsDefaultHeld: true }, null, 2));
