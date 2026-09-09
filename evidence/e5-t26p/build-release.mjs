// Build the actual release packaging with scrubbed compiler environment.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(root, "evidence/e5-t26p/production-candidate-r1");
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith("CARGO_") && !k.startsWith("E5_") && !["RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG"].includes(k)));
const sha = b => createHash("sha256").update(b).digest("hex");
const files = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml",
  "crates/core/Cargo.toml", "crates/wasm/Cargo.toml", "crates/core/src/hart/mod.rs",
  "crates/core/src/lib.rs", "crates/wasm/src/lib.rs"];
const pins = async () => Object.fromEntries(await Promise.all(files.map(async f => [f, sha(await readFile(path.join(root, f)))])));
const before = await pins();
await mkdir(output);
const command = "wasm-pack", args = ["build", "crates/wasm", "--target", "web"];
const metadata = { before, command, args,
  builderSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  runtimeDiffSha256: sha(execFileSync("git", ["diff", "--", ...files], { cwd: root })),
  rustc: execFileSync("rustc", ["-vV"], { cwd: root, env, encoding: "utf8" }),
  cargo: execFileSync("cargo", ["-V"], { cwd: root, env, encoding: "utf8" }).trim(),
  wasmPack: execFileSync(command, ["--version"], { cwd: root, env, encoding: "utf8" }).trim(),
  scrubbed: "CARGO_*, E5_*, RUSTFLAGS, RUSTDOCFLAGS, RUST_LOG; repository profile and wasm-pack packaging unchanged" };
await writeFile(path.join(output, "invocation.json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
const p = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
const out = [], err = [];
p.stdout.on("data", b => { out.push(b); process.stdout.write(b); });
p.stderr.on("data", b => { err.push(b); process.stdout.write(b); });
const status = await new Promise((resolve, reject) => { p.once("error", reject); p.once("close", (code, signal) => resolve({ code, signal })); });
await writeFile(path.join(output, "build.stdout"), Buffer.concat(out), { flag: "wx" });
await writeFile(path.join(output, "build.stderr"), Buffer.concat(err), { flag: "wx" });
await writeFile(path.join(output, "exit.json"), JSON.stringify(status) + "\n", { flag: "wx" });
assert.equal(status.code, 0); assert.equal(status.signal, null);
assert.deepEqual(await pins(), before, "runtime source changed during production build");
const artifacts = {};
for (const [name, source] of [["rust-web.wasm", "target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm"],
  ["release-web.wasm", "crates/wasm/pkg/wasm_vm_wasm_bg.wasm"]]) {
  await copyFile(path.join(root, source), path.join(output, name));
  const b = await readFile(path.join(output, name)); artifacts[name] = { source, bytes: b.length, sha256: sha(b) };
}
await writeFile(path.join(output, "result.json"), JSON.stringify({ ...metadata, artifacts }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, artifacts }));
