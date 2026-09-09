// Authenticate compiler names against an existing production release; no browser run.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bindNames } from "../../tools/verify/e5-t22c-symbolize-cpu.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [phase, rustInput, release, output] = process.argv.slice(2);
assert.equal(process.argv.length, 6);
assert.ok(["baseline", "candidate"].includes(phase));
for (const input of [rustInput, release, output]) assert.equal(path.resolve(input), input);
assert.equal(path.dirname(output), path.join(root, "evidence/e5-t26p"));
assert.match(path.basename(output), /^release-(baseline|candidate)-[a-zA-Z0-9-]+$/u);
assert.ok(path.basename(output).startsWith(`release-${phase}-`));
const sha = data => createHash("sha256").update(data).digest("hex");
const pins = async () => Object.fromEntries(await Promise.all([rustInput, release].map(async file => {
  const data = await readFile(file); return [file, { bytes: data.length, sha256: sha(data) }];
})));
const before = await pins();
if (phase === "baseline") {
  assert.equal(before[rustInput].sha256, "d2cd30aa88cbae55539e820577dad401695d911df499bbe05fa13c126b870381");
  assert.equal(before[release].sha256, "20f58e0d44cc94f9d0629478789680e4a87345ba800162aa0737ddc763bfd238");
}
const bindgen = "/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen";
const wasmOpt = "/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt";
const wasm2wat = "/opt/homebrew/bin/wasm2wat";
await mkdir(output);
const commands = [];
async function run(label, executable, args) {
  const r = spawnSync(executable, args, { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  const entry = { label, executable, args, status: r.status, signal: r.signal };
  commands.push(entry);
  await writeFile(path.join(output, `${label}.stdout`), r.stdout ?? Buffer.alloc(0), { flag: "wx" });
  await writeFile(path.join(output, `${label}.stderr`), r.stderr ?? Buffer.alloc(0), { flag: "wx" });
  await writeFile(path.join(output, `${label}.json`), JSON.stringify(entry) + "\n", { flag: "wx" });
  assert.ifError(r.error); assert.equal(r.status, 0, `${label} failed`);
}
await writeFile(path.join(output, "invocation.json"), JSON.stringify({ phase, before,
  builderSha256: sha(await readFile(fileURLToPath(import.meta.url))),
  limitation: "Only authenticated production code identity and function names, not runtime or performance evidence." }, null, 2) + "\n", { flag: "wx" });
await run("bindgen-version", bindgen, ["--version"]);
await run("opt-version", wasmOpt, ["--version"]);
await run("wat-version", wasm2wat, ["--version"]);
const companion = path.join(output, "companion");
await run("bindgen", bindgen, ["--target", "web", "--out-dir", companion, "--out-name", "wasm_vm_wasm", rustInput]);
const named = path.join(output, "named.wasm");
await run("opt", wasmOpt, ["-O", "-g", path.join(companion, "wasm_vm_wasm_bg.wasm"), "-o", named]);
const binding = bindNames(await readFile(release), await readFile(named));
assert.equal(binding.sections.length, 11, "all eleven production non-custom sections must match");
await run("named-wat", wasm2wat, [named]);
const after = await pins();
assert.deepEqual(after, before, "input artifact changed during naming");
await writeFile(path.join(output, "binding.json"), JSON.stringify({ phase, before, after,
  commands, ...binding, names: Object.fromEntries(binding.names) }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ phase, output, releaseSha256: binding.releaseSha256,
  namedSha256: binding.namedSha256, authenticatedSections: binding.sections.length, names: binding.names.size }));
