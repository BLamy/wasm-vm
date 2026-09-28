import assert from "node:assert/strict";
import test from "node:test";
import { formatRpcCommand } from "../../web/guest-rpc.js";
import { auditDesktopServicesReport } from "./omarchy-desktop-services.mjs";

const layers = "XDG_RUNTIME_DIR=/run/user/1000 hyprctl -i 0 -j layers";
const input = (command, rid = "a1") => ({ type: "serial-input", sent: true,
  bytes: [...Buffer.from(formatRpcCommand(command, rid))], ms: 1, timestamp: "2026-09-14T08:00:00Z" });
const fixture = () => ({ trial: { recycling: false, scopedStatus: "", outcome: "startup-failed-input-not-tested" },
  cleanup: { closed: true }, errors: [], serialCommands: [], inputEvents: [], workerTraffic: [input(layers)],
  result: "failed", observations: [{ runtime: { jit: { hasExecutor: true, admissionProbe: false,
    coldCounterRecycling: { enabled: false, epochs: "0", discardedCounters: "0", threshold: 512, capacity: 65536 },
    decodedCacheEntries: 4096, jitResidencyPolicy: "repack-off", jitResidencyCap: 24,
    entryCost: { timingEnabled: false } }, clock: { mode: "icount", clockDiv: 64 },
    guestSession: { key: "omarchy", generation: 1 },
    presentation: { framesReceived: 2, successfulPresents: 2 } } }] });

test("service-isolated startup failure is retained without claiming input acceptance", () => {
  const result = auditDesktopServicesReport(fixture());
  assert.equal(result.serviceIsolation, true);
  assert.equal(result.desktopAcceptance, false);
  assert.equal(result.inputOutcome, "startup-failed-input-not-tested");
});
test("rejects unsolicited agent frames, hidden Explorer and Docker calls", () => {
  const wrongOwner = fixture(); wrongOwner.observations[0].runtime.guestSession.key = "alpine";
  assert.throws(() => auditDesktopServicesReport(wrongOwner), /actual Omarchy owner/u);
  const agent = fixture(); agent.workerTraffic.push({ method: "sendAgentInput" });
  assert.throws(() => auditDesktopServicesReport(agent), /unsolicited agent/u);
  for (const command of ["ls -la '/root'", "wvrun ps -a", "cat /opt/containers/index.json"]) {
    const report = fixture(); report.serialCommands.push({ command }); report.workerTraffic.push(input(command, "b2"));
    assert.throws(() => auditDesktopServicesReport(report), /hidden CLI IDE/u);
  }
});
test("does not accept a success label without physical input, timing and fresh frames", () => {
  const report = fixture(); report.result = "input-trial-physical-nonce-and-fresh-presentation";
  assert.throws(() => auditDesktopServicesReport(report));
  report.keyboard = { verified: true, completedAt: "2026-09-14T08:00:05Z", deadlineAt: "2026-09-14T08:02:00Z" };
  report.inputEvents.push({ type: "keydown", trusted: true, code: "Enter" });
  report.trial.presentationBaseline = { framesReceived: 2, successfulPresents: 2 };
  report.trial.presentationAfter = { framesReceived: 3, successfulPresents: 3 };
  assert.equal(auditDesktopServicesReport(report).desktopAcceptance, true);
  report.keyboard.completedAt = "2026-09-14T08:02:01Z";
  assert.throws(() => auditDesktopServicesReport(report));
});
