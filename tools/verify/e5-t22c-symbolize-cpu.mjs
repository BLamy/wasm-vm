#!/usr/bin/env node
// Recover names for an already-recorded release module, without rerunning the
// guest under different code. Every non-custom section must be byte-identical.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

function reader(bytes) {
  let at = 0;
  return {
    get remaining() { return bytes.length - at; },
    take(n) { assert.ok(n >= 0 && n <= bytes.length - at, "bounded Wasm section"); const b = bytes.subarray(at, at + n); at += n; return b; },
    uint() { let n = 0; for (let shift = 0; shift < 35; shift += 7) { const b = this.take(1)[0]; n += (b & 127) * 2 ** shift; if (!(b & 128)) { assert.ok(n <= 0xffffffff); return n; } } throw Error("invalid u32 LEB"); },
    string() { return this.take(this.uint()).toString("utf8"); },
  };
}

function sections(bytes) {
  const r = reader(bytes);
  assert.deepEqual(r.take(8), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]));
  const result = [];
  while (r.remaining) { const id = r.take(1)[0]; result.push({ id, bytes: r.take(r.uint()) }); }
  return result;
}

export function bindNames(release, named) {
  const a = sections(release).filter(s => s.id), b = sections(named).filter(s => s.id);
  assert.deepEqual(b, a, "named Wasm executable sections differ from the recorded release");
  const names = new Map();
  for (const section of sections(named).filter(s => !s.id)) {
    const r = reader(section.bytes);
    if (r.string() !== "name") continue;
    while (r.remaining) {
      const id = r.take(1)[0], sub = reader(r.take(r.uint()));
      if (id !== 1) continue;
      const count = sub.uint();
      for (let i = 0; i < count; ++i) names.set(sub.uint(), sub.string());
      assert.equal(sub.remaining, 0);
    }
  }
  assert.ok(names.size, "function names required");
  return { names, releaseSha256: sha(release), namedSha256: sha(named),
    sections: a.map(s => ({ id: s.id, payloadSha256: sha(s.bytes) })) };
}

export function summarize(recording, names) {
  const p = recording.profile, nodes = new Map(p.nodes.map(n => [n.id, n])), parents = new Map();
  for (const n of p.nodes) for (const child of n.children || []) parents.set(child, n.id);
  assert.equal(p.samples.length, p.timeDeltas.length);
  const self = new Map(), inclusive = new Map();
  const moduleUrl = new URL("./pkg/wasm_vm_wasm_bg.wasm", recording.url).href;
  const name = n => {
    assert.ok(n, "sampled node exists");
    const f = n.callFrame, match = /^wasm-function\[(\d+)\]$/.exec(f.functionName);
    return f.url === moduleUrl && match ? (names.get(Number(match[1])) || f.functionName) : `${f.functionName} ${f.url}`.trim();
  };
  let totalUs = 0;
  for (let i = 0; i < p.samples.length; ++i) {
    let id = p.samples[i]; const us = p.timeDeltas[i], leaf = name(nodes.get(id)), seen = new Set(), visited = new Set();
    assert.ok(Number.isFinite(us) && us >= 0); totalUs += us;
    self.set(leaf, (self.get(leaf) || 0) + us);
    while (id) {
      assert.ok(!visited.has(id), "acyclic profile tree"); visited.add(id);
      const key = name(nodes.get(id));
      if (!seen.has(key)) { inclusive.set(key, (inclusive.get(key) || 0) + us); seen.add(key); }
      id = parents.get(id);
    }
  }
  assert.ok(totalUs > 0);
  const ranked = m => [...m].sort((a, b) => b[1] - a[1]).map(([name, us]) => ({ name, us, percent: 100 * us / totalUs }));
  return { totalUs, samples: p.samples.length, self: ranked(self), inclusive: ranked(inclusive) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [releaseFile, namedFile, input, output] = process.argv.slice(2);
  assert.ok(releaseFile && namedFile && input && output, "release.wasm named.wasm profile-directory output-directory");
  const binding = bindNames(await readFile(releaseFile), await readFile(namedFile));
  const profiles = {};
  for (const file of (await readdir(input)).filter(f => f.endsWith("-cpu.json")).sort()) {
    const raw = await readFile(path.join(input, file));
    profiles[file] = { sha256: sha(raw), ...summarize(JSON.parse(raw), binding.names) };
  }
  assert.ok(Object.keys(profiles).length);
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, "cpu-summary.json"), JSON.stringify({ ...binding, names: Object.fromEntries(binding.names), profiles }, null, 2) + "\n");
  console.log(`Bound ${Object.keys(profiles).length} profiles to release ${binding.releaseSha256}`);
}
