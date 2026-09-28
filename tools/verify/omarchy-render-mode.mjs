// A local measurement of existing guest modesetting, not a production display policy.
import assert from "node:assert/strict";
import { remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";

export const RENDER_MODE = Object.freeze({ width: 640, height: 400, maxResourceHeight: 448 });

export function hasSmallerFrame(state, before) {
  const latest = state?.latest;
  return latest?.resourceWidth === RENDER_MODE.width &&
    latest.resourceHeight >= RENDER_MODE.height && latest.resourceHeight <= RENDER_MODE.maxResourceHeight &&
    state.framesReceived > before.framesReceived && state.successfulPresents > before.successfulPresents;
}

export function assertGuestMode(observation, before) {
  const { gpu, presentation } = observation;
  assert.equal(gpu.advertisedWidth, RENDER_MODE.width);
  assert.equal(gpu.advertisedHeight, RENDER_MODE.height);
  assert.equal(gpu.scanoutWidth, RENDER_MODE.width, "advertised mode is not an actual guest scanout");
  assert.ok(gpu.scanoutHeight >= RENDER_MODE.height && gpu.scanoutHeight <= RENDER_MODE.maxResourceHeight,
    "guest scanout height exceeds the bounded padded allocation");
  assert.ok(hasSmallerFrame(presentation, before), "no new smaller guest frame reached presentation");
  assert.equal(presentation.latest.resourceHeight, gpu.scanoutHeight, "frame and actual scanout disagree");
}

export function assertModeWire(report) {
  const mode = report.renderBudget, requestedAt = Date.parse(mode.requestedAt);
  const calls = report.workerTraffic.filter(row => row.type === "worker-call" && row.method === "setDisplay");
  const later = calls.filter(row => Date.parse(row.timestamp) >= requestedAt);
  assert.equal(later.length, 1, "trial mode was repeated or superseded");
  const call = later[0];
  assert.deepEqual(call.args, [RENDER_MODE.width, RENDER_MODE.height]);
  assert.equal(call.sent, true);
  for (const earlier of calls.filter(row => Date.parse(row.timestamp) < requestedAt)) {
    assert.deepEqual(earlier.args, [1280, 800], "unexpected startup modeset");
  }
  const replies = report.workerTraffic.filter(row => row.type === "input-result" && row.method === "setDisplay" &&
    row.worker === call.worker && row.id === call.id);
  assert.equal(replies.length, 1, "missing or ambiguous actual modeset reply");
  assert.equal(replies[0].error, null); assert.equal(replies[0].result, mode.acknowledged);
  assert.ok(Date.parse(replies[0].timestamp) >= Date.parse(call.timestamp));
  assert.ok(Date.parse(replies[0].timestamp) <= Date.parse(mode.acknowledgedAt));
}

// Classify a report only after the owning recorder's service/input audit has passed.
export function renderBudgetOutcome(report) {
  const mode = report.renderBudget;
  assert.ok(mode, "no actual modeset attempt was recorded");
  assert.equal(mode.requestCount, 1);
  assert.equal(mode.deadlineAtMs, Date.parse(report.startup.deadlineAt));
  assertModeWire(report);
  if (mode.status === "mode-not-observed") {
    assert.equal(report.keyboard, undefined, "input cannot precede mode adoption");
    assert.equal(report.trial.outcome, "startup-failed-input-not-tested");
    return "mode-not-observed-input-not-tested";
  }
  assert.equal(mode.status, "guest-mode-observed");
  assertGuestMode(mode.after, mode.before.presentation);
  assert.ok(Date.parse(mode.observedAt) < mode.deadlineAtMs);
  assert.ok(Date.parse(report.keyboard.startedAt) >= Date.parse(mode.observedAt));
  assert.equal(report.keyboard.deadlineMs, 120000);
  return report.result === "input-trial-physical-nonce-and-fresh-presentation"
    ? "physical-input-and-presentation-passed" : "physical-input-failed";
}

export async function requestSmallerScanout(page, deadline, report, { configureCompositor = null } = {}) {
  const call = operation => withinTrialDeadline(operation, deadline, "render mode startup");
  const receipt = report.renderBudget = { mode: RENDER_MODE, deadlineAtMs: deadline,
    startedAt: new Date().toISOString(), status: "requesting", requestCount: 0 };
  const observe = () => page.evaluate(async () => {
    const { edid, ...gpu } = await window.wvmDemo.displayStats();
    return { gpu, presentation: window.__presentation.state() };
  });
  try {
    receipt.before = await call(observe);
    assert.equal(receipt.before.gpu.scanoutWidth, 1280, "trial must start with the recorded R3 scanout");
    receipt.requestedAt = new Date().toISOString(); receipt.requestCount++;
    receipt.acknowledged = await call(() => page.evaluate(({ width, height }) =>
      window.wvmDemo.setDisplay(width, height), RENDER_MODE));
    receipt.acknowledgedAt = new Date().toISOString();
    assert.equal(receipt.acknowledged, true, "display mode request rejected");
    if (configureCompositor) {
      receipt.status = "configuring-compositor";
      await call(configureCompositor);
    }
    receipt.status = "awaiting-guest-frame";
    await call(() => page.waitForFunction(({ mode, before }) => {
      const state = window.__presentation.state(), latest = state.latest;
      return latest?.resourceWidth === mode.width && latest.resourceHeight >= mode.height &&
        latest.resourceHeight <= mode.maxResourceHeight && state.framesReceived > before.framesReceived &&
        state.successfulPresents > before.successfulPresents;
    }, { mode: RENDER_MODE, before: receipt.before.presentation },
    { polling: 500, timeout: remainingTrialMs(deadline) }));
    receipt.after = await call(observe);
    assertGuestMode(receipt.after, receipt.before.presentation);
    receipt.status = "guest-mode-observed";
    receipt.observedAt = new Date().toISOString();
  } catch (error) {
    receipt.status = "mode-not-observed"; receipt.error = String(error); throw error;
  } finally { receipt.finishedAt = new Date().toISOString(); }
}
