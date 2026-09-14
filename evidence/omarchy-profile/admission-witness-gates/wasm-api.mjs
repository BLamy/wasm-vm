// Actual frozen web-target WASM boundary, not a mock or guest responsiveness test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { initSync, WasmMachine } from '../../../web/dist/pkg/wasm_vm_wasm.js';
const bytes = readFileSync(new URL('../../../web/dist/pkg/wasm_vm_wasm_bg.wasm', import.meta.url));
const sha256 = createHash('sha256').update(bytes).digest('hex');
assert.equal(sha256, '2c8e48ff31c510099f719e849b760e878f6c1c0ec568e4a4aac1336af7520777');
initSync({ module: bytes });
const machine = new WasmMachine(1);
try {
  const before = machine.jitStats();
  assert.equal(before.admissionProbe, false); assert.equal(before.hasExecutor, false);
  assert.equal(machine.setAdmissionProbe(true), true);
  const enabled = machine.jitStats();
  assert.equal(enabled.hasExecutor, false, 'observer cannot enable JIT');
  assert.equal(enabled.admissionProbe.enabled, true);
  assert.equal(enabled.admissionProbe.observedEntries, '0');
  assert.equal(typeof enabled.admissionProbe.generation, 'string');
  assert.deepEqual(enabled.admissionProbe.records, []);
  assert.equal(machine.setAdmissionProbe(true), true);
  assert.deepEqual(machine.jitStats().admissionProbe, enabled.admissionProbe);
  assert.equal(machine.setAdmissionProbe(false), false);
  assert.equal(machine.jitStats().admissionProbe, false);
  console.log(JSON.stringify({ result: 'passed', sha256, defaultOff: true,
    enabledReport: enabled.admissionProbe, repeatedEnableIdempotent: true, disabledAgain: true }));
} finally { machine.free(); }
