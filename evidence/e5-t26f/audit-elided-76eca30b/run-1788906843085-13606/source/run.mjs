#!/usr/bin/env node
// Launcher only. Main owns the one browser launch after review; this file does not run on import.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AUDIT_ELIDED_PLAY_SHA256, generateAuditElided, CURRENT_HEAD, SEAL, SOURCE_PINS, validateAuditEnvironment } from "./factory.mjs";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const evidenceRoot = path.join(repo, "evidence/e5-t26f/audit-elided-76eca30b");
const targetParent = path.join(repo, "target/e5-t26f");

export async function createRunLayout(output) {
  await mkdir(output);
  const record = path.join(output, "record");
  await mkdir(record);
  return { output, record };
}

export function validateClosedResult(raw, code) {
  assert.ok(code === 0 || code === 1, "unexpected browser child exit");
  for (const record of [raw, raw.milestones]) {
    assert.equal(record?.auditElided, "counterfactual");
    assert.equal(record.acceptance, false);
    assert.equal(record.fVerified, false);
    assert.equal(record.postIdentityValidated, false);
  }
  const m = raw.milestones;
  assert.equal(m.run?.binding?.head, CURRENT_HEAD);
  assert.equal(m.run?.binding?.runtimeSha256, SEAL.runtimeSha256);
  assert.ok(Number.isFinite(m.postRestoreStart) && Number.isFinite(m.postRestoreEnd));
  assert.equal(m.normalRestore?.result?.completedAt, m.postRestoreStart);
  const elapsedMs = m.postRestoreEnd - m.postRestoreStart;
  assert.ok(elapsedMs >= 0);
  if (code === 1) {
    assert.equal(raw.error?.message, "post-restore interaction exceeded 2 seconds");
    assert.ok(elapsedMs > 2000, "cap failure without a deadline miss");
  } else {
    assert.equal(raw.error, undefined);
    assert.ok(elapsedMs <= 2000, "successful screen concealed a deadline miss");
  }
  return { t0: m.postRestoreStart, end: m.postRestoreEnd, elapsedMs,
    capLimitMs: 2000, capFailed: elapsedMs > 2000 };
}

export async function main() {
for (const key of Object.keys(process.env)) {
  assert.ok(!key.startsWith("E5_T26F_"), `launcher refuses inherited override ${key}`);
}
const original = JSON.parse(await readFile(path.join(repo,
  "evidence/e5-t26f/single-process-observer-76eca30b/invocation.json"), "utf8"));
assert.equal(original.head, CURRENT_HEAD);
const nonce = `${Date.now()}-${process.pid}`;
const output = path.join(evidenceRoot, `run-${nonce}`);
const record = path.join(output, "record");
const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("E5_") && !key.startsWith("CARGO_") && !["RUSTFLAGS", "RUSTDOCFLAGS", "RUST_LOG"].includes(key)));
const actualHead = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const expectedPins = { ...original.sourceBindings, ...SOURCE_PINS };
for (const name of ["factory.mjs", "factory.test.mjs", "run.mjs"]) {
  const relative = path.relative(repo, path.join(evidenceRoot, name));
  expectedPins[relative] = sha(await readFile(path.join(repo, relative)));
}
const sourceDigests = async () => Object.fromEntries(await Promise.all(Object.keys(expectedPins).map(async relative => [relative, sha(await readFile(path.join(repo, relative)))])));
const env = { ...clean, ...original.common, E5_T26F_REQUIRE_HEAD: CURRENT_HEAD,
  E5_T26F_DIAGNOSTIC: "reuse", E5_T26F_OUT: record };
validateAuditEnvironment(env, CURRENT_HEAD);
await mkdir(evidenceRoot, { recursive: true });
assert.deepEqual(await createRunLayout(output), { output, record });
const target = path.join(targetParent, `audit-elided-76eca30b-${nonce}`);
const before = { head: actualHead(), sourcePins: await sourceDigests() };
assert.equal(before.head, CURRENT_HEAD);
assert.deepEqual(before.sourcePins, expectedPins);
const metadata = await generateAuditElided(target, env);
const script = path.join(target, "probe.mjs");
const invocation = { schema: "wasm-vm.e5-t26f.audit-elided-counterfactual-invocation.v1", auditElided: "counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false, head: CURRENT_HEAD, seal: SEAL, sourcePins: expectedPins, config: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("E5_T26F_"))), target, output, command: [process.execPath, script], originalInterval: "restore.completedAt -> frozen post-restore end <= 2000ms", setupVisualChange: metadata.setupVisualChange, auditElidedPlayBodySha256: AUDIT_ELIDED_PLAY_SHA256, auditElidedPlayBodyBytes: 535, generatedSourceSha256: metadata.generatedSourceSha256, factorySha256: metadata.factorySha256, before };
await writeFile(path.join(output, "invocation.json"), JSON.stringify(invocation, null, 2) + "\n", { flag: "wx" });
let log = JSON.stringify({ command: invocation.command, env: Object.fromEntries(Object.entries(env).filter(([key]) => key.startsWith("E5_T26F_"))) }) + "\n";
const child = spawn(process.execPath, [script], { cwd: repo, env, stdio: ["ignore", "pipe", "pipe"] });
for (const stream of [child.stdout, child.stderr]) stream.on("data", chunk => { log += chunk.toString(); process.stdout.write(chunk); });
const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
await writeFile(path.join(output, "run.log"), log, { flag: "wx" });
await writeFile(path.join(output, "exit.json"), JSON.stringify({ ...result, auditElided: "counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false }) + "\n", { flag: "wx" });
assert.equal(result.signal, null, "browser child terminated by signal; retain failed attempt");
const after = { head: actualHead(), sourcePins: await sourceDigests() };
assert.equal(after.head, before.head); assert.deepEqual(after.sourcePins, before.sourcePins);
assert.equal(sha(await readFile(script)), metadata.generatedSourceSha256);
assert.ok(result.code === 0 || result.code === 1);
const rawPath = path.join(record, result.code === 0 ? "diagnostic-iteration.json" :
  "failure-post-restore-interaction-checks.json");
const rawBytes = await readFile(rawPath);
const raw = JSON.parse(rawBytes);
const rawDigest = sha(rawBytes);
const timing = validateClosedResult(raw, result.code);
await writeFile(path.join(output, "raw-validation.json"), JSON.stringify({ auditElided: "counterfactual", acceptance: false, fVerified: false, postIdentityValidated: false, rawPath, rawSha256: rawDigest, timing, before, after }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ output, target, result, generatedSourceSha256: metadata.generatedSourceSha256, digest: sha(await readFile(script)), rawSha256: rawDigest, timing, before, after, acceptance: false, fVerified: false, postIdentityValidated: false }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
