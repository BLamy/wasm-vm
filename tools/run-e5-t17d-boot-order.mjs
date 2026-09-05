#!/usr/bin/env node

// E5-T17d: replay the final T17c desktop image through the native emulator's serial boot path.
// The image intentionally has no root password, so this driver records the serial login boundary,
// continues to a fixed instruction bound for tty1, and reads the persistent boot-order audit.
// Each run is a fresh process and a fresh copy of the handoff image; the varying quantum is a
// deterministic timing perturbation, not host randomness.

import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repo, "target/release/wasm-vm");
const kernel = path.join(repo, "releases/kernel/6.6.63/Image");
const handoffPath = path.join(repo, "evidence/e5-t17c/desktop-image-reproducibility.json");
const evidenceDir = path.join(repo, "evidence/e5-t17d");
const runRoot = path.join(repo, "target/e5-t17d/boots");
const runCount = Number(process.env.E5_T17D_RUN_COUNT ?? "20");
const timeoutMs = Number(process.env.E5_T17D_BOOT_TIMEOUT_MS ?? String(20 * 60 * 1_000));
const maxInstrs = "6000000000";
const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256File = async (file) => sha256Bytes(await readFile(file));
const relative = (file) => path.relative(repo, file);

assert.ok(Number.isSafeInteger(runCount) && runCount === 20, "E5-T17d requires exactly 20 cold boots");
assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "E5_T17D_BOOT_TIMEOUT_MS must be positive");

for (const file of [cli, kernel, handoffPath]) {
  const fileStat = await stat(file);
  assert.ok(fileStat.isFile() && fileStat.size > 0, `missing T17d input: ${file}`);
}

const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
assert.equal(handoff.schema, "wasm-vm.e5-t17c.desktop-image-reproducibility.v1");
assert.equal(handoff.task, "E5-T17c");
const build = handoff.builds?.b;
assert.ok(build?.output && build?.image?.sha256, "T17c handoff has no final build B");
const sourceImage = path.join(repo, build.output, "alpine-rootfs.ext4");
const sourceManifest = path.join(repo, build.output, "MANIFEST.txt");
const sourceFileManifest = path.join(repo, build.output, "FILE-MANIFEST.txt");
for (const file of [sourceImage, sourceManifest, sourceFileManifest]) {
  const fileStat = await stat(file);
  assert.ok(fileStat.isFile() && fileStat.size > 0, `missing final T17c handoff file: ${file}`);
}
const sourceImageSha256 = await sha256File(sourceImage);
assert.equal(sourceImageSha256, build.image.sha256, "T17c handoff image digest is stale");
assert.equal(await sha256File(sourceManifest), build.packageManifest.sha256, "T17c package lock is stale");
assert.equal(await sha256File(sourceFileManifest), build.fileManifest.sha256, "T17c file lock is stale");

await mkdir(evidenceDir, { recursive: true });
await mkdir(runRoot, { recursive: true });

const source = {
  task: "E5-T17c",
  handoff: relative(handoffPath),
  image: { path: relative(sourceImage), sha256: sourceImageSha256, size: (await stat(sourceImage)).size },
  packageManifest: { path: relative(sourceManifest), sha256: await sha256File(sourceManifest) },
  fileManifest: { path: relative(sourceFileManifest), sha256: await sha256File(sourceFileManifest) },
  chunkManifest: {
    path: handoff.chunks?.desktop?.manifestPath ?? "target/e5-t17c/chunks/desktop-b/manifest.json",
    reusedPositionCount: handoff.chunks?.reusedPositionCount,
    newObjectCount: handoff.chunks?.newObjectCount,
  },
};

const runs = await Promise.all(
  Array.from({ length: runCount }, (_, index) => runBoot(index + 1)),
);

for (const run of runs) {
  assert.equal(run.ok, true, `${run.id} failed: ${run.error ?? "unknown failure"}`);
}

const output = {
  schema: "wasm-vm.e5-t17d.desktop-boot-order.v1",
  task: "E5-T17d",
  environment: "native-emulator",
  architecture: "riscv64",
  policy: { independentMachines: false, webkit: false, hostRr: false },
  command: "node tools/run-e5-t17d-boot-order.mjs",
  boot: {
    count: runs.length,
    coldCopyPerRun: true,
    profileStopsAt: "fixed-instruction-bound-after-serial-login",
    timeoutMs,
    maxInstrs,
    deviceMode: "headless-no-gpu",
    timingPerturbation: "fixed seed -> quantum; no wall-clock or random seed controls guest state",
  },
  source,
  runs,
};
const outputPath = path.join(evidenceDir, "boot-order.json");
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`E5T17D_BOOT_ORDER=${JSON.stringify({
  evidence: relative(outputPath),
  sourceImageSha256,
  runCount: runs.length,
  allPassed: true,
})}\n`);

