#!/usr/bin/env node
// One new authenticated cold seal, then unprofiled 10/1/1/10 copies. Never F acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ORDER = Object.freeze([10, 1, 1, 10]);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const SHA = /^[0-9a-f]{64}$/u;
const CAP = "post-restore interaction exceeded 2 seconds";
const safe = (value, label) => assert.ok(Number.isSafeInteger(value) && value >= 0, label);
const time = (value, label) => assert.ok(Number.isFinite(value) && value >= 0, label);

export function childEnvironment(input, head, retained) {
  assert.equal(input.E5_T26J_CHECKPOINT, undefined, "T26j requires a NEW cold seal, not checkpoint reuse");
  assert.match(head, /^[0-9a-f]{40}$/u);
  if (input.E5_T26J_REQUIRE_HEAD !== undefined) assert.equal(input.E5_T26J_REQUIRE_HEAD, head, "exact HEAD differs");
  assert.ok(path.isAbsolute(retained) && path.normalize(retained) === retained, "scratch must be absolute");
  const port = input.E5_T26J_PORT ?? "61630";
  assert.ok(typeof port === "string" && /^[1-9][0-9]{3,4}$/u.test(port) && Number(port) >= 1024 && Number(port) <= 65535,
    "invalid fixed comparison port");
  const env = Object.fromEntries(Object.entries(input).filter(([key]) => !key.startsWith("E5_T26F_")));
  return { ...env, E5_T26F_REQUIRE_HEAD: head, E5_T26F_DIAGNOSTIC_PROFILE: retained,
    E5_T26F_DIAGNOSTIC_PORT: port,
    E5_T26F_IMAGE: input.E5_T26J_IMAGE ?? "target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4",
    E5_T26F_IMAGE_INFO: input.E5_T26J_IMAGE_INFO ?? "target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json",
    E5_T26F_DESKTOP_ASSET_DIR: input.E5_T26J_ASSET_DIR ?? "target/e5-t26f/chunks/desktop-aplay-noresize" };
}

export function settingsFor(index) {
  assert.ok(Number.isInteger(index) && index >= 0 && index < ORDER.length, "invalid ABBA index");
  return { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_ICOUNT_DIVIDER: String(ORDER[index]),
    E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5" };
}

export async function requireEmptyOutput(directory) {
  await mkdir(directory, { recursive: true });
  const stat = await lstat(directory);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), "output must be a real directory");
  assert.equal((await readdir(directory)).length, 0, "refusing nonempty output; use a fresh comparison directory");
}

function policy(run, mode, divider) {
  assert.equal(run.acceptance, false);
  assert.equal(run.kind, "diagnostic-iteration");
  assert.equal(run.diagnostic.mode, mode);
  assert.equal(run.diagnostic.icountDivider, divider);
  for (const key of ["cpu", "latency", "complete"]) assert.equal(run.diagnostic[key], false, key);
  for (const key of ["command", "guestClock", "jit", "residency"]) assert.equal(run.diagnostic[key], null, key);
  assert.equal(run.postRestoreCommand, "sh /tmp/a");
  assert.equal(run.postRestoreKeyDelayMs, mode === "create" ? 0 : 5);
  assert.equal(run.diagnostic.keyDelayMs, run.postRestoreKeyDelayMs);
}

function clockState(state, divider) {
  assert.equal(state?.mode, "icount");
  assert.equal(state.clockDiv, divider);
  assert.equal(state.timebaseHz, 10_000_000);
  assert.equal(typeof state.mtime, "string");
  assert.match(state.mtime, /^[0-9]+$/u);
  const ticks = BigInt(state.mtime);
  assert.ok(ticks <= 0xffff_ffff_ffff_ffffn, "clock exceeds u64");
  return ticks;
}

function pcmProof(pcm) {
  assert.equal(pcm?.available, true);
  for (const key of ["writtenFrames", "inspectedFrames", "nonSilentFrames"]) safe(pcm[key], key);
  assert.ok(pcm.writtenFrames > 0 && pcm.nonSilentFrames > 0 && pcm.nonSilentFrames <= pcm.inspectedFrames);
  assert.ok(Number.isFinite(pcm.maxAbs) && pcm.maxAbs > 0);
}

