// VERIFIER E4-T40f: on the committed wasm, a WasmMachine without a JIT records no discovery; enableJit nominates and compiles.
import { readFileSync } from "node:fs";
const dist = process.argv[2];
const pkg = await import(`${dist}/pkg/wasm_vm_wasm.js`);
pkg.initSync({ module: readFileSync(`${dist}/pkg/wasm_vm_wasm_bg.wasm`) });
const { eventClockElf } = await import(`${process.argv[3]}/web/event-clock-probe.js`);
const out = {};
for (const jit of [false, true]) {
  const m = new pkg.WasmMachine(1);
  m.loadElf(eventClockElf(false));
  if (jit) m.enableJit(4);
  for (let i = 0; i < 200; i++) m.run(10000);
  const s = m.jitStats();
  out[jit ? "enableJit" : "noJit"] = { hasExecutor: s.hasExecutor, nominated: s.discovery.nominated, deduped: s.discovery.deduped, compiledBlocks: s.compiledBlocks, executedBlocks: s.executedBlocks, retiredViaJit: s.retiredViaJit };
}
console.log(JSON.stringify(out, null, 1));
