// E0-T24 node MIPS runner: loads the wasm-pack (--target web) module by handing init() the
// wasm bytes directly (node has no file: fetch), then calls bench() for >= 10^7 retired
// instructions and prints MIPS. Usage: node web/bench-node.mjs [target_instrs]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import init, { bench, version } from "./pkg/wasm_vm_wasm.js";

const wasmPath = fileURLToPath(new URL("./pkg/wasm_vm_wasm_bg.wasm", import.meta.url));
await init(readFileSync(wasmPath));

const target = Number(process.argv[2] ?? 10_000_000);
const { retired, ms } = bench(target);
const mips = retired / ms / 1000;
console.log(`core ${version()}  node-wasm  retired=${retired}  ms=${ms.toFixed(1)}  MIPS=${mips.toFixed(1)}`);
