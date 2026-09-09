// Independent old-source execution first; identical candidate fixture second.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const oldSource = "/private/tmp/e5-t26p-baseline.T3zMuW";
const oldHead = "d7d308a58825e6856db532822e36e1681230027a";
const fixture = "crates/core/examples/retirement_capture_baseline.rs";
const [suffix] = process.argv.slice(2);
assert.equal(process.argv.length, 3); assert.match(suffix, /^[a-zA-Z0-9-]+$/);
const output = path.join(root, `evidence/e5-t26p/semantics-${suffix}`);
const sha = b => createHash("sha256").update(b).digest("hex");
const inputs = ["Cargo.toml", "Cargo.lock", ".cargo/config.toml", "rust-toolchain.toml",
  "crates/core/Cargo.toml", "crates/core/src/hart/mod.rs", "crates/core/src/lib.rs"];
const hashes = async source => Object.fromEntries(await Promise.all([...inputs, fixture].map(async f => [f, sha(await readFile(path.join(source, f)))])));
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) =>
  !k.startsWith("CARGO_") && !k.startsWith("E5_") && !["RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG"].includes(k)));
await mkdir(output);
await copyFile(path.join(root, fixture), path.join(oldSource, fixture));
const fixtureDigest = sha(await readFile(path.join(root, fixture)));
const results = {};
for (const [phase, source] of [["baseline", oldSource], ["candidate", root]]) {
  const before = await hashes(source);
  assert.equal(before[fixture], fixtureDigest);
  if (phase === "baseline") for (const f of inputs) {
    assert.equal(before[f], sha(execFileSync("git", ["show", `${oldHead}:${f}`], { cwd: root })), `old source drift: ${f}`);
  }
  const args = ["run", "--locked", "--offline", "--release", "-p", "wasm-vm-core", "--features", "trace", "--example", "retirement_capture_baseline"];
  const invocation = { phase, source, oldHead, before, fixtureDigest, command: "cargo", args,
    builderSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    rustc: execFileSync("rustc", ["-vV"], { cwd: source, env, encoding: "utf8" }),
    cargo: execFileSync("cargo", ["-V"], { cwd: source, env, encoding: "utf8" }).trim() };
  await writeFile(path.join(output, `${phase}-invocation.json`), JSON.stringify(invocation, null, 2) + "\n", { flag: "wx" });
  const p = spawn("cargo", args, { cwd: source, env, stdio: ["ignore", "pipe", "pipe"] });
  const out = [], err = [];
  p.stdout.on("data", b => out.push(b));
  p.stderr.on("data", b => { err.push(b); process.stdout.write(b); });
  const status = await new Promise((resolve, reject) => { p.once("error", reject); p.once("close", (code, signal) => resolve({ code, signal })); });
  const stdout = Buffer.concat(out), stderr = Buffer.concat(err);
  await writeFile(path.join(output, `${phase}.stdout`), stdout, { flag: "wx" });
  await writeFile(path.join(output, `${phase}.stderr`), stderr, { flag: "wx" });
  await writeFile(path.join(output, `${phase}.exit.json`), JSON.stringify(status) + "\n", { flag: "wx" });
  assert.equal(status.code, 0, `${phase} failed; partial result preserved`); assert.equal(status.signal, null);
  assert.deepEqual(await hashes(source), before, "source changed during semantic recording");
  const binary = path.join(source, "target/release/examples/retirement_capture_baseline");
  await copyFile(binary, path.join(output, `${phase}-producer`));
  results[phase] = { ...invocation, stdoutSha256: sha(stdout), stdoutBytes: stdout.length,
    binarySha256: sha(await readFile(binary)), caseCount: (stdout.toString().match(/^CASE /gm) || []).length };
}
assert.deepEqual(await readFile(path.join(output, "candidate.stdout")), await readFile(path.join(output, "baseline.stdout")), "candidate state differs from independently executed old source");
await writeFile(path.join(output, "result.json"), JSON.stringify({ results, identical: true }, null, 2) + "\n", { flag: "wx" });
// Authoritative golden is old-source stdout, never computed by candidate capture code.
await copyFile(path.join(output, "baseline.stdout"), path.join(root, "evidence/e5-t26p/baseline-semantic.stdout"));
console.log(JSON.stringify({ output, fixtureDigest, cases: results.baseline.caseCount, stdoutSha256: results.baseline.stdoutSha256, identical: true }));
