import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { bindNames } from "../../../tools/verify/e5-t22c-symbolize-cpu.mjs";
const exec = promisify(execFile), hash = bytes => createHash("sha256").update(bytes).digest("hex");
const out = "target/e5-t26f/resident-symbols", evidence = "evidence/e5-t26f/resident-profile-analysis";
const release = "web/pkg/wasm_vm_wasm_bg.wasm", input = "target/wasm32-unknown-unknown/release/wasm_vm_wasm.wasm";
const before = { release: hash(await fs.readFile(release)), input: hash(await fs.readFile(input)) };
assert.equal(before.release, "8df0e82c87aa25d39988517b045b42712f8c94d1bec4f0d1db5ed2ab772f0e3a");
await fs.mkdir(out);
await fs.copyFile(release, `${out}/release.wasm`, (await import("node:fs")).constants.COPYFILE_EXCL);
const commands = [
  ["/Users/blamy/Library/Caches/.wasm-pack/wasm-bindgen-cargo-install-0.2.126/wasm-bindgen", ["--target", "web", "--out-dir", `${out}/bindgen`, "--out-name", "wasm_vm_wasm", input]],
  ["/Users/blamy/Library/Caches/.wasm-pack/wasm-opt-50385c9e73ccee70/bin/wasm-opt", ["-O", "-g", `${out}/bindgen/wasm_vm_wasm_bg.wasm`, "-o", `${out}/named.wasm`]],
  [process.execPath, ["tools/verify/e5-t22c-symbolize-cpu.mjs", `${out}/release.wasm`, `${out}/named.wasm`, "evidence/e5-t26f/resident-profile-33a65efb", evidence]],
];
const results = [];
for (const [command, args] of commands) {
  const startedAt = new Date().toISOString();
  const result = await exec(command, args, { timeout: 90_000, maxBuffer: 1024 * 1024 });
  results.push({ command, args, startedAt, finishedAt: new Date().toISOString(), ...result });
}
const binding = bindNames(await fs.readFile(release), await fs.readFile(`${out}/named.wasm`));
const after = { release: hash(await fs.readFile(release)), input: hash(await fs.readFile(input)) };
assert.deepEqual(after, before, "shared input bytes changed");
await fs.writeFile(`${evidence}/symbol-build.json`, JSON.stringify({ before, after, commands: results,
  releaseSha256: binding.releaseSha256, namedSha256: binding.namedSha256, names: binding.names.size,
  sections: binding.sections }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ names: binding.names.size, sections: binding.sections.length,
  release: binding.releaseSha256, named: binding.namedSha256 }));
