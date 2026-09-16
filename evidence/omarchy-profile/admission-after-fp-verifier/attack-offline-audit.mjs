// One in-memory counterfeit success against the worker's actual offline audit.
// No original report, source, browser, or guest is changed.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { auditReport } from "../admission-after-fp-gates/audit.mjs";

const base = new URL("../admission-after-fp-r1/", import.meta.url);
const bytes = await fs.readFile(new URL("control/report.json", base));
const original = JSON.parse(bytes);
const pair = JSON.parse(await fs.readFile(new URL("ab.json", base)));
const args = { head: pair.head, wasmSha256: pair.wasmSha256, arm: "control" };
const actual = auditReport(original, args);
assert.equal(actual.machineAcceptance, false);
assert.equal(actual.nonceReplies, 0);
const forged = structuredClone(original);
forged.keyboard.verified = true;
forged.keyboard.completedAt = forged.keyboard.typedAt;
forged.result = "input-trial-physical-nonce-and-fresh-presentation";
delete forged.trial.outcome;
let failure = null;
try { auditReport(forged, args); }
catch (error) { failure = error; }
assert.ok(failure, "the worker audit accepted counterfeit desktop success");
assert.match(String(failure), /no timely nonce on the raw wire/u,
  "attack must reach and fail the independent nonce check");
const receipt = {
  attack: "Forge an on-time success receipt while preserving actual missing nonce replies",
  target: "evidence/omarchy-profile/admission-after-fp-gates/audit.mjs:auditReport",
  originalReportSha256: createHash("sha256").update(bytes).digest("hex"),
  targetSourceSha256: createHash("sha256").update(await fs.readFile(new URL("../admission-after-fp-gates/audit.mjs", import.meta.url))).digest("hex"),
  unchangedOriginalAcceptance: actual.machineAcceptance,
  unchangedRawNonceReplies: actual.nonceReplies,
  inMemoryOnly: true,
  originalReportUnchanged: bytes.equals(await fs.readFile(new URL("control/report.json", base))),
  rejected: true,
  reason: String(failure),
  browsersLaunched: 0,
};
await fs.writeFile(new URL("worker-audit-attack.json", import.meta.url), JSON.stringify(receipt, null, 2) + "\n");
console.log(JSON.stringify(receipt, null, 2));
