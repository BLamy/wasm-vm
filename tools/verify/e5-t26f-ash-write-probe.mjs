// Parse actual retained strace/PCM, not a timing estimate or browser acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const directory = process.argv[2];
assert.ok(directory, "usage: node tools/verify/e5-t26f-ash-write-probe.mjs EVIDENCE_DIRECTORY");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const helper = readFileSync(new URL("../guest/e5-t26f-resident-aplay.sh", import.meta.url), "utf8");
const probe = readFileSync(new URL("./e5-t26f-ash-write-probe.sh", import.meta.url), "utf8");
const expression = String.raw`e5_pcm=$(yes '\001\000\377\177' | head -n 960 | tr -d '\n')`;
assert.ok(helper.includes(expression) && probe.includes(expression), "baseline must use the actual helper expression");
assert.ok(helper.includes(`printf '%b' "$e5_pcm" >&3`) && probe.includes(`printf '%b' "$e5_pcm" >&3`));
const results = [];
for (const name of ["escaped-file", "escaped-fifo", "decoded-fifo"]) {
  const trace = readFileSync(path.join(directory, `${name}.strace`), "utf8");
  const pcm = readFileSync(path.join(directory, `${name}.pcm`));
  const target = `/work/results/${name}.${name === "escaped-file" ? "pcm" : "fifo"}`;
  const mainPid = trace.match(/^(\d+)\s+execve\("\/bin\/busybox", \["\/bin\/busybox", "ash"/m)?.[1];
  assert.ok(mainPid, "real BusyBox ash exec must be traced");
  const pending = new Map(), writes = [];
  for (const [index, line] of trace.split("\n").entries()) {
    const match = line.match(/^(\d+)\s+(.*)$/);
    if (!match) continue;
    const [, pid, text] = match;
    let call = text;
    if (/^(write|writev)\(/.test(text) && text.endsWith("<unfinished ...>")) {
      pending.set(pid, { call: text.replace("<unfinished ...>", ""), line: index + 1 });
      continue;
    }
    let startLine = index + 1;
    if (/^<\.\.\. (write|writev) resumed>/.test(text)) {
      const start = pending.get(pid);
      assert.ok(start, "resumed write lacks its actual original call");
      pending.delete(pid);
      call = start.call + text.replace(/^<\.\.\. (write|writev) resumed>/, "");
      startLine = start.line;
    }
    if (pid !== mainPid || !/^(write|writev)\(/.test(call) || !call.includes(`<${target}>`)) continue;
    const completed = call.match(/\)\s+=\s+(-?\d+)/);
    assert.ok(completed, `unparsed target write: ${call}`);
    const bytes = Number(completed[1]);
    assert.ok(bytes > 0, `failed or zero-byte target write at ${startLine}`);
    writes.push({ line: startLine, bytes });
  }
  assert.equal(pending.size, 0, "unfinished write trace");
  const expected = Buffer.from(Array.from({ length: 960 }, () => [1, name === "decoded-fifo" ? 1 : 0, 255, 127]).flat());
  assert.equal(pcm.length, expected.length, `${name} reader must receive all finite PCM`);
  assert.equal(hash(pcm), hash(expected), `${name} reader must receive exact finite PCM`);
  assert.equal(writes.reduce((n, write) => n + write.bytes, 0), 3840);
  const histogram = {};
  for (const { bytes } of writes) histogram[bytes] = (histogram[bytes] ?? 0) + 1;
  results.push({ name, mainPid: Number(mainPid), target, writes: writes.length, bytes: pcm.length,
    writeSizeHistogram: histogram, firstWriteLine: writes[0].line, lastWriteLine: writes.at(-1).line,
    pcmSha256: hash(pcm), traceSha256: hash(trace) });
}
console.log(JSON.stringify({ acceptance: false, helperSha256: hash(helper), probeSha256: hash(probe),
  parserSha256: hash(readFileSync(new URL(import.meta.url))),
  versions: readFileSync(path.join(directory, "versions.txt"), "utf8"), results }, null, 2));
