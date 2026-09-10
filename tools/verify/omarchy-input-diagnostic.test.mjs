import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const manifestSha256 = "ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391";

const candidateInputsPresent = [
  "releases/kernel/6.6.63/Image",
  "releases/boot-snapshot/omarchy-ready.snap.gz",
  "releases/boot-snapshot/omarchy-overlay-delta.bin.gz",
  "target/omarchy-profile-chunks-r2-256k/manifest.json",
].every(existsSync);

test("candidate diagnostic binds its actual manifest to an immutable alias", { skip: !candidateInputsPresent }, async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    "tools/verify/omarchy-input-diagnostic.mjs",
    "--check-only",
    "--pair-directory",
    "releases/boot-snapshot",
    "--chunk-manifest",
    "target/omarchy-profile-chunks-r2-256k/manifest.json",
  ]);
  const result = JSON.parse(stdout);
  assert.equal(result.result, "candidate-source-check-pass");
  assert.equal(result.source.chunkManifest.sha256, manifestSha256);
  assert.equal(result.chunkManifestKey, `chunked-omarchy/manifest-${manifestSha256}.json`);
});

test("jit residency flag is strict and exposes only existing A/B policies", () => {
  const invalid = spawnSync(process.execPath, [
    "tools/verify/omarchy-input-diagnostic.mjs", "--check-only", "--jit-residency", "cap-1024",
  ], { encoding: "utf8" });
  assert.notEqual(invalid.status, 0);
  assert.match(`${invalid.stdout}\n${invalid.stderr}`, /expected repack-off or cap-256/u);

  for (const args of [
    ["--check-only", "--jit-residency", "cap-256"],
    ["--check-only", "0", "--jit-residency", "cap-256"],
  ]) {
    const missingOrDisabled = spawnSync(process.execPath, ["tools/verify/omarchy-input-diagnostic.mjs", ...args], {
      encoding: "utf8",
    });
    assert.notEqual(missingOrDisabled.status, 0);
    assert.match(`${missingOrDisabled.stdout}\n${missingOrDisabled.stderr}`, /explicit diagnostic JIT selector 1/u);
  }
});

test("jit residency is recorded in the served URL and source receipt", () => {
  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /jitResidency=\$\{encodeURIComponent\(jitResidency\)\}/u);
  assert.match(source, /const sessionReceipt = \{ pageUrl, sourceReceipt, jitResidency: jitResidency \?\? null \}/u);
  assert.match(source, /\["repack-off", "cap-256"\]/u);
});
