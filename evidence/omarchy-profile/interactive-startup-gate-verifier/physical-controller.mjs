import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";

const repo = path.resolve(import.meta.dirname, "../../..");
const out = path.join(import.meta.dirname, "physical-r1");
const recorder = "tools/verify/omarchy-input-diagnostic.mjs";
const args = [recorder, out, "64", "1", "--pair-directory", "target/omarchy-input-kernel-prepared-pair-r1",
  "--chunk-dir", "target/omarchy-profile-chunks-sdr-r3-256k", "--jit-residency", "cap-256", "--decoded-cache-entries", "16384"];
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const records = [];
const note = (phase, value = {}) => {
  const record = { phase, time: new Date().toISOString(), ...value };
  records.push(record);
  console.log(JSON.stringify(record));
};
const harness = await Promise.all([
  path.relative(repo, import.meta.filename), recorder, "tools/verify/omarchy-live-recording.mjs",
  "tools/verify/omarchy-browser-session.mjs", "tools/verify/omarchy-process-sample.mjs",
].map(async filename => {
  const bytes = await readFile(path.join(repo, filename));
  return { path: filename, size: bytes.length, sha256: hash(bytes) };
}));
note("controller-receipt", {
  head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
  scopedStatus: execFileSync("git", ["status", "--short", "--", recorder, "tools/verify/omarchy-live-recording.mjs", "web/ide.js", "web/dist/ide.js"], { cwd: repo, encoding: "utf8" }),
  executable: process.execPath, args, harness,
  scope: "real canvas click and one physical key; later actual presentation; no guest-response claim",
});
const child = spawn(process.execPath, args, { cwd: repo, stdio: ["pipe", "pipe", "pipe"] });
let stdout = "", stderr = "", pending = null, readyReceipt = null;
const exit = new Promise(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
child.stderr.on("data", bytes => { stderr += bytes; });
child.stdout.on("data", bytes => { stdout += bytes; });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Error("real guest did not reach ready within 150 seconds")), 150_000);
  const lines = createInterface({ input: child.stdout });
  lines.on("line", line => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.ready === "INPUT_DIAGNOSTIC_READY") {
      readyReceipt = value; clearTimeout(timer); resolve(value);
    } else if (pending && value.request && JSON.stringify(value.request) === JSON.stringify(pending.request)) {
      const waiter = pending; pending = null;
      if (value.error) waiter.reject(Error(value.error)); else waiter.resolve(value);
    }
  });
  child.once("close", (code, signal) => {
    clearTimeout(timer);
    if (!readyReceipt) reject(Error(`recorder exited before ready: ${code}/${signal}`));
    if (pending) { pending.reject(Error(`recorder exited with request pending: ${code}/${signal}`)); pending = null; }
  });
});
const send = async (request) => {
  assert.equal(pending, null, "controller refuses overlapping requests");
  note("request", { request });
  let timer;
  try {
    const response = await new Promise((resolve, reject) => {
      pending = { request, resolve, reject };
      timer = setTimeout(() => {
        pending = null; reject(Error(`request timed out: ${JSON.stringify(request)}`));
      }, 30_000);
      child.stdin.write(JSON.stringify(request) + "\n");
    });
    note("response", { response });
    return response;
  } finally { clearTimeout(timer); }
};
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let verdict = "NEEDS EVIDENCE", failure = null;
try {
  note("ready", await ready);
  await send({ op: "screenshot", name: "physical-before.png" });
  const before = (await send({ op: "stats" })).result;
  assert.equal(before.focus, "ide-display-canvas");
  const baselinePresents = before.display.successfulPresents;
  note("before-input", { successfulPresents: baselinePresents, pointerFrames: before.pointerFrames.length, keyboardFrames: before.keyboardFrames.length });
  await send({ op: "click", x: 400, y: 300 });
  await send({ op: "type", text: "a", enter: false, delay: 80 });
  const deadline = Date.now() + 140_000;
  let after;
  do {
    after = (await send({ op: "stats" })).result;
    note("after-input-sample", {
      successfulPresents: after.display.successfulPresents, framesReceived: after.display.framesReceived,
      replayedFrames: after.display.replayedFrames, pointerFrames: after.pointerFrames.length,
      keyboardFrames: after.keyboardFrames.length, inputDevice: after.inputDevice,
    });
    if (after.display.successfulPresents > baselinePresents && after.display.framesReceived > before.display.framesReceived) break;
    assert.ok(Date.now() < deadline, "no later real presentation within the bounded trial");
    await pause(20_000);
  } while (true);
  assert.ok(after.pointerFrames.length > before.pointerFrames.length);
  assert.ok(after.pointerFrames.some(frame => frame.source === "pointerdown" && frame.events.some(event => event.code === 272 && event.value === 1)));
  assert.ok(after.pointerFrames.some(frame => frame.source === "pointerup" && frame.events.some(event => event.code === 272 && event.value === 0)));
  assert.ok(after.keyboardFrames.length >= before.keyboardFrames.length + 2);
  assert.equal(after.display.replayedFrames, before.display.replayedFrames);
  assert.deepEqual(after.display.errors, []);
  for (const key of ["droppedFrames", "droppedEvents", "rejectedEvents"]) assert.equal(after.inputDevice[key], 0);
  const screenshot = await send({ op: "screenshot", name: "physical-after.png" });
  const bytes = await readFile(screenshot.result);
  note("after-screenshot", { path: screenshot.result, size: bytes.length, sha256: hash(bytes) });
  verdict = "HELD";
} catch (error) {
  failure = String(error); note("failure", { failure, stack: error.stack });
  process.exitCode = 1;
} finally {
  if (child.exitCode === null && !child.killed) {
    note("request", { request: { op: "quit" } });
    child.stdin.end('{"op":"quit"}\n');
  }
  let timer;
  const result = await Promise.race([exit, new Promise(resolve => {
    timer = setTimeout(() => { child.kill("SIGTERM"); resolve({ code: null, signal: "controller-timeout" }); }, 15_000);
  })]);
  clearTimeout(timer);
  note("recorder-exit", result);
  await writeFile(path.join(import.meta.dirname, "physical-recorder.stdout.log"), stdout);
  await writeFile(path.join(import.meta.dirname, "physical-recorder.stderr.log"), stderr);
  try {
    const identitiesBytes = await readFile(path.join(out, "identities.json"));
    const wireBytes = await readFile(path.join(out, "wire.json"));
    const identities = JSON.parse(identitiesBytes), wire = JSON.parse(wireBytes);
    const keys = wire.inputEvents.filter(event => event.code === "KeyA");
    assert.equal(identities.head, records[0].head);
    assert.deepEqual(identities.errors, []);
    assert.ok(keys.some(event => event.type === "keydown" && event.trusted && event.target === "ide-display-canvas"));
    assert.ok(keys.some(event => event.type === "keyup" && event.trusted && event.target === "ide-display-canvas"));
    for (const filename of ["web/dist/ide.js", "web/dist/main.js", "web/dist/pkg/wasm_vm_wasm_bg.wasm"]) {
      const resource = identities.resourceIdentities.find(value => value.repoPath === filename);
      assert.ok(resource, `served source receipt missing for ${filename}`);
      assert.equal(resource.sha256, hash(await readFile(path.join(repo, filename))), `served source differs: ${filename}`);
    }
    note("raw-receipts", { identitiesSha256: hash(identitiesBytes), wireSha256: hash(wireBytes),
      trustedCanvasKeyA: keys, resourceCount: identities.resourceIdentities.length,
      workerTabletCalls: wire.workerTraffic.filter(event => event.type === "worker-call" && ["sendTabletEvent", "syncTablet"].includes(event.method)).length,
      workerKeyboardCalls: wire.workerTraffic.filter(event => event.type === "worker-call" && ["sendKeyboardEvent", "syncKeyboard"].includes(event.method)).length });
  } catch (error) { verdict = "NEEDS EVIDENCE"; failure = String(error); process.exitCode = 1; }
  if (result.code !== 0) { verdict = "NEEDS EVIDENCE"; failure ||= `recorder exit ${JSON.stringify(result)}`; process.exitCode = 1; }
  note("result", { verdict, failure });
  await writeFile(path.join(import.meta.dirname, "physical-controller.ndjson"), records.map(value => JSON.stringify(value)).join("\n") + "\n");
}
