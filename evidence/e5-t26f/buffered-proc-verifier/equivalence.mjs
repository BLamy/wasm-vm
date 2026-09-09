import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const parent = "7f15d76646a9f94e9c089b53bb7202fb1278a18c";
const head = "52b29b9a41103337aba77bc5d002090111991c2d";
const helperPath = "tools/guest/e5-t26f-resident-aplay.sh";
const testPath = "tools/verify/e5-t26f-resident-aplay.test.mjs";
const wrapperPath = "tools/verify/e5-t26f-browser-buffered-proc.mjs";
const wrapperTestPath = "tools/verify/e5-t26f-browser-buffered-proc.test.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const q = value => `'${value.replaceAll("'", "'\\''")}'`;

assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), head);
const legacy = execFileSync("git", ["show", `${parent}:${helperPath}`], { cwd: repo });
const candidate = readFileSync(path.join(repo, helperPath));
const bindings = {
  head,
  parent,
  legacyHelperSha256: sha(legacy),
  candidateHelperSha256: sha(candidate),
  candidateTestSha256: sha(readFileSync(path.join(repo, testPath))),
  wrapperSha256: sha(readFileSync(path.join(repo, wrapperPath))),
  wrapperTestSha256: sha(readFileSync(path.join(repo, wrapperTestPath))),
};
assert.equal(bindings.legacyHelperSha256, "2ae65408985f18be8b1287521bad23803282d652bb8f98421a135a351dac213c");
assert.equal(bindings.candidateHelperSha256, "324e0acddd88bd2d41b0310444e32e2262dedd3129132240134dac857d4eec2e");
assert.equal(bindings.candidateTestSha256, "1f4543e1d67757724578b1889bd39b84d489b853418ffdc0dcc248cbeca07654");
assert.equal(bindings.wrapperSha256, "536d02b9833ca889c4b22b9df87f1d303d1e71df26b6fa135bdcd0d34effa90e");
assert.equal(bindings.wrapperTestSha256, "9058fdda19af29d2a460d0e23b33d8054f9fe63109357ccbaf3c84d2495d9ea7");

const out = path.join(here, "equivalence-run-r5");
mkdirSync(out); // Deliberately refuse overwrite/replay into retained evidence.
writeFileSync(path.join(out, "bindings.json"), JSON.stringify(bindings, null, 2) + "\n", { flag: "wx" });

function adapt(sourceBytes, dir) {
  let source = sourceBytes.toString()
    .replaceAll('/proc/"$e5_pid"', `${dir}/child`)
    .replaceAll('/proc/$e5_pid', `${dir}/child`)
    .replaceAll('/proc/"$$"', `${dir}/parent`)
    .replaceAll('/proc/$$', `${dir}/parent`)
    .replaceAll('/proc/asound/', `${dir}/asound/`)
    .replaceAll('/tmp/e5t26f-resident.fifo', `${dir}/fifo`)
    .replaceAll('/dev/snd/pcmC0D0p', `${dir}/pcm`)
    .replaceAll('/usr/bin/aplay', `${dir}/aplay`)
    .replaceAll('/bin/busybox cat', '/bin/cat');
  // Path adaptation must not rewrite the unchanged user-visible printer literal.
  source = source.replaceAll(`exe=${dir}/aplay(inode-match)`, "exe=/usr/bin/aplay(inode-match)");
  assert.doesNotMatch(source, /\/proc\/|\/dev\/snd\/|\/bin\/busybox cat/);
  assert.equal(source.split("/usr/bin/aplay").length, 2, "only unchanged printer literal may retain production path");
  return source;
}

const defaultIo = "rchar:\t100\nwchar: 89\nsyscr:\t19 \nsyscw: 5\nread_bytes: 0\nwrite_bytes: 4096\ncancelled_write_bytes: 0\n";
const basicIo = "rchar: 100\nwchar: 89\nsyscr: 19\nsyscw: 5\n";
const defaultStatus = "state: PREPARED\nowner_pid   : 123\nhw_ptr     : 0\nappl_ptr   : 0\ntrigger_time: 0.000000\ntstamp: 0.000000\ndelay: 0\navail: 960\navail_max: 960\n-----\n";

