import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const manifestSha256 = "ec1bc2601b104cfb6d6875c091377ccfd0654d5b6aab71c6a08ae37263f1c391";

test("admission recorder flag forbids policy/profiler changes and exposes actual opt-in", () => {
  for (const args of [[], ["unused", "1", "1"], ["unused", "64", "0"],
    ["unused", "64", "1", "--profile"], ["unused", "64", "1", "--jit-threshold", "1"],
    ["unused", "64", "1", "--jit-residency", "cap-256"]]) {
    const result = spawnSync(process.execPath, ["tools/verify/omarchy-input-diagnostic.mjs",
      "--check-only", "--admission-probe", ...args], { encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /admission probe requires explicit JIT 1/u);
  }
  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /options\.admissionprobe \? "&jitAdmissionProbe=1" : ""/u);
  assert.match(source, /admissionProbeRequested: Boolean\(options\.admissionprobe\)/u);
});

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
  assert.match(source, /const sessionReceipt = \{/u);
  assert.match(source, /\["repack-off", "cap-256"\]/u);
});

test("decoded cache entries are strict and forwarded through Omarchy query options", () => {
  for (const value of ["1", "4096.0", "8192"]) {
    const invalid = spawnSync(process.execPath, [
      "tools/verify/omarchy-input-diagnostic.mjs", "--check-only", "--decoded-cache-entries", value,
    ], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.match(`${invalid.stdout}\n${invalid.stderr}`, /expected 4096 or 16384/u);
  }

  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /decodedCacheEntries=\$\{encodeURIComponent\(decodedCacheEntries\)\}/u);
  assert.match(source, /decodedCacheEntries: decodedCacheEntries \?\? null/u);
  assert.match(source, /\["4096", "16384"\]/u);

  const main = readFileSync("web/main.js", "utf8");
  assert.match(main, /decodedCacheEntries: query\.get\("decodedCacheEntries"\) \?\? "4096"/u);
});

test("jit threshold is strict and forwarded through the existing query control", () => {
  for (const value of ["0", "2", "128", "1024"]) {
    const invalid = spawnSync(process.execPath, [
      "tools/verify/omarchy-input-diagnostic.mjs", "--check-only", "--jit-threshold", value,
    ], { encoding: "utf8" });
    assert.notEqual(invalid.status, 0);
    assert.match(`${invalid.stdout}\n${invalid.stderr}`, /expected 1, 64, or 512/u);
  }

  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /jitThreshold=\$\{encodeURIComponent\(jitThreshold\)\}/u);
  assert.match(source, /\["1", "64", "512"\]/u);
  const main = readFileSync("web/main.js", "utf8");
  assert.match(main, /query\.get\("jitThreshold"\)/u);
});

test("diagnostic profiler and clock controls remain capability-gated", () => {
  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /profileRequested: Boolean\(options\.profile\)/u);
  assert.match(source, /const profileOverride = options\.profile \? "&profile=1" : ""/u);
  assert.match(source, /action === "top"/u);
  assert.match(source, /typeof controller\?\.setProfiling !== "function"/u);
  assert.match(source, /typeof controller\?\.profileStats !== "function"/u);
  assert.match(source, /typeof controller\?\.setICountDivider !== "function"/u);
  assert.match(source, /profile, topPcs: profile\?\.regions \?\? \[\]/u);
  assert.match(source, /setICountDivider\(divider\)/u);
});

test("diagnostic stats expose the read-only keyboard device counters", () => {
  const wasm = readFileSync("crates/wasm/src/lib.rs", "utf8");
  assert.match(wasm, /js_name = inputDeviceStats/u);
  for (const field of [
    "pendingEventBudget", "pendingEvents", "pendingFrames", "droppedFrames",
    "droppedEvents", "statusEventsServed", "rejectedEvents",
  ]) assert.match(wasm, new RegExp(`set\\(\\s*"${field}"`, "u"));
  const loader = readFileSync("web/loader.js", "utf8");
  assert.match(loader, /inputDeviceStats: \(\) =>/u);
  const protocol = readFileSync("web/linux-worker-protocol.js", "utf8");
  assert.match(protocol, /"inputDeviceStats"/u);
  const helper = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(helper, /inputDevice: await window\.__linuxCtl\?\.inputDeviceStats\?\.\(\)/u);
});

test("worker CPU profile operation is bounded, file-safe, and targets linux-worker", () => {
  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /request\.op === "cpu-profile"/u);
  assert.match(source, /durationMs < CPU_PROFILE_MIN_MS \|\| durationMs > CPU_PROFILE_MAX_MS/u);
  assert.match(source, /CPU_PROFILE_NAME = \/\^\[a-z0-9\]/u);
  assert.match(source, /type === "worker" && \/\(\?:\^\|\\\/\)linux-worker\\\.js/u);
  assert.match(source, /Target\.attachToTarget/u);
  assert.match(source, /Profiler\.start/u);
  assert.match(source, /Profiler\.stop/u);
  assert.match(source, /\.summary\.json/u);
  assert.match(source, /supported: false, reason: "linux-worker-target-unavailable"/u);
  assert.match(source, /CPU_PROFILE_COMMAND_TIMEOUT_MS = 10_000/u);
  assert.match(source, /setTimeout\(\(\) => finish\(null, new Error\(`/u);
  assert.match(source, /removeListener\("Target\.receivedMessageFromTarget", onMessage\)/u);
  assert.match(source, /fs\.lstat\(filename\)/u);
  const selfTest = spawnSync(process.execPath, [
    "tools/verify/omarchy-input-diagnostic.mjs", "--check-only", "--self-test-cpu-profile",
  ], { encoding: "utf8" });
  assert.equal(selfTest.status, 0, selfTest.stderr);
  assert.match(selfTest.stdout, /cpu-profile-self-test-pass/u);
});

test("diagnostic exec is subshell-wrapped and failures are retained in history", () => {
  const source = readFileSync("tools/verify/omarchy-input-diagnostic.mjs", "utf8");
  assert.match(source, /const wrapDiagnosticExec = \(command\) => `\( \$\{String\(command\)\}\\n \)`/u);
  assert.match(source, /actualCommand = wrapDiagnosticExec\(request\.command\)/u);
  assert.match(source, /\.\.\.\(actualCommand === null \? \{\} : \{ actualCommand \}\)/u);
  assert.match(source, /const errorEntry = \{/u);
  assert.match(source, /history\.push\(errorEntry\)/u);
  assert.match(source, /request,\n        .*error: String\(error\)/su);
});
