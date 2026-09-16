// Clearly synthetic helper coverage; these fixtures are never product evidence.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { auditInputReport } from "../../../tools/verify/omarchy-input-audit.mjs";
import { auditSerial } from "../../../tools/verify/omarchy-latency-receipt.mjs";

const dir = new URL("./", import.meta.url);
const basePath = new URL("../worker-cost-r2/desktop/report.json", dir);
const bytes = await fs.readFile(basePath);
const base = JSON.parse(bytes);
const expected = { head: base.trial.head, arm: "candidate",
  wasmSha256: base.identities.files["pkg/wasm_vm_wasm_bg.wasm"].sha256 };
const read = auditSerial(base.workerTraffic, base.serialCommands.map(row => row.command))
  .find(row => row.command.startsWith("if [ -f "));
assert.ok(read);
const at = Date.parse(read.sentAt) + 1;
const index = base.workerTraffic.findIndex(row => row.type === "serial-output"
  && Date.parse(row.timestamp) >= Date.parse(read.sentAt));
assert.ok(index >= 0);
const sourceOutputMs = base.workerTraffic[index].ms;

function syntheticSuccess(lateWire = false) {
  const report = structuredClone(base);
  report.result = "input-trial-physical-nonce-and-fresh-presentation";
  delete report.trial.outcome;
  report.keyboard.verified = true;
  report.keyboard.completedAt = new Date(at).toISOString();
  report.trial.presentationAfter = { ...report.trial.presentationBaseline,
    framesReceived: report.trial.presentationBaseline.framesReceived + 1,
    successfulPresents: report.trial.presentationBaseline.successfulPresents + 1 };
  const wireAt = lateWire ? Date.parse(report.keyboard.deadlineAt) + 1 : at;
  report.workerTraffic.splice(index, 0, { type: "serial-output", ms: sourceOutputMs,
    timestamp: new Date(wireAt).toISOString(),
    text: `\n__WVBEGIN_${read.rid}\n${report.keyboard.nonce}\n__WVEND_${read.rid}_0\n` });
  return report;
}

const positive = auditInputReport(syntheticSuccess(), expected);
assert.equal(positive.machineAcceptance, true);
assert.equal(positive.visualInspectionRequired, true);
assert.equal(positive.nonceReplies, 1);
let lateError;
try { auditInputReport(syntheticSuccess(true), expected); } catch (error) { lateError = error; }
assert.match(String(lateError), /no timely nonce on the raw wire/u);
const stale = syntheticSuccess();
stale.trial.presentationAfter = structuredClone(stale.trial.presentationBaseline);
assert.throws(() => auditInputReport(stale, expected));

// A success classification must also require physical completion metadata/events.
const missingPhysical = syntheticSuccess();
delete missingPhysical.keyboard.typedAt;
missingPhysical.inputEvents = [];
missingPhysical.workerTraffic = missingPhysical.workerTraffic.filter(row =>
  !["sendKeyboardEvent", "syncKeyboard"].includes(row.method));
let missingPhysicalAccepted = false, missingPhysicalError = null;
try { missingPhysicalAccepted = auditInputReport(missingPhysical, expected).machineAcceptance; }
catch (error) { missingPhysicalError = String(error); }
assert.equal(missingPhysicalAccepted, false, "success accepted without physical completion");
assert.match(missingPhysicalError, /completed physical sequence/u);

const sha = value => createHash("sha256").update(value).digest("hex");
const result = { purpose: "synthetic positive-branch coverage and bounded late-readback rejection",
  productEvidence: false, sourceFixture: basePath.pathname, sourceFixtureSha256: sha(bytes),
  helperSha256: sha(await fs.readFile(new URL("../../../tools/verify/omarchy-input-audit.mjs", dir))),
  positiveControl: { acceptedAsMachineOnly: positive.machineAcceptance,
    visualInspectionStillRequired: positive.visualInspectionRequired, nonceReplies: positive.nonceReplies },
  lateWireAttack: { summaryCompletedAt: new Date(at).toISOString(), deadlineAt: base.keyboard.deadlineAt,
    rawWireCompletedAt: new Date(Date.parse(base.keyboard.deadlineAt) + 1).toISOString(),
    rejected: true, error: String(lateError) },
  stalePresentationRejected: true,
  missingPhysicalAttack: { removedTypedAt: true, removedDomKeyEvents: true, removedKeyboardCallsAndAcks: true,
    acceptedAsMachine: missingPhysicalAccepted, error: missingPhysicalError } };
await fs.writeFile(new URL("input-audit-fixed.json", dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
