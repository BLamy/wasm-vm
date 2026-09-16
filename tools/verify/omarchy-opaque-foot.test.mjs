import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { formatRpcCommand } from "../../web/guest-rpc.js";
import { OPAQUE_FOOT_COMMAND, requestOpaqueFoot, assertOpaqueProperties,
  assertOriginalPresentation, auditOpaqueFoot } from "./omarchy-opaque-foot-command.mjs";
import { auditInputReport } from "./omarchy-input-audit.mjs";

const iso = value => new Date(value).toISOString();
const response = { stdout: "ok\n\ntrue\n\ntrue\n\n1.000000\n", exit: 0 };
function fixture() {
  return { opaqueFootRequested: true, startup: { deadlineAt: iso(5000) },
    opaqueFoot: { command: OPAQUE_FOOT_COMMAND, requestCount: 1, startedAt: iso(1200),
      deadlineAtMs: 5000, respondedAt: iso(1500), finishedAt: iso(1500),
      status: "properties-confirmed", response: structuredClone(response) },
    trial: { outcome: "startup-failed-input-not-tested" },
    workerTraffic: [
      { type: "serial-input", sent: true, bytes: [...Buffer.from(formatRpcCommand(OPAQUE_FOOT_COMMAND, "op1"))], ms: 1300, timestamp: iso(1300) },
      { type: "serial-output", text: `\n__WVBEGIN_op1\n${response.stdout}__WVEND_op1_0\n`, ms: 1400, timestamp: iso(1400) },
    ] };
}

test("fixed opaque rule requires all real properties and consumes the existing startup deadline", async () => {
  const report = {}, calls = [], deadline = Date.now()+1000;
  await requestOpaqueFoot(async (command, timeout) => {
    calls.push(command); assert.ok(timeout > 0 && timeout <= 1000); return response;
  }, deadline, report);
  assert.deepEqual(calls, [OPAQUE_FOOT_COMMAND]);
  assert.equal(report.opaqueFoot.status, "properties-confirmed");
  assert.equal(report.opaqueFoot.deadlineAtMs, deadline);
  for (const bad of ["ok\n", "ok\ntrue\nfalse\n1", "ok\ntrue\ntrue\n0.9", "ok\ntrue\ntrue\n1\nextra"])
    assert.throws(() => assertOpaqueProperties({ exit: 0, stdout: bad }));
  await assert.rejects(requestOpaqueFoot(async () => ({ exit: 1, stdout: "error" }), deadline, report));
  assert.equal(report.opaqueFoot.status, "configuration-failed");
});

test("an expired or late configuration cannot restart the original clock", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: 1000 });
  const report = {}; let calls = 0;
  await assert.rejects(requestOpaqueFoot(async () => { calls++; }, 999, report), /deadline/u);
  assert.equal(calls, 0);
  await assert.rejects(requestOpaqueFoot(async () => { calls++; t.mock.timers.tick(1001); return response; }, 2000, report), /deadline/u);
  assert.equal(calls, 1); assert.equal(report.opaqueFoot.status, "configuration-failed");
});

test("property audit binds to the wire and rejects missing, forged, duplicate, late and pre-configuration input", () => {
  assert.equal(auditOpaqueFoot(fixture()).configuration, "properties-confirmed");
  for (const mutate of [
    r => r.workerTraffic.pop(),
    r => { r.workerTraffic[1].text = r.workerTraffic[1].text.replace("true", "false"); },
    r => r.workerTraffic.push({ ...r.workerTraffic[0], bytes: [...Buffer.from(formatRpcCommand(OPAQUE_FOOT_COMMAND, "op2"))] }),
    r => { r.opaqueFoot.respondedAt = iso(5001); },
    r => { r.keyboard = { startedAt: iso(1400) }; },
  ]) { const r = fixture(); mutate(r); assert.throws(() => auditOpaqueFoot(r)); }
  const negative = fixture(); delete negative.opaqueFoot.response; delete negative.opaqueFoot.respondedAt;
  negative.opaqueFoot.status = "configuration-failed"; negative.workerTraffic.pop();
  assert.equal(auditOpaqueFoot(negative).physicalInputTested, false);
  const early = fixture(); delete early.opaqueFoot; early.workerTraffic = [];
  assert.equal(auditOpaqueFoot(early).configuration, "not-reached");
});

test("actual original resource and frame dimensions are required, regardless of canvas size", () => {
  const state = { framesReceived: 2, successfulPresents: 2, latest: { resourceWidth: 1280, resourceHeight: 832,
    rect: { x: 0, y: 0, width: 1280, height: 800 } } };
  assertOriginalPresentation(state);
  state.latest.resourceWidth = 640; assert.throws(() => assertOriginalPresentation(state));
});

test("retained real negative input recording passes reusable audit; missing sync or fabricated success fails", () => {
  const report = JSON.parse(readFileSync(new URL("../../evidence/omarchy-profile/worker-cost-r2/desktop/report.json", import.meta.url)));
  const expected = { head: report.trial.head, wasmSha256: report.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256, arm: "candidate" };
  const result = auditInputReport(report, expected);
  assert.equal(result.machineAcceptance, false); assert.equal(result.trustedEvents, 128);
  for (const mutate of [
    r => { r.workerTraffic.splice(r.workerTraffic.findIndex(x => x.type === "input-result" && x.method === "syncKeyboard"), 1); },
    r => { r.keyboard.verified = true; r.keyboard.completedAt = r.keyboard.deadlineAt; },
    r => { r.startup.deadlineAt = iso(Date.parse(r.startup.deadlineAt)+1); },
  ]) { const bad = structuredClone(report); mutate(bad); assert.throws(() => auditInputReport(bad, expected)); }
});
