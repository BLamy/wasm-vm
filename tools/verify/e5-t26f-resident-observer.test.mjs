// Exercise the real shell adapter with a deliberately fake observer protocol.
// This does NOT prove C /proc parsing or real aplay/PCM; those have separate gates.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = readFileSync(new URL("../guest/e5-t26f-resident-observer.sh", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../guest/e5-t26f-resident-aplay.sh", import.meta.url), "utf8");
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const accepted = "e5-observe-v1/777/12345/4/0100000/5/0100002/|rchar: 0|wchar: 0|syscr: 0|syscw: 0";

function fixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), "e5-t26f-shell-observer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const observer = path.join(directory, "observer"), helper = path.join(directory, "helper.sh");
  writeFileSync(observer, '#!/bin/sh\nprintf "%s\\n" "$E5_TEST_REPLY"\nexit "$E5_TEST_EXIT"\n', { mode: 0o755 });
  writeFileSync(helper, source.replaceAll("/usr/libexec/wasm-vm/e5t26f-observe", observer));
  return { directory, observer, helper, run: (script, reply = accepted, exit = 0) => spawnSync("/bin/sh", ["-c",
    `. ${quote(helper)}\ne5_pid=777 e5_parent=$$\n${script}`], {
    encoding: "utf8", timeout: 5000, env: { PATH: "/usr/bin:/bin", E5_TEST_REPLY: reply, E5_TEST_EXIT: String(exit) },
  }) };
}

test("arming, finite feed, same-child wait and three printed observations remain byte-identical", () => {
  const begin = text => text.slice(text.indexOf("e5_print_observation()"));
  assert.equal(begin(source), begin(legacy));
  assert.match(source, /e5_record=\$\(exec \/usr\/libexec\/wasm-vm\/e5t26f-observe "\$e5_pid" "\$e5_parent"\)/u);
  const code = source.slice(0, source.indexOf("e5_print_observation()")).split("\n")
    .filter(line => !line.trimStart().startsWith("#")).join("\n");
  assert.doesNotMatch(code, /\beval\b|\bread\b|busybox cat/u);
});

test("successful versioned result populates exact old fields and printer bytes", t => {
  const f = fixture(t), r = f.run('e5_observe || exit 97; printf "%s\\n" "$e5_seen"; e5_print_observation post');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, `${accepted.slice("e5-observe-v1/".length)}\n` +
    "e5t26f-post pid=777 start=12345 exe=/usr/bin/aplay(inode-match) wchan=pipe_read\n" +
    "fifoFD=4 flags=0100000 readonly=1 parentFD=3 flags=0100002 child-writers=0\n" +
    "pcmFD=5 owner=777 state=PREPARED hw_ptr=0 appl_ptr=0\n");
});

for (const [name, reply] of Object.entries({
  "missing version": accepted.slice(14), "wrong version": accepted.replace("v1", "v2"),
  "wrong PID": accepted.replace("/777/", "/888/"), "missing field": "e5-observe-v1/777/1/2/000/3/0002",
  "empty field": accepted.replace("/12345/", "//"), "non-numeric field": accepted.replace("/12345/", "/x/"),
  "writer child flags": accepted.replace("0100000", "0100001"),
  "read-only parent flags": accepted.replace("0100002", "0100000"),
  "non-octal flags": accepted.replace("0100000", "0100008"),
  "overbound flags": accepted.replace("0100000", "0".repeat(12)),
  "wrong IO tag": accepted.replace("|rchar:", "rchar:"),
  "surplus slash": `${accepted}/surplus`, "surplus line": `${accepted}\nextra`,
  "overbound result": `${accepted}${"x".repeat(4353)}`,
})) test(`malformed observer response refuses before feed: ${name}`, t => {
  const f = fixture(t), r = f.run(`exec 3>${quote(path.join(f.directory, "feed"))}
e5_writer_open=1 e5_armed=1 e5_expected_pid=777 e5_expected=${quote(reply.slice("e5-observe-v1/".length))} e5_pcm=forbidden
e5_play`, reply);
  assert.notEqual(r.status, 0); assert.match(r.stdout, /resident-failed:post-identity/u);
  assert.equal(readFileSync(path.join(f.directory, "feed")).length, 0);
  assert.doesNotMatch(r.stdout, /\u001b\[42m/u);
});

test("observer failures discard even apparently successful partial output and preserve category", t => {
  const f = fixture(t);
  for (const [code, category] of [[10, "identity"], [20, "fifo"], [30, "pcm"], [64, "identity"], [74, "identity"], [127, "identity"]]) {
    const r = f.run('if e5_observe; then exit 97; fi; printf "%s/%s" "$e5_reason" "$e5_record"', accepted, code);
    assert.equal(r.status, 0); assert.equal(r.stdout, `${category}/`);
  }
});

test("unavailable optional accounting survives byte-exactly; changed observation cannot feed", t => {
  const f = fixture(t), reply = accepted.slice(0, accepted.indexOf("/|")) + "/unavailable";
  const good = f.run('e5_observe || exit 97; printf "%s" "$e5_io"', reply);
  assert.equal(good.status, 0); assert.equal(good.stdout, "unavailable");
  const r = f.run(`exec 3>${quote(path.join(f.directory, "feed"))}; e5_writer_open=1 e5_armed=1 e5_expected_pid=777 e5_expected=other e5_pcm=forbidden; e5_play`, reply);
  assert.notEqual(r.status, 0); assert.equal(readFileSync(path.join(f.directory, "feed")).length, 0);
});

test("actual command-substitution exec preserves physical parent and parent's FD3", t => {
  const f = fixture(t), c = path.join(f.directory, "transport.c");
  // This tiny test-only executable checks process transport, not observation facts.
  writeFileSync(c, `#include <unistd.h>
#include <fcntl.h>
#include <stdlib.h>
#include <stdio.h>
int main(int argc,char **argv) {
  if(argc!=3 || getppid()!=atoi(argv[2])) return 10;
  if(close(3)!=0 || fcntl(3,F_GETFD)!=-1) return 20;
  puts("${accepted}"); return 0;
}
`);
  const cc = spawnSync("/usr/bin/clang", ["-std=c11", "-Wall", "-Wextra", "-Werror", c, "-o", f.observer], { encoding: "utf8" });
  assert.equal(cc.status, 0, cc.stderr);
  const r = f.run(`exec 3>${quote(path.join(f.directory, "parent-writer"))}; e5_observe || exit 97; printf parent-retained >&3`);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(path.join(f.directory, "parent-writer"), "utf8"), "parent-retained");
});
