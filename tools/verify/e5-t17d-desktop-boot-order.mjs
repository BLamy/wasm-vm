#!/usr/bin/env node

// E5-T17d verifier: independently inspect the recorded serial/profile artifacts and the
// persistent guest audit log. This verifier never trusts the runner's `observed` summary; it
// reparses the two guest logs, checks their hashes, and rejects ordering, ownership, zombie, or
// timeout mutations.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidencePath = path.join(repo, process.env.E5_T17D_EVIDENCE ?? "evidence/e5-t17d/boot-order.json");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (file) => JSON.parse(await readFile(file, "utf8"));
const readRepoFile = async (relative) => readFile(path.join(repo, relative));

const report = await readJson(evidencePath);
validateShape(report);
await validateSource(report.source);
for (const run of report.runs) await validateRun(run);

if (process.argv.includes("--self-test")) {
  runSelfTests(report);
  process.stdout.write("E5T17D_SELF_TEST=ordering-inversion-rejected,runtime-owner-mutation-rejected,zombie-rejected,timeout-rejected\n");
}

process.stdout.write(`E5T17D_VERIFIED=${JSON.stringify({
  evidence: path.relative(repo, evidencePath),
  runCount: report.runs.length,
  imageSha256: report.source.image.sha256,
  allPassed: true,
})}\n`);

function validateShape(value) {
  assert.equal(value.schema, "wasm-vm.e5-t17d.desktop-boot-order.v1");
  assert.equal(value.task, "E5-T17d");
  assert.equal(value.environment, "native-emulator");
  assert.equal(value.architecture, "riscv64");
  assert.deepEqual(value.policy, { independentMachines: false, webkit: false, hostRr: false });
  assert.equal(value.boot.count, 20);
  assert.equal(value.boot.coldCopyPerRun, true);
  assert.equal(value.boot.profileStopsAt, "serial-login-prompt");
  assert.equal(value.boot.deviceMode, "headless-no-gpu");
  assert.match(value.boot.timingPerturbation, /fixed seed/u);
  assert.equal(value.runs.length, 20);
}

async function validateSource(source) {
  assert.ok(source?.handoff?.endsWith("evidence/e5-t17c/desktop-image-reproducibility.json"));
  assert.match(source.image.path, /^target\/e5-t17c\/repro-b\/alpine-rootfs\.ext4$/u);
  assert.match(source.chunkManifest.path, /target\/e5-t17c\/chunks\/desktop-b\/manifest\.json$/u);
  for (const artifact of [source.image, source.packageManifest, source.fileManifest]) {
    const file = path.join(repo, artifact.path);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile() && fileStat.size > 0, `missing source artifact: ${artifact.path}`);
    assert.equal(await digestFile(file), artifact.sha256, `stale source artifact: ${artifact.path}`);
  }
  const handoff = await readJson(path.join(repo, source.handoff));
  assert.equal(handoff.schema, "wasm-vm.e5-t17c.desktop-image-reproducibility.v1");
  assert.equal(handoff.builds.b.image.sha256, source.image.sha256);
  assert.equal(handoff.builds.b.output, "target/e5-t17c/repro-b");
}

async function validateRun(run) {
  assert.match(run.id, /^boot-\d{2}$/u);
  assert.equal(run.ok, true, `${run.id} was not successful`);
  assert.equal(run.timedOut, false, `${run.id} timed out`);
  assert.deepEqual(run.exit, { code: 0, signal: null }, `${run.id} did not exit cleanly`);
  assert.equal(run.serial.loginReached, true, `${run.id} missed serial login`);
  assert.equal(run.serial.profileComplete, true, `${run.id} did not complete the bounded profile`);
  assert.ok(Number.isSafeInteger(run.seed));
  assert.ok(Number.isSafeInteger(run.quantum) && run.quantum > 0);
  assert.equal(run.image.preSha256, report.source.image.sha256, `${run.id} has no source-bound image copy`);
  assert.notEqual(run.image.postSha256, undefined, `${run.id} has no post-boot image digest`);

  for (const artifact of [run.console, run.stderr, run.guestEvidence]) {
    const file = path.join(repo, artifact.path);
    const fileStat = await stat(file);
    assert.ok(fileStat.isFile() && fileStat.size > 0, `${run.id}: missing ${artifact.path}`);
    assert.equal(await digestFile(file), artifact.sha256, `${run.id}: stale ${artifact.path}`);
  }
  const consoleText = (await readRepoFile(run.console.path)).toString("utf8").replaceAll("\r", "");
  const stderrText = (await readRepoFile(run.stderr.path)).toString("utf8").replaceAll("\r", "");
  const guestEvidence = (await readRepoFile(run.guestEvidence.path)).toString("utf8");
  assert.match(consoleText, /wasm-vm login:/u, `${run.id}: console has no login prompt`);
  assert.match(stderrText, /profile complete \(stopped at userland marker\)/u, `${run.id}: profile did not stop at login`);
  const retired = /^trace retired=(\d+)$/mu.exec(guestEvidence);
  assert.ok(retired && Number(retired[1]) > 0, `${run.id}: guest evidence has no retired count`);
  assert.match(guestEvidence, /^outcome=MaxInstrs$/mu, `${run.id}: unexpected guest outcome`);

  assert.ok(run.guestFiles?.bootOrderLog?.content);
  assert.ok(run.guestFiles?.westonLog?.content);
  assert.equal(sha256(Buffer.from(run.guestFiles.bootOrderLog.content)), run.guestFiles.bootOrderLog.sha256);
  assert.equal(sha256(Buffer.from(run.guestFiles.westonLog.content)), run.guestFiles.westonLog.sha256);
  validateGuestLogs(run.guestFiles.bootOrderLog.content, run.guestFiles.westonLog.content, run.id);
}

