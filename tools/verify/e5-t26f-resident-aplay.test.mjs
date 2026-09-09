// Actual shell helper, with proc/device paths replaced ONLY in this test copy.
// The fixed BusyBox cat invocation is adapted to real Mac /bin/cat, not a reader mock.
// The fake proc files test refusal logic, not real hardware/restore acceptance.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Test-only opt-in. Native mode keeps the production BusyBox invocation intact.
const dockerSetting = process.env.E5_T26F_RESIDENT_TEST_DOCKER;
assert.ok(dockerSetting === undefined || dockerSetting === "1", "E5_T26F_RESIDENT_TEST_DOCKER must be omitted or exactly 1");
const dockerMode = dockerSetting === "1";
const dockerImage = "sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";
let invocation = 0;

const source = readFileSync(new URL("../guest/e5-t26f-resident-aplay.sh", import.meta.url), "utf8");
const q = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const payloadLine = source.match(/^    e5_pcm=\$\(yes .*$/m)?.[0];
assert.ok(payloadLine, "execute the actual prepare payload expression");

function fixture(t, { prepare = false, io = true, ioText = "rchar: 100\nwchar: 89\nsyscr: 19\nsyscw: 5\n", mutate = value => value, catBody } = {}) {
  const parent = dockerMode ? fileURLToPath(new URL("../../target/e5-t26f/", import.meta.url)) : os.tmpdir();
  if (dockerMode) mkdirSync(parent, { recursive: true });
  const dir = mkdtempSync(path.join(parent, "e5t26f-resident-test-"));
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
  if (!dockerMode) copy = copy.replaceAll('/bin/busybox cat', '/bin/cat');
  if (catBody) {
    writeFileSync(path.join(dir, "cat-adapter.sh"), `#!/bin/sh\n${catBody(dir)}\n`, { mode: 0o700 });
    copy = copy.replaceAll(dockerMode ? '/bin/busybox cat' : '/bin/cat', q(path.join(dir, "cat-adapter.sh")));
  }
  copy = mutate(copy);
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
    if (io) writeFileSync(path.join(dir, "child/io"), ioText);
  }
  return { dir, invoke(script) {
    const command = `. ${q(path.join(dir, "helper.sh"))}\n${script}`;
    const container = `e5t26f-resident-test-${process.pid}-${++invocation}`;
    const args = dockerMode ? ["run", "--rm", "--pull=never", "--network=none", "--cpus=1", "--memory=128m", "--pids-limit=32",
      "--name", container, "--mount", `type=bind,src=${dir},dst=${dir}`, "--workdir", dir,
      dockerImage, "/bin/busybox", "ash", "-c", command] : ["-c", command];
    const result = spawnSync(dockerMode ? "docker" : "/bin/sh", args, {
      encoding: "utf8", timeout: 5_000, maxBuffer: 512 * 1024,
    });
    if (dockerMode && (result.error || result.signal)) {
      // Only this uniquely named fixture container; normal exits use --rm.
      spawnSync("docker", ["rm", "--force", container], { timeout: 5_000 });
    }
    assert.equal(result.error, undefined);
    assert.equal(result.signal, null);
    return result;
  } };
}

function status(dir, { state = "PREPARED", owner = '"$e5_pid"', hw = "0", appl = "0", extra = "" } = {}) {
  return `printf 'state: ${state}\\nowner_pid   : %s\\nhw_ptr     : ${hw}\\nappl_ptr   : ${appl}\\n${extra}' ${owner} > ${q(path.join(dir, "asound/card0/pcm0p/sub0/status"))}`;
}

function stat(dir, { pid = '"$e5_pid"', start = "777", parent = '"$$"', comm = "(aplay)", rest = Array(30).fill("0").join(" ") } = {}) {
  return `printf '%s ${comm} S %s ${"0 ".repeat(17)}${start} ${rest}\\n' ${pid} ${parent} > ${q(path.join(dir, "child/stat"))}`;
}

