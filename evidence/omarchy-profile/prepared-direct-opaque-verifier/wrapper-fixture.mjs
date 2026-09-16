// Exact CLI body with fake process/IO boundaries. Never spawns a child or browser.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { assertInputTrialSource, assertInputTrialRuntime, R3_IDENTITIES } from "../../../tools/verify/omarchy-input-trial.mjs";
import { modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS } from "../../../tools/verify/omarchy-mode-preparation.mjs";
import { assertOriginalPresentation } from "../../../tools/verify/omarchy-opaque-foot-command.mjs";
import { DIRECT_OPAQUE_COMMAND, auditDirectOpaque } from "../../../tools/verify/omarchy-direct-opaque-command.mjs";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";

const sourceUrl = new URL("../../../tools/verify/omarchy-prepare-direct-opaque.mjs", import.meta.url);
const source = await fs.readFile(sourceUrl, "utf8");
const start = source.indexOf("const repo=path.resolve("); assert.ok(start > 0);
const actualBody = source.slice(start).replaceAll("import.meta.url", "SOURCE_URL");
const repo = path.resolve(path.dirname(fileURLToPath(sourceUrl)), "../..");
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const wasm = Buffer.from("synthetic wasm fixture; never executed");
const cases = [];
for (const kind of ["normal-negative", "watchdog", "unclosed", "child-error", "wrong-private-path", "existing-pair", "missing-argument"]) {
  const calls = [], saves = [], streams = [];
  const pair = kind === "wrong-private-path" ? "/tmp/foreign-direct-opaque-pair" : path.join(repo, "target/verifier-no-real-files");
  const out = "/tmp/verifier-no-real-evidence";
  const child = { connected: true, stdout: new PassThrough(), stderr: new PassThrough(),
    unref() { calls.push("unref"); }, disconnect() { calls.push("disconnect"); this.connected = false; } };
  streams.push(child.stdout, child.stderr);
  const report = { mode: "direct-opaque-pair", trial: { head: "synthetic-head", scopedStatus: "" },
    identities: { files: { "pkg/wasm_vm_wasm_bg.wasm": { sha256: sha(wasm) } } },
    candidate: { source: { ...structuredClone(R3_IDENTITIES), image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } } },
    startup: { startedAt: "2026-09-16T00:00:00.000Z", deadlineAt: "2026-09-16T00:15:00.000Z", timeoutMs: 900000 },
    cleanup: { closed: true }, errors: [], inputEvents: [], workerTraffic: [], observations: [],
    preparationInputFence: { ignore: true, acknowledgedAt: "2026-09-16T00:00:00.000Z" },
    browserRequests: [{ timestamp: "2026-09-16T00:00:00.001Z" }], result: "failed",
    modePreparation: { status: "preparation-failed-input-untested" } };
  const fakeFs = {
    async stat(name) { calls.push(["stat", name]); if (kind !== "existing-pair") throw Object.assign(Error("absent"), { code: "ENOENT" }); return {}; },
    async mkdir(name, options) { calls.push(["mkdir", name, options]); },
    async writeFile(name, bytes) { assert.equal(name, path.join(out, "run.json")); saves.push(JSON.parse(bytes)); },
    async readFile(name) {
      if (name === path.join(repo, "web/dist/pkg/wasm_vm_wasm_bg.wasm")) return wasm;
      assert.equal(name, path.join(out, "desktop/report.json")); return JSON.stringify(report);
    },
  };
  const fakeProcess = { argv: ["node", "fixture", ...(kind === "missing-argument" ? [] : [out, pair])],
    env: { PATH: "fixture", OMARCHY_UNEXPECTED: "must-be-stripped", KEEP: "yes" }, execPath: "fixture-node" };
  const fakeSpawn = (binary, args, options) => {
    calls.push(["spawn", binary, args, options]);
    assert.equal(binary, "fixture-node"); assert.equal(args.at(-1), "direct-opaque-pair");
    assert.equal(options.env.OMARCHY_UNEXPECTED, undefined); assert.equal(options.env.KEEP, "yes");
    assert.equal(options.env.OMARCHY_CANDIDATE_PAIR_DIR, path.join(repo, "target/omarchy-sdr-r3-snapshot"));
    assert.equal(options.env.OMARCHY_CANDIDATE_CHUNKS, path.join(repo, "target/omarchy-profile-chunks-sdr-r3-256k"));
    assert.equal(options.env.OMARCHY_MODE_PAIR_OUTPUT_DIR, pair);
    assert.equal(options.detached, true); assert.deepEqual(options.stdio, ["ignore", "pipe", "pipe", "ipc"]);
    return child;
  };
  const fakeWatch = async (owned, options) => {
    assert.equal(owned, child); assert.deepEqual(options, { modePreparation: true });
    calls.push("owned-watch");
    return { closed: kind !== "unclosed", code: 1, signal: null,
      watchdog: kind === "watchdog" ? { phase: "synthetic-expiry" } : null,
      ...(kind === "child-error" ? { error: "synthetic child error" } : {}) };
  };
  const fakeStream = (name, options) => {
    assert.equal(name, path.join(out, "desktop.log")); assert.deepEqual(options, { flags: "wx" });
    const stream = new PassThrough(); streams.push(stream); return stream;
  };
  const bindings = { assert, fs: fakeFs, createWriteStream: fakeStream, spawn: fakeSpawn,
    execFileSync: () => "synthetic-head\n", createHash, gunzipSync, fileURLToPath, path,
    watchOwnedTrial: fakeWatch, assertInputTrialSource, assertInputTrialRuntime,
    modePreparationOptions, validatePreparedPair, MODE_PREPARATION_MS, DIRECT_OPAQUE_COMMAND,
    auditDirectOpaque, assertOriginalPresentation, auditSerial,
    process: fakeProcess, SOURCE_URL: sourceUrl.href, console: { log: () => {} } };
  let error = null;
  try {
    const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
    await new AsyncFunction(...Object.keys(bindings), actualBody)(...Object.values(bindings));
  } catch (cause) { error = String(cause); }
  for (const stream of streams) stream.destroy();
  if (kind === "normal-negative") {
    assert.equal(error, null); assert.equal(saves.at(-1).usablePair, false);
    assert.equal(saves.at(-1).result, "preparation-failed-input-untested");
  } else {
    assert.ok(error);
    assert.ok(saves.every(receipt => receipt.usablePair !== true));
    if (["watchdog", "unclosed", "child-error"].includes(kind)) {
      assert.match(error, /no usable pair/u); assert.ok(calls.includes("unref") && calls.includes("disconnect"));
      assert.ok(child.stdout.destroyed && child.stderr.destroyed);
    } else assert.ok(!calls.some(row => Array.isArray(row) && row[0] === "spawn"));
  }
  cases.push({ kind, error, calls, saves });
}
console.log(JSON.stringify({ synthetic: true, noGuestOrBrowser: true, sourceSha256: sha(source),
  sourceStart: start, substitutions: ["import.meta.url -> fixed source URL only"], cases }, null, 2));
