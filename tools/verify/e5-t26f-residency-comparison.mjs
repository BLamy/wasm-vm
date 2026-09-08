#!/usr/bin/env node
// Existing JIT policy control, not an F acceptance command or a default-policy decision.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const out = path.resolve(process.env.E5_T26F_RESIDENCY_OUT || path.join(repo, "evidence/e5-t26f/residency"));
await mkdir(out, { recursive: true });
const retained = process.env.E5_T26F_RESIDENCY_CHECKPOINT || await mkdtemp(path.join(os.tmpdir(), "e5-t26f-residency-"));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("E5_T26F_")));
Object.assign(env, {
  E5_T26F_REQUIRE_HEAD: head,
  E5_T26F_HEADED: "1",
  E5_T26F_DIAGNOSTIC_PROFILE: retained,
  E5_T26F_DIAGNOSTIC_PORT: process.env.E5_T26F_RESIDENCY_PORT || "61629",
  E5_T26F_IMAGE: process.env.E5_T26F_RESIDENCY_IMAGE || "target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4",
  E5_T26F_IMAGE_INFO: process.env.E5_T26F_RESIDENCY_IMAGE_INFO || "target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json",
  E5_T26F_DESKTOP_ASSET_DIR: process.env.E5_T26F_RESIDENCY_ASSET_DIR || "target/e5-t26f/chunks/desktop-aplay-noresize",
});

async function run(label, settings) {
  const directory = path.join(out, label);
  await mkdir(directory); // Refuse to overwrite any prior result, including a failure.
  const child = spawn(process.execPath, ["tools/verify/e5-t26f-browser-roundtrip.mjs"], {
    cwd: repo, env: { ...env, ...settings, E5_T26F_OUT: directory }, stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => {
    log += chunk.toString();
    process.stderr.write(chunk);
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => signal ? reject(new Error(`${label}: ${signal}`)) : resolve(code));
  });
  await writeFile(path.join(directory, "run.log"), log, { flag: "wx" });
  return { directory, code };
}

if (!process.env.E5_T26F_RESIDENCY_CHECKPOINT) {
  const created = await run("checkpoint", { E5_T26F_DIAGNOSTIC: "create" });
  assert.equal(created.code, 0, "cold checkpoint did not complete");
}

const results = [];
// ABBA order screens an order effect without selecting the fastest observation.
for (const [index, policy] of ["repack-off", "cap-256", "cap-256", "repack-off"].entries()) {
  const child = await run(`${index + 1}-${policy}`, {
    E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_JIT: "1",
    E5_T26F_DIAGNOSTIC_RESIDENCY: policy, E5_T26F_DIAGNOSTIC_GUEST_CLOCK: "icount",
    E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5",
  });
  const file = path.join(child.directory, child.code === 0
    ? "diagnostic-iteration.json" : "failure-post-restore-interaction-checks.json");
  const bytes = await readFile(file);
  const record = JSON.parse(bytes), m = record.milestones;
  if (child.code !== 0) {
    assert.equal(child.code, 1);
    assert.equal(record.error?.message, "post-restore interaction exceeded 2 seconds",
      "a different failure is not a completed residency comparison");
  }
  assert.equal(m.run.acceptance, false);
  assert.equal(m.run.diagnostic.jit, "1");
  assert.equal(m.run.diagnostic.residency, policy);
  assert.equal(m.run.diagnostic.cpu, false);
  assert.equal(m.run.diagnostic.latency, false);
  assert.equal(m.run.postRestoreCommand, "sh /tmp/a");
  assert.equal(m.run.postRestoreKeyDelayMs, 5);
  assert.equal(m.normalRestore.displayChecksPassed, true);
  assert.equal(m.normalRestore.result.resume.restored, true);
  assert.equal(m.normalRestore.result.bootStates.some(({ state }) => state === "booting"), false);
  assert.equal(m.postRestoreAudioAfter.guestAttached, true);
  assert.ok(m.postRestoreAudioAfter.pcm.nonSilentFrames > 0);
  assert.ok(m.postRestoreAudioAfter.pcm.maxAbs > 0);
  assert.equal(m.postRestoreAplay.terminalMarkerSeen, true);
  assert.ok(m.postRestoreAplay.visualDiffPixels >= 2_000);
  assert.deepEqual(m.guestClockErrors, { browser: [], http: [] });
  for (const sample of [m.guestClockBefore, m.guestClockAfter]) assert.equal(sample.state.mode, "icount");
  const { jitBefore: before, jitAfter: after } = m;
  for (const sample of [before, after]) {
    assert.equal(sample.state.hasExecutor, true);
    assert.equal(sample.state.jitResidencyPolicy, policy);
    assert.equal(sample.state.jitResidencyCap, policy === "repack-off" ? 24 : 256);
    assert.ok(sample.receivedAt >= sample.requestedAt);
  }
  const deltas = {};
  for (const key of ["guestRetired", "retiredViaJit", "hostEntries", "directChainEntries",
    "blockEntryHits", "blockBuilds", "jitCacheInstalls", "jitCacheRetranslations", "jitCacheEvictions",
    "decodedBlocksDiscarded", "decodedCacheFlushes"]) {
    assert.ok(Number.isSafeInteger(before.state[key]) && Number.isSafeInteger(after.state[key]), key);
    deltas[key] = after.state[key] - before.state[key];
    assert.ok(deltas[key] >= 0, `${key} regressed`);
  }
  assert.ok(deltas.guestRetired > 0 && deltas.retiredViaJit > 0);
  assert.equal(m.postRestoreStart, m.normalRestore.result.completedAt);
  results.push({ index: index + 1, policy, record: path.relative(repo, file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    binding: m.run.binding, profileSha256: m.run.profileSha256,
    snapshotSha256: m.normalSnapshot.sha256, workerBefore: before, workerAfter: after, deltas,
    interactionMs: m.postRestoreEnd - m.postRestoreStart,
    fTimingPassed: m.postRestoreEnd - m.postRestoreStart <= 2_000, fVerified: false,
  });
  for (const key of ["binding", "profileSha256", "snapshotSha256"]) {
    assert.deepEqual(results[0][key], results.at(-1)[key], `comparison changed ${key}`);
  }
}
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), head);
const report = { schema: "wasm-vm.e5-t26f.residency-comparison.v1", head, retained,
  claim: "unprofiled ABBA control of existing policies; not F acceptance or a production default decision", results };
await writeFile(path.join(out, "comparison.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
