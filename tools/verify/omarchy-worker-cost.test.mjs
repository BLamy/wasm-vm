import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureWorkerCost, validateWorkerCostProfile, workerCostInputVerdict, auditWorkerCostInput } from "./omarchy-worker-cost-capture.mjs";

test("post-verdict audit rejects every ingress channel, including R1 tablet sends and acknowledgements", () => {
  const r = failed(), stamp = new Date(Date.parse(r.keyboard.failedAt)+1).toISOString();
  r.workerCostInputFence = { method: "Input.setIgnoreInputEvents", ignore: true,
    startedAt: r.keyboard.typedAt, acknowledgedAt: new Date(r.keyboard.enteredAtMs+1).toISOString() };
  r.inputEvents = [];
  r.workerTraffic = [{ type: "worker-call", method: "jitStats", args: [], sent: true, timestamp: stamp },
    { type: "serial-output", timestamp: stamp }];
  assert.equal(auditWorkerCostInput(r).noPostVerdictIngress, true);
  for (const method of ["sendKeyboardEvent", "syncKeyboard", "sendTabletEvent", "syncTablet", "sendMouseEvent",
    "syncMouse", "setDisplay", "sendAgentInput", "unknownMutation"]) {
    for (const type of ["worker-call", "input-result"]) {
      const mutated = structuredClone(r);
      mutated.workerTraffic.push({ type, method, args: [], sent: true, timestamp: stamp });
      assert.throws(() => auditWorkerCostInput(mutated));
    }
  }
  for (const type of ["serial-input", "worker-boot", "unobserved-input"]) {
    const mutated = structuredClone(r); mutated.workerTraffic.push({ type, timestamp: stamp });
    assert.throws(() => auditWorkerCostInput(mutated));
  }
  r.workerCostInputFence.acknowledgedAt = r.keyboard.deadlineAt;
  assert.throws(() => auditWorkerCostInput(r), /existing deadline/);
});

const url = "http://127.0.0.1:1234/linux-worker.js";
function profile() {
  return { url, target: { targetId: "synthetic-owned", type: "worker", url }, intervalUs: 1000, browser: "synthetic",
    profile: { startTime: 0, endTime: 30000000,
      nodes: [{ id: 1, callFrame: { functionName: "(root)" }, children: [2] },
        { id: 2, callFrame: { functionName: "synthetic-leaf", url } }],
      samples: Array(1000).fill(2), timeDeltas: Array(1000).fill(30000) } };
}
function failed() {
  const now = Date.now(), enteredAtMs = now - 120001;
  return { mode: "input-trial", result: "failed", trial: { outcome: "nonce-readback-failed", readbackMs: 120000 },
    keyboard: { typedAt: new Date(enteredAtMs).toISOString(), verified: false, enteredAtMs,
      deadlineAt: new Date(enteredAtMs + 120000).toISOString(), failedAt: new Date(now).toISOString() } };
}
test("profile validates exact worker, span, sample references and an unambiguous tree", () => {
  assert.equal(validateWorkerCostProfile(profile(), url).sampledUs, 30000000);
  const mutations = [
    p => { p.target.url = url + "?foreign"; }, p => { p.target.type = "page"; },
    p => { p.profile.endTime = 90000000; }, p => { p.profile.samples[0] = 9; },
    p => { p.profile.timeDeltas[0] = -1; }, p => { p.profile.nodes[1].id = 1; },
    p => { p.profile.nodes[0].children = [99]; }, p => { p.profile.nodes[0].children = [2,2]; },
    p => { p.profile.nodes[1].children = [1]; },
    p => { p.profile.nodes.push({ id: 3, callFrame: { functionName: "other-parent" }, children: [2] }); },
    p => { p.profile.nodes.push({ id: 3, callFrame: { functionName: "isolated-cycle" }, children: [3] }); },
  ];
  for (const mutate of mutations) { const p = profile(); mutate(p); assert.throws(() => validateWorkerCostProfile(p, url)); }
});
test("capture cannot attach before failed deadline or without the failure image", async () => {
  let attached = false;
  const dependencies = { attach: async () => { attached = true; } };
  const r = failed(); r.keyboard.enteredAtMs = Date.now(); r.keyboard.deadlineAt = new Date(Date.now()+120000).toISOString();
  await assert.rejects(captureWorkerCost({}, {}, "/does-not-exist", r, dependencies));
  await assert.rejects(captureWorkerCost({}, {}, "/does-not-exist", failed(), dependencies));
  assert.equal(attached, false);
});
test("synthetic capture preserves failed verdict and binds raw bytes; not a guest success fixture", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-cost-test-"));
  try {
    await fs.writeFile(path.join(out, "failure.png"), Buffer.from([137,80,78,71,13,10,26,10]));
    const report = failed(), events = [], before = JSON.stringify(report.keyboard);
    await captureWorkerCost({ url: () => url.replace("linux-worker.js", "app.html?guest=omarchy") }, {}, out, report, {
      attach: async (_browser, target) => { assert.equal(target, url); events.push("attach"); return {
        start: async () => events.push("start"), stop: async () => { events.push("stop"); return profile(); },
        close: async () => events.push("close") }; },
      delay: async ms => { assert.equal(ms, 30000); events.push("synthetic-delay"); },
    });
    assert.deepEqual(events, ["attach", "start", "synthetic-delay", "stop", "close"]);
    assert.equal(report.result, "failed"); assert.equal(JSON.stringify(report.keyboard), before);
    assert.equal(report.workerCost.status, "captured");
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(out, "worker-cpu.json"), "utf8")), profile());
  } finally { await fs.rm(out, { recursive: true, force: true }); }
});
test("a profiler that mutates the verdict is rejected and closed without a usable profile", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-cost-test-"));
  try {
    await fs.writeFile(path.join(out, "failure.png"), Buffer.from([137,80,78,71,13,10,26,10]));
    const report = failed(); let closed = false;
    await assert.rejects(captureWorkerCost({ url: () => url }, {}, out, report, {
      attach: async () => ({ start: async () => {}, stop: async () => { report.keyboard.verified = true; return profile(); },
        close: async () => { closed = true; } }), delay: async () => {},
    }));
    assert.equal(closed, true); assert.equal(report.workerCost.status, "failed");
    await assert.rejects(fs.stat(path.join(out, "worker-cpu.json")), { code: "ENOENT" });
  } finally { await fs.rm(out, { recursive: true, force: true }); }
});
test("cleanup timing annotations do not change the frozen input verdict", () => {
  const report = failed(), before = workerCostInputVerdict(report);
  Object.assign(report.keyboard, { desktopReadyPageMs: 1, firstPhysicalKeydownPageMs: 2, readyToFirstPhysicalKeydownMs: 1 });
  assert.equal(workerCostInputVerdict(report), before);
  report.keyboard.enteredAtMs += 1;
  assert.throws(() => workerCostInputVerdict(report));
});
test("an attachment completing after the fixed capture deadline cannot start sampling", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "omarchy-cost-test-")), originalNow = Date.now;
  try {
    await fs.writeFile(path.join(out, "failure.png"), Buffer.from([137,80,78,71,13,10,26,10]));
    const report = failed(); let started = false;
    await assert.rejects(captureWorkerCost({ url: () => url }, {}, out, report, {
      attach: async () => {
        const future = originalNow() + 180001; Date.now = () => future;
        return { start: async () => { started = true; }, close: async () => {} };
      }, delay: async () => {},
    }), /deadline exceeded/u);
    assert.equal(started, false); assert.equal(report.workerCost.status, "failed");
  } finally { Date.now = originalNow; await fs.rm(out, { recursive: true, force: true }); }
});
