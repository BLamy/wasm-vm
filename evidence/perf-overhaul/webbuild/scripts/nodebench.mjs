// node nodebench.mjs ROOTDIR TOTAL_INSTRS [fast=1]  -> JSON line {root, cpu_s, wall_s, retired, mips_cpu}
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
const [root, totalS, fastS = "1"] = process.argv.slice(2);
const total = Number(totalS);
const pkg = path.join(root, "pkg");
const mod = await import(pathToFileURL(path.join(pkg, "wasm_vm_wasm.js")).href);
mod.initSync({ module: readFileSync(path.join(pkg, "wasm_vm_wasm_bg.wasm")) });
const W = "/Users/blamy/Documents/Codex/wasm-vm-t-webbuild/releases";
const kernel = readFileSync(`${W}/kernel/6.6.63/Image`);
const initrd = readFileSync(`${W}/initramfs/initramfs.cpio.gz`);
let out = "";
const m = new mod.WasmLinux(256, kernel, initrd, "", (s) => { out += s; }, false);
m.setFastInterpreter(fastS === "1");
const c0 = process.cpuUsage(); const th0 = process.threadCpuUsage(); const t0 = performance.now();
let retired = 0;
while (retired < total) {
  const r = m.runChunk(2_000_000);
  retired += r.retired;
  if (r.done) break;
}
const th = process.threadCpuUsage(th0); const c = process.cpuUsage(c0); const wall = (performance.now() - t0) / 1000;
const cpu = (c.user + c.system) / 1e6;
console.log(JSON.stringify({ root: path.basename(root), cpu_s: +cpu.toFixed(3), wall_s: +wall.toFixed(3), retired, main_s: +((th.user + th.system) / 1e6).toFixed(3), mips_main: +(retired / ((th.user + th.system)) ).toFixed(2), mips_cpu: +(retired / cpu / 1e6).toFixed(2), userland: out.includes("userland up") || out.includes("#") }));
