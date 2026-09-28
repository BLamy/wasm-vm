// Execute the frozen wrapper in a VM with only synthetic I/O; no browser/process.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PREPARED_DIRECT_IDENTITIES, PREPARED_DIRECT_WASM, PREPARED_DIRECT_COMMAND }
  from "../../../tools/verify/omarchy-prepared-direct-state.mjs";
import { assertOriginalPresentation } from "../../../tools/verify/omarchy-opaque-foot-command.mjs";

const dir = new URL("./", import.meta.url);
const url = new URL("../../../tools/verify/omarchy-prepared-direct-input.mjs", dir);
const source = await fs.readFile(url, "utf8");
const body = source.replace(/^#!.*\n/u, "").replace(/^import [\s\S]*?;\n/gmu, "").replaceAll("import.meta.url", "moduleUrl");
const head = "9cc377180921be98f904c3689a1d7c48b9df3947";
const cases = [];
for (const name of ["negative", "synthetic-positive", "wrong-pair-size", "wrong-pair-hash", "wrong-wasm", "watchdog", "audit-error", "late-fence"]) {
  const saved = [], signals = [], outputs = [];
  const stream = { pipe() {}, unpipe() {}, destroy() { signals.push("stream-destroy"); } };
  const child = { stdout: stream, stderr: stream, connected: true,
    unref() { signals.push("unref"); }, disconnect() { signals.push("disconnect"); } };
  const report = { result: name === "negative" ? "failed" : "input-trial-physical-nonce-and-fresh-presentation",
    observations: [{ runtime: { presentation: { framesReceived: 2, successfulPresents: 2,
      latest: { resourceWidth: 1280, resourceHeight: 832, rect: { x: 0, y: 0, width: 1280, height: 800 } } } } }], inputEvents: [] };
  if (name !== "negative") {
    report.keyboard = { typedAt: new Date(1000).toISOString(), enteredAtMs: 1000, deadlineAt: new Date(121000).toISOString() };
    report.preparedDirectInputFence = { method: "Input.setIgnoreInputEvents", ignore: true,
      startedAt: new Date(1001).toISOString(), acknowledgedAt: new Date(name === "late-fence" ? 121001 : 1002).toISOString() };
  }
  const bindings = {
    assert, path, fileURLToPath, moduleUrl: url.href, Buffer, JSON,
    // Only synthetic pin objects are hashed by this test adapter. The real
    // pair and runtime bytes were separately hashed by the prerequisite audit.
    createHash: algorithm => {
      let value; return { update(v) { value = v; return this; }, digest() {
        return value.syntheticPin ?? createHash(algorithm).update(value).digest("hex");
      } };
    },
    process: { argv: ["node", url.pathname, "/tmp/critic-synthetic-out", "/tmp/critic-synthetic-pair"], execPath: "unused-node",
      env: { OMARCHY_BROWSER_TIMEOUT_MS: "999999", OMARCHY_DIRECT_OPAQUE: "1", KEEP: "value" } },
    console: { log(value) { outputs.push(value); } },
    fs: { async mkdir() { signals.push("mkdir-mocked"); }, async readFile(filename) {
      if (filename.endsWith("omarchy-ready.snap.gz")) return {
        length: name === "wrong-pair-size" ? 1 : 207172408,
        syntheticPin: name === "wrong-pair-hash" ? "0".repeat(64) : "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75" };
      if (filename.endsWith("omarchy-overlay-delta.bin.gz")) return { length: 1232847,
        syntheticPin: "4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972" };
      if (filename.endsWith(".wasm")) return { syntheticPin: name === "wrong-wasm" ? "0".repeat(64) : PREPARED_DIRECT_WASM };
      return Buffer.from(JSON.stringify(report));
    }, async writeFile(filename, value) { saved.push(JSON.parse(value)); } },
    createWriteStream: () => ({ end(callback) { callback(); } }),
    spawn: (executable, args, options) => {
      assert.equal(options.env.OMARCHY_BROWSER_TIMEOUT_MS, undefined);
      assert.equal(options.env.OMARCHY_DIRECT_OPAQUE, undefined);
      assert.equal(options.env.OMARCHY_PREPARED_DIRECT, "1");
      assert.equal(options.env.OMARCHY_INPUT_TRIAL_ARM, "candidate");
      assert.equal(options.env.OMARCHY_CANDIDATE_PAIR_DIR, "/tmp/critic-synthetic-pair");
      assert.equal(options.env.KEEP, "value"); signals.push("spawn-mocked"); return child;
    },
    execFileSync: () => head + "\n",
    watchOwnedTrial: async () => ({ closed: name !== "watchdog", watchdog: name === "watchdog" ? { phase: "synthetic" } : null }),
    auditInputReport: (r, options) => {
      assert.equal(options.preparedDirect, true); assert.equal(options.startupCommands[0], PREPARED_DIRECT_COMMAND);
      if (name === "audit-error") throw Error("synthetic raw audit rejection");
      return { machineAcceptance: name !== "negative" };
    },
    auditPreparedDirect: () => ({ configuration: "synthetic-only" }),
    assertOriginalPresentation, PREPARED_DIRECT_COMMAND, PREPARED_DIRECT_IDENTITIES, PREPARED_DIRECT_WASM,
  };
  let failure;
  try { await vm.runInNewContext(`(async () => {${body}\n})()`, bindings, { filename: "actual-prepared-direct-wrapper.mjs" }); }
  catch (error) { failure = error; }
  if (["negative", "synthetic-positive"].includes(name)) {
    assert.equal(failure, undefined); assert.equal(saved.at(-1).desktopAcceptance, false);
    assert.equal(saved.at(-1).acceptanceClaim, false); assert.equal(saved.at(-1).visualInspectionRequired, true);
    assert.equal(outputs.length, 1);
  } else {
    assert.ok(failure); assert.equal(outputs.length, 0);
    if (name.startsWith("wrong-")) { assert.deepEqual(signals, []); assert.equal(saved.length, 0); }
    else if (name === "watchdog") assert.deepEqual(signals, ["mkdir-mocked", "spawn-mocked", "unref", "stream-destroy", "stream-destroy", "disconnect"]);
    else assert.ok(saved.at(-1).auditError);
  }
  cases.push({ name, held: true, rejected: Boolean(failure), error: failure ? String(failure) : null,
    wroteExplicitNonAcceptance: saved.at(-1)?.desktopAcceptance === false, signals });
}
const result = { productEvidence: false, purpose: "actual wrapper branch coverage with synthetic process, files, hash pins and reports",
  sourceSha256: createHash("sha256").update(source).digest("hex"), cases };
await fs.writeFile(new URL("wrapper-test.json", dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