export function validateCold(record, seal, head, env) {
  const m = record.milestones;
  assert.equal(record.acceptance, false);
  policy(m.run, "create", null);
  assert.equal(m.run.currentHead, head);
  assert.equal(m.run.creatorHead, head);
  assert.equal(m.run.binding.head, head);
  for (const key of ["runtimeSha256", "kernelSha256", "imageSha256", "manifestSha256"]) assert.match(m.run.binding[key], SHA, key);
  safe(m.run.binding.imageBytes, "image byte count");
  assert.ok(m.run.binding.imageBytes > 0);
  assert.equal(m.run.binding.origin, `http://127.0.0.1:${env.E5_T26F_DIAGNOSTIC_PORT}`);
  assert.equal(m.run.diagnostic.directory, env.E5_T26F_DIAGNOSTIC_PROFILE);
  assert.equal(m.run.checkpointFile, path.join(env.E5_T26F_DIAGNOSTIC_PROFILE, "normal-checkpoint.json"));
  assert.equal(seal.schema, "wasm-vm.e5-t26f.diagnostic-profile.v1");
  assert.equal(seal.browser?.headless, true);
  assert.equal(seal.browser.name, "chromium");
  assert.ok(typeof seal.browser.version === "string" && seal.browser.version.length > 0);
  assert.match(seal.profileSha256, SHA);
  assert.equal(m.run.profileSha256, seal.profileSha256);
  assert.deepEqual(m.normalSnapshot, seal.normalSnapshot);
  assert.match(m.normalSnapshot.sha256, SHA);
  assert.equal(m.normalSnapshot.machineResume?.persisted, true);
  assert.equal(m.normalSnapshotPause?.isPaused, true);
  assert.equal(m.normalCheckpointBeforeReload?.status, "passed");
  assert.equal(m.initialAplay?.terminalMarkerSeen, true);
  assert.equal(m.initialAplay.inputSequenceMatch, true);
  assert.equal(m.initialAudio?.outputAttached, true);
  pcmProof(m.initialAudio.after);
  assert.deepEqual(record.errors, { browser: [], http: [] });
  return { head, binding: m.run.binding, browser: seal.browser, normalSnapshot: seal.normalSnapshot,
    profileSha256: seal.profileSha256, checkpointFile: m.run.checkpointFile, createdAt: seal.createdAt,
    retained: env.E5_T26F_DIAGNOSTIC_PROFILE };
}

