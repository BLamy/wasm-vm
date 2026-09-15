// One ephemeral guest configuration command; physical input remains a separate proof.
import assert from "node:assert/strict";
import { remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";
import { renderBudgetOutcome } from "./omarchy-render-mode.mjs";

export const COMPOSITOR_MODE_COMMAND = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -r eval 'hl.monitor({ output = "", mode = "640x400@60", position = "auto", scale = 1 })'`;

export async function requestCompositorMode(exec, deadline, report) {
  const receipt = report.compositorMode = { command: COMPOSITOR_MODE_COMMAND,
    startedAt: new Date().toISOString(), deadlineAtMs: deadline, requestCount: 0, status: "requesting" };
  try {
    const timeout = remainingTrialMs(deadline);
    receipt.requestCount++;
    receipt.response = await withinTrialDeadline(() => exec(COMPOSITOR_MODE_COMMAND, timeout),
      deadline, "compositor mode startup");
    receipt.respondedAt = new Date().toISOString();
    assert.equal(receipt.response.exit, 0, "Hyprland mode command failed");
    assert.equal(receipt.response.stdout.trim(), "ok", "Hyprland did not accept its monitor configuration");
    receipt.status = "command-accepted";
  } catch (error) {
    receipt.status = "command-failed"; receipt.error = String(error); throw error;
  } finally { receipt.finishedAt = new Date().toISOString(); }
}

export function assertCompositorModeWire(report) {
  const mode = report.renderBudget, command = report.compositorMode;
  assert.equal(report.compositorModeRequested, true);
  assert.ok(command, "no compositor command receipt");
  assert.equal(command.command, COMPOSITOR_MODE_COMMAND);
  assert.equal(command.requestCount, 1);
  assert.equal(command.deadlineAtMs, Date.parse(report.startup.deadlineAt));
  assert.ok(Date.parse(command.startedAt) >= Date.parse(mode.acknowledgedAt));
  const records = auditSerial(report.workerTraffic, report.serialCommands.map(row => row.command));
  const commands = records.filter(row => row.command === COMPOSITOR_MODE_COMMAND);
  assert.equal(commands.length, 1, "missing or repeated actual compositor command");
  const wire = commands[0];
  assert.ok(Date.parse(wire.sentAt) >= Date.parse(command.startedAt));
  assert.ok(Date.parse(wire.sentAt) < command.deadlineAtMs);
  if (command.response) {
    assert.deepEqual(wire.response, command.response, "compositor response disagrees with actual serial output");
    assert.ok(Date.parse(wire.completedAt) <= Date.parse(command.respondedAt));
    assert.ok(Date.parse(command.respondedAt) < command.deadlineAtMs);
  } else {
    assert.equal(command.status, "command-failed", "missing compositor response cannot be accepted");
  }
  if (command.status === "command-accepted") {
    assert.equal(command.response?.exit, 0);
    assert.equal(command.response?.stdout.trim(), "ok");
    if (mode.observedAt) assert.ok(Date.parse(command.respondedAt) <= Date.parse(mode.observedAt));
  } else {
    assert.equal(command.status, "command-failed");
    assert.equal(mode.status, "mode-not-observed");
    assert.equal(report.keyboard, undefined, "physical input cannot precede a successful compositor command");
  }
  return wire;
}

export function compositorModeOutcome(report) {
  const outcome = renderBudgetOutcome(report);
  assertCompositorModeWire(report);
  return report.compositorMode.status === "command-failed"
    ? "compositor-command-failed-input-not-tested" : outcome;
}
