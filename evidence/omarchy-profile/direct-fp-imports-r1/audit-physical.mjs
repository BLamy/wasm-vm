// Offline proof correction: latest.rect is damage, not the display dimensions.
// Preserve the original wrapper failure and the original negative guest run.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {createHash} from "node:crypto";
import {auditInputReport} from "../../../tools/verify/omarchy-input-audit.mjs";
import {PREPARED_DIRECT_COMMAND,auditPreparedDirect} from "../../../tools/verify/omarchy-prepared-direct-state.mjs";
import {WORKER_COST_CAPTURE_MS,validateWorkerCostProfile,workerCostInputVerdict,auditWorkerCostInput} from "../../../tools/verify/omarchy-worker-cost-capture.mjs";
const root=new URL("./",import.meta.url);
const bytes=await fs.readFile(new URL("physical-input/desktop/report.json",root));
const r=JSON.parse(bytes), run=JSON.parse(await fs.readFile(new URL("physical-input/run.json",root)));
const sha=b=>createHash("sha256").update(b).digest("hex");
assert.match(run.auditError,/height: 28/u);
assert.equal(run.reportSha256,sha(bytes));
assert.equal(run.exit.closed,true);assert.equal(run.exit.watchdog,null);
const receipt={reportSha256:sha(bytes),originalAuditFailure:run.auditError,passed:false,
  correction:"Resource::flush_rect narrows later transfers to changed pixels; JsFrameSink tracks damage. Check display/resource dimensions separately from damage bounds.",
  source:["crates/core/src/dev/virtio/gpu/resources.rs:69","crates/wasm/src/lib.rs:2336"],
  input:auditInputReport(r,{head:run.head,wasmSha256:run.wasmSha256,arm:"candidate",preparedDirect:true,preparedRecycling:true,startupCommands:[PREPARED_DIRECT_COMMAND]}),
  configuration:auditPreparedDirect(r)};
function geometry(s) {
  assert.equal(s.width,1280);assert.equal(s.height,800);assert.equal(s.fixedViewport,true);
  assert.equal(s.gpu.width,1280);assert.equal(s.gpu.height,800);
  assert.equal(s.latest.resourceWidth,1280);assert.equal(s.latest.resourceHeight,832);
  const {x,y,width,height}=s.latest.rect;
  for(const n of [x,y,width,height])assert.ok(Number.isSafeInteger(n));
  assert.ok(x>=0&&y>=0&&width>0&&height>0&&x+width<=1280&&y+height<=800);
  assert.ok(s.framesReceived>0&&s.successfulPresents>0);
}
const states=r.observations.filter(row=>row.runtime).map(row=>row.runtime.presentation);
assert.equal(states.length,2);states.forEach(geometry);
receipt.geometry=states.map(s=>({width:s.width,height:s.height,resourceWidth:s.latest.resourceWidth,
  resourceHeight:s.latest.resourceHeight,damage:s.latest.rect,frames:s.framesReceived}));
const mutations=[s=>s.width=640,s=>s.height=400,s=>s.gpu.width=640,s=>s.gpu.height=400,
 s=>s.latest.resourceWidth=640,s=>s.latest.resourceHeight=400,s=>s.fixedViewport=false,
 s=>s.latest.rect.x=-1,s=>s.latest.rect.y=-1,s=>s.latest.rect.width=0,
 s=>s.latest.rect.height=0,s=>s.latest.rect.width=1281,s=>s.latest.rect.height=801,
 s=>s.latest.rect.x=.5,s=>s.framesReceived=0,s=>s.successfulPresents=0];
for(const mutate of mutations){const state=structuredClone(states[1]);mutate(state);assert.throws(()=>geometry(state));}
receipt.rejectedGeometryAttacks=mutations.length;
const fence=r.preparedDirectInputFence;
assert.equal(fence.method,"Input.setIgnoreInputEvents");assert.equal(fence.ignore,true);
assert.ok(Date.parse(fence.startedAt)>=r.keyboard.enteredAtMs);
assert.ok(Date.parse(fence.acknowledgedAt)>=Date.parse(fence.startedAt));
assert.ok(Date.parse(fence.acknowledgedAt)<Date.parse(r.keyboard.deadlineAt));
assert.ok(r.inputEvents.every(row=>Date.parse(row.timestamp)<=Date.parse(fence.startedAt)));
assert.equal(r.result,"failed");assert.equal(r.trial.outcome,"nonce-readback-failed");
const c=r.workerCost;
assert.equal(c.status,"captured");assert.deepEqual(c.inputVerdict,JSON.parse(workerCostInputVerdict(r)));
assert.ok(Date.parse(c.startedAt)>=Date.parse(r.keyboard.failedAt));
assert.equal(c.timeoutMs,WORKER_COST_CAPTURE_MS);
const deadlineSample=Date.parse(c.deadlineAt)-WORKER_COST_CAPTURE_MS;
assert.ok(deadlineSample>=Date.parse(c.startedAt)&&deadlineSample<=Date.parse(c.sampleStartedAt));
assert.ok(Date.parse(c.finishedAt)<=Date.parse(c.deadlineAt));
assert.equal(c.failureImageSha256,sha(await fs.readFile(new URL("physical-input/desktop/failure.png",root))));
const profileBytes=await fs.readFile(new URL("physical-input/desktop/worker-cpu.json",root));
assert.equal(sha(profileBytes),c.sha256);assert.equal(profileBytes.length,c.bytes);
receipt.profile=validateWorkerCostProfile(JSON.parse(profileBytes),new URL("./linux-worker.js",r.url).href);
receipt.postVerdictInput=auditWorkerCostInput(r);receipt.passed=true;
receipt.desktopResponsive=false;
await fs.writeFile(new URL("physical-audit.json",root),JSON.stringify(receipt,null,2)+"\n");
console.log(JSON.stringify({passed:true,desktopResponsive:false,rejectedGeometryAttacks:mutations.length,profile:receipt.profile}));
