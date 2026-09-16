// Synthetic orchestration only: execute the actual wrapper with no process/browser.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertOriginalPresentation } from "../../../tools/verify/omarchy-opaque-foot-command.mjs";
import { DIRECT_OPAQUE_COMMAND } from "../../../tools/verify/omarchy-direct-opaque-command.mjs";

const dir = new URL("./", import.meta.url);
const url = new URL("../../../tools/verify/omarchy-direct-opaque.mjs", dir);
const source = await fs.readFile(url, "utf8");
const body = source.replace(/^#!.*\n/u, "").replace(/^import .*;\n/gmu, "")
  .replaceAll("import.meta.url", "moduleUrl");
const cases = [];
for (const name of ["negative", "synthetic-positive", "watchdog", "audit-error", "late-fence"]) {
  const saved = [], signals = [], outputs = [];
  const stream = { pipe() {}, unpipe() {}, destroy() { signals.push("stream-destroy"); } };
  const child = { stdout: stream, stderr: stream, connected: true,
    unref() { signals.push("unref"); }, disconnect() { signals.push("disconnect"); } };
  const report = { result: name === "negative" ? "failed" : "input-trial-physical-nonce-and-fresh-presentation",
    observations: [{ runtime: { presentation: { framesReceived: 2, successfulPresents: 2,
      latest: { resourceWidth: 1280, resourceHeight: 832, rect: { x: 0, y: 0, width: 1280, height: 800 } } } } }],
    inputEvents: [] };
  if (name !== "negative") {
    report.keyboard = { typedAt: new Date(1000).toISOString(), enteredAtMs: 1000, deadlineAt: new Date(121000).toISOString() };
    report.directOpaqueInputFence = { method: "Input.setIgnoreInputEvents", ignore: true,
      startedAt: new Date(1001).toISOString(), acknowledgedAt: new Date(name === "late-fence" ? 121001 : 1002).toISOString() };
  }
  const bindings = {
    assert, path, createHash, fileURLToPath, moduleUrl: url.href, Buffer, JSON,
    process: { argv: ["node", url.pathname, "/tmp/opaque-critic-synthetic"], execPath: "unused-node",
      env: { OMARCHY_BROWSER_TIMEOUT_MS: "999999", OMARCHY_UNRELATED: "invalid", KEEP: "value" } },
    console: { log(value) { outputs.push(value); } },
    fs: { async mkdir() {}, async readFile(filename) {
      return filename.endsWith(".wasm") ? Buffer.from("synthetic-wasm") : Buffer.from(JSON.stringify(report));
    }, async writeFile(filename, value) { saved.push(JSON.parse(value)); } },
    createWriteStream: () => ({ end(callback) { callback(); } }),
    spawn: (executable, args, options) => {
      assert.equal(options.env.OMARCHY_BROWSER_TIMEOUT_MS, undefined);
      assert.equal(options.env.OMARCHY_UNRELATED, undefined);
      assert.equal(options.env.OMARCHY_DIRECT_OPAQUE, "1");
      assert.equal(options.env.OMARCHY_INPUT_TRIAL_ARM, "candidate");
      assert.equal(options.env.KEEP, "value"); signals.push("spawn-mocked"); return child;
    },
    execFileSync: () => "f55923bda86172359f73db8ea998692ceb155fae\n",
    watchOwnedTrial: async () => ({ closed: name !== "watchdog", watchdog: name === "watchdog" ? { phase: "synthetic" } : null }),
    auditInputReport: () => { if (name === "audit-error") throw Error("synthetic raw audit rejection"); return { machineAcceptance: name !== "negative" }; },
    auditDirectOpaque: () => ({ configuration: "synthetic-only" }),
    assertOriginalPresentation, DIRECT_OPAQUE_COMMAND,
  };
  let failure;
  try { await vm.runInNewContext(`(async () => {${body}\n})()`, bindings, { filename: "actual-direct-opaque-wrapper.mjs" }); }
  catch (error) { failure = error; }
  if (["negative", "synthetic-positive"].includes(name)) {
    assert.equal(failure, undefined); assert.equal(saved.at(-1).desktopAcceptance, false);
    assert.equal(saved.at(-1).visualInspectionRequired, true);
    assert.equal(outputs.length, 1);
  } else {
    assert.ok(failure); assert.equal(outputs.length, 0);
    if (name === "watchdog") assert.deepEqual(signals, ["spawn-mocked", "unref", "stream-destroy", "stream-destroy", "disconnect"]);
    else assert.ok(saved.at(-1).auditError);
  }
  cases.push({ name, held: true, failedAsExpected: Boolean(failure), error: failure ? String(failure) : null,
    wroteExplicitNonAcceptance: saved.at(-1).desktopAcceptance === false });
}
const result = { productEvidence: false, sourceSha256: createHash("sha256").update(source).digest("hex"), cases };
await fs.writeFile(new URL("wrapper-test.json", dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
