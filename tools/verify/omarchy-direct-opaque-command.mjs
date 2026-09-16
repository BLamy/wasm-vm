// Direct window properties, with actual readback in the same synchronous batch.
import assert from "node:assert/strict";
import { remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";

const properties = ["opaque", "force_rgbx", "opacity", "opacity_inactive", "opacity_fullscreen",
  "opacity_override", "opacity_inactive_override", "opacity_fullscreen_override"];
export const DIRECT_OPAQUE_COMMAND = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch '${[
  ...properties.map(prop => `dispatch hl.dsp.window.set_prop({ prop = "${prop}", value = "1", window = "activewindow" })`),
  ...properties.map(prop => `getprop active ${prop}`), "j/activewindow",
].join("; ")}'`;

export function assertDirectOpaqueProperties(response) {
  assert.equal(response?.exit, 0, "direct property batch failed");
  const lines = response.stdout.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  assert.ok(lines.length > 16, "missing direct property or active-window output");
  assert.deepEqual(lines.slice(0, 8), Array(8).fill("ok"), "every direct write must succeed");
  for (let i = 0; i < properties.length; i++) {
    if (i >= 2 && i <= 4) assert.match(lines[8+i], /^1(?:\.0+)?$/u, `${properties[i]} is not one`);
    else assert.equal(lines[8+i], "true", `${properties[i]} is not true`);
  }
  const foot = JSON.parse(lines.slice(16).join("\n"));
  assert.equal(foot.class, "foot"); assert.equal(foot.mapped, true); assert.equal(foot.hidden, false);
  assert.match(foot.address, /^0x[0-9a-f]+$/iu); assert.notEqual(BigInt(foot.address), 0n);
  assert.ok(Array.isArray(foot.at) && foot.at.length === 2 && Array.isArray(foot.size) && foot.size.length === 2);
  const [x,y] = foot.at, [width,height] = foot.size;
  assert.ok([x,y,width,height].every(Number.isFinite));
  assert.ok(x >= 0 && y >= 26 && width >= 200 && height >= 100 && x+width <= 1280 && y+height <= 800);
  return foot;
}

export async function requestDirectOpaque(exec, deadline, report) {
  const receipt = report.directOpaque = { command: DIRECT_OPAQUE_COMMAND, requestCount: 0,
    startedAt: new Date().toISOString(), deadlineAtMs: deadline, status: "requesting" };
  try {
    const timeout = remainingTrialMs(deadline); receipt.requestCount++;
    receipt.response = await withinTrialDeadline(() => exec(DIRECT_OPAQUE_COMMAND, timeout), deadline, "direct opaque startup");
    receipt.respondedAt = new Date().toISOString();
    receipt.foot = assertDirectOpaqueProperties(receipt.response);
    receipt.status = "properties-confirmed";
  } catch (error) { receipt.status = "configuration-failed"; receipt.error = String(error); throw error; }
  finally { receipt.finishedAt = new Date().toISOString(); }
}

export function auditDirectOpaque(report, additionalCommands = []) {
  assert.equal(report.directOpaqueRequested, true);
  const receipt = report.directOpaque;
  const read = report.keyboard ? `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi` : null;
  const serial = auditSerial(report.workerTraffic, [DIRECT_OPAQUE_COMMAND, ...(read ? [read] : []), ...additionalCommands]);
  assert.ok(serial.every(row => [DIRECT_OPAQUE_COMMAND, read,
    "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers", ...additionalCommands].includes(row.command)), "unexpected serial command");
  const commands = serial.filter(row => row.command === DIRECT_OPAQUE_COMMAND);
  if (!receipt) {
    assert.equal(commands.length, 0); assert.equal(report.keyboard, undefined);
    assert.equal(report.trial.outcome, "startup-failed-input-not-tested");
    return { configuration: "not-reached", physicalInputTested: false };
  }
  assert.equal(receipt.command, DIRECT_OPAQUE_COMMAND);
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
    assert.deepEqual(receipt.foot, assertDirectOpaqueProperties(receipt.response));
    if (report.keyboard) assert.ok(Date.parse(report.keyboard.startedAt) >= Date.parse(receipt.respondedAt));
  } else {
    assert.equal(receipt.status, "configuration-failed");
    assert.equal(report.keyboard, undefined, "unconfirmed properties cannot reach physical input");
  }
  return { configuration: receipt.status, wire, physicalInputTested: Boolean(report.keyboard?.typedAt) };
}