function runOne(label, flavor, sourceBytes, options = {}) {
  const dir = path.join(out, `${label}-${flavor}`);
  for (const name of ["child/fd", "child/fdinfo", "parent/fd", "parent/fdinfo", "asound/card0/pcm0p/sub0"])
    mkdirSync(path.join(dir, name), { recursive: true });
  writeFileSync(path.join(dir, "aplay"), "aplay inode fixture\n");
  writeFileSync(path.join(dir, "pcm"), "pcm inode fixture\n");
  writeFileSync(path.join(dir, "foreign"), "foreign inode\n");
  execFileSync("mkfifo", [path.join(dir, "fifo")]);
  symlinkSync(path.join(dir, "aplay"), path.join(dir, "child/exe"));
  symlinkSync(path.join(dir, "fifo"), path.join(dir, "child/fd/4"));
  symlinkSync(path.join(dir, "pcm"), path.join(dir, "child/fd/5"));
  symlinkSync(path.join(dir, "fifo"), path.join(dir, "parent/fd/3"));
  writeFileSync(path.join(dir, "child/fdinfo/4"), options.childFdinfo ?? "pos:\t0\nflags:\t0100000\nmnt_id:\t352\nino:\t5\n");
  writeFileSync(path.join(dir, "parent/fdinfo/3"), options.parentFdinfo ?? "pos:\t0\nflags:\t0100002\nmnt_id:\t352\nino:\t5\n");
  writeFileSync(path.join(dir, "child/wchan"), options.wchan ?? "pipe_read");
  writeFileSync(path.join(dir, "asound/card0/pcm0p/sub0/status"), options.status ?? defaultStatus);
  if (options.io !== null) writeFileSync(path.join(dir, "child/io"), options.io ?? defaultIo);

  let adapted = adapt(sourceBytes, dir);
  if (options.sabotage) adapted = options.sabotage(adapted);
  writeFileSync(path.join(dir, "helper.sh"), adapted);
  chmodSync(path.join(dir, "helper.sh"), 0o700);
  const rest = options.statRest ?? Array(30).fill("0").join(" ");
  const command = `. ${q(path.join(dir, "helper.sh"))}
e5_pid=123 e5_parent=$$
printf '%s (aplay) S %s ${"0 ".repeat(17)}777 ${rest}\\n' "$e5_pid" "$$" > ${q(path.join(dir, "child/stat"))}
e5_observe
rc=$?
printf 'RC=%s\\n' "$rc"
if [ "$rc" = 0 ]; then
  printf 'SEEN=%s\\n' "$e5_seen"
  e5_print_observation equivalence
fi
exit "$rc"
`;
  const result = spawnSync("/bin/sh", ["-c", command], { cwd: repo, encoding: "utf8", timeout: 5000, maxBuffer: 512 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  writeFileSync(path.join(dir, "stdout.log"), result.stdout, { flag: "wx" });
  writeFileSync(path.join(dir, "stderr.log"), result.stderr, { flag: "wx" });
  return { label, flavor, status: result.status, stdout: result.stdout, stderr: result.stderr,
    helperSha256: sha(Buffer.from(adapted)) };
}

const accepted = [
  { name: "full-io-and-pcm-status", options: {} },
  { name: "basic-io-only", options: { io: basicIo, status: "state: PREPARED\nowner_pid: 123\nhw_ptr: 0\nappl_ptr: 0\n" } },
  { name: "io-unavailable", options: { io: null } },
];
const acceptedResults = [];
for (const item of accepted) {
  const old = runOne(item.name, "legacy", legacy, item.options);
  const next = runOne(item.name, "candidate", candidate, item.options);
  assert.equal(old.status, 0, `${item.name} legacy refused: ${old.stderr}`);
  assert.equal(next.status, 0, `${item.name} candidate refused: ${next.stderr}`);
  assert.equal(next.stdout, old.stdout, `${item.name} changed accepted observation bytes`);
  acceptedResults.push({ name: item.name, outputSha256: sha(Buffer.from(old.stdout)), bytes: Buffer.byteLength(old.stdout) });
}

const stricter = [
  { name: "exact-52-stat-fields", options: { statRest: Array(29).fill("0").join(" ") } },
  { name: "wchan-exact-eof", options: { wchan: "pipe_read\n" } },
  { name: "fdinfo-duplicate-key", options: { childFdinfo: "flags: 0100000\nflags: 0100000\n" } },
  { name: "pcm-single-value", options: { status: "state: PREPARED ignored\nowner_pid: 123\nhw_ptr: 0\nappl_ptr: 0\n" } },
  { name: "io-required-schema", options: { io: "rchar: 100\nwchar: 89\nsyscr: 19\n" } },
  // Linux 6.6 stores this field as u64 and proc prints it with %llu. A leading
  // minus is non-kernel text even though the docs describe its effect as negative I/O.
  { name: "signed-cancelled-write-bytes-is-non-kernel-text", options: { io: "rchar: 100\nwchar: 89\nsyscr: 19\nsyscw: 5\nread_bytes: 0\nwrite_bytes: 4096\ncancelled_write_bytes: -4096\n" } },
];
const stricterResults = [];
for (const item of stricter) {
  const old = runOne(item.name, "legacy", legacy, item.options);
  const next = runOne(item.name, "candidate", candidate, item.options);
  assert.equal(old.status, 0, `${item.name} was not a genuine stricter refusal; legacy also refused`);
  assert.notEqual(next.status, 0, `${item.name} candidate unexpectedly accepted`);
  stricterResults.push({ name: item.name, legacyStatus: old.status, candidateStatus: next.status });
}

const novelIo = `${defaultIo}unexpected_counter: 7\n`;
const novelLegacy = runOne("novel-unknown-io-key", "legacy", legacy, { io: novelIo });
const novelCandidate = runOne("novel-unknown-io-key", "candidate", candidate, { io: novelIo });
assert.equal(novelLegacy.status, 0, "novel attack must be accepted by the legacy loose io collector");
assert.notEqual(novelCandidate.status, 0, "candidate must refuse an unknown io key");

const rejectBlock = `                rchar|wchar|syscr|syscw) e5_io_basic=$((e5_io_basic + 1));;
                read_bytes|write_bytes|cancelled_write_bytes) e5_io_accounting=$((e5_io_accounting + 1));;
                *) return 1;;`;
const acceptBlock = `                rchar|wchar|syscr|syscw) e5_io_basic=$((e5_io_basic + 1));;
                read_bytes|write_bytes|cancelled_write_bytes) e5_io_accounting=$((e5_io_accounting + 1));;
                *) :;;`;
const sabotage = source => {
  assert.equal(source.split(rejectBlock).length, 2, "sabotage target must be unique");
  return source.replace(rejectBlock, acceptBlock);
};
const mutant = runOne("novel-unknown-io-key", "sabotaged-candidate", candidate, { io: novelIo, sabotage });
assert.equal(mutant.status, 0, "sabotage must defeat the unknown-key refusal");
assert.throws(() => assert.notEqual(mutant.status, 0), assert.AssertionError, "rejection oracle must fail against mutant");

assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), head);
assert.equal(sha(readFileSync(path.join(repo, helperPath))), bindings.candidateHelperSha256);
assert.equal(sha(readFileSync(path.join(repo, testPath))), bindings.candidateTestSha256);
const result = {
  verdict: "HELD",
  scope: "Controlled proc-byte acquisition/parser equivalence and refusal only; no real player, browser, timing, or F acceptance.",
  bindings,
  accepted: acceptedResults,
  stricterRefusals: stricterResults,
  novelAttack: { name: "all required io fields plus unknown key", legacyStatus: novelLegacy.status,
    candidateStatus: novelCandidate.status, sabotagedCandidateStatus: mutant.status, effectiveSabotage: true },
  kernelContractFinding: "Candidate correctly rejects signed cancelled_write_bytes text: Linux 6.6 stores the field as u64 and formats /proc/$pid/io with unsigned %llu.",
};
writeFileSync(path.join(out, "results.json"), JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(result, null, 2));
