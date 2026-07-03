// E0-T26 capstone: run hello.elf under the node-wasm build with tracing on, print the
// canonical trace to stdout (byte-for-byte comparable to the native CLI --trace output).
// Usage: node tools/capstone/trace-node.mjs [elf] [ram_mib]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import init, { WasmMachine } from "../../web/pkg/wasm_vm_wasm.js";

const wasmPath = fileURLToPath(new URL("../../web/pkg/wasm_vm_wasm_bg.wasm", import.meta.url));
await init(readFileSync(wasmPath));

const elf = process.argv[2] ?? fileURLToPath(new URL("../../guest/prebuilt/hello.elf", import.meta.url));
const ramMib = Number(process.argv[3] ?? 128);
const m = new WasmMachine(ramMib);
m.setTrace(true);
m.loadElf(new Uint8Array(readFileSync(elf)));
const status = m.run(100_000_000);
// trace to stdout; status + digest to stderr so stdout stays byte-clean.
process.stderr.write(`kind=${status.kind} code=${status.code} retired=${status.retired} digest=${m.stateDigest()}\n`);
process.stdout.write(m.takeTrace());
