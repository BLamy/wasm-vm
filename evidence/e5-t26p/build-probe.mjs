// Build matched compiler probes; no browser, deployment, or semantic-pass claim.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const mainRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baselineHead = "d7d308a58825e6856db532822e36e1681230027a";
const [phase, source, output] = process.argv.slice(2);
assert.ok(phase === "baseline" || phase === "candidate");
assert.equal(process.argv.length, 5);
assert.ok(path.isAbsolute(source) && path.resolve(source) === source);
assert.ok(phase === "baseline" ? /^\/private\/tmp\/e5-t26p-baseline\.[A-Za-z0-9]+$/u.test(source) : source === mainRepo);
assert.equal(path.dirname(output), path.join(mainRepo, "evidence/e5-t26p"));
assert.match(path.basename(output), /^artifact-(baseline|candidate)-[A-Za-z0-9-]+$/u);
assert.ok(path.basename(output).startsWith(`artifact-${phase}-`));
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const probeRelative = "crates/core/examples/retirement_capture_probe.rs";
const manifestRelative = "evidence/e5-t26p/probe-crate/Cargo.toml";
const files = ["Cargo.toml", "Cargo.lock", "rust-toolchain.toml", ".cargo/config.toml",
  "crates/core/Cargo.toml", "crates/core/src/hart/mod.rs",
  "crates/core/src/lib.rs", "crates/core/src/trace.rs", manifestRelative, probeRelative];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(path.join(source, file)))])));
const before = await hashes();
if (phase === "baseline") {
  for (const file of files.filter(file => file !== probeRelative && file !== manifestRelative)) {
    const committed = execFileSync("git", ["show", `${baselineHead}:${file}`], { cwd: mainRepo, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(before[file], sha(committed), `baseline source drift: ${file}`);
  }
}
for (const file of [probeRelative, manifestRelative])
  assert.equal(before[file], sha(await readFile(path.join(mainRepo, file))), "probe differs between source trees");
await mkdir(output);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("CARGO_") && !key.startsWith("E5_") && !["RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG"].includes(key)));
env.CARGO_TARGET_DIR = path.join(source, "target", path.basename(output));
env.CARGO_PROFILE_RELEASE_CODEGEN_UNITS = "1";
const commands = [];
const run = async (name, command, args) => {
  commands.push({ name, command, args, cwd: source });
  console.log(JSON.stringify({ phase, name, command, args }));
  const child = spawn(command, args, { cwd: source, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout = [], stderr = [];
  child.stdout.on("data", b => stdout.push(b));
  child.stderr.on("data", b => { stderr.push(b); process.stdout.write(b); });
  const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
  await writeFile(path.join(output, `${name}.stdout`), Buffer.concat(stdout), { flag: "wx" });
  await writeFile(path.join(output, `${name}.stderr`), Buffer.concat(stderr), { flag: "wx" });
  await writeFile(path.join(output, `${name}.exit.json`), JSON.stringify(result) + "\n", { flag: "wx" });
  assert.equal(result.signal, null); assert.equal(result.code, 0, `${name} failed; artifacts retained`);
};
const metadata = { schema: "wasm-vm.e5-t26p.compiler-probes.v1", phase, source, baselineHead,
  mainHead: execFileSync("git", ["rev-parse", "HEAD"], { cwd: mainRepo, encoding: "utf8" }).trim(),
  builderSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  rustc: execFileSync("rustc", ["-vV"], { cwd: source, env, encoding: "utf8" }),
  cargo: execFileSync("cargo", ["-V"], { cwd: source, env, encoding: "utf8" }).trim(),
  wasm2wat: execFileSync("wasm2wat", ["--version"], { env, encoding: "utf8" }).trim(),
  before, flags: { CARGO_TARGET_DIR: env.CARGO_TARGET_DIR, CARGO_PROFILE_RELEASE_CODEGEN_UNITS: "1",
    cargo: "--offline --release --manifest-path evidence/e5-t26p/probe-crate/Cargo.toml; standalone probe excludes core dev-dependencies; core default std + trace" },
  limitation: "Compiler probes and positive control; not production-browser timing or complete semantic evidence" };
await writeFile(path.join(output, "invocation.json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
const manifest = path.join(source, manifestRelative);
const probeLock = path.join(path.dirname(manifest), "Cargo.lock");
// Seed compatible dependency versions from the repository lock, then record the
// standalone manifest's pruned lock. Subsequent builds are strictly locked.
await copyFile(path.join(source, "Cargo.lock"), probeLock);
await run("probe-lock", "cargo", ["check", "--offline", "--manifest-path", manifest]);
await copyFile(probeLock, path.join(output, "probe-Cargo.lock"));
const common = ["rustc", "--locked", "--offline", "--release", "--manifest-path", manifest];
await run("native-build", "cargo", [...common, "--", "--emit=asm,link"]);
const examples = path.join(env.CARGO_TARGET_DIR, "release/deps");
const asm = (await readdir(examples)).filter(name => /^retirement_capture_probes-[a-f0-9]+\.s$/u.test(name));
assert.equal(asm.length, 1, "need one unambiguous fresh assembly artifact");
await copyFile(path.join(examples, asm[0]), path.join(output, "native.s"));
await copyFile(path.join(env.CARGO_TARGET_DIR, "release/retirement-capture-probes"), path.join(output, "native-probe"));
await run("native-smoke", path.join(output, "native-probe"), []);
const exports = ["capture_hart_unit_probe", "capture_hart_record_probe", "capture_machine_unit_probe", "capture_machine_record_probe"];
await run("wasm-build", "cargo", [...common, "--target", "wasm32-unknown-unknown", "--", ...exports.map(name => `-Clink-arg=--export=${name}`)]);
await copyFile(path.join(env.CARGO_TARGET_DIR, "wasm32-unknown-unknown/release/retirement-capture-probes.wasm"), path.join(output, "probe.wasm"));
await run("wasm-decode", "wasm2wat", [path.join(output, "probe.wasm")]);
const after = await hashes();
assert.deepEqual(after, before, "source changed during compiler recording");
const artifacts = Object.fromEntries(await Promise.all(["native.s", "native-probe", "probe.wasm", "wasm-decode.stdout", "probe-Cargo.lock"].map(async file => {
  const bytes = await readFile(path.join(output, file)); return [file, { bytes: bytes.length, sha256: sha(bytes) }];
})));
await writeFile(path.join(output, "result.json"), JSON.stringify({ ...metadata, after, commands, artifacts }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ phase, output, artifacts }));