function playFixture(t, attack = () => "", { exitCode = 0, io = true, ...options } = {}) {
  const f = fixture(t, { io, ...options });
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
    # PATH lookup is unavailable; only the explicitly adapted real cat can run.
    PATH=${q(path.join(f.dir, "no-executables"))}
    play
  `);
  assert.notEqual(result.status, 97, "unattacked fixture must satisfy the actual observer");
  return { ...f, result, pcm: readFileSync(path.join(f.dir, "fed.pcm")) };
}

test("actual play validates with buffered cat, feeds exact bytes, waits child zero; no PATH commands", (t) => {
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
  "truncated stat field list": (d) => stat(d, { rest: "0" }),
  "surplus stat fields": (d) => stat(d, { rest: Array(31).fill("0").join(" ") }),
  "stat glob is not expanded": (d) => stat(d, { rest: ["*", ...Array(29).fill("0")].join(" ") }),
  "negative starttime": (d) => stat(d, { start: "-1" }),
  "second stat record": (d) => `printf '\\n' >> ${q(`${d}/child/stat`)}`,
  "stat missing final newline": (d) => `text=$(/bin/cat ${q(`${d}/child/stat`)}); printf '%s' "$text" > ${q(`${d}/child/stat`)}`,
  "wchan extra newline": (d) => `printf 'pipe_read\\n' > ${q(`${d}/child/wchan`)}`,
  "wchan extra record": (d) => `printf 'pipe_read\\nwait_woken\\n' > ${q(`${d}/child/wchan`)}`,
  "missing flags field": (d) => `printf 'pos: 0\\n' > ${q(`${d}/child/fdinfo/4`)}`,
  "duplicate child flags": (d) => `printf 'flags: 0100000\\nflags: 0100000\\n' > ${q(`${d}/child/fdinfo/4`)}`,
  "duplicate parent flags": (d) => `printf 'flags: 0100002\\nflags: 0100002\\n' > ${q(`${d}/parent/fdinfo/3`)}`,
  "flags surplus token": (d) => `printf 'flags: 0100000 ignored\\n' > ${q(`${d}/child/fdinfo/4`)}`,
  "flags octal overflow": (d) => `printf 'flags: 7777777777777777777777777777777777770\\n' > ${q(`${d}/child/fdinfo/4`)}`,
  "flags missing final newline": (d) => `printf 'flags: 0100000' > ${q(`${d}/child/fdinfo/4`)}`,
  "PCM missing application pointer": (d) => `printf 'state: PREPARED\\nowner_pid: %s\\nhw_ptr: 0\\n' "$e5_pid" > ${q(`${d}/asound/card0/pcm0p/sub0/status`)}`,
  "PCM surplus value": (d) => status(d, { hw: "0 ignored" }),
  "PCM malformed separator": (d) => `printf 'state PREPARED\\nowner_pid: %s\\nhw_ptr: 0\\nappl_ptr: 0\\n' "$e5_pid" > ${q(`${d}/asound/card0/pcm0p/sub0/status`)}`,
  "duplicate PCM owner": (d) => status(d, { extra: "owner_pid: 0\\n" }),
  "readable empty I/O": (d) => `: > ${q(`${d}/child/io`)}`,
  "I/O missing mandatory field": (d) => `printf 'rchar: 100\\nwchar: 89\\nsyscr: 19\\n' > ${q(`${d}/child/io`)}`,
  "I/O duplicate field": (d) => `printf 'rchar: 100\\n' >> ${q(`${d}/child/io`)}`,
  "I/O negative counter": (d) => `printf 'rchar: -100\\nwchar: 89\\nsyscr: 19\\nsyscw: 5\\n' > ${q(`${d}/child/io`)}`,
  "I/O incomplete accounting group": (d) => `printf 'read_bytes: 0\\n' >> ${q(`${d}/child/io`)}`,
  "I/O extra token": (d) => `printf 'rchar: 100 extra\\nwchar: 89\\nsyscr: 19\\nsyscw: 5\\n' > ${q(`${d}/child/io`)}`,
  "I/O missing final newline": (d) => `text=$(/bin/cat ${q(`${d}/child/io`)}); printf '%s' "$text" > ${q(`${d}/child/io`)}`,
  "I/O unexpected blank record": (d) => `printf '\\n' >> ${q(`${d}/child/io`)}`,
  "I/O shell metacharacters are data": (d) => `printf '%s\\n' ${q(`rchar: $(touch ${d}/must-not-exist);*`)} > ${q(`${d}/child/io`)}`,
  "overbound proc text": (d) => `printf '%5000s\\n' 0 > ${q(`${d}/asound/card0/pcm0p/sub0/status`)}`,
};

function requireRefusal({ result, pcm }) {
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /\x1b\[41me5t26f-resident-failed:/);
  assert.doesNotMatch(result.stdout, /\x1b\[42m/);
  assert.equal(pcm.length, 0);
}

for (const [label, attack] of Object.entries(attacks)) {
  test(`refuses ${label} before feeding or green success`, (t) => {
    const observation = playFixture(t, attack);
    requireRefusal(observation);
    assert.throws(() => readFileSync(path.join(observation.dir, "must-not-exist")), { code: "ENOENT" });
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

test("three observation printf calls remain byte-identical to parent 7f15d766", () => {
  const printer = source.slice(source.indexOf("e5_print_observation() {"), source.indexOf("e5_prepare() {"));
  assert.equal(createHash("sha256").update(printer).digest("hex"), "fbe3ca0637bb704d9a51f22f91f7ddc0f4efe906f8a549098cac8819cd9716f8");
  assert.equal(printer.match(/    printf /g)?.length, 3);
});

test("capture preserves EOF and all trailing newlines at the exact small bound", (t) => {
  const f = fixture(t);
  for (const [index, bytes] of ["", "pipe_read", "line\n", "line\n\n", "x".repeat(128)].entries()) {
    // Immutable inputs: a fresh container can retain the old shared-file size
    // after a rapid host rewrite of the same inode (see native-fixture evidence).
    const file = path.join(f.dir, `capture-${index}.data`);
    writeFileSync(file, bytes, { flag: "wx" });
    const result = f.invoke(`e5_capture ${q(file)} 128 || exit 17\nprintf '%s' "$e5_text"`);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, bytes);
  }
});

for (const bytes of ["x".repeat(129), ":e5t26f-capture-end:", "prefix:e5t26f-capture-end:\n", ":e5t26f-capture-end::e5t26f-capture-end:"]) {
  test(`capture refuses overbound or embedded sentinel (${JSON.stringify(bytes.slice(0, 40))})`, (t) => {
    const f = fixture(t);
    writeFileSync(path.join(f.dir, "capture.data"), bytes);
    const result = f.invoke(`if e5_capture ${q(`${f.dir}/capture.data`)} 128; then exit 17; fi\n[ -z "$e5_text" ]`);
    assert.equal(result.status, 0, result.stderr);
  });
}

for (const sentinel of [":", "printf '%s' ':e5t26f-capture-en'"]) {
  test(`missing/truncated capture sentinel refuses even when cat succeeds (${sentinel})`, (t) => {
    const f = fixture(t, { mutate: text => text.replace("printf '%s' ':e5t26f-capture-end:'", sentinel) });
    const result = f.invoke(`if e5_capture ${q(`${f.dir}/child/wchan`)} 128; then exit 17; fi\n[ -z "$e5_text" ]`);
    assert.equal(result.status, 0, result.stderr);
  });
}

test("cat failure cannot turn partial data into a successful capture", (t) => {
  const f = fixture(t, { catBody: () => '/bin/cat "$@"\nexit 23' });
  const result = f.invoke(`if e5_capture ${q(`${f.dir}/child/wchan`)} 128; then exit 17; fi\n[ -z "$e5_text" ]`);
  assert.equal(result.status, 0, result.stderr);
});

test("missing/unreadable-as-file captures fail closed using real cat errors", (t) => {
  const f = fixture(t);
  for (const file of [`${f.dir}/missing`, `${f.dir}/child`]) {
    const result = f.invoke(`if e5_capture ${q(file)} 128; then exit 17; fi\n[ -z "$e5_text" ]`);
    assert.equal(result.status, 0);
    assert.notEqual(result.stderr, "", "real cat must report its failed file read");
  }
});

test("each actual capture subprocess has FD3 closed while parent feed descriptor stays open", (t) => {
  const observation = playFixture(t, undefined, { catBody: () => `
    if ( : >&3 ) 2>/dev/null; then printf 'reader inherited FD3\\n' >&2; exit 23; fi
    exec /bin/cat "$@"
  ` });
  assert.equal(observation.result.status, 0, observation.result.stderr);
  assert.equal(observation.pcm.length, 3840, "parent's actual descriptor must survive all captures");
});

for (const change of ["start", "pid", "parent", "exe", "exit"]) {
  test(`identity ${change} change during capture refuses before feed`, (t) => {
    const changedStat = change === "start" ? { start: "778" } : change === "pid" ? { pid: "999999" } : { parent: "999999" };
    const observation = playFixture(t, d => `
      ${stat(d, changedStat).replace(q(`${d}/child/stat`), q(`${d}/changed-stat`))}
      : > ${q(`${d}/attack`)}
    `, { catBody: d => `
      if [ "$1" = ${q(`${d}/child/io`)} ] && [ -e ${q(`${d}/attack`)} ]; then
        ${change === "exe" ? `/bin/rm ${q(`${d}/child/exe`)}; /bin/ln -s ${q(`${d}/foreign`)} ${q(`${d}/child/exe`)}` : change === "exit" ? `/bin/rm ${q(`${d}/child/stat`)}` : `/bin/cp ${q(`${d}/changed-stat`)} ${q(`${d}/child/stat`)}`}
      fi
      exec /bin/cat "$@"
    ` });
    requireRefusal(observation);
    assert.match(observation.result.stdout, /post-identity:identity/);
  });
}

test("readable optional io disappearing during cat is not silently unavailable", (t) => {
  const observation = playFixture(t, d => `: > ${q(`${d}/attack`)}`, { catBody: d => `
    if [ "$1" = ${q(`${d}/child/io`)} ] && [ -e ${q(`${d}/attack`)} ]; then /bin/rm "$1"; fi
    exec /bin/cat "$@"
  ` });
  requireRefusal(observation);
  assert.notEqual(observation.result.stderr, "");
});

test("in-memory io reconstruction preserves each original byte in |line serialization", (t) => {
  const ioText = "rchar:\t100\nwchar: 89\nsyscr:\t19 \nsyscw: 5\nread_bytes: 0\nwrite_bytes: 4096\ncancelled_write_bytes: 0\n";
  const f = fixture(t, { ioText });
  const result = f.invoke(`e5_pid=123 e5_parent=$$\n${stat(f.dir)}\n${status(f.dir)}\ne5_observe || exit 17\nprintf '%s' "$e5_seen"`);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `123/777/4/0100000/5/0100002/${ioText.slice(0, -1).split("\n").map(line => `|${line}`).join("")}`);
});

test("PCM ordinary timestamp/availability lines and delimiter retain required guards", (t) => {
  const observation = playFixture(t, d => status(d, { extra: "trigger_time: 0.000000\\ntstamp: 0.000000\\ndelay: 0\\navail: 960\\navail_max: 960\\n-----\\n" }));
  assert.equal(observation.result.status, 0, observation.result.stderr);
  assert.equal(observation.pcm.length, 3840);
});

test("zero-pointer guard sabotage in a temporary helper is killed by the same refusal oracle", (t) => {
  requireRefusal(playFixture(t, d => status(d, { hw: "480" })));
  const mutant = playFixture(t, d => status(d, { hw: "480" }), { mutate: text => {
    assert.equal(text.split('[ "$e5_hw_ptr" = 0 ]').length, 2);
    return text.replace('[ "$e5_hw_ptr" = 0 ]', ':');
  } });
  assert.equal(mutant.result.status, 0, "the sabotage must actually remove the live pointer refusal");
  assert.equal(mutant.pcm.length, 3840);
  assert.throws(() => requireRefusal(mutant), assert.AssertionError, "ordinary rejection test must fail against the mutant");
});

test("capture/parser source uses fixed cat and memory parsing, never read/eval/heredoc", () => {
  const buffered = source.slice(source.indexOf("e5_capture() {"), source.indexOf("e5_print_observation() {"));
  const commands = buffered.split("\n").filter(line => !line.trimStart().startsWith("#")).join("\n");
  assert.match(commands, /exec 3>&-\n        \/bin\/busybox cat "\$1" \|\| exit 1/);
  assert.doesNotMatch(commands, /\b(?:read|eval)[ \t]+|<<|set --/);
  assert.doesNotMatch(source, /E5_T26F_|MOCK|fixturePath/);
});
