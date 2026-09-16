import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { auditDisplayPixelProbe } from "../../../tools/verify/omarchy-display-pixel-probe.mjs";
import { auditInputKernelResponse } from "../../../tools/verify/omarchy-input-kernel-response-audit.mjs";
const out = path.resolve(process.argv[2]);
const report = JSON.parse(await fs.readFile(path.join(out, "report.json")));
const wasmSha256 = "7d7b300003cf68076c28958694062dacf3c879efe921bc631bade568ee143bdf";
assert.throws(() => auditInputKernelResponse(report, report.trial.head, { wasmSha256 }),
  /Expected values to be strictly equal/);
auditInputKernelResponse(report, report.trial.head, { wasmSha256, displayPixelProbe: true });
const old = JSON.parse(await fs.readFile("evidence/omarchy-profile/gpu-transfer-offset-r1/final/response/desktop/report.json"));
auditInputKernelResponse(old, old.trial.head, { wasmSha256 });
const baseline = await auditDisplayPixelProbe(report, out);
assert.equal(baseline.latestMatchesCanvas, true); assert.equal(baseline.desktopAcceptance, false);
const mutations = [
  ["drop latest while preserving apparent frame count", r => { r.displayPixelProbe.frames.pop(); r.displayPixelProbe.evicted++; }],
  ["final clear cannot be called a final frame", r => { r.displayPixelProbe.events.at(-1).type = "clear"; }],
  ["pending presentation cannot be called complete", r => { r.displayPixelProbe.canvas.state.scheduler.pending = 1; }],
  ["latest source digest substitution", r => { r.displayPixelProbe.frames.at(-1).sha256 = "0".repeat(64); }],
];
const cases = [];
for (const [name, mutate] of mutations) {
  const r = structuredClone(report); mutate(r);
  let failure;
  try { await auditDisplayPixelProbe(r, out); } catch (error) { failure = String(error); }
  assert.ok(failure, `unrejected attack: ${name}`);
  cases.push({ name, rejected: true, failure });
}
const result = { realEvidenceBaseline: { latestMatchesCanvas: baseline.latestMatchesCanvas,
  canvasSha256: baseline.canvasSha256, frameCount: baseline.frames.length, desktopAcceptance: baseline.desktopAcceptance },
  ordinaryAuditRejectsDiagnostic: true, explicitDiagnosticAuditAccepts: true, oldAtDefaultStillAccepted: true, cases };
await fs.writeFile(new URL("./audit-attacks.json", import.meta.url), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
