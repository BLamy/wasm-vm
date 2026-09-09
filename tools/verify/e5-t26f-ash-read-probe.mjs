// Authenticate a single retained native run. Counts are observations, not a timing prediction.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const directory = process.argv[2];
assert.equal(process.argv.length, 3, "usage: node e5-t26f-ash-read-probe.mjs EVIDENCE_DIRECTORY");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const read = file => readFileSync(path.join(directory, file));
const helper = readFileSync(new URL("../guest/e5-t26f-resident-aplay.sh", import.meta.url));
assert.equal(hash(helper), "2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c");
const probe = readFileSync(new URL("./e5-t26f-ash-read-probe.sh", import.meta.url));
assert.deepEqual(read("run.sh"), probe);
const versions = read("versions.txt").toString();
assert.match(versions, /BusyBox v1\.36\.1\b/);
assert.match(versions, /strace -- version 6\.9\b/);
assert.ok(versions.includes(`${hash(probe)}  /work/run.sh`));
const binaries = {};
for (const file of ["/bin/busybox", "/usr/bin/strace"]) {
  const line = versions.split("\n").find(line => line.endsWith(`  ${file}`));
  assert.match(line ?? "", /^[0-9a-f]{64}  /);
  binaries[file] = line.slice(0, 64);
}

// strace's C escapes, decoded explicitly: never evaluate trace text as JavaScript.
function decodeCString(text) {
  assert.ok(text.startsWith('"') && text.endsWith('"'));
  const bytes = [];
  for (let i = 1; i < text.length - 1; i++) {
    let c = text[i];
    if (c !== "\\") { assert.ok(c.charCodeAt(0) < 128); bytes.push(c.charCodeAt(0)); continue; }
    c = text[++i];
    const escaped = { n: 10, r: 13, t: 9, b: 8, f: 12, v: 11, "\\": 92, '"': 34 };
    if (Object.hasOwn(escaped, c)) bytes.push(escaped[c]);
    else if (c === "x") {
      const hex = text.slice(i + 1, i + 3); assert.match(hex, /^[0-9a-f]{2}$/i);
      bytes.push(parseInt(hex, 16)); i += 2;
    } else if (/[0-7]/.test(c)) {
      const octal = text.slice(i).match(/^[0-7]{1,3}/)[0];
      bytes.push(parseInt(octal, 8)); i += octal.length - 1;
    } else assert.fail(`unknown C escape ${c}`);
  }
  return Buffer.from(bytes);
}

const results = [];
for (const mode of ["builtin", "whole"]) {
  const pidText = read(`${mode}.pid`).toString().trim();
  assert.match(pidText, /^[1-9][0-9]*$/);
  const traceBytes = read(`${mode}.strace`), trace = traceBytes.toString();
  assert.match(trace, new RegExp(`^${pidText} +execve\\("/bin/busybox", \\["/bin/busybox", "ash"`, "m"));
  // The three finite proc reads are sequential; refuse incomplete/error/truncated target calls.
  for (const kind of ["stat", "fdinfo", "io"]) {
    const target = `/proc/${pidText}/${kind === "fdinfo" ? "fdinfo/3" : kind}`;
    const calls = [], chunks = [];
    for (const [index, line] of trace.split("\n").entries()) {
      if (!line.includes(`<${target}>`)) continue;
      const match = line.match(/^(\d+)\s+read\(\d+<[^>]+>, ("(?:[^"\\]|\\.)*"), (\d+)\)\s+=\s+(\d+)$/);
      assert.ok(match, `unparsed target read at ${mode}:${index + 1}: ${line}`);
      const [, pid, encoded, requested, returned] = match;
      const bytes = decodeCString(encoded);
      assert.equal(bytes.length, Number(returned), "truncated/mismatched read payload");
      assert.ok(Number(requested) >= bytes.length);
      if (mode === "builtin") assert.equal(pid, pidText, "builtin read came from another process");
      else assert.notEqual(pid, pidText, "whole-file comparator must execute real cat");
      chunks.push(bytes);
      calls.push({ line: index + 1, pid: Number(pid), requested: Number(requested), returned: bytes.length });
    }
    assert.ok(calls.length > 0, `missing ${mode}/${kind} reads`);
    if (mode === "whole") {
      const catPids = new Set(calls.map(call => call.pid)); assert.equal(catPids.size, 1);
      assert.match(trace, new RegExp(`^${[...catPids][0]} +execve\\("/bin/busybox", \\["/bin/busybox", "cat"`, "m"));
    }
    const output = read(`${mode}-${kind}.data`);
    assert.ok(output.length > 0 && output.at(-1) === 10);
    assert.deepEqual(Buffer.concat(chunks), output, "actual proc read bytes differ from real output");
    if (kind === "stat") assert.ok(output.toString().startsWith(`${pidText} (`));
    if (kind === "fdinfo") assert.match(output.toString(), /^flags:\s+[0-7]+$/m);
    if (kind === "io") assert.match(output.toString(), /^syscr:\s+\d+$/m);
    results.push({ mode, kind, target, bytes: output.length, reads: calls.length,
      positiveReads: calls.filter(call => call.returned > 0).length,
      eofReads: calls.filter(call => call.returned === 0).length,
      returnedSizeHistogram: calls.reduce((hist, call) => { hist[call.returned] = (hist[call.returned] ?? 0) + 1; return hist; }, {}),
      calls, outputSha256: hash(output), traceSha256: hash(traceBytes) });
  }
}
const summary = { acceptance: false, scope: "Native aarch64 BusyBox ash read primitive on its own real proc files; not full e5_observe, aplay, RISC-V, browser timing or a fixture promotion.",
  helperSha256: hash(helper), probeSha256: hash(probe), parserSha256: hash(readFileSync(new URL(import.meta.url))),
  binaries, versions, results };
writeFileSync(path.join(directory, "summary.json"), JSON.stringify(summary, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ acceptance: false, results: results.map(({ calls, ...rest }) => rest) }, null, 2));
