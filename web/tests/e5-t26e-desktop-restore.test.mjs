// E5-T26e — page-side composition proof for the fresh Channel HELLO and T22 owner.

import assert from "node:assert/strict";
import test from "node:test";

import { restoreDesktopThroughHost } from "../desktop-restore.js";

const viewport = { width: 1024, height: 768 };
const snapshot = Uint8Array.of(1, 2, 3, 4);

function fixture({ confirm = true, restore = true, beforeRestore = null } = {}) {
  const calls = [];
  const channel = {
    state: "ready",
    async rehandshake() {
      calls.push("rehandshake");
      return { generation: 2, version: 1, capabilities: 0n };
    },
  };
  const controller = {
    async confirmAgentHello() {
      calls.push("confirmAgentHello");
      return confirm;
    },
    async restoreDesktopSnapshot(bytes, width, height) {
      calls.push(["restore", [...bytes], width, height]);
      if (!restore) throw new Error("agent_unavailable");
      return { hostViewport: { width, height }, viewport: "letterbox", fullRepairFrame: true };
    },
  };
  const presentation = {
    clear() { calls.push("clear"); },
    setViewport(width, height) {
      calls.push(["setViewport", width, height]);
      return { width, height };
    },
  };
  const viewportController = { applyCanvasStyle() { calls.push("applyCanvasStyle"); } };
  return { calls, agentChannel: channel, controller, presentation, viewportController, beforeRestore };
}

test("desktop restore requires fresh Channel HELLO and applies T22 viewport", async () => {
  const f = fixture();
  const result = await restoreDesktopThroughHost(f, snapshot, viewport);
  assert.deepEqual(f.calls, [
    "clear",
    ["setViewport", 1024, 768],
    "rehandshake",
    "confirmAgentHello",
    ["restore", [1, 2, 3, 4], 1024, 768],
    "applyCanvasStyle",
  ]);
  assert.equal(result.handshake.generation, 2);
  assert.deepEqual(result.appliedViewport, viewport);
});

test("desktop restore may pause only after the fresh HELLO", async () => {
  const f = fixture();
  f.beforeRestore = () => f.calls.push("pause-at-commit");
  const result = await restoreDesktopThroughHost({ ...f, beforeRestore: f.beforeRestore }, snapshot, viewport);
  assert.equal(result.report.fullRepairFrame, true);
  assert.deepEqual(f.calls, [
    "clear",
    ["setViewport", 1024, 768],
    "rehandshake",
    "confirmAgentHello",
    "pause-at-commit",
    ["restore", [1, 2, 3, 4], 1024, 768],
    "applyCanvasStyle",
  ]);
});

test("a dropped Channel or refused restore clears the T22 surface", async () => {
  const dropped = fixture({ confirm: false });
  await assert.rejects(
    restoreDesktopThroughHost(dropped, snapshot, viewport),
    /fresh application HELLO/,
  );
  assert.deepEqual(dropped.calls, [
    "clear",
    ["setViewport", 1024, 768],
    "rehandshake",
    "confirmAgentHello",
    "clear",
  ]);

  const refused = fixture({ restore: false });
  await assert.rejects(restoreDesktopThroughHost(refused, snapshot, viewport), /agent_unavailable/);
  assert.equal(refused.calls.at(-1), "clear");
});
