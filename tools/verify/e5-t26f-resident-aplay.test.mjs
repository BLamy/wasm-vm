// Actual shell helper, with proc/device paths replaced ONLY in this test copy.
// The fake proc files test refusal logic, not real hardware/restore acceptance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const source = readFileSync(new URL("../guest/e5-t26f-resident-aplay.sh", import.meta.url), "utf8");
const q = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const payloadLine = source.match(/^    e5_pcm=\$\(yes .*$/m)?.[0];
assert.ok(payloadLine, "execute the actual prepare payload expression");

function fixture(t, { prepare = false, io = true } = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "e5t26f-resident-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ["child/fd", "child/fdinfo", "parent/fd", "parent/fdinfo", "asound/card0/pcm0p/sub0"])
    mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, "aplay"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(path.join(dir, "pcm"), "PCM identity fixture\n");
  writeFileSync(path.join(dir, "foreign"), "foreign inode\n");
  let copy = source
    .replaceAll('/proc/"$e5_pid"', `${dir}/child`)
    .replaceAll('/proc/$e5_pid', `${dir}/child`)
    .replaceAll('/proc/"$$"', `${dir}/parent`)
    .replaceAll('/proc/$$', `${dir}/parent`)
    .replaceAll('/proc/asound/', `${dir}/asound/`)
    .replaceAll('/tmp/e5t26f-resident.fifo', `${dir}/fifo`)
    .replaceAll('/dev/snd/pcmC0D0p', `${dir}/pcm`)
    .replaceAll('/usr/bin/aplay', `${dir}/aplay`);
  assert.doesNotMatch(copy, /\/proc\/|\/dev\/snd\/|\/usr\/bin\/aplay/);
  writeFileSync(path.join(dir, "helper.sh"), copy);
  if (!prepare) {
    const mk = spawnSync("mkfifo", [path.join(dir, "fifo")]);
    assert.equal(mk.status, 0);
    symlinkSync(path.join(dir, "aplay"), path.join(dir, "child/exe"));
    symlinkSync(path.join(dir, "fifo"), path.join(dir, "child/fd/4"));
    symlinkSync(path.join(dir, "pcm"), path.join(dir, "child/fd/5"));
    symlinkSync(path.join(dir, "fifo"), path.join(dir, "parent/fd/3"));
    writeFileSync(path.join(dir, "child/fdinfo/4"), "pos:\t0\nflags:\t0100000\n");
    writeFileSync(path.join(dir, "parent/fdinfo/3"), "pos:\t0\nflags:\t0100002\n");
    writeFileSync(path.join(dir, "child/wchan"), "pipe_read"); // deliberately no newline
    if (io) writeFileSync(path.join(dir, "child/io"), "rchar: 100\nwchar: 89\nsyscr: 19\nsyscw: 5\n");
  }
  return { dir, invoke(script) {
    const result = spawnSync("/bin/sh", ["-c", `. ${q(path.join(dir, "helper.sh"))}\n${script}`], {
      encoding: "utf8", timeout: 5_000, maxBuffer: 512 * 1024,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return result;
  } };
}

function status(dir, { state = "PREPARED", owner = '"$e5_pid"', hw = "0", appl = "0", extra = "" } = {}) {
  return `printf 'state: ${state}\\nowner_pid   : %s\\nhw_ptr     : ${hw}\\nappl_ptr   : ${appl}\\n${extra}' ${owner} > ${q(path.join(dir, "asound/card0/pcm0p/sub0/status"))}`;
}

function stat(dir, { pid = '"$e5_pid"', start = "777", parent = '"$$"', comm = "(aplay)" } = {}) {
  return `printf '%s ${comm} S %s ${"0 ".repeat(17)}${start} 0\\n' ${pid} ${parent} > ${q(path.join(dir, "child/stat"))}`;
}

function playFixture(t, attack = () => "", { exitCode = 0, io = true } = {}) {
  const f = fixture(t, { io });
  const result = f.invoke(`
    (exit ${exitCode}) &
    e5_pid=$! e5_parent=$$ e5_writer_open=1
    ${stat(f.dir)}
    ${status(f.dir)}
    ${payloadLine}
    exec 3>${q(path.join(f.dir, "fed.pcm"))}
    e5_observe || exit 97
    e5_expected_pid=$e5_pid e5_expected=$e5_seen e5_armed=1
    ${attack(f.dir)}
    # No external command is available during the actual play function.
    PATH=${q(path.join(f.dir, "no-executables"))}
    play
  `);
  assert.notEqual(result.status, 97, "unattacked fixture must satisfy the actual observer");
  return { ...f, result, pcm: readFileSync(path.join(f.dir, "fed.pcm")) };
}

test("actual play alias validates, feeds exact 3840 bytes, waits child zero, then prints green using only builtins", (t) => {
  const { result, pcm } = playFixture(t);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(pcm.length, 3840);
  assert.deepEqual(pcm, Buffer.from(Array.from({ length: 960 }, () => [1, 0, 255, 127]).flat()));
  assert.match(result.stdout, /start=777 .*inode-match\) wchan=pipe_read/);
  assert.match(result.stdout, /fifoFD=4 flags=0100000 readonly=1 parentFD=3 flags=0100002 child-writers=0/);
  assert.match(result.stdout, /pcmFD=5 owner=\d+ state=PREPARED hw_ptr=0 appl_ptr=0/);
  assert.ok(result.stdout.indexOf("e5t26f-post") < result.stdout.indexOf("\x1b[42me5t26f-aplay"));
  assert.equal(result.stdout.match(/\x1b\[42me5t26f-aplay/g)?.length, 1);
  assert.doesNotMatch(result.stdout, /resident-failed/);
});

const attacks = {
  "wrong saved PID": () => "e5_pid=999999",
  "wrong actual stat PID": (d) => stat(d, { pid: "999999" }),
  "changed starttime": (d) => stat(d, { start: "778" }),
  "wrong parent shell": (d) => stat(d, { parent: "999999" }),
  "malformed comm cannot shift starttime": (d) => stat(d, { comm: "(a play)" }),
  "wrong executable inode": (d) => `rm ${q(`${d}/child/exe`)}; ln -s ${q(`${d}/foreign`)} ${q(`${d}/child/exe`)}`,
  "not blocked in pipe_read": (d) => `printf wait_woken > ${q(`${d}/child/wchan`)}`,
  "missing actual FIFO descriptor": (d) => `rm ${q(`${d}/child/fd/4`)}`,
  "wrong FIFO inode": (d) => `rm ${q(`${d}/child/fd/4`)}; ln -s ${q(`${d}/foreign`)} ${q(`${d}/child/fd/4`)}`,
  "child inherited extra writer": (d) => `ln -s ${q(`${d}/fifo`)} ${q(`${d}/child/fd/6`)}; printf 'flags: 0100001\\n' > ${q(`${d}/child/fdinfo/6`)}`,
  "child FIFO descriptor is read-write": (d) => `printf 'flags: 0100002\\n' > ${q(`${d}/child/fdinfo/4`)}`,
  "malformed fd flags": (d) => `printf 'flags: 0100008\\n' > ${q(`${d}/child/fdinfo/4`)}`,
  "missing parent writer": (d) => `rm ${q(`${d}/parent/fd/3`)}`,
  "extra parent writer": (d) => `ln -s ${q(`${d}/fifo`)} ${q(`${d}/parent/fd/7`)}`,
  "parent descriptor read-only": (d) => `printf 'flags: 0100000\\n' > ${q(`${d}/parent/fdinfo/3`)}`,
  "missing PCM descriptor": (d) => `rm ${q(`${d}/child/fd/5`)}`,
  "wrong PCM device inode": (d) => `rm ${q(`${d}/child/fd/5`)}; ln -s ${q(`${d}/foreign`)} ${q(`${d}/child/fd/5`)}`,
  "wrong PCM owner": (d) => status(d, { owner: "999999" }),
  "OPEN is not PREPARED": (d) => status(d, { state: "OPEN" }),
  "RUNNING is not PREPARED": (d) => status(d, { state: "RUNNING" }),
  "nonzero hardware pointer": (d) => status(d, { hw: "480" }),
  "queued application data": (d) => status(d, { appl: "480" }),
  "duplicate PCM status field": (d) => status(d, { extra: "state: PREPARED\\n" }),
  "unreadable/missing PCM status": (d) => `rm ${q(`${d}/asound/card0/pcm0p/sub0/status`)}`,
  "child I/O changed after prepare": (d) => `printf 'rchar: 101\\nwchar: 89\\nsyscr: 19\\nsyscw: 5\\n' > ${q(`${d}/child/io`)}`,
  "available I/O accounting disappears": (d) => `rm ${q(`${d}/child/io`)}`,
  "not armed": () => "e5_armed=0",
};

for (const [label, attack] of Object.entries(attacks)) {
  test(`refuses ${label} before feeding or green success`, (t) => {
    const { result, pcm } = playFixture(t, attack);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /\x1b\[41me5t26f-resident-failed:/);
    assert.doesNotMatch(result.stdout, /\x1b\[42m/);
    assert.equal(pcm.length, 0);
  });
}

test("failed feed reports red and cannot print completion", (t) => {
  const { result, pcm } = playFixture(t, () => "exec 3>&-");
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /resident-failed:feed/);
  assert.doesNotMatch(result.stdout, /\x1b\[42m/);
  assert.equal(pcm.length, 0);
});

test("kernel without optional task I/O accounting still requires all actual PCM and FIFO guards", (t) => {
  const { result, pcm } = playFixture(t, undefined, { io: false });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(pcm.length, 3840);
  assert.match(result.stdout, /state=PREPARED hw_ptr=0 appl_ptr=0/);
  assert.match(result.stdout, /\x1b\[42me5t26f-aplay/);
  const rejected = playFixture(t, (d) => status(d, { appl: "480" }), { io: false });
  assert.notEqual(rejected.result.status, 0);
  assert.equal(rejected.pcm.length, 0);
  assert.doesNotMatch(rejected.result.stdout, /\x1b\[42m/);
});

test("nonzero original child exit refuses green even after a successful finite feed", (t) => {
  const { result, pcm } = playFixture(t, undefined, { exitCode: 23 });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /resident-failed:child-exit/);
  assert.doesNotMatch(result.stdout, /\x1b\[42m/);
  assert.equal(pcm.length, 3840);
});

test("prepare requires two matching observations and retains the actual observation in parent RAM", (t) => {
  const f = fixture(t, { prepare: true });
  const result = f.invoke(`
    count=0
    e5_observe() { count=$((count + 1)); e5_seen=actual-observation; }
    e5_print_observation() { printf 'observation:%s\\n' "$1"; }
    sleep() { :; }
    e5_prepare || exit 1
    [ "$count" = 2 ] && [ "$e5_expected" = actual-observation ] &&
      [ "$e5_expected_pid" = "$e5_pid" ] && [ "$e5_armed" = 1 ] || exit 2
    exec 3>&-
    wait "$e5_pid"
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /observation:pre-1\nobservation:pre-2\n\x1b\[42me5t26f-prepared/);
});

for (const unstable of [false, true]) {
  test(`prepare bounds ${unstable ? "changing" : "refused"} observations without green`, (t) => {
    const f = fixture(t, { prepare: true });
    const result = f.invoke(`
      count=0
      e5_observe() { count=$((count + 1)); e5_seen=$count; return ${unstable ? 0 : 1}; }
      e5_print_observation() { :; }
      sleep() { :; }
      e5_prepare
      rc=$?
      [ "$rc" != 0 ] && [ "$count" = ${unstable ? 200 : 100} ] && [ "$e5_armed" = 0 ] || exit 2
      wait "$e5_pid"
    `);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /resident-failed:prepare-timeout/);
    assert.doesNotMatch(result.stdout, /\x1b\[42m/);
  });
}

test("actual child launch closes inherited FD3 before exec, with fixed real PCM parameters", () => {
  assert.match(source, /\(exec 3>&-; exec \/usr\/bin\/aplay -Dhw:0,0 --period-size=480 --buffer-size=960/);
  assert.match(source, /-f S16_LE -t raw -r48000 -c2 \/tmp\/e5t26f-resident\.fifo\) &\n    e5_pid=\$!/);
  const play = source.slice(source.indexOf("e5_play() {"));
  assert.ok(play.indexOf('exec 3>&-') < play.indexOf('wait "$e5_pid"'));
  assert.ok(play.indexOf('wait "$e5_pid"') < play.indexOf('42me5t26f-aplay'));
  assert.match(play, /play\(\) \{ e5_play; \}/);
});
