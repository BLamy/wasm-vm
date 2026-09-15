import test from "node:test";
import assert from "node:assert/strict";
import { assertGuestMode, assertModeWire, requestSmallerScanout } from "./omarchy-render-mode.mjs";

const before = { framesReceived: 2, successfulPresents: 2 };
const observed = () => ({ gpu: { advertisedWidth: 640, advertisedHeight: 400, scanoutWidth: 640, scanoutHeight: 416 },
  presentation: { framesReceived: 3, successfulPresents: 3, latest: { resourceWidth: 640, resourceHeight: 416 } } });

test("advertised mode, CSS resize, stale frames and mismatched scanout never prove guest adoption", () => {
  assertGuestMode(observed(), before);
  for (const mutate of [
    value => { value.gpu.scanoutWidth = 1280; },
    value => { value.gpu.scanoutHeight = 832; },
    value => { value.presentation.latest.resourceWidth = 1280; },
    value => { value.presentation.latest.resourceHeight = 400; },
    value => { value.presentation.framesReceived = 2; },
    value => { value.presentation.successfulPresents = 2; },
  ]) {
    const value = observed(); mutate(value); assert.throws(() => assertGuestMode(value, before));
  }
});

test("expired original startup deadline cannot send a modeset", async () => {
  let calls = 0;
  const report = {};
  await assert.rejects(requestSmallerScanout({ evaluate() { calls++; } }, Date.now() - 1, report), /deadline exceeded/u);
  assert.equal(calls, 0); assert.equal(report.renderBudget.requestCount, 0);
  assert.equal(report.renderBudget.status, "mode-not-observed");
});

test("acknowledgement without a guest frame records failure and sends exactly one request", async () => {
  const events = [], report = {}, deadline = Date.now() + 1000;
  const page = {
    async evaluate(_fn, argument) {
      if (argument) { events.push([argument.width, argument.height]); return true; }
      return { gpu: { scanoutWidth: 1280, scanoutHeight: 832 }, presentation: before };
    },
    async waitForFunction(_fn, argument, options) {
      assert.deepEqual(argument.before, before); assert.ok(options.timeout <= 1000);
      throw Error("synthetic guest never modeset");
    },
  };
  await assert.rejects(requestSmallerScanout(page, deadline, report), /guest never modeset/u);
  assert.deepEqual(events, [[640, 400]]); assert.equal(report.renderBudget.requestCount, 1);
  assert.equal(report.renderBudget.status, "mode-not-observed");
  assert.equal(report.renderBudget.deadlineAtMs, deadline);
});

test("mode wire proof rejects a superseding resize or mismatched acknowledgement", () => {
  const report = { renderBudget: { requestedAt: new Date(1000).toISOString(), acknowledgedAt: new Date(1010).toISOString(), acknowledged: true },
    workerTraffic: [
      { type: "worker-call", method: "setDisplay", worker: 1, id: 8, args: [1280, 800], sent: true, timestamp: new Date(100).toISOString() },
      { type: "worker-call", method: "setDisplay", worker: 1, id: 9, args: [640, 400], sent: true, timestamp: new Date(1001).toISOString() },
      { type: "input-result", method: "setDisplay", worker: 1, id: 9, result: true, error: null, timestamp: new Date(1002).toISOString() },
    ] };
  assertModeWire(report);
  const wrongReply = structuredClone(report); wrongReply.workerTraffic[2].worker = 2;
  assert.throws(() => assertModeWire(wrongReply), /missing or ambiguous/u);
  const resized = structuredClone(report);
  resized.workerTraffic.push({ ...resized.workerTraffic[0], timestamp: new Date(2000).toISOString() });
  assert.throws(() => assertModeWire(resized), /repeated or superseded/u);
});