async function runBoot(ordinal) {
  const seed = (0xe5_17d0_00 + ordinal * 0x9e3779b1) >>> 0;
  const quantum = 100_000 + (seed % 9) * 20_000;
  const id = `boot-${String(ordinal).padStart(2, "0")}`;
  const runDir = path.join(runRoot, id);
  const imagePath = path.join(runDir, "alpine-rootfs.ext4");
  const consolePath = path.join(evidenceDir, `${id}-console.log`);
  const stderrPath = path.join(evidenceDir, `${id}-stderr.log`);
  const guestEvidencePath = path.join(evidenceDir, `${id}-guest-evidence.txt`);
  await mkdir(runDir, { recursive: true });
  await copyFile(sourceImage, imagePath);
  await Promise.all([
    rm(consolePath, { force: true }),
    rm(stderrPath, { force: true }),
    rm(guestEvidencePath, { force: true }),
  ]);
  const preImageSha256 = await sha256File(imagePath);
  if (preImageSha256 !== sourceImageSha256) {
    return { id, ordinal, seed, quantum, ok: false, error: "clean image copy digest drifted" };
  }

  const stdoutLog = createWriteStream(consolePath);
  const stderrLog = createWriteStream(stderrPath);
  const stdoutFinished = new Promise((resolve) => stdoutLog.once("finish", resolve));
  const stderrFinished = new Promise((resolve) => stderrLog.once("finish", resolve));
  const child = spawn(cli, [
    "boot",
    "--kernel", kernel,
    "--drive", `file=${imagePath}`,
    "--append", "root=/dev/vda rw console=ttyS0 earlycon=sbi",
    "--no-input",
    "--no-reboot",
    "--block-cache",
    "--interrupt-batching",
    "--evidence", guestEvidencePath,
    "--max-instrs", maxInstrs,
    "--quantum", String(quantum),
  ], { cwd: repo, env: cleanEnvironment(), stdio: ["ignore", "pipe", "pipe"] });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout = append(stdout, chunk);
    stdoutLog.write(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr = append(stderr, chunk);
    stderrLog.write(chunk);
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  let exit;
  try {
    exit = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
  } catch (error) {
    clearTimeout(timer);
    stdoutLog.end();
    stderrLog.end();
    await Promise.all([stdoutFinished, stderrFinished]);
    return { id, ordinal, seed, quantum, ok: false, timedOut, error: String(error) };
  }
  clearTimeout(timer);
  stdoutLog.end();
  stderrLog.end();
  await Promise.all([stdoutFinished, stderrFinished]);

  const normalizedStdout = stdout.replaceAll("\r", "");
  const normalizedStderr = stderr.replaceAll("\r", "");
  const loginReached = normalizedStdout.includes("wasm-vm login:");
  const boundedInstructionStop = normalizedStderr.includes(`reached --max-instrs ${maxInstrs}`);
  let guestFiles;
  let error;
  if (!timedOut && exit.code === 102 && exit.signal === null && loginReached && boundedInstructionStop) {
    try {
      guestFiles = await inspectGuestFiles(imagePath);
    } catch (inspectionError) {
      error = `guest filesystem inspection failed: ${inspectionError}`;
    }
  }

  const postImageSha256 = await sha256File(imagePath);
  const guestEvidenceArtifact = await optionalArtifact(guestEvidencePath);
  const result = {
    id,
    ordinal,
    seed,
    quantum,
    ok: !timedOut && exit.code === 102 && exit.signal === null && loginReached && boundedInstructionStop &&
      guestEvidenceArtifact !== null && !error,
    timedOut,
    exit,
    serial: { loginReached, boundedInstructionStop },
    image: { path: relative(imagePath), preSha256: preImageSha256, postSha256: postImageSha256 },
    console: { path: relative(consolePath), sha256: await sha256File(consolePath) },
    stderr: { path: relative(stderrPath), sha256: await sha256File(stderrPath) },
    guestEvidence: guestEvidenceArtifact,
    guestFiles: guestFiles ? {
      bootOrderLog: { sha256: sha256Bytes(guestFiles.bootOrderLog), content: guestFiles.bootOrderLog },
      westonLog: { sha256: sha256Bytes(guestFiles.westonLog), content: guestFiles.westonLog },
    } : null,
    error: error ?? (timedOut ? `boot exceeded ${timeoutMs} ms` : undefined),
  };
  if (result.ok) {
    result.observed = summarizeGuest(result.guestFiles);
  }
  return result;
}

async function optionalArtifact(file) {
  try {
    const fileStat = await stat(file);
    if (!fileStat.isFile() || fileStat.size === 0) return null;
    return { path: relative(file), sha256: await sha256File(file) };
  } catch {
    return null;
  }
}

function cleanEnvironment() {
  const environment = { ...process.env };
  for (const name of [
    "RUSTFLAGS",
    "RUSTDOCFLAGS",
    "RUST_LOG",
    "CARGO_HOME",
    "CARGO_TARGET_DIR",
    "CARGO_BUILD_RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "NODE_OPTIONS",
    "npm_config_userconfig",
  ]) delete environment[name];
  return environment;
}

function append(current, chunk) {
  return `${current}${chunk.toString("utf8")}`.slice(-2_000_000);
}

async function inspectGuestFiles(imagePath) {
  const script = [
    "set -eu",
    "apk add --no-cache e2fsprogs-extra >/dev/null",
    "debugfs -R 'dump /home/desktop/.local/state/wasm-vm/boot-order.log /tmp/boot-order.log' /image >/dev/null 2>&1",
    "debugfs -R 'dump /home/desktop/.local/state/wasm-vm/weston.log /tmp/weston.log' /image >/dev/null 2>&1",
    "test -s /tmp/boot-order.log",
    "test -s /tmp/weston.log",
    "printf '%s\\n' E5T17D_BOOT_ORDER_BEGIN",
    "cat /tmp/boot-order.log",
    "printf '%s\\n' E5T17B_WESTON_LOG_BEGIN",
    "cat /tmp/weston.log",
  ].join("\n");
  const { stdout } = await execFile("docker", [
    "run", "--rm", "-v", `${imagePath}:/image:ro`, "alpine:3.20", "sh", "-lc", script,
  ], { cwd: repo, maxBuffer: 4 * 1024 * 1024 });
  const bootStart = stdout.indexOf("E5T17D_BOOT_ORDER_BEGIN\n");
  assert.ok(bootStart >= 0, "debugfs inspection returned no boot-order log");
  const westonStart = stdout.indexOf("E5T17B_WESTON_LOG_BEGIN\n", bootStart);
  assert.ok(westonStart >= 0, "debugfs inspection returned no Weston log");
  return {
    bootOrderLog: stdout
      .slice(bootStart + "E5T17D_BOOT_ORDER_BEGIN\n".length, westonStart)
      .trim(),
    westonLog: stdout.slice(westonStart + "E5T17B_WESTON_LOG_BEGIN\n".length).trim(),
  };
}

function summarizeGuest(guestFiles) {
  const order = guestFiles.bootOrderLog;
  const weston = guestFiles.westonLog;
  const seatdReady = /^E5T17D_SEATD_READY=1 pid=(\d+) state=([A-Z])$/mu.exec(order);
  const runtimeReady = /^E5T17D_RUNTIME_READY mode=(0?700) uid=1000 gid=1000$/mu.exec(order);
  const desktopAfterSeatd = /^E5T17D_START_DESKTOP_AFTER_SEATD=1 pid=(\d+) state=([A-Z])$/mu.exec(order);
  const desktopRuntime = /^E5T17D_START_DESKTOP_RUNTIME mode=(0?700) uid=1000 gid=1000$/mu.exec(order);
  const failure = /^E5T17D_COMPOSITOR_FAILURE_BOUNDED=30$/mu.test(order);
  const returned = /^E5T17D_DESKTOP_RETURNED=0$/mu.test(order);
  assert.ok(seatdReady, "seatd readiness marker is missing");
  assert.notEqual(seatdReady[2], "Z", "seatd was a zombie at desktop-runtime");
  assert.ok(runtimeReady, "runtime-directory readiness marker is missing");
  assert.ok(desktopAfterSeatd, "start-desktop ordering marker is missing");
  assert.notEqual(desktopAfterSeatd[2], "Z", "seatd was a zombie at start-desktop");
  assert.ok(desktopRuntime, "start-desktop runtime-directory marker is missing");
  assert.ok(failure, "headless compositor failure did not hit the 30-second bound");
  assert.ok(returned, "bounded compositor failure did not return to getty/init");
  assert.ok(/^E5T17B_WESTON_NOT_READY=1$/mu.test(weston), "Weston failure was not logged");
  const seatdIndex = order.indexOf("E5T17D_SEATD_READY=1");
  const runtimeIndex = order.indexOf("E5T17D_RUNTIME_READY");
  const startIndex = order.indexOf("E5T17D_START_DESKTOP_AFTER_SEATD=1");
  assert.ok(seatdIndex >= 0 && seatdIndex < runtimeIndex && runtimeIndex < startIndex, "boot order inverted");
  return {
    serialUser: "root (login prompt; no credential bypass)",
    autologinUser: "desktop",
    seatd: { ready: true, state: seatdReady[2], zombie: false },
    runtime: { mode: runtimeReady[1], uid: 1000, gid: 1000 },
    startDesktop: { afterSeatd: true, runtimeMode: desktopRuntime[1], runtimeUid: 1000, runtimeGid: 1000 },
    compositorFailure: { logged: true, boundSeconds: 30, returned: true },
    initUsable: true,
    order: "seatd -> desktop-runtime -> tty1 autologin -> start-desktop",
  };
}
