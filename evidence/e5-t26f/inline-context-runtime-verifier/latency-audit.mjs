#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");
const root = path.join(repo, "evidence/e5-t26f/single-process-observer-657fb5a2");
const latency = path.join(root, "latency");
const output = path.join(here, "latency-audit-result.json");
const head = "657fb5a23b411bf02832b2d10ef943b43d0becf1";
const rawExpected = "8064f99fce17507fded7ee9324fbac420ff5a697b5b6a54b8aefc004745a919a";

async function hashFile(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const json = async file => JSON.parse(await readFile(file, "utf8"));
const files = {
  driver: path.join(root, "run-latency.mjs"),
  invocation: path.join(latency, "invocation.json"),
  runLog: path.join(latency, "run.log"),
  exit: path.join(latency, "exit.json"),
  raw: path.join(latency, "record/failure-post-restore-interaction-checks.json"),
  rawPng: path.join(latency, "record/failure-post-restore-interaction-checks.png"),
  post: path.join(latency, "record/post-restore.json"),
  postPng: path.join(latency, "record/post-restore.png"),
};
const hashes = {};
for (const [key, file] of Object.entries(files)) hashes[key] = await hashFile(file);
assert.equal(hashes.raw, rawExpected);
assert.equal(hashes.rawPng, hashes.postPng);

const [invocation, exit, raw] = await Promise.all([
  json(files.invocation), json(files.exit), json(files.raw),
]);
assert.equal(invocation.head, head);
assert.equal(invocation.acceptance, false);
assert.deepEqual(exit, { code: 1, signal: null });
assert.equal(raw.head, head);
assert.deepEqual(raw.error && { name: raw.error.name, code: raw.error.code, message: raw.error.message }, {
  name: "AssertionError", code: "ERR_ASSERTION", message: "post-restore interaction exceeded 2 seconds",
});
assert.match(raw.error.stack, /e5-t26f-browser-roundtrip\.mjs:1930:12/u);

const sourceBindings = {};
for (const [relative, expected] of Object.entries(invocation.sourceBindings)) {
  const actual = await hashFile(path.join(repo, relative));
  assert.equal(actual, expected, `source pin changed: ${relative}`);
  sourceBindings[relative] = actual;
}
assert.equal(sourceBindings["crates/wasm/src/jit_browser.rs"],
  "5a83c4269e73ba6cb8e66c27c8f2a4fc797e7e55b5abbd37f566e510f5ba24df");
assert.equal(sourceBindings["web/pkg/wasm_vm_wasm_bg.wasm"],
  "18e53caa2e160819d16a6e0bf376530d45234e28f315c89b5042c48b1d791cc4");
assert.equal(sourceBindings["evidence/e5-t26f/single-process-observer-657fb5a2/run-latency.mjs"], hashes.driver);

const m = raw.milestones, run = m.run, probe = m.interactionLatency;
assert.equal(run.acceptance, false);
assert.equal(run.binding.head, head);
assert.equal(run.binding.runtimeSha256, "f3a4fbe4d5aee30a9fcaa6f38cef292d8a65959d56612c43f3a82c427701249d");
assert.equal(run.profileSha256, "3d1f4671402fc69da3f4957cd32f1fd9d92ea3fb28e1d03d60e8f716a4c65a0e");
assert.equal(run.creatorHead, head);
assert.equal(run.currentHead, head);
assert.equal(run.profile,
  "/var/folders/nr/cyvk1qc14jj5c081vj1xts000000gn/T/e5-t26f-single-process-observer-9IMCYn/iteration-VrryWr/profile");
assert.notEqual(path.basename(path.dirname(run.profile)), "checkpoint-profile");
assert.ok(run.profile.startsWith(`${invocation.config.E5_T26F_DIAGNOSTIC_PROFILE}${path.sep}iteration-`));
assert.deepEqual(run.diagnostic, {
  mode: "reuse", directory: invocation.config.E5_T26F_DIAGNOSTIC_PROFILE,
  port: 61637, origin: "http://127.0.0.1:61637", command: null, keyDelayMs: 0,
  latency: true, cpu: false, guestClock: null, jit: null, residency: null,
  complete: false, icountDivider: null,
});
assert.equal(run.postRestoreCommand, "play");
assert.equal(run.postRestoreKeyDelayMs, 5);
assert.equal(m.normalRestore.result.snapshotSha256, m.normalSnapshot.sha256);
assert.equal(m.normalRestore.result.observation.firstPresent.crc32, m.normalSnapshot.preFrontBufferCrc);
assert.equal(m.normalRestore.result.bootStates.some(({ state }) => state === "booting"), false);

assert.equal(m.postRestoreStart, 1192.7849999666214);
assert.equal(m.postRestoreEnd, 4830.579999923706);
const elapsedMs = m.postRestoreEnd - m.postRestoreStart;
assert.equal(elapsedMs, 3637.7949999570847);
assert.deepEqual(probe.limits, {
  pcmIntervalMs: 50, pcmSamples: 120, schedulerIntervalMs: 250,
  schedulerSamples: 24, markerSamples: 120,
});
assert.equal(probe.restoredAt, m.postRestoreStart);
assert.equal(probe.baselineWriteIndex, 0);
assert.equal(probe.stopReason, "command-wait-settled");
assert.equal(probe.pcmSamples.length, 57);
const zeroSamples = probe.pcmSamples.filter(sample => sample.writeIndex === 0);
const lastZero = zeroSamples.at(-1);
assert.equal(lastZero.elapsedMs, 3108.2949999570847);
assert.equal(lastZero.writeIndex, 0);
assert.deepEqual(probe.firstWrite, {
  observedAt: 4349.439999938011, elapsedMs: 3156.6549999713898,
  available: true, writeIndex: 480,
});
assert.equal(probe.firstPcm.elapsedMs, 3156.6549999713898);
assert.equal(probe.firstPcm.pcm.writtenFrames, 480);
assert.equal(probe.firstPcm.pcm.nonSilentFrames, 480);
assert.equal(probe.firstPcm.pcm.maxAbs, 0.999969482421875);
assert.equal(probe.firstMarker.elapsedMs, 3613.4500000476837);
assert.equal(probe.firstMarker.markerSeen, true);
assert.equal(probe.markerSamples.length, 120);
assert.equal(probe.markerCalls, 170);
assert.equal(probe.markerTotalMs, 9.500000238418579);
assert.equal(probe.markerMaxMs, 4.620000004768372);
assert.equal(probe.schedulerSamples.length, 11);
assert.ok(probe.schedulerSamples.every(sample => sample.status === "completed" &&
  sample.schedulerAvailable === true && sample.workerRpcAvailable === true));
assert.ok(probe.schedulerSamples.every(sample => sample.scheduler.quantum === 500000 &&
  sample.scheduler.fetchWaits === 0 && sample.scheduler.fetchRequestedChunks === 0 &&
  sample.scheduler.fetchWaitTotalMs === 0));
assert.ok(probe.schedulerSamples.every(sample => sample.jit.available === true &&
  sample.jit.status === "completed" && sample.jit.stats.entryCost.timingEnabled === false &&
  sample.jit.stats.entryCost.timerReads === 0));
assert.equal(Math.min(...probe.schedulerSamples.map(sample => sample.requestMs)), 2.3350000381469727);
assert.equal(Math.max(...probe.schedulerSamples.map(sample => sample.requestMs)), 48.330000042915344);

const result = {
  schema: "wasm-vm.e5-t26f.inline-context-latency-verifier.v1",
  head, hashes, sourceBindings,
  isolation: { baselineProfileSha256: run.profileSha256, executedCopy: run.profile,
    originalBaselineLaunched: false, latencyOnly: true, profilers: false },
  timing: { start: m.postRestoreStart, end: m.postRestoreEnd, elapsedMs,
    limitMs: 2000, passed: false, failpoint: "tools/verify/e5-t26f-browser-roundtrip.mjs:1930:12" },
  sampling: {
    limits: probe.limits, pcmSamplesRetained: probe.pcmSamples.length,
    lastZero, firstWrite: probe.firstWrite, firstPcm: probe.firstPcm,
    markerSamplesRetained: probe.markerSamples.length, markerCalls: probe.markerCalls,
    firstMarker: probe.firstMarker, markerTotalMs: probe.markerTotalMs,
    markerMaxMs: probe.markerMaxMs, schedulerSamples: probe.schedulerSamples.length,
    allFetchWaitsZero: true,
    workerRequestMs: { min: 2.3350000381469727, max: 48.330000042915344 },
  },
  limitations: [
    "The PCM arrival is bounded between the last zero and first positive samples; 3156.655 ms is not an exact arrival time.",
    "The marker time is the first observed true sample, not the exact guest render/completion time.",
    "Zero fetch waits in eleven sampled scheduler windows does not identify or exclude a dominant host cost.",
    "The latency sampler and worker RPCs perturb this run; it is not an unprofiled comparison arm or a speedup measurement.",
    "This diagnostic is acceptance:false and leaves coherence/drag/second restore unproven after the cap failure.",
  ],
};
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
console.log(JSON.stringify({ output: path.relative(repo, output), rawSha256: hashes.raw,
  elapsedMs, lastZeroMs: lastZero.elapsedMs, firstPcmSampleMs: probe.firstPcm.elapsedMs,
  firstMarkerSampleMs: probe.firstMarker.elapsedMs, schedulerSamples: probe.schedulerSamples.length }));
