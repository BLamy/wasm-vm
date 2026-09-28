import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { initSync, WasmMachine } from "../../../web/dist/pkg/wasm_vm_wasm.js";

const bytes = await readFile(new URL("../../../web/dist/pkg/wasm_vm_wasm_bg.wasm", import.meta.url));
initSync({ module: bytes });
const machine = new WasmMachine(1);
try {
  assert.equal(machine.jitStats().hasExecutor, false);
  const initial = machine.jitStats().coldCounterRecycling;
  assert.deepEqual(initial, { enabled: false, epochs: "0", discardedCounters: "0", threshold: 64, capacity: 65536 });
  for (const enabled of [true, true, false]) {
    assert.equal(machine.setColdCounterRecycling(enabled), enabled);
    assert.deepEqual(machine.jitStats().coldCounterRecycling, { ...initial, enabled });
    assert.equal(machine.jitStats().hasExecutor, false, "selection must not enable JIT implicitly");
    assert.equal(machine.jitStats().admissionProbe, false);
  }
  console.log(JSON.stringify({ result: "actual-WASM-API-passed", initial,
    wasmSha256: createHash("sha256").update(bytes).digest("hex") }));
} finally { machine.free(); }