export function validateIteration(record, code, divider, baseline, prior = []) {
  assert.ok(divider === 1 || divider === 10, "comparison divider must be 1 or 10");
  assert.ok(code === 0 || code === 1, "only exit 0 or the exact F cap failure is admissible");
  const m = record.milestones;
  policy(m.run, "reuse", divider);
  assert.equal(m.run.currentHead, baseline.head);
  assert.equal(m.run.creatorHead, baseline.head);
  assert.deepEqual(m.run.binding, baseline.binding, "runtime/image/head binding changed");
  assert.deepEqual(m.normalSnapshot, baseline.normalSnapshot, "normal snapshot changed");
  assert.equal(m.run.profileSha256, baseline.profileSha256, "sealed profile changed");
  assert.equal(m.run.checkpointFile, baseline.checkpointFile);
  assert.equal(m.run.checkpointCreatedAt, baseline.createdAt);
  assert.equal(m.run.diagnostic.directory, baseline.retained);
  assert.equal(m.run.diagnostic.origin, baseline.binding.origin);
  const relativeProfile = path.relative(baseline.retained, m.run.profile);
  assert.match(relativeProfile, /^iteration-[^/]+\/profile$/u, "must use an independent sealed-profile copy");
  assert.ok(!prior.some(row => row.profile === m.run.profile), "iteration profile was reused");
  if (record.browser) assert.deepEqual(record.browser, baseline.browser);
  assert.deepEqual(m.icountDividerErrors, { browser: [], http: [] }, "missing or nonempty endpoint error observation");
  const start = m.postRestoreStart, end = m.postRestoreEnd;
  time(start, "original restore T0"); time(end, "frozen interaction end");
  assert.ok(end >= start);
  assert.equal(start, m.normalRestore.result.completedAt, "restore clock was reset");
  const interactionMs = end - start, fTimingPassed = interactionMs <= 2_000;
  if (code === 1) {
    assert.equal(record.error?.name, "AssertionError");
    assert.equal(record.error.code, "ERR_ASSERTION");
    assert.equal(record.error.message, CAP, "a different failure is not a completed divider comparison");
    assert.equal(fTimingPassed, false, "claimed timing failure contradicts original timestamps");
  } else {
    assert.equal(record.acceptance, false);
    assert.equal(record.schema, "wasm-vm.e5-t26f.diagnostic-iteration.v1");
    assert.equal(fTimingPassed, true, "exit zero cannot waive F's cap");
    assert.deepEqual(record.errors, { browser: [], http: [] });
  }
  const restore = m.normalRestore.result;
  assert.equal(m.normalRestore.displayChecksPassed, true);
  assert.equal(restore.resume.restored, true);
  assert.equal(restore.snapshotSha256, baseline.normalSnapshot.sha256);
  assert.equal(restore.observation.firstPresent.crc32, baseline.normalSnapshot.preFrontBufferCrc);
  assert.equal(restore.bootStates.some(({ state }) => state === "booting"), false);
  const cursor = m.postRestoreCursor;
  time(cursor.observedAt, "cursor observation");
  assert.equal(cursor.elapsedMs, cursor.observedAt - start);
  assert.ok(cursor.elapsedMs >= 0 && cursor.elapsedMs <= 2_000);
  assert.equal(cursor.frame?.device, "tablet");
  assert.equal(cursor.frame.source, "pointermove");
  for (const [key, extent] of [["x", 1280], ["y", 800]]) {
    time(cursor.rendered?.[key], `rendered cursor ${key}`);
    assert.ok(Math.abs(cursor.frame.coordinates[key] - Math.round(cursor.rendered[key] / extent * 32767)) <= 1);
  }
  const command = m.postRestoreAplay;
  assert.equal(command.command, "sh /tmp/a");
  assert.equal(command.accepted, true);
  assert.equal(command.inputSequenceMatch, true);
  assert.equal(command.keyboardFrames, 20);
  assert.equal(command.domEvents, 20);
  assert.equal(command.terminalMarkerSeen, true);
  assert.equal(command.redMarkerSeen, false);
  assert.ok(command.visualDiffPixels >= 2_000);
  assert.deepEqual(m.postRestoreInteraction.heldButtons, []);
  assert.equal(m.postRestoreInteraction.audio.policy, "unlocked");
  assert.equal(m.postRestoreInteraction.audio.context, "running");
  pcmProof(m.postRestorePcmAtCompletion.pcm);
  time(m.postRestorePcmAtCompletion.observedAt, "PCM observedAt");
  assert.ok(m.postRestorePcmAtCompletion.observedAt >= start && m.postRestorePcmAtCompletion.observedAt <= end);
  assert.equal(m.postRestoreOutputAttached.outputAttached, true);
  assert.ok(m.postRestoreOutputAttached.observedAt >= m.postRestorePcmAtCompletion.observedAt && m.postRestoreOutputAttached.observedAt <= end);
  assert.equal(m.postRestoreAudioAfter.guestAttached, true);
  assert.deepEqual(m.postRestoreAudioAfter.pcm, m.postRestorePcmAtCompletion.pcm);
  safe(m.postRestoreAudioBefore.renderedFrames, "rendered before");
  safe(m.postRestoreAudioAfter.renderedFrames, "rendered after");
  assert.ok(m.postRestoreAudioAfter.renderedFrames > m.postRestoreAudioBefore.renderedFrames);
  const before = m.icountDividerBefore, after = m.icountDividerAfter;
  for (const sample of [before, after]) {
    time(sample.requestedAt, "clock requestedAt"); time(sample.receivedAt, "clock receivedAt");
    assert.ok(sample.receivedAt >= sample.requestedAt);
    const ticks = clockState(sample.state, divider);
    assert.equal(sample.selection?.requested, divider);
    const stored = clockState(sample.selection.before, 10), selected = clockState(sample.selection.after, divider);
    assert.equal(stored, selected, "selection changed mtime");
    assert.ok(ticks >= selected);
    assert.equal(sample.jit?.hasExecutor, true);
    assert.equal(sample.jit.jitResidencyPolicy, "repack-off");
    assert.equal(sample.jit.jitResidencyCap, 24);
    assert.equal(sample.jit.jitRegionChaining, true);
    assert.equal(sample.jit.jitDynamicChaining, true);
    for (const key of ["guestRetired", "retiredViaJit"]) safe(sample.jit[key], key);
  }
  assert.deepEqual(after.selection, before.selection, "selection receipt changed");
  assert.ok(before.requestedAt >= start && before.receivedAt <= end, "before RPC must be charged to original interval");
  assert.ok(after.requestedAt >= end && after.requestedAt > before.receivedAt, "after RPC must follow frozen end");
  const deltas = Object.fromEntries(["guestRetired", "retiredViaJit"].map(key => [key, after.jit[key] - before.jit[key]]));
  assert.ok(deltas.guestRetired > 0 && deltas.retiredViaJit > 0);
  const ticks = BigInt(after.state.mtime) - BigInt(before.state.mtime);
  assert.ok(ticks > 0n, "actual clock did not advance");
  if (prior.length) assert.deepEqual(before.selection.before, prior[0].workerBefore.selection.before, "stored clock changed between copies");
  return { divider, profile: m.run.profile, binding: m.run.binding, profileSha256: m.run.profileSha256,
    snapshotSha256: m.normalSnapshot.sha256, workerBefore: before, workerAfter: after, deltas,
    guestDeltaTicks: String(ticks), interactionMs, postRestoreStart: start, postRestoreEnd: end,
    cursor, command, pcmAtCompletion: m.postRestorePcmAtCompletion, attachment: m.postRestoreOutputAttached,
    childExit: code, fTimingPassed, fVerified: false };
}

