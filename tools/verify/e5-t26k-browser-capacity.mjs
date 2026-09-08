#!/usr/bin/env node
// One new runtime-bound cold seal, then 4096/16384/16384/4096. Never F acceptance.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { collectDecodedCacheRecord } from "./e5-t26k-decoded-cache.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const headNow = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const head = headNow(), sha = bytes => createHash("sha256").update(bytes).digest("hex");
const out = path.resolve(process.env.E5_T26K_OUT || path.join(repo, "evidence/e5-t26k/capacity"));
await mkdir(path.dirname(out), { recursive: true });
await mkdir(out); // Every attempt is immutable, including failures.
const retained = process.env.E5_T26K_CHECKPOINT || await mkdtemp(path.join(os.tmpdir(), "e5-t26k-capacity-"));
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !key.startsWith("E5_T26F_") && !key.startsWith("E5_T26K_") && !key.startsWith("CARGO_") && !["RUSTFLAGS", "RUST_LOG"].includes(key)));
const common = {
  E5_T26F_REQUIRE_HEAD: head, E5_T26F_HEADED: "0", E5_T26F_FIXTURE: "resident-aplay-v1",
  E5_T26F_DIAGNOSTIC_PROFILE: retained, E5_T26F_DIAGNOSTIC_PORT: "61632",
  E5_T26F_TIMEOUT_MS: "1800000",
  E5_T26F_IMAGE: "target/e5-t26f/resident-image-2ae65408-a/alpine-rootfs.ext4",
  E5_T26F_IMAGE_INFO: "target/e5-t26f/resident-image-2ae65408-a/desktop-info.json",
  E5_T26F_DESKTOP_ASSET_DIR: "target/e5-t26f/chunks/resident-2ae65408",
};
const command = "tools/verify/e5-t26f-browser-roundtrip.mjs";
const sourceBindings = {};
for (const file of [command, "tools/verify/e5-t26f-resident-proof.mjs", "tools/verify/e5-t26k-decoded-cache.mjs",
  "tools/verify/e5-t26k-browser-capacity.mjs"]) sourceBindings[file] = sha(await readFile(path.join(repo, file)));
await writeFile(path.join(out, "invocation.json"), JSON.stringify({ head, acceptance: false, common, command,
  sourceBindings, order: [4096, 16384, 16384, 4096], retained }, null, 2) + "\n", { flag: "wx" });

async function run(label, settings) {
  assert.equal(headNow(), head);
  const directory = path.join(out, label); await mkdir(directory);
  const config = { ...common, ...settings, E5_T26F_OUT: directory };
  let log = `${JSON.stringify({ head, config, command })}\n`;
  const child = spawn(process.execPath, [command], { cwd: repo, env: { ...clean, ...config }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => {
    log += bytes.toString(); process.stderr.write(bytes);
  });
  const { code, signal } = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
  });
  await writeFile(path.join(directory, "run.log"), log, { flag: "wx" });
  assert.equal(signal, null, "browser child terminated by signal; retained log is not an arm");
  assert.equal(headNow(), head);
  return { directory, code };
}

if (!process.env.E5_T26K_CHECKPOINT) {
  const cold = await run("cold", { E5_T26F_DIAGNOSTIC: "create" });
  assert.equal(cold.code, 0, "new cold checkpoint failed; never rebind an old seal");
}

const results = [];
for (const [index, entries] of [4096, 16384, 16384, 4096].entries()) {
  const child = await run(`${index + 1}-${entries}`, { E5_T26F_DIAGNOSTIC: "reuse",
    E5_T26F_DIAGNOSTIC_DECODED_CACHE_ENTRIES: String(entries) });
  const file = path.join(child.directory, child.code === 0 ? "diagnostic-iteration.json" : "failure-post-restore-interaction-checks.json");
  const bytes = await readFile(file), raw = JSON.parse(bytes);
  assert.equal(raw.head, head);
  const observed = collectDecodedCacheRecord(raw, child.code, entries);
  results.push({ order: index + 1, record: path.relative(repo, file), sha256: sha(bytes), exitCode: child.code, ...observed });
  for (const key of ["binding", "profileSha256", "snapshotSha256", "residentCheckpoint"]) {
    assert.deepEqual(results[0][key], observed[key], `capacity comparison changed ${key}`);
  }
  console.log(JSON.stringify({ arm: index + 1, entries, elapsedMs: observed.elapsedMs, fTimingPassed: observed.fTimingPassed, deltas: observed.deltas }));
}
assert.equal(headNow(), head);
await writeFile(path.join(out, "comparison.json"), JSON.stringify({ schema: "wasm-vm.e5-t26k.capacity-comparison.v1",
  head, acceptance: false, defaultChanged: false, retained, sourceBindings, results }, null, 2) + "\n", { flag: "wx" });
console.log("K configuration comparison recorded; no F acceptance or default promotion.");
