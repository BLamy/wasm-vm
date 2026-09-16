// One bounded in-memory report attack; no source, original evidence or browser changes.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { auditReport } from "../residency-after-fp-gates/audit.mjs";

const base = new URL("../residency-after-fp-r1/", import.meta.url);
const bytes = await fs.readFile(new URL("control/report.json", base));
const original = JSON.parse(bytes);
const pair = JSON.parse(await fs.readFile(new URL("ab.json", base)));
const args = { head: pair.head, wasmSha256: pair.wasmSha256, arm: "control" };
const actual = auditReport(original, args);
assert.equal(actual.machineAcceptance, false);
assert.deepEqual(actual.residency, { policy: "repack-off", cap: 24 });

const forged = structuredClone(original);
forged.keyboard.verified = true;
forged.keyboard.completedAt = forged.keyboard.typedAt;
forged.result = "input-trial-physical-nonce-and-fresh-presentation";
delete forged.trial.outcome;
// Preserve the declared control arm, URL and policy label, but make its first
// observed runtime cap the candidate's. A favorable receipt must not hide it.
const runtime = forged.observations.find(row => row.runtime).runtime;
runtime.jit.jitResidencyCap = 256;
let failure;
try { auditReport(forged, args); }
catch (error) { failure = error; }
assert.ok(failure, "the audit accepted a favorable receipt with the wrong observed module cap");
assert.equal(failure.actual, 256);
assert.equal(failure.expected, 24);
assert.equal(failure.operator, "strictEqual");
assert.ok(failure.stack.includes("assertInputTrialRuntime"), failure.stack);
assert.ok(bytes.equals(await fs.readFile(new URL("control/report.json", base))));

const sha = data => createHash("sha256").update(data).digest("hex");
const receipt = { checkedAt: new Date().toISOString(),
  attack: "Favorable forged control receipt with cap-256 in its raw runtime observation",
  preserved: "Declared control arm, repack-off label, URL, source, WASM, raw inputs and serial wire",
  originalReportSha256: sha(bytes),
  auditSourceSha256: sha(await fs.readFile(new URL("../residency-after-fp-gates/audit.mjs", import.meta.url))),
  guardSourceSha256: sha(await fs.readFile(new URL("../../../tools/verify/omarchy-input-trial.mjs", import.meta.url))),
  originalAcceptance: actual.machineAcceptance, originalCap: actual.residency.cap,
  expectedCap: failure.expected, alteredObservedCap: failure.actual,
  rejected: true, reason: String(failure), stack: failure.stack,
  inMemoryOnly: true, originalReportUnchanged: true, browsersLaunched: 0, guestRuns: 0 };
await fs.writeFile(new URL("worker-audit-attack.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify({ rejected: receipt.rejected, expectedCap: receipt.expectedCap,
  alteredObservedCap: receipt.alteredObservedCap, originalReportUnchanged: true, browsersLaunched: 0 }, null, 2));
