import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { auditInputKernelResponse } from "../../../tools/verify/omarchy-input-kernel-response-audit.mjs";
const dir = "evidence/omarchy-profile/code-page-index-r2";
const hash = b => createHash("sha256").update(b).digest("hex");
const rb = await fs.readFile(`${dir}/desktop/report.json`), r = JSON.parse(rb);
const run = JSON.parse(await fs.readFile(`${dir}/run.json`));
assert.equal(hash(rb), run.reportSha256); assert.equal(r.trial.head, run.head);
assert.equal(run.head, "0e3c0641488e342788f68d648ea7da9043da48e0");
assert.equal(run.wasmSha256, "1e475d3874972a5f111e458d3b3f742f6ff2b279620fa5a21af218c914072ca1");
assert.equal(run.desktopAcceptance, false);
const checked = auditInputKernelResponse(r, run.head, { wasmSha256: run.wasmSha256, experiment: run.experiment });
const git = file => execFileSync("git", ["show", `${run.head}:${file}`], { maxBuffer: 32*1024*1024,
  env: { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" } });
for (const [file, row] of Object.entries(r.trial.helpers)) {
  const b = git(file); assert.equal(b.length,row.size); assert.equal(hash(b),row.sha256);
}
let gitResources = 0;
const seen = new Set();
for (const row of r.resourceIdentities) {
  const file = row.repoPath;
  if (!file?.startsWith("web/dist/") || seen.has(file)) continue;
  seen.add(file); const b = git(file); assert.equal(b.length,row.size); assert.equal(hash(b),row.sha256); gitResources++;
}
for (const row of r.observations.filter(x=>x.runtime)) {
  const s=row.runtime;
  assert.equal(s.jit.jitResidencyCap,1024); assert.equal(s.jit.decodedCacheEntries,16384);
  assert.equal(s.jit.jitDynamicChaining,false); assert.equal(s.jit.jitRegionChaining,true);
  assert.equal(s.jit.coldCounterRecycling.enabled,true); assert.equal(s.clock.clockDiv,64);
  assert.equal(s.scheduler.quantum,500000);
  assert.equal(s.presentation.width,1280); assert.equal(s.presentation.height,800);
}
const output=r.workerTraffic.filter(x=>x.type==="serial-output").map(x=>x.text).join("");
const replies=[...output.matchAll(/__WVBEGIN_([a-z0-9]+)\r?\n([\s\S]*?)\r?\n__WVEND_\1_(\d+)\r?\n/g)]
  .filter(x=>x[2].trim()===r.keyboard.nonce&&x[3]==="0");
assert.equal(replies.length,0);
assert.equal(run.machineAcceptance,false); assert.equal(r.keyboard.verified,false);
assert.equal(Date.parse(r.keyboard.deadlineAt)-r.keyboard.enteredAtMs,120000);
assert.ok(Date.parse(r.keyboard.failedAt)>=Date.parse(r.keyboard.deadlineAt));
const serialIn=r.workerTraffic.filter(x=>x.type==="serial-input").map(x=>Buffer.from(x.bytes).toString("ascii")).join("");
assert.ok(!serialIn.includes(r.keyboard.nonce));
const image=await fs.readFile(`${dir}/desktop/failure.png`);
assert.equal(hash(image),"431be977157bf77dcd21ca8bf3b640bce9e02dc8c54f09a30d58af78a8195b24");
const result={head:run.head,reportSha256:hash(rb),wasmSha256:run.wasmSha256,
  helperCount:Object.keys(r.trial.helpers).length,gitResources,nonce:r.keyboard.nonce,
  successfulNonceFences:replies.length,failedAfterMs:Date.parse(r.keyboard.failedAt)-r.keyboard.enteredAtMs,
  completedReads:checked.input.completedReads,pendingReads:checked.input.pendingReads,readExits:checked.input.readExits,
  trustedEvents:checked.input.trustedEvents,matchedKeyboardCalls:checked.input.matchedKeyboardCalls,
  budgets:{startupMs:r.trial.startupMs,typingMs:r.trial.typingMs,readbackMs:r.trial.readbackMs,captureMs:r.trial.captureMs,cleanupMs:r.trial.cleanupMs},
  imageSha256:hash(image),desktopAcceptance:false,personalImageReview:"Old empty prompt; no typed command or returned prompt."};
await fs.writeFile(new URL("./browser-check.json",import.meta.url),JSON.stringify(result,null,2)+"\n");
console.log(JSON.stringify(result,null,2));
