#!/usr/bin/env node
// Native ARM Linux pre-check only: actual libc/BusyBox topology, controlled proc
// fixtures. Not a RISC-V boot, real prepared player, PCM or timing acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(repo, "target/e5-t26f/native-observer-v1");
const image = "alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const files = ["tools/guest/e5-t26f-observer.c", "tools/verify/e5-t26f-observer.test.c", "tools/guest/e5-t26f-resident-observer.sh"];
const sources = Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(repo, file)))]));
const compiler = realpathSync(execFileSync("which", ["zig"], { encoding: "utf8" }).trim());
const compilerSha256 = sha(readFileSync(compiler));
assert.equal(execFileSync(compiler, ["version"], { encoding: "utf8" }).trim(), "0.16.0");
mkdirSync(path.dirname(out), { recursive: true }); mkdirSync(out); // Refuse all reuse/overwrites.
for (const directory of ["tmp", "zig-global", "zig-local"]) mkdirSync(path.join(out, directory));
const env = { PATH: process.env.PATH, SOURCE_DATE_EPOCH: "1731542400", TMPDIR: path.join(out, "tmp"),
  ZIG_GLOBAL_CACHE_DIR: path.join(out, "zig-global"), ZIG_LOCAL_CACHE_DIR: path.join(out, "zig-local") };
const record = { acceptance: false, scope: "native ARM libc and shell transport; controlled proc fixtures",
  sourceBindings: sources, compiler, compilerSha256, compilerVersion: "0.16.0", image, runs: [] };
const write = (name, bytes) => writeFileSync(path.join(out, name), bytes, { flag: "wx" });
function run(command, args, options = {}) {
  console.log(JSON.stringify({ command, args }));
  const result = spawnSync(command, args, { cwd: repo, encoding: "utf8", timeout: 300_000, maxBuffer: 1024 * 1024, ...options });
  const { stdout, stderr, status, signal } = result;
  record.runs.push({ command, args, stdout, stderr, status, signal, error: result.error ? String(result.error) : null });
  if (stdout) process.stdout.write(stdout); if (stderr) process.stderr.write(stderr);
  assert.equal(result.error, undefined); assert.equal(signal, null); assert.equal(status, 0);
}
try {
  for (const [source, output] of [[files[0], "observer"], [files[1], "observer-tests"]]) {
    run(compiler, ["cc", "-target", "aarch64-linux-musl", "-mcpu=baseline", "-std=c11", "-Wall", "-Wextra", "-Werror",
      "-Os", "-static", "-s", "-Wl,--build-id=none", source, "-o", path.join(out, output)], { env });
  }
  const helper = readFileSync(path.join(repo, files[2]), "utf8");
  assert.equal(helper.split("/usr/libexec/wasm-vm/e5t26f-observe").length, 2);
  write("transport-helper.sh", helper.replace("/usr/libexec/wasm-vm/e5t26f-observe", "/work/observer-tests"));
  const command = `set -eu
/bin/busybox | head -n 1
/work/observer-tests
. /work/transport-helper.sh
e5_pid=111 e5_parent=$$
exec 3>/tmp/e5t26f-parent-writer
e5_observe
test "$e5_seen" = '111/777/4/0100000/5/0100002/|rchar:\t100|wchar: 89 |syscr: 19|syscw: 5'
printf 'parent-retained' >&3
exec 3>&-
test "$(cat /tmp/e5t26f-parent-writer)" = parent-retained
printf 'PASS: actual observer_main getppid/FD3 under BusyBox exec substitution; controlled proc only\\n'
`;
  write("transport.sh", command);
  run("docker", ["run", "--rm", "--pull=never", "--network=none", "--read-only", "--cap-drop=ALL",
    "--security-opt=no-new-privileges", "--cpus=1", "--memory=128m", "--pids-limit=32",
    "--tmpfs", "/tmp:rw,nosuid,nodev", "--mount", `type=bind,src=${out},dst=/work,readonly`,
    "--entrypoint", "/bin/busybox", image, "ash", "/work/transport.sh"]);
  record.binaries = Object.fromEntries(["observer", "observer-tests"].map(name => [name, sha(readFileSync(path.join(out, name)))]));
} catch (error) { record.failure = String(error); process.exitCode = 1; }
finally {
  try {
    assert.deepEqual(Object.fromEntries(files.map(file => [file, sha(readFileSync(path.join(repo, file)))])), sources);
    assert.equal(sha(readFileSync(compiler)), compilerSha256);
  } catch (error) { record.immutabilityFailure = String(error); process.exitCode = 1; }
  write("result.json", JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ output: out, failed: process.exitCode === 1, sources }));
}
