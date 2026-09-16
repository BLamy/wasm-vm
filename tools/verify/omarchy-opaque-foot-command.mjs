// One ephemeral rule, under the original startup deadline. Never writes a nonce.
import assert from "node:assert/strict";
import { remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";

export const OPAQUE_FOOT_COMMAND = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -r --batch 'eval hl.window_rule({ match = { class = "^foot$" }, opacity = "1.0 override 1.0 override 1.0 override", opaque = true, force_rgbx = true }); getprop active opaque; getprop active force_rgbx; getprop active opacity'`;

export function assertOpaqueProperties(response) {
  assert.equal(response?.exit, 0, "Hyprland opaque Foot batch failed");
  const lines = response.stdout.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  assert.equal(lines.length, 4, "Hyprland must return the rule and all three properties");
  assert.deepEqual(lines.slice(0, 3), ["ok", "true", "true"], "Hyprland did not confirm opaque/RGBX");
  assert.match(lines[3], /^1(?:\.0+)?$/u, "Hyprland did not confirm full opacity");
}

export async function requestOpaqueFoot(exec, deadline, report) {
  const receipt = report.opaqueFoot = { command: OPAQUE_FOOT_COMMAND, requestCount: 0,
    startedAt: new Date().toISOString(), deadlineAtMs: deadline, status: "requesting" };
  try {
    const timeout = remainingTrialMs(deadline); receipt.requestCount++;
    receipt.response = await withinTrialDeadline(() => exec(OPAQUE_FOOT_COMMAND, timeout), deadline, "opaque Foot startup");
    receipt.respondedAt = new Date().toISOString();
    assertOpaqueProperties(receipt.response); receipt.status = "properties-confirmed";
  } catch (error) { receipt.status = "configuration-failed"; receipt.error = String(error); throw error; }
  finally { receipt.finishedAt = new Date().toISOString(); }
}

export function assertOriginalPresentation(state) {
  assert.equal(state?.latest?.resourceWidth, 1280);
  assert.equal(state.latest.resourceHeight, 832);
  assert.deepEqual(state.latest.rect, { x: 0, y: 0, width: 1280, height: 800 });
  assert.ok(state.framesReceived > 0 && state.successfulPresents > 0);
}

export function auditOpaqueFoot(report) {
  assert.equal(report.opaqueFootRequested, true);
  const receipt = report.opaqueFoot;
  const read = report.keyboard ? `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi` : null;
  const serial = auditSerial(report.workerTraffic, [OPAQUE_FOOT_COMMAND, ...(read ? [read] : [])]);
  assert.ok(serial.every(row => [OPAQUE_FOOT_COMMAND, read,
    "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers"].includes(row.command)), "unexpected serial command");
  const commands = serial.filter(row => row.command === OPAQUE_FOOT_COMMAND);
  if (!receipt) {
    assert.equal(commands.length, 0); assert.equal(report.keyboard, undefined);
    assert.equal(report.trial.outcome, "startup-failed-input-not-tested");
    return { configuration: "not-reached", physicalInputTested: false };
  }
  assert.equal(receipt.command, OPAQUE_FOOT_COMMAND);
  assert.equal(receipt.requestCount, 1); assert.equal(commands.length, 1);
  assert.equal(receipt.deadlineAtMs, Date.parse(report.startup.deadlineAt));
  const wire = commands[0];
  assert.ok(Date.parse(wire.sentAt) >= Date.parse(receipt.startedAt));
  assert.ok(Date.parse(wire.sentAt) < receipt.deadlineAtMs);
  if (receipt.response) {
    assert.deepEqual(receipt.response, wire.response, "reported properties disagree with actual wire");
    assert.ok(Date.parse(wire.completedAt) <= Date.parse(receipt.respondedAt));
    assert.ok(Date.parse(receipt.respondedAt) < receipt.deadlineAtMs);
  }
  if (receipt.status === "properties-confirmed") {
    assertOpaqueProperties(receipt.response);
    if (report.keyboard) assert.ok(Date.parse(report.keyboard.startedAt) >= Date.parse(receipt.respondedAt));
  } else {
    assert.equal(receipt.status, "configuration-failed");
    assert.equal(report.keyboard, undefined, "unconfirmed properties cannot reach physical input");
  }
  return { configuration: receipt.status, wire, physicalInputTested: Boolean(report.keyboard?.typedAt) };
}
