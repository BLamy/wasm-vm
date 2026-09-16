// Host-only sampling after the product input verdict and failure image are fixed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { attachWorkerProfiler } from "./e5-t22c-cpu-profile.mjs";
import { assertFailedInput } from "./omarchy-failure-checkpoint.mjs";
import { withinTrialDeadline } from "./omarchy-input-trial.mjs";

export const WORKER_COST_SAMPLE_MS = 30000;
export const WORKER_COST_CAPTURE_MS = 180000;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

// CDP's host-side audit fence; no guest RPC or input-queue flush. Keep this
// session attached until the owned browser closes so screenshot/profiler setup
// cannot admit incidental host pointer input after the physical command.
export async function fenceWorkerCostInput(page, keyboard) {
  const deadline = keyboard.enteredAtMs + keyboard.readbackTimeoutMs;
  assert.equal(keyboard.readbackTimeoutMs, 120000);
  assert.equal(Date.parse(keyboard.deadlineAt), deadline);
  const receipt = { startedAt: new Date().toISOString(), method: "Input.setIgnoreInputEvents", ignore: true };
  const bounded = fn => withinTrialDeadline(fn, deadline, "worker cost host-input fence");
  const session = await bounded(() => page.context().newCDPSession(page));
  await bounded(() => session.send(receipt.method, { ignore: true }));
  receipt.acknowledgedAt = new Date().toISOString();
  return receipt;
}

export function auditWorkerCostInput(report) {
  const failedAt = Date.parse(report.keyboard.failedAt), fence = report.workerCostInputFence;
  assert.equal(fence?.method, "Input.setIgnoreInputEvents"); assert.equal(fence.ignore, true);
  const started = Date.parse(fence.startedAt), acknowledged = Date.parse(fence.acknowledgedAt);
  assert.ok(started >= report.keyboard.enteredAtMs && acknowledged >= started &&
    acknowledged < Date.parse(report.keyboard.deadlineAt), "host-input fence must consume the existing deadline");
  assert.ok(report.inputEvents.every(row => Date.parse(row.timestamp) <= started), "physical input after fence");
  // A read-only allowlist rejects future/alternate ingress methods as well as
  // the tablet RPCs missed by R1. Replies to earlier read-only commands may finish.
  const reads = new Set(["keyboardLedState", "inputDeviceStats", "jitStats", "schedulerStats", "guestClockState"]);
  for (const row of report.workerTraffic) {
    assert.ok(Number.isFinite(Date.parse(row.timestamp)), "invalid worker event timestamp");
    if (Date.parse(row.timestamp) <= failedAt) continue;
    if (row.type === "serial-output") continue;
    assert.equal(row.type, "worker-call", "new input or mutation acknowledgement after verdict");
    assert.ok(reads.has(row.method) && row.sent === true && row.args.length === 0,
      `non-observational worker RPC after verdict: ${row.method}`);
  }
  return { fenceAcknowledgedAt: fence.acknowledgedAt, noPostVerdictIngress: true };
}

export function workerCostInputVerdict(report) {
  const verdict = JSON.parse(assertFailedInput(report));
  // Cleanup adds these observations after sampling; they are not verdict fields.
  for (const key of ["desktopReadyPageMs", "firstPhysicalKeydownPageMs", "readyToFirstPhysicalKeydownMs"])
    delete verdict.keyboard[key];
  return JSON.stringify(verdict);
}

