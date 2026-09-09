#!/usr/bin/env node
// E5-T26i: two unprofiled clock modes, the same authenticated restored desktop.
// A measured F deadline failure is retained, never turned into an F acceptance pass.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const out = path.resolve(process.env.E5_T26I_OUT || path.join(repo, "evidence/e5-t26i/browser"));
await mkdir(out, { recursive: true });
const retained = process.env.E5_T26I_CHECKPOINT || await mkdtemp(path.join(os.tmpdir(), "e5-t26i-clock-"));
// Do not inherit an override, profiler, or old F image accidentally from an implementer's shell.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("E5_T26F_")));
Object.assign(env, {
  E5_T26F_REQUIRE_HEAD: head,
  E5_T26F_HEADED: "1",
  E5_T26F_DIAGNOSTIC_PROFILE: retained,
  E5_T26F_DIAGNOSTIC_PORT: process.env.E5_T26I_PORT || "61628",
  E5_T26F_IMAGE: process.env.E5_T26I_IMAGE || "target/e5-t26f/desktop-image-aplay-noresize/alpine-rootfs.ext4",
  E5_T26F_IMAGE_INFO: process.env.E5_T26I_IMAGE_INFO || "target/e5-t26f/desktop-image-aplay-noresize/desktop-info.json",
  E5_T26F_DESKTOP_ASSET_DIR: process.env.E5_T26I_ASSET_DIR || "target/e5-t26f/chunks/desktop-aplay-noresize",
});

async function run(label, settings) {
  const directory = path.join(out, label);
  await mkdir(directory); // Never overwrite a prior recording, including a failed one.
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

if (!process.env.E5_T26I_CHECKPOINT) {
  const created = await run("checkpoint", { E5_T26F_DIAGNOSTIC: "create" });
  assert.equal(created.code, 0, "cold checkpoint did not complete; retain failure evidence");
}

const results = [];
for (const mode of ["icount", "wall"]) {
  const runResult = await run(mode, {
    E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_GUEST_CLOCK: mode,
    E5_T26F_DIAGNOSTIC_KEY_DELAY_MS: "5",
  });
  const file = path.join(runResult.directory, runResult.code === 0
    ? "diagnostic-iteration.json" : "failure-post-restore-interaction-checks.json");
  const bytes = await readFile(file);
  const record = JSON.parse(bytes);
  if (runResult.code !== 0) {
    assert.equal(runResult.code, 1);
    assert.equal(record.error?.message, "post-restore interaction exceeded 2 seconds",
      "only the named, unchanged F timing failure can be reported as a completed I comparison");
  }
  const m = record.milestones;
  assert.equal(m.run.acceptance, false);
  assert.equal(m.run.diagnostic.guestClock, mode);
  assert.equal(m.run.diagnostic.cpu, false);
  assert.equal(m.run.diagnostic.latency, false);
  assert.equal(m.run.postRestoreCommand, "sh /tmp/a");
  assert.equal(m.run.postRestoreKeyDelayMs, 5);
  assert.equal(m.normalRestore.displayChecksPassed, true);
  assert.equal(m.normalRestore.result.resume.restored, true);
  assert.equal(m.postRestoreAudioAfter.guestAttached, true);
  assert.ok(m.postRestoreAudioAfter.pcm.nonSilentFrames > 0);
  assert.ok(m.postRestoreAudioAfter.pcm.maxAbs > 0);
  assert.equal(m.postRestoreAplay.terminalMarkerSeen, true);
  assert.ok(m.postRestoreAplay.visualDiffPixels >= 2_000);
  assert.deepEqual(m.guestClockErrors, { browser: [], http: [] });
  const { guestClockBefore: before, guestClockAfter: after } = m;
  for (const sample of [before, after]) {
    assert.equal(sample.state.mode, mode);
    assert.equal(sample.state.timebaseHz, 10_000_000);
    assert.equal(sample.state.clockDiv, 10);
    assert.match(sample.state.mtime, /^\d+$/u);
    assert.ok(sample.receivedAt >= sample.requestedAt);
  }
  const ticks = BigInt(after.state.mtime) - BigInt(before.state.mtime);
  assert.ok(ticks > 0n, "the actual running guest clock must advance");
  const hostMinMs = after.requestedAt - before.receivedAt;
  const hostMaxMs = after.receivedAt - before.requestedAt;
  assert.ok(hostMinMs > 0 && hostMaxMs >= hostMinMs);
  results.push({ mode, record: path.relative(repo, file),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    binding: m.run.binding, profileSha256: m.run.profileSha256,
    snapshotSha256: m.normalSnapshot.sha256, workerBefore: before, workerAfter: after,
    guestDeltaTicks: ticks.toString(), guestDeltaMs: Number(ticks) / 10_000,
    hostMinMs, hostMaxMs, interactionMs: m.postRestoreEnd - m.postRestoreStart,
    fTimingPassed: runResult.code === 0, fVerified: false,
  });
}
for (const key of ["binding", "profileSha256", "snapshotSha256"]) {
  assert.deepEqual(results[0][key], results[1][key], `comparison changed ${key}`);
}
assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(), head);
const report = { schema: "wasm-vm.e5-t26i.browser-clock-comparison.v1", head, retained,
  claim: "opt-in clock plumbing and recorded input/audio comparison; not F acceptance or a default policy change",
  results };
await writeFile(path.join(out, "comparison.json"), JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify(report, null, 2));
