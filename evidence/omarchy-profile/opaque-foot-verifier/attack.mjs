// Independent offline attack. No guest/browser or implementation mutation.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { OPAQUE_FOOT_COMMAND, auditOpaqueFoot } from "../../../tools/verify/omarchy-opaque-foot-command.mjs";
import { formatRpcCommand } from "../../../web/guest-rpc.js";

const root = new URL("./", import.meta.url);
const hash = value => createHash("sha256").update(value).digest("hex");
const start = Date.parse("2026-09-16T00:00:00.000Z");
const iso = ms => new Date(start + ms).toISOString();
const good = { exit: 0, stdout: "ok\ntrue\ntrue\n1.0\n" };
const fixture = (wireResponse = good) => ({
  opaqueFootRequested: true,
  startup: { startedAt: iso(0), deadlineAt: iso(300000), timeoutMs: 300000 },
  trial: { outcome: "startup-failed-input-not-tested" },
  opaqueFoot: { command: OPAQUE_FOOT_COMMAND, requestCount: 1, startedAt: iso(100),
    deadlineAtMs: start + 300000, respondedAt: iso(1000), finishedAt: iso(1001),
    status: "properties-confirmed", response: structuredClone(good) },
  workerTraffic: [
    { type: "serial-input", sent: true, ms: 110, timestamp: iso(110),
      bytes: [...Buffer.from(formatRpcCommand(OPAQUE_FOOT_COMMAND, "critic01"))] },
    { type: "serial-output", ms: 900, timestamp: iso(900),
      text: `\n__WVBEGIN_critic01\n${wireResponse.stdout}__WVEND_critic01_${wireResponse.exit}\n` },
  ],
});

const accepted = auditOpaqueFoot(fixture());
assert.equal(accepted.configuration, "properties-confirmed");
assert.equal(accepted.physicalInputTested, false);
const attacks = [
  ["forged-summary-over-false-opaque-wire", () => fixture({ exit: 0, stdout: "ok\nfalse\ntrue\n1.0\n" })],
  ["false-property-in-both-summary-and-wire", () => {
    const response = { exit: 0, stdout: "ok\ntrue\nfalse\n1.0\n" };
    const r = fixture(response); r.opaqueFoot.response = response; return r;
  }],
  ["late-property-with-backdated-summary", () => {
    const r = fixture(); r.workerTraffic[1].ms = 300001;
    r.workerTraffic[1].timestamp = iso(300001); return r;
  }],
  ["echo-without-real-property-reply", () => {
    const r = fixture(); r.workerTraffic[1].text = formatRpcCommand(OPAQUE_FOOT_COMMAND, "critic01"); return r;
  }],
];
const result = { purpose: "bounded independent forged-property/late-property attack", baseline: accepted,
  sourceSha256: hash(await fs.readFile(new URL("../../../tools/verify/omarchy-opaque-foot-command.mjs", root))),
  attacks: [] };
for (const [name, make] of attacks) {
  const input = make();
  let caught;
  try { auditOpaqueFoot(input); } catch (error) { caught = error; }
  assert.ok(caught, `forged candidate accepted: ${name}`);
  result.attacks.push({ name, rejected: true, error: String(caught), fixture: input });
}
await fs.writeFile(new URL("attack.json", root), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ baselineAccepted: true, attacks: result.attacks.map(({ name, rejected, error }) => ({ name, rejected, error })) }, null, 2));
