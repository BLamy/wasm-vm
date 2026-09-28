// Only the independently verified T03aj R2 pair is admitted by this input trial.
import assert from "node:assert/strict";
import { R3_IDENTITIES, remainingTrialMs, withinTrialDeadline } from "./omarchy-input-trial.mjs";
import { auditSerial } from "./omarchy-latency-receipt.mjs";

export const PREPARED_DIRECT_WASM = "8230800b2ed4fe92ed0647d871d6c548fe824f3a550b09ca4a9b4941bc220ca4";
export const PREPARED_DIRECT_IDENTITIES = Object.freeze({
  kernel: R3_IDENTITIES.kernel,
  chunkManifest: R3_IDENTITIES.chunkManifest,
  bootSnapshot: Object.freeze({ size: 207172408, sha256: "989dff1cad261ab6e53e1dea8f57cb12866d2a236b5366f114102744553d4e75" }),
  overlayDelta: Object.freeze({ size: 1232847, sha256: "4fde816771e4fcfe085b492b6321302e945c58145c5c16f0c91e02ac94d10972" }),
});
const properties = ["opaque", "force_rgbx", "opacity", "opacity_inactive", "opacity_fullscreen",
  "opacity_override", "opacity_inactive_override", "opacity_fullscreen_override"];
export const PREPARED_DIRECT_COMMAND = `XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 --batch '${[
  ...properties.map(prop => `getprop active ${prop}`), "j/activewindow",
].join("; ")}'`;

export function assertPreparedDirectSource(source) {
  for (const [role, identity] of Object.entries(PREPARED_DIRECT_IDENTITIES)) {
    assert.equal(source?.[role]?.size, identity.size, `${role}: not verified AJ R2 size`);
    assert.equal(source?.[role]?.sha256, identity.sha256, `${role}: not verified AJ R2 bytes`);
  }
  assert.deepEqual(source.image, { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 });
}

export function assertPreparedDirectProperties(response, expectedFoot = { address: "0x55555eb73630", pid: 503 }) {
  assert.equal(response?.exit, 0, "prepared property read failed");
  const lines = response.stdout.split(/\r?\n/u).map(s => s.trim()).filter(Boolean);
  assert.ok(lines.length > 8, "missing saved properties or active Foot");
  for (let i = 0; i < properties.length; i++) {
    if (i >= 2 && i <= 4) assert.match(lines[i], /^1(?:\.0+)?$/u, `${properties[i]} is not one`);
    else assert.equal(lines[i], "true", `${properties[i]} is not true`);
  }
  const foot = JSON.parse(lines.slice(8).join("\n"));
  assert.equal(foot.class, "foot"); assert.equal(foot.mapped, true); assert.equal(foot.hidden, false);
  assert.equal(foot.visible, true); assert.equal(foot.acceptsInput, true);
  assert.equal(foot.address, expectedFoot.address); assert.equal(foot.pid, expectedFoot.pid);
  assert.deepEqual(foot.at, [12, 38]); assert.deepEqual(foot.size, [1256, 750]);
  return foot;
}

export async function requestPreparedDirectProperties(exec, deadline, report, expectedFoot) {
  const receipt = report.preparedDirect = { command: PREPARED_DIRECT_COMMAND, requestCount: 0,
    startedAt: new Date().toISOString(), deadlineAtMs: deadline, status: "reading" };
  try {
    const timeout = remainingTrialMs(deadline); receipt.requestCount++;
    receipt.response = await withinTrialDeadline(() => exec(PREPARED_DIRECT_COMMAND, timeout), deadline, "saved opaque properties");
    receipt.respondedAt = new Date().toISOString();
    receipt.foot = assertPreparedDirectProperties(receipt.response, expectedFoot);
    receipt.status = "properties-confirmed";
  } catch (error) { receipt.status = "properties-unproven"; receipt.error = String(error); throw error; }
  finally { receipt.finishedAt = new Date().toISOString(); }
}

export function auditPreparedDirect(report, { expectedFoot, startupCommands = [] } = {}) {
  assert.equal(report.preparedDirectRequested, true);
  const receipt = report.preparedDirect;
  const read = report.keyboard ? `if [ -f '${report.keyboard.guestFile}' ]; then cat '${report.keyboard.guestFile}'; else (exit 75); fi` : null;
  const serial = auditSerial(report.workerTraffic, [PREPARED_DIRECT_COMMAND, ...startupCommands, ...(read ? [read] : [])]);
  assert.ok(serial.every(row => [PREPARED_DIRECT_COMMAND, read, ...startupCommands,
    "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers"].includes(row.command)), "unexpected serial command");
  const commands = serial.filter(row => row.command === PREPARED_DIRECT_COMMAND);
  if (!receipt) {
    assert.equal(commands.length, 0); assert.equal(report.keyboard, undefined);
    assert.equal(report.trial.outcome, "startup-failed-input-not-tested");
    return { configuration: "not-reached", physicalInputTested: false };
  }
  assert.equal(receipt.command, PREPARED_DIRECT_COMMAND);
  assert.equal(receipt.requestCount, 1); assert.equal(commands.length, 1);
  assert.equal(receipt.deadlineAtMs, Date.parse(report.startup.deadlineAt));
  const wire = commands[0];
  assert.ok(Date.parse(wire.sentAt) >= Date.parse(receipt.startedAt));
  assert.ok(Date.parse(wire.sentAt) < receipt.deadlineAtMs);
  if (receipt.response) {
    assert.deepEqual(receipt.response, wire.response, "saved properties disagree with actual wire");
    assert.ok(Date.parse(wire.completedAt) <= Date.parse(receipt.respondedAt));
    assert.ok(Date.parse(receipt.respondedAt) < receipt.deadlineAtMs);
  }
  if (receipt.status === "properties-confirmed") {
    assert.deepEqual(receipt.foot, assertPreparedDirectProperties(receipt.response, expectedFoot));
    if (report.keyboard) assert.ok(Date.parse(report.keyboard.startedAt) >= Date.parse(receipt.respondedAt));
  } else {
    assert.equal(receipt.status, "properties-unproven");
    assert.equal(report.keyboard, undefined, "unconfirmed saved properties cannot reach physical input");
  }
  return { configuration: receipt.status, wire, physicalInputTested: Boolean(report.keyboard?.typedAt) };
}
