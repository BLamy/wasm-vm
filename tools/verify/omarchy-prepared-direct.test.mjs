// Synthetic auditor controls, never substituted for actual guest acceptance.
import assert from "node:assert/strict";
import test from "node:test";
import { formatRpcCommand } from "../../web/guest-rpc.js";
import { R3_IDENTITIES, assertInputTrialSource } from "./omarchy-input-trial.mjs";
import { PREPARED_DIRECT_IDENTITIES, PREPARED_DIRECT_COMMAND, assertPreparedDirectSource,
  assertPreparedDirectProperties, requestPreparedDirectProperties, auditPreparedDirect } from "./omarchy-prepared-direct-state.mjs";

const iso = value => new Date(value).toISOString();
const foot = { address: "0x55555eb73630", pid: 503, class: "foot", mapped: true,
  hidden: false, visible: true, acceptsInput: true, at: [12,38], size: [1256,750] };
const values = ["true", "true", "1", "1.000000", "1", "true", "true", "true"];
const response = { exit: 0, stdout: `${values.join("\n\n\n")}\n\n\n${JSON.stringify(foot,null,2)}\n` };
const source = () => ({ ...structuredClone(PREPARED_DIRECT_IDENTITIES),
  image: { imageLen: 4294967296, chunkSize: 262144, chunkCount: 16384 } });
function fixture() {
  return { preparedDirectRequested: true, startup: { deadlineAt: iso(5000) },
    preparedDirect: { command: PREPARED_DIRECT_COMMAND, requestCount: 1, startedAt: iso(1200),
      deadlineAtMs: 5000, respondedAt: iso(1500), finishedAt: iso(1500),
      status: "properties-confirmed", response: structuredClone(response), foot: structuredClone(foot) },
    trial: { outcome: "startup-failed-input-not-tested" }, workerTraffic: [
      { type: "serial-input", sent: true, bytes: [...Buffer.from(formatRpcCommand(PREPARED_DIRECT_COMMAND,"prep1"))], ms: 1300, timestamp: iso(1300) },
      { type: "serial-output", text: `\n__WVBEGIN_prep1\n${response.stdout}__WVEND_prep1_0\n`, ms: 1400, timestamp: iso(1400) },
    ] };
}

test("prepared selection accepts only the verified pair while original R3 guards stay exact", () => {
  assertPreparedDirectSource(source());
  assert.throws(() => assertInputTrialSource(source()));
  const old = { ...structuredClone(R3_IDENTITIES), image: source().image };
  assertInputTrialSource(old); assert.throws(() => assertPreparedDirectSource(old));
  for (const role of Object.keys(PREPARED_DIRECT_IDENTITIES)) for (const field of ["size", "sha256"]) {
    const bad = source(); bad[role][field] = field === "size" ? 0 : "0".repeat(64);
    assert.throws(() => assertPreparedDirectSource(bad));
  }
  const bad = source(); bad.image.imageLen /= 2; assert.throws(() => assertPreparedDirectSource(bad));
});

test("one read-only batch checks eight saved properties and the exact restored Foot", async () => {
  assert.deepEqual(PREPARED_DIRECT_COMMAND.split("--batch '")[1].slice(0,-1).split("; "), [
    "getprop active opaque", "getprop active force_rgbx", "getprop active opacity",
    "getprop active opacity_inactive", "getprop active opacity_fullscreen", "getprop active opacity_override",
    "getprop active opacity_inactive_override", "getprop active opacity_fullscreen_override", "j/activewindow",
  ]);
  assert.doesNotMatch(PREPARED_DIRECT_COMMAND, /dispatch|set_prop|reload|keyword|nonce|sendkey/u);
  assert.deepEqual(assertPreparedDirectProperties(response), foot);
  const report = {}, calls = [];
  await requestPreparedDirectProperties(async (command, timeout) => {
    assert.ok(timeout > 0 && timeout <= 1000); calls.push(command); return response;
  }, Date.now()+1000, report);
  assert.deepEqual(calls, [PREPARED_DIRECT_COMMAND]);
  assert.equal(report.preparedDirect.status, "properties-confirmed");
});

test("missing property, altered active Foot, write acknowledgment or exit0 error text fails closed", () => {
  for (let i=0; i<values.length; i++) {
    const bad=[...values]; bad[i]=i>=2&&i<=4 ? "0.985" : "false";
    assert.throws(()=>assertPreparedDirectProperties({exit:0,stdout:bad.join("\n")+"\n"+JSON.stringify(foot)}));
    bad.splice(i,1);
    assert.throws(()=>assertPreparedDirectProperties({exit:0,stdout:bad.join("\n")+"\n"+JSON.stringify(foot)}));
  }
  for (const stdout of ["ok\n"+response.stdout, response.stdout+"trailing", "IPC timeout", values.join("\n")])
    assert.throws(()=>assertPreparedDirectProperties({exit:0,stdout}));
  assert.throws(()=>assertPreparedDirectProperties({...response,exit:1}));
  for (const mutation of [{class:"kitty"},{address:"0x55555eb73631"},{pid:504},{mapped:false},
    {hidden:true},{visible:false},{acceptsInput:false},{at:[12,39]},{size:[640,400]}])
    assert.throws(()=>assertPreparedDirectProperties({exit:0,stdout:values.join("\n")+"\n"+JSON.stringify({...foot,...mutation})}));
});

test("expired or late property replies do not renew startup or admit input", async t => {
  t.mock.timers.enable({apis:["Date"],now:1000}); let calls=0; const report={};
  await assert.rejects(requestPreparedDirectProperties(async()=>{calls++;},999,report), /deadline/u);
  assert.equal(calls,0);
  await assert.rejects(requestPreparedDirectProperties(async()=>{calls++;t.mock.timers.tick(1001);return response;},2000,report), /deadline/u);
  assert.equal(calls,1); assert.equal(report.preparedDirect.status,"properties-unproven");
});

test("prepared audit rejects forged, duplicate, late and mutating raw property commands", () => {
  assert.equal(auditPreparedDirect(fixture()).configuration,"properties-confirmed");
  for (const mutate of [r=>r.workerTraffic.pop(),
    r=>{r.workerTraffic[1].text=r.workerTraffic[1].text.replace("true","false");},
    r=>{r.preparedDirect.foot.pid=504;}, r=>{r.preparedDirect.respondedAt=iso(5001);},
    r=>{r.keyboard={startedAt:iso(1400)};},
    r=>r.workerTraffic.push({...r.workerTraffic[0],bytes:[...Buffer.from(formatRpcCommand(PREPARED_DIRECT_COMMAND,"prep2"))]}),
    r=>{r.workerTraffic[0].bytes=[...Buffer.from(formatRpcCommand("hyprctl reload","prep1"))];},
  ]) { const bad=fixture(); mutate(bad); assert.throws(()=>auditPreparedDirect(bad)); }
  const negative=fixture(); delete negative.preparedDirect.response; delete negative.preparedDirect.respondedAt;
  negative.preparedDirect.status="properties-unproven"; negative.workerTraffic.pop();
  assert.equal(auditPreparedDirect(negative).physicalInputTested,false);
  negative.keyboard={startedAt:iso(1600)}; assert.throws(()=>auditPreparedDirect(negative));
  const early=fixture(); delete early.preparedDirect; early.workerTraffic=[];
  assert.equal(auditPreparedDirect(early).configuration,"not-reached");
});
