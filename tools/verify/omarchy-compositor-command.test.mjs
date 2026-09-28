import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { formatRpcCommand } from "../../web/guest-rpc.js";
import { requestSmallerScanout } from "./omarchy-render-mode.mjs";
import { COMPOSITOR_MODE_COMMAND, requestCompositorMode, compositorModeOutcome } from "./omarchy-compositor-command.mjs";

const iso = value => new Date(value).toISOString();
const response = { stdout: "ok\n", exit: 0 };
const smaller = () => ({ gpu: { advertisedWidth: 640, advertisedHeight: 400, scanoutWidth: 640, scanoutHeight: 416 },
  presentation: { framesReceived: 3, successfulPresents: 3, latest: { resourceWidth: 640, resourceHeight: 416 } } });

// Synthetic conditional receipt only; no test fixture stands in for an actual guest modeset.
function fixture() {
  return { compositorModeRequested: true, startup: { deadlineAt: iso(5000) },
    renderBudget: { deadlineAtMs: 5000, requestCount: 1, requestedAt: iso(1100), acknowledgedAt: iso(1150),
      acknowledged: true, status: "guest-mode-observed", observedAt: iso(1500),
      before: { presentation: { framesReceived: 2, successfulPresents: 2 } }, after: smaller() },
    compositorMode: { command: COMPOSITOR_MODE_COMMAND, deadlineAtMs: 5000, startedAt: iso(1200),
      respondedAt: iso(1450), finishedAt: iso(1450), requestCount: 1, status: "command-accepted", response: { ...response } },
    serialCommands: [{ command: COMPOSITOR_MODE_COMMAND }],
    workerTraffic: [
      { type: "worker-call", method: "setDisplay", worker: 1, id: 1, args: [640, 400], sent: true, timestamp: iso(1110) },
      { type: "input-result", method: "setDisplay", worker: 1, id: 1, result: true, error: null, timestamp: iso(1140) },
      { type: "serial-input", sent: true, bytes: [...Buffer.from(formatRpcCommand(COMPOSITOR_MODE_COMMAND, "c1"))], ms: 1300, timestamp: iso(1300) },
      { type: "serial-output", text: "\n__WVBEGIN_c1\nok\n__WVEND_c1_0\n", ms: 1400, timestamp: iso(1400) },
    ], keyboard: { startedAt: iso(1600), deadlineMs: 120000 },
    trial: {}, result: "input-trial-physical-nonce-and-fresh-presentation" };
}

test("one fixed compositor request preserves remaining startup time and checks real response", async () => {
  const report = {}, calls = [], deadline = Date.now() + 1000;
  await requestCompositorMode(async (command, timeout) => {
    calls.push(command); assert.ok(timeout > 0 && timeout <= 1000); return response;
  }, deadline, report);
  assert.deepEqual(calls, [COMPOSITOR_MODE_COMMAND]);
  assert.equal(report.compositorMode.status, "command-accepted");
  assert.equal(report.compositorMode.deadlineAtMs, deadline);
  for (const bad of [{ stdout: "failed\n", exit: 1 }, { stdout: "Lua error\n", exit: 0 }]) {
    await assert.rejects(requestCompositorMode(async () => bad, deadline, report), /Hyprland/u);
    assert.equal(report.compositorMode.status, "command-failed");
  }
});

test("expired or late compositor work cannot obtain a new deadline", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const report = {}; let calls = 0;
  await assert.rejects(requestCompositorMode(async () => { calls++; }, 999, report), /deadline/u);
  assert.equal(calls, 0); assert.equal(report.compositorMode.requestCount, 0);
  await assert.rejects(requestCompositorMode(async () => {
    calls++; t.mock.timers.tick(1001); return response;
  }, 2000, report), /deadline/u);
  assert.equal(calls, 1); assert.equal(report.compositorMode.status, "command-failed");
});

test("compositor callback runs after the display ack and before actual guest-frame observation", async () => {
  for (const rejected of [false, true]) {
    const report = {}, events = []; let configured = false;
    const page = {
      async evaluate(_fn, argument) {
        if (argument) { events.push("advertise"); return true; }
        return configured ? smaller() : { gpu: { scanoutWidth: 1280 }, presentation: { framesReceived: 2, successfulPresents: 2 } };
      },
      async waitForFunction(fn, argument) {
        events.push("observe");
        assert.ok(vm.runInNewContext(`(${fn.toString()})(argument)`, {
          argument, window: { __presentation: { state: () => smaller().presentation } },
        }));
      },
    };
    const operation = requestSmallerScanout(page, Date.now() + 1000, report, {
      configureCompositor: () => requestCompositorMode(async () => {
        events.push("configure"); configured = true;
        return rejected ? { stdout: "error", exit: 1 } : response;
      }, report.renderBudget.deadlineAtMs, report),
    });
    if (rejected) {
      await assert.rejects(operation, /Hyprland/u);
      assert.deepEqual(events, ["advertise", "configure"]);
      assert.equal(report.renderBudget.status, "mode-not-observed");
    } else {
      await operation;
      assert.deepEqual(events, ["advertise", "configure", "observe"]);
      assert.equal(report.renderBudget.status, "guest-mode-observed");
    }
  }
});

test("synthetic classifier binds compositor result to actual wire and rejects forged success", () => {
  assert.equal(compositorModeOutcome(fixture()), "physical-input-and-presentation-passed");
  for (const mutate of [
    r => { r.workerTraffic.pop(); },
    r => { r.workerTraffic[3].text = "\n__WVBEGIN_c1\nerror\n__WVEND_c1_1\n"; },
    r => { r.compositorMode.response.exit = 1; r.workerTraffic[3].text = "\n__WVBEGIN_c1\nok\n__WVEND_c1_1\n"; },
    r => { r.workerTraffic.push({ ...r.workerTraffic[2], bytes: [...Buffer.from(formatRpcCommand(COMPOSITOR_MODE_COMMAND, "c2"))] }); },
    r => { r.compositorMode.respondedAt = iso(5000); },
    r => { r.renderBudget.after.gpu.scanoutWidth = 1280; },
  ]) {
    const report = fixture(); mutate(report); assert.throws(() => compositorModeOutcome(report));
  }
});

test("negative command, absent frame and physical input failures retain distinct outcomes", () => {
  const report = fixture(); report.result = "failed";
  assert.equal(compositorModeOutcome(report), "physical-input-failed");
  delete report.keyboard;
  report.renderBudget.status = "mode-not-observed"; delete report.renderBudget.observedAt;
  report.trial.outcome = "startup-failed-input-not-tested";
  assert.equal(compositorModeOutcome(report), "mode-not-observed-input-not-tested");
  report.compositorMode.status = "command-failed";
  delete report.compositorMode.response; delete report.compositorMode.respondedAt;
  report.workerTraffic.pop();
  assert.equal(compositorModeOutcome(report), "compositor-command-failed-input-not-tested");
});