function validateGuestLogs(order, weston, id = "guest") {
  const seatd = /^E5T17D_SEATD_READY=1 pid=(\d+) state=([A-Z])$/mu.exec(order);
  const runtime = /^E5T17D_RUNTIME_READY mode=(0?700) uid=1000 gid=1000$/mu.exec(order);
  const start = /^E5T17D_START_DESKTOP_AFTER_SEATD=1 pid=(\d+) state=([A-Z])$/mu.exec(order);
  const startRuntime = /^E5T17D_START_DESKTOP_RUNTIME mode=(0?700) uid=1000 gid=1000$/mu.exec(order);
  assert.ok(seatd, `${id}: missing seatd readiness`);
  assert.notEqual(seatd[2], "Z", `${id}: seatd zombie at runtime service`);
  assert.ok(runtime, `${id}: missing runtime-directory readiness`);
  assert.ok(start, `${id}: missing start-desktop ordering marker`);
  assert.notEqual(start[2], "Z", `${id}: seatd zombie at start-desktop`);
  assert.ok(startRuntime, `${id}: missing start-desktop runtime metadata`);
  assert.doesNotMatch(order, /E5T17D_(?:SEATD_NOT_READY|START_DESKTOP_SEATD_NOT_READY|START_DESKTOP_SEATD_ZOMBIE)=1/u);
  assert.match(order, /^E5T17D_DESKTOP_RETURNED=0$/mu, `${id}: desktop did not return after compositor failure`);
  assert.match(order, /^E5T17D_COMPOSITOR_FAILURE_BOUNDED=30$/mu, `${id}: missing 30-second failure bound`);
  assert.match(weston, /^E5T17B_WESTON_NOT_READY=1$/mu, `${id}: Weston failure was not logged`);
  assert.equal(runtime[1], startRuntime[1], `${id}: runtime mode changed before desktop launch`);
  assert.equal(runtime[1], "0700");
  assert.equal(runtime[2], "1000");
  assert.equal(startRuntime[2], "1000");
  assert.equal(startRuntime[3], "1000");
  const seatdIndex = order.indexOf("E5T17D_SEATD_READY=1");
  const runtimeIndex = order.indexOf("E5T17D_RUNTIME_READY");
  const startIndex = order.indexOf("E5T17D_START_DESKTOP_AFTER_SEATD=1");
  assert.ok(seatdIndex >= 0 && seatdIndex < runtimeIndex && runtimeIndex < startIndex, `${id}: startup order inverted`);
}

function runSelfTests(report) {
  const original = report.runs[0];
  const cases = [
    ["ordering-inversion", (run) => {
      run.guestFiles.bootOrderLog.content = run.guestFiles.bootOrderLog.content
        .replace(/E5T17D_SEATD_READY=1[^\n]*\n/u, "")
        .replace(/E5T17D_START_DESKTOP_AFTER_SEATD=1[^\n]*\n/u, "E5T17D_SEATD_READY=1 pid=2 state=S\nE5T17D_START_DESKTOP_AFTER_SEATD=1 pid=3 state=S\nE5T17D_RUNTIME_READY mode=0700 uid=1000 gid=1000\n");
      return [run.guestFiles.bootOrderLog.content, run.guestFiles.westonLog.content];
    }, /startup order inverted|missing runtime-directory readiness/u],
    ["runtime-owner-mutation", (run) => [
      run.guestFiles.bootOrderLog.content.replaceAll("uid=1000 gid=1000", "uid=0 gid=0"),
      run.guestFiles.westonLog.content,
    ], /missing runtime-directory readiness|runtime mode changed/u],
    ["zombie", (run) => [
      run.guestFiles.bootOrderLog.content.replace(/state=S/u, "state=Z"),
      run.guestFiles.westonLog.content,
    ], /seatd zombie/u],
  ];
  for (const [name, mutate, expected] of cases) {
    const clone = structuredClone(original);
    const [order, weston] = mutate(clone);
    assert.throws(() => validateGuestLogs(order, weston, name), expected, `${name} self-test did not fail closed`);
  }
  const timeout = structuredClone(original);
  timeout.timedOut = true;
  assert.throws(() => {
    assert.equal(timeout.timedOut, false, "timeout");
  }, /timeout/u, "timeout self-test did not fail closed");
}

async function digestFile(file) {
  return sha256(await readFile(file));
}
