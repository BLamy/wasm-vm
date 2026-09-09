// Lossless storage for the completed static-code evidence. Originals are retained.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const files = [
  "baseline/rust-web.wasm", "baseline/release-web.wasm",
  "production-candidate-r1/rust-web.wasm", "production-candidate-r1/release-web.wasm",
  ...["artifact-baseline-d7d308a5-r2", "artifact-candidate-d7d308a5-r1"].flatMap(d =>
    ["native.s", "native-probe", "probe.wasm", "wasm-decode.stdout", "native-disassembly.txt"].map(f => `${d}/${f}`)),
  ...["release-baseline-d7d308a5", "release-candidate-r1"].flatMap(d =>
    ["named.wasm", "named-wat.stdout", "disassembly.txt"].map(f => `${d}/${f}`)),
  "artifact-baseline-d7d308a5/native.s", "artifact-baseline-d7d308a5/native-probe",
  "semantics-r1/baseline-producer", "semantics-r1/candidate-producer",
];
const sha = b => createHash("sha256").update(b).digest("hex");
const entries = [];
for (const file of files) {
  const original = await readFile(path.join(root, file));
  const compressed = gzipSync(original, { level: 9 });
  assert.deepEqual(gunzipSync(compressed), original, `lossless archive: ${file}`);
  const archive = path.join(root, `${file}.gz`);
  try {
    assert.deepEqual(await readFile(archive), compressed, `existing archive differs: ${file}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(archive, compressed, { flag: "wx" });
  }
  entries.push({ file, bytes: original.length, sha256: sha(original), gzip: `${file}.gz`, gzipBytes: compressed.length, gzipSha256: sha(compressed) });
}
await writeFile(path.join(root, "packed-artifacts.json"), JSON.stringify({ schema: "wasm-vm.e5-t26p.lossless-artifacts.v1",
  note: "Gzip decompresses to the exact bytes cited by the static-code verdict and semantic comparison. Originals were not deleted. The first baseline attempt remains excluded from admitted evidence.", entries }, null, 2) + "\n");
console.log(JSON.stringify({ files: entries.length, originalBytes: entries.reduce((n, e) => n + e.bytes, 0), gzipBytes: entries.reduce((n, e) => n + e.gzipBytes, 0) }));
