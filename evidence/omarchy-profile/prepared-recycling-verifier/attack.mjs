// One bounded counterfeit-success attack; all transformed states are synthetic.
// No browser, process, guest, or product-acceptance claim.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { auditInputReport } from "../../../tools/verify/omarchy-input-audit.mjs";
import { auditPreparedDirect, PREPARED_DIRECT_COMMAND, PREPARED_DIRECT_WASM }
  from "../../../tools/verify/omarchy-prepared-direct-state.mjs";
import { formatRpcCommand } from "../../../web/guest-rpc.js";

const dir = new URL("./", import.meta.url);
const head = "e7e378288581069ae0471e3ca141507e1f5faf30";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const baseBytes = await fs.readFile(new URL("../prepared-direct-input-r1/desktop/report.json", dir));
assert.equal(sha(baseBytes), "0d4f8f50d2d9e940ce098f744202bcff49ae3c1048b39d692231d1d2c7fa38ea");
const base = JSON.parse(baseBytes);
const iso = n => new Date(n).toISOString();
function fixture(withRawNonce) {
  const r = structuredClone(base);
  r.syntheticVerifierFixture = true;
  Object.assign(r.trial, { head, experiment: "prepared-recycling", recycling: true });
  delete r.trial.outcome;
  const u = new URL(r.url); u.searchParams.set("jitColdCounterRecycling", "1"); r.url = u.href;
  for (const row of r.observations.filter(o => o.runtime)) {
    Object.assign(row.runtime.jit.coldCounterRecycling,
      { enabled: true, epochs: "1", discardedCounters: "65536" });
    row.runtime.jit.discovery.countsDropped = 0;
  }
  r.result = "input-trial-physical-nonce-and-fresh-presentation";
  Object.assign(r.keyboard, { verified: true, completedAt: iso(r.keyboard.enteredAtMs + 500) });
  delete r.keyboard.failedAt; delete r.keyboard.error;
  r.trial.presentationAfter = { ...r.trial.presentationBaseline,
    framesReceived: r.trial.presentationBaseline.framesReceived + 100,
    successfulPresents: r.trial.presentationBaseline.successfulPresents + 100 };
  const start = Date.parse(r.startup.startedAt);
  const propAt = Date.parse(r.preparedDirect.startedAt), entered = r.keyboard.enteredAtMs;
  const read = `if [ -f '${r.keyboard.guestFile}' ]; then cat '${r.keyboard.guestFile}'; else (exit 75); fi`;
  const request = (id, command, ms) => ({ type: "serial-input", worker: 1, sent: true,
    ms: ms - start, timestamp: iso(ms), bytes: [...Buffer.from(formatRpcCommand(command, id))] });
  const response = (id, stdout, code, ms) => ({ type: "serial-output", worker: 1,
    ms: ms - start, timestamp: iso(ms), text: `\n__WVBEGIN_${id}\n${stdout}__WVEND_${id}_${code}\n` });
  r.workerTraffic = r.workerTraffic.filter(row => !["serial-input", "serial-output"].includes(row.type));
  r.workerTraffic.push(request("criticam1", PREPARED_DIRECT_COMMAND, propAt),
    response("criticam1", r.preparedDirect.response.stdout, 0, Date.parse(r.preparedDirect.respondedAt)),
    request("criticam2", read, entered + 100),
    response("criticam2", withRawNonce ? r.keyboard.nonce + "\n" : "\n", withRawNonce ? 0 : 75, entered + 500));
  r.workerTraffic.sort((a, b) => a.ms - b.ms);
  r.serialCommands = [{ command: PREPARED_DIRECT_COMMAND }, { command: read }];
  return r;
}
const options = { head, wasmSha256: PREPARED_DIRECT_WASM, arm: "candidate", preparedDirect: true,
  preparedRecycling: true, startupCommands: [PREPARED_DIRECT_COMMAND] };
const cases = [];
for (const rawNonce of [true, false]) {
  let result, error;
  const r = fixture(rawNonce);
  try {
    const input = auditInputReport(r, options);
    result = { machineAcceptance: input.machineAcceptance, nonceReplies: input.nonceReplies,
      visualInspectionRequired: input.visualInspectionRequired, configuration: auditPreparedDirect(r).configuration };
  } catch (e) { error = String(e); }
  assert.equal(Boolean(error), !rawNonce);
  if (rawNonce) assert.deepEqual(result, { machineAcceptance: true, nonceReplies: 1,
    visualInspectionRequired: true, configuration: "properties-confirmed" });
  else assert.match(error, /no timely nonce on the raw wire/u);
  cases.push({ name: rawNonce ? "synthetic machine-only positive control" : "convincing success without raw nonce",
    held: true, rejected: Boolean(error), error: error ?? null, result: result ?? null,
    fixtureSha256: sha(JSON.stringify(r)) });
}
const sources = {};
for (const rel of ["tools/verify/omarchy-input-audit.mjs", "tools/verify/omarchy-input-trial.mjs",
  "tools/verify/omarchy-prepared-direct-state.mjs", "tools/verify/omarchy-latency-receipt.mjs", "web/guest-rpc.js"])
  sources[rel] = sha(await fs.readFile(new URL("../../../" + rel, dir)));
const result = { head, productEvidence: false,
  base: "evidence/omarchy-profile/prepared-direct-input-r1/desktop/report.json", baseSha256: sha(baseBytes),
  transformation: "Preserved AK physical key/ACK sequence and property reply. Relabelled head and recycling, fabricated success flags and 100 fresh frames, removed refusal counts; only the control adds an explicitly synthetic timely nonce reply. No transformed report is a real guest recording.",
  sources, cases };
await fs.writeFile(new URL("attack.json", dir), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