export function validateWorkerCostProfile(recording, url) {
  assert.equal(recording.url, url);
  assert.equal(recording.target?.url, url);
  assert.equal(recording.target?.type, "worker");
  assert.ok(recording.target.targetId);
  assert.equal(recording.intervalUs, 1000);
  assert.ok(recording.browser);
  const p = recording.profile;
  assert.ok(p.endTime > p.startTime);
  const durationMs = (p.endTime - p.startTime) / 1000;
  assert.ok(durationMs >= 29000 && durationMs <= 60000, "profile outside bounded sampling window");
  assert.ok(p.samples.length >= 1000, "insufficient raw CPU samples");
  assert.equal(p.samples.length, p.timeDeltas.length);
  const nodes = new Set();
  for (const node of p.nodes) {
    assert.ok(Number.isSafeInteger(node.id) && node.id > 0 && !nodes.has(node.id), "unique profile node IDs");
    assert.ok(node.callFrame && typeof node.callFrame.functionName === "string");
    nodes.add(node.id);
  }
  const byId = new Map(p.nodes.map(node => [node.id, node])), parents = new Map();
  for (const node of p.nodes) for (const child of node.children ?? []) {
    assert.ok(nodes.has(child), "child references a missing node");
    assert.ok(!parents.has(child), "profile child has multiple parents or duplicate edges");
    parents.set(child, node.id);
  }
  const roots = p.nodes.filter(node => !parents.has(node.id));
  assert.equal(roots.length, 1, "one profile root");
  const visited = new Set(), pending = [roots[0].id];
  while (pending.length) {
    const id = pending.pop();
    assert.ok(!visited.has(id), "profile graph is acyclic"); visited.add(id);
    pending.push(...(byId.get(id).children ?? []));
  }
  assert.equal(visited.size, nodes.size, "profile graph is connected and acyclic");
  for (const id of p.samples) assert.ok(nodes.has(id), "sample references a missing node");
  let sampledUs = 0;
  for (const delta of p.timeDeltas) {
    assert.ok(Number.isFinite(delta) && delta >= 0); sampledUs += delta;
  }
  assert.ok(sampledUs > 0 && sampledUs <= p.endTime - p.startTime + 1000000,
    "weighted samples exceed recorded profile span");
  return { durationMs, samples: p.samples.length, nodes: p.nodes.length, sampledUs };
}

export async function captureWorkerCost(page, browser, out, report,
  { attach = attachWorkerProfiler, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const verdict = workerCostInputVerdict(report);
  assert.equal(report.failureCaptureError, undefined, "failure image/runtime must be captured first");
  const failure = await fs.readFile(path.join(out, "failure.png"));
  assert.deepEqual(failure.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  const url = new URL("./linux-worker.js", page.url()).href;
  const capture = report.workerCost = { status: "capturing", diagnostic: true, acceptanceChanged: false,
    startedAt: new Date().toISOString(), timeoutMs: WORKER_COST_CAPTURE_MS,
    sampleMs: WORKER_COST_SAMPLE_MS, failureImageSha256: sha(failure), inputVerdict: JSON.parse(verdict), url };
  const deadline = Date.now() + WORKER_COST_CAPTURE_MS;
  capture.deadlineAt = new Date(deadline).toISOString();
  const bounded = (fn, label) => withinTrialDeadline(fn, deadline, `worker cost: ${label}`);
  let profiler;
  try {
    profiler = await bounded(() => attach(browser, url), "attach");
    await bounded(() => profiler.start(), "start");
    capture.sampleStartedAt = new Date().toISOString();
    await bounded(() => delay(WORKER_COST_SAMPLE_MS), "sample");
    const recording = await bounded(() => profiler.stop(), "stop");
    capture.sampleStoppedAt = new Date().toISOString();
    capture.summary = validateWorkerCostProfile(recording, url);
    assert.equal(workerCostInputVerdict(report), verdict, "CPU capture changed the input verdict");
    const bytes = Buffer.from(JSON.stringify(recording) + "\n");
    const file = path.join(out, "worker-cpu.json");
    await bounded(() => fs.writeFile(file, bytes, { flag: "wx" }), "write");
    Object.assign(capture, { file, sha256: sha(bytes), bytes: bytes.length, target: recording.target,
      browser: recording.browser, intervalUs: recording.intervalUs, status: "captured" });
  } catch (error) { capture.status = "failed"; capture.error = String(error); throw error; }
  finally {
    try { if (profiler) await bounded(() => profiler.close(), "close"); }
    catch (error) { capture.status = "failed"; capture.closeError = String(error); }
    capture.finishedAt = new Date().toISOString();
  }
}