export async function collect(input = process.env) {
  const getHead = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const head = getHead();
  // Validate policy before creating scratch/output; never accept an old checkpoint knob.
  childEnvironment(input, head, path.join(os.tmpdir(), "e5-t26j-preflight"));
  const out = path.resolve(input.E5_T26J_OUT ?? path.join(repo, "evidence/e5-t26j/browser"));
  await requireEmptyOutput(out); // Outside reporting try: refusal must not modify existing evidence.
  const retained = await mkdtemp(path.join(os.tmpdir(), "e5-t26j-clock-"));
  const env = childEnvironment(input, head, retained), results = [];
  async function run(label, settings) {
    assert.equal(getHead(), head, "HEAD changed during comparison");
    const directory = path.join(out, label);
    await mkdir(directory);
    const child = spawn(process.execPath, ["tools/verify/e5-t26f-browser-roundtrip.mjs"], {
      cwd: repo, env: { ...env, ...settings, E5_T26F_OUT: directory }, stdio: ["ignore", "pipe", "pipe"],
    });
    let log = "";
    for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk; process.stderr.write(chunk); });
    try {
      const code = await new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => signal ? reject(Error(`${label}: ${signal}`)) : resolve(code));
      });
      return { directory, code };
    } finally { await writeFile(path.join(directory, "run.log"), log, { flag: "wx" }); }
  }
  try {
    const cold = await run("checkpoint", { E5_T26F_DIAGNOSTIC: "create" });
    assert.equal(cold.code, 0, "new cold seal failed; retain evidence and stop");
    const coldBytes = await readFile(path.join(cold.directory, "diagnostic-checkpoint.json"));
    const sealBytes = await readFile(path.join(retained, "normal-checkpoint.json"));
    const baseline = validateCold(JSON.parse(coldBytes), JSON.parse(sealBytes), head, env);
    for (const [index, divider] of ORDER.entries()) {
      const child = await run(`${index + 1}-divider-${divider}`, settingsFor(index));
      const file = path.join(child.directory, child.code === 0 ? "diagnostic-iteration.json" : "failure-post-restore-interaction-checks.json");
      const bytes = await readFile(file), record = JSON.parse(bytes);
      const row = validateIteration(record, child.code, divider, baseline, results);
      results.push({ index: index + 1, ...row, record: path.relative(repo, file), sha256: hash(bytes),
        transcriptSha256: hash(await readFile(path.join(child.directory, "run.log"))) });
    }
    assert.equal(getHead(), head);
    const report = { schema: "wasm-vm.e5-t26j.browser-clock-comparison.v1", head, acceptance: false, fVerified: false,
      claim: "unprofiled deterministic-divider ABBA; not F acceptance or a default-policy promotion", retained,
      baseline, coldRecordSha256: hash(coldBytes), sealSha256: hash(sealBytes), results };
    await writeFile(path.join(out, "comparison.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
    console.log(JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    await writeFile(path.join(out, "collector-failure.json"), JSON.stringify({ head, retained, acceptance: false,
      fVerified: false, results, error: { name: error.name, message: error.message } }, null, 2) + "\n", { flag: "wx" });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await collect();
