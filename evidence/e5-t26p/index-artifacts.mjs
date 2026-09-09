// Mechanical code-size/callsite index; the critic still inspects full disassembly.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const sha = b => createHash("sha256").update(b).digest("hex");
const relevant = n => /capture_.*probe|Hart.*(?:execute|step_traced|step_with_capture)|Machine(?:::|\d)(?:run|step_cached)|RunCapture/.test(n);
function uint(bytes, state) {
  let value = 0;
  for (let shift = 0; shift < 35; shift += 7) {
    assert.ok(state.at < bytes.length); const b = bytes[state.at++]; value += (b & 127) * 2 ** shift;
    if (!(b & 128)) return value;
  }
  throw Error("invalid u32 LEB");
}
function wasmSections(b) {
  assert.deepEqual(b.subarray(0, 8), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const s = { at: 8 }, result = [];
  while (s.at < b.length) { const id = b[s.at++], bytes = uint(b, s), start = s.at;
    s.at += bytes; assert.ok(s.at <= b.length); result.push({ id, start, bytes }); }
  return result;
}
function listing(text, kind) {
  const lines = text.split("\n"), functions = []; let f;
  for (let i = 0; i < lines.length; ++i) {
    const m = (kind === "native" ? /^(_\S+):$/ : /^([a-f0-9]+) func\[(\d+)\] <(.+)>:$/).exec(lines[i]);
    if (m) { f = { name: kind === "native" ? m[1] : m[3], line: i + 1, code: [], calls: [] };
      if (kind === "wasm") f.index = Number(m[2]); functions.push(f); continue; }
    if (!f) continue;
    const a = (kind === "native" ? /^([a-f0-9]{16})\s+(.+)$/ : /^\s*([a-f0-9]+):[^|]+\|\s*(.+)$/).exec(lines[i]);
    if (!a) continue;
    f.code.push({ line: i + 1, address: a[1], instruction: a[2].trim() });
    const c = (kind === "native" ? /^bl?\s+(_\S+)/ : /^call (\d+) <(.+)>/).exec(a[2].trim());
    if (c) f.calls.push({ line: i + 1, address: a[1], name: kind === "native" ? c[1] : c[2] });
  }
  return functions;
}
const result = { schema: "wasm-vm.e5-t26p.artifact-index.v1", limitation:
  "Static compiled-code evidence only; instruction spans include any alignment listed by otool. No runtime or speed claim.", phases: {} };
for (const [phase, probeDir, releaseDir, releaseFile] of [
  ["baseline", "artifact-baseline-d7d308a5-r2", "release-baseline-d7d308a5", "baseline/release-web.wasm"],
  ["candidate", "artifact-candidate-d7d308a5-r1", "release-candidate-r1", "production-candidate-r1/release-web.wasm"],
]) {
  const nativePath = path.join(root, probeDir, "native-probe");
  const nativeBytes = await readFile(nativePath), nativeText = await readFile(path.join(root, probeDir, "native-disassembly.txt"), "utf8");
  const nativeSize = execFileSync("size", ["-m", nativePath], { encoding: "utf8" });
  await writeFile(path.join(root, probeDir, "native-size.txt"), nativeSize);
  const nf = listing(nativeText, "native").filter(f => relevant(f.name));
  const native = { file: `${probeDir}/native-probe`, sha256: sha(nativeBytes), bytes: nativeBytes.length,
    textBytes: Number(/Section __text: (\d+)/.exec(nativeSize)[1]),
    disassembly: `${probeDir}/native-disassembly.txt`, disassemblySha256: sha(nativeText),
    functions: nf.map(f => ({ name: f.name, line: f.line, firstAddress: f.code[0]?.address,
      instructions: f.code.length, instructionSpanBytes: f.code.length * 4,
      calls: f.calls.filter(c => relevant(c.name)) })) };
  const wb = await readFile(path.join(root, releaseFile)), sections = wasmSections(wb);
  const wt = await readFile(path.join(root, releaseDir, "disassembly.txt"), "utf8"), wf = listing(wt, "wasm");
  const code = sections.find(s => s.id === 10), state = { at: code.start }, count = uint(wb, state);
  assert.equal(count, wf.length);
  for (const f of wf) {
    const bytes = uint(wb, state), start = state.at; state.at += bytes;
    f.body = { fileOffset: start, bytes, sha256: sha(wb.subarray(start, state.at)) };
  }
  assert.equal(state.at, code.start + code.bytes);
  const wasm = { file: releaseFile, sha256: sha(wb), bytes: wb.length, codeSectionBytes: code.bytes,
    disassembly: `${releaseDir}/disassembly.txt`, disassemblySha256: sha(wt),
    functions: wf.filter(f => relevant(f.name) || /WasmLinux::run_chunk/.test(f.name)).map(f => ({
      name: f.name, index: f.index, line: f.line, body: f.body,
      calls: f.calls.filter(c => relevant(c.name)) })) };
  result.phases[phase] = { native, wasm };
}
result.deltas = Object.fromEntries(["native", "wasm"].map(k => [k, {
  wholeArtifactBytes: result.phases.candidate[k].bytes - result.phases.baseline[k].bytes,
  codeBytes: k === "native" ? result.phases.candidate[k].textBytes - result.phases.baseline[k].textBytes
    : result.phases.candidate[k].codeSectionBytes - result.phases.baseline[k].codeSectionBytes,
}]));
await writeFile(path.join(root, "artifact-index.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ deltas: result.deltas, functions: Object.fromEntries(Object.entries(result.phases).map(([p, v]) => [p, { native: v.native.functions.length, wasm: v.wasm.functions.length }])) }));
