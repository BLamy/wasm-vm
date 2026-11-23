// E5-T33 smoke for Replay Node 26 on riscv64: WebAssembly, WebCrypto, worker_threads, fs.
// Prints one line per check and a final digest; exits non-zero on any failure.
import { Worker } from "node:worker_threads";
import { createHash, webcrypto } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const results = [];
const check = (name, ok, detail) => {
  results.push(`${name}:${ok ? "ok" : "FAIL"}:${detail}`);
  console.log(`${ok ? "ok  " : "FAIL"} ${name} ${detail}`);
  if (!ok) process.exitCode = 1;
};

// WebAssembly: (module (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add))
const wasm = Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0,
  7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
const { instance } = await WebAssembly.instantiate(wasm);
check("wasm", instance.exports.add(40, 2) === 42, `add(40,2)=${instance.exports.add(40, 2)}`);

const digest = Buffer.from(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("wasm-vm")));
const expect = createHash("sha256").update("wasm-vm").digest();
check("crypto.subtle", digest.equals(expect), digest.toString("hex").slice(0, 16));

const sum = await new Promise((resolve, reject) => {
  const w = new Worker("const {parentPort}=require('node:worker_threads');" +
    "parentPort.on('message',n=>{let s=0;for(let i=1;i<=n;i++)s+=i;parentPort.postMessage(s);});", { eval: true });
  w.once("message", (v) => { resolve(v); w.terminate(); });
  w.once("error", reject);
  w.postMessage(100000);
});
check("worker_threads", sum === 5000050000, `sum=${sum}`);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "node26-"));
const file = path.join(dir, "probe.txt");
fs.writeFileSync(file, "riscv64\n");
const back = fs.readFileSync(file, "utf8");
fs.rmSync(dir, { recursive: true });
check("fs", back === "riscv64\n", `roundtrip=${JSON.stringify(back)}`);

check("arch", process.arch === "riscv64", `${process.platform}/${process.arch} ${process.version}`);
console.log("digest", createHash("sha256").update(results.join("\n")).digest("hex"));
