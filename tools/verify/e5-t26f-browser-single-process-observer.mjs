#!/usr/bin/env node
// New authenticated cold seal, then one unchanged-policy F screen. Never F acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { compileQueueObservation } from "./e5-t26f-compile-queue-observation.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const headNow = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const head = headNow(), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const out = path.resolve(process.env.E5_T26F_SINGLE_PROCESS_OUT || path.join(repo, `evidence/e5-t26f/single-process-observer-${head.slice(0, 8)}`));
await mkdir(path.dirname(out), { recursive: true });
await mkdir(out); // Refuse overwriting every attempt, including failed attempts.
const retained = await mkdtemp(path.join(os.tmpdir(), "e5-t26f-single-process-observer-"));
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("E5_") && !key.startsWith("CARGO_") && !["RUSTFLAGS", "RUST_LOG"].includes(key)));
const common = {
  E5_T26F_REQUIRE_HEAD: head, E5_T26F_HEADED: "0", E5_T26F_FIXTURE: "resident-observer-v1",
  E5_T26F_DIAGNOSTIC_PROFILE: retained, E5_T26F_DIAGNOSTIC_PORT: "61637",
  E5_T26F_TIMEOUT_MS: "1800000",
  E5_T26F_IMAGE: "target/e5-t26f/resident-image-single-process-observer-v1/alpine-rootfs.ext4",
  E5_T26F_IMAGE_INFO: "target/e5-t26f/resident-image-single-process-observer-v1/desktop-info.json",
  E5_T26F_DESKTOP_ASSET_DIR: "target/e5-t26f/chunks/resident-single-process-observer-v1",
};
const command = "tools/verify/e5-t26f-browser-roundtrip.mjs";
// The inner runner verifies image bytes against the pinned metadata and helper.
const sourceBindings = {};
for (const file of [command, "tools/verify/e5-t26f-resident-proof.mjs", "tools/verify/e5-t26f-discovery-observation.mjs", "tools/verify/e5-t26f-compile-queue-observation.mjs",
  "tools/verify/e5-t26f-browser-single-process-observer.mjs", "crates/core/src/compile_queue.rs", "crates/core/src/lib.rs", "crates/wasm/src/lib.rs",
  "tools/guest/e5-t26f-resident-observer.sh", "tools/verify/e5-t26f-observer-image.mjs", "tools/chunk_image.py",
  "tools/guest/e5-t26f-observer.c", "tools/verify/e5-t26f-observer-build.mjs",
  "target/e5-t26f/observer-build-v1/build-info.json", "target/e5-t26f/observer-build-v1/e5t26f-observe",
  common.E5_T26F_IMAGE_INFO, `${common.E5_T26F_DESKTOP_ASSET_DIR}/manifest.json`])
  sourceBindings[file] = sha(await readFile(path.join(repo, file)));
await writeFile(path.join(out, "invocation.json"), JSON.stringify({ head, acceptance: false, common, command,
  sourceBindings, retained, order: ["cold", "reuse-default4096-repack-off24"] }, null, 2) + "\n", { flag: "wx" });

async function run(label, settings) {
  assert.equal(headNow(), head);
  const directory = path.join(out, label); await mkdir(directory);
  const config = { ...common, ...settings, E5_T26F_OUT: directory };
  let log = JSON.stringify({ head, config, command }) + "\n";
  const child = spawn(process.execPath, [command], { cwd: repo, env: { ...clean, ...config }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
    log += bytes.toString(); process.stdout.write(bytes);
  });
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await writeFile(path.join(directory, "run.log"), log, { flag: "wx" });
  await writeFile(path.join(directory, "exit.json"), JSON.stringify(result) + "\n", { flag: "wx" });
  assert.equal(result.signal, null, "terminated browser child is not a measurement");
  assert.equal(headNow(), head);
  return { ...result, directory };
}

const cold = await run("cold", { E5_T26F_DIAGNOSTIC: "create" });
assert.equal(cold.code, 0, "new cold checkpoint failed; never rebind an old seal");
const reuse = await run("reuse", { E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_DIAGNOSTIC_JIT: "1",
  E5_T26F_DIAGNOSTIC_RESIDENCY: "repack-off" });
assert.ok([0, 1].includes(reuse.code));
const record = path.join(reuse.directory, reuse.code === 0 ? "diagnostic-iteration.json" : "failure-post-restore-interaction-checks.json");
const bytes = await readFile(record), raw = JSON.parse(bytes);
assert.equal(raw.milestones?.run?.binding?.head, head, "raw authenticated runtime head");
if (Object.hasOwn(raw, "head")) assert.equal(raw.head, head, "inconsistent top-level record head");
const observation = compileQueueObservation(raw, reuse.code); // Reject non-cap failures; retain the original T0/end.
assert.equal(headNow(), head);
for (const [file, digest] of Object.entries(sourceBindings))
  assert.equal(sha(await readFile(path.join(repo, file))), digest, `source changed during recording: ${file}`);
await writeFile(path.join(out, "observation.json"), JSON.stringify({ ...observation, head,
  record: path.relative(repo, record), recordSha256: sha(bytes), retained, sourceBindings }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ elapsedMs: observation.elapsedMs, fTimingPassed: observation.fTimingPassed,
  fVerified: false, accounting: observation.accounting }));
