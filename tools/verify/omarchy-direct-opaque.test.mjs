import assert from "node:assert/strict";
import test from "node:test";
import { formatRpcCommand } from "../../web/guest-rpc.js";
import { DIRECT_OPAQUE_COMMAND, assertDirectOpaqueProperties, requestDirectOpaque,
  auditDirectOpaque } from "./omarchy-direct-opaque-command.mjs";

const iso = value => new Date(value).toISOString();
const foot = { address: "0x55555eed", class: "foot", mapped: true, hidden: false, at: [12,38], size: [1256,750] };
const values = [...Array(8).fill("ok"), "true", "true", "1", "1.000000", "1", "true", "true", "true"];
const response = { exit: 0, stdout: `${values.join("\n\n\n")}\n\n\n${JSON.stringify(foot,null,2)}\n` };
function fixture() {
  return { directOpaqueRequested: true, startup: { deadlineAt: iso(5000) },
    directOpaque: { command: DIRECT_OPAQUE_COMMAND, requestCount: 1, startedAt: iso(1200),
      deadlineAtMs: 5000, respondedAt: iso(1500), finishedAt: iso(1500),
      status: "properties-confirmed", response: structuredClone(response), foot: structuredClone(foot) },
    trial: { outcome: "startup-failed-input-not-tested" },
    workerTraffic: [
      { type: "serial-input", sent: true, bytes: [...Buffer.from(formatRpcCommand(DIRECT_OPAQUE_COMMAND,"op1"))], ms: 1300, timestamp: iso(1300) },
      { type: "serial-output", text: `\n__WVBEGIN_op1\n${response.stdout}__WVEND_op1_0\n`, ms: 1400, timestamp: iso(1400) },
    ] };
}

test("one synchronous direct batch contains only the specified writes then reads", async () => {
  assert.doesNotMatch(DIRECT_OPAQUE_COMMAND, /(?: -r |eval|window_rule|reload|nonce|sendkey)/u);
  const batch = DIRECT_OPAQUE_COMMAND.split("--batch '")[1].slice(0,-1).split("; ");
  assert.equal(batch.length,17);
  assert.ok(batch.slice(0,8).every(row=>row.startsWith("dispatch setprop active ") && row.endsWith(" 1")));
  assert.ok(batch.slice(8,16).every(row=>row.startsWith("getprop active ")));
  assert.equal(batch[16],"j/activewindow");
  assert.deepEqual(assertDirectOpaqueProperties(response),foot);
  const report = {}, calls = [], deadline = Date.now()+1000;
  await requestDirectOpaque(async (command, timeout) => {
    assert.ok(timeout>0 && timeout<=1000); calls.push(command); return response;
  },deadline,report);
  assert.deepEqual(calls,[DIRECT_OPAQUE_COMMAND]);
  assert.equal(report.directOpaque.status,"properties-confirmed");
  assert.equal(report.directOpaque.deadlineAtMs,deadline);
});

test("every property and acknowledgment is required; exit0 error strings never pass", () => {
  for (let i=0;i<values.length;i++) {
    const bad=[...values];bad[i]=i<8?"error":i>=10&&i<=12?"0.985":"false";
    assert.throws(()=>assertDirectOpaqueProperties({exit:0,stdout:bad.join("\n")+"\n"+JSON.stringify(foot)}));
    bad.splice(i,1);
    assert.throws(()=>assertDirectOpaqueProperties({exit:0,stdout:bad.join("\n")+"\n"+JSON.stringify(foot)}));
  }
  for(const bad of ["ok\nHyprland IPC didn't respond in time\nCouldn't read (6)\n",values.join("\n"),
    response.stdout+"trailing",response.stdout.replace("1.000000","1.000001")])
    assert.throws(()=>assertDirectOpaqueProperties({exit:0,stdout:bad}));
  assert.throws(()=>assertDirectOpaqueProperties({...response,exit:1}));
  for(const fields of [{class:"kitty"},{mapped:false},{hidden:true},{address:"0x0"},
    {at:[12,0]},{size:[2000,500]},{at:[12]},{size:[0,0]}])
    assert.throws(()=>assertDirectOpaqueProperties({exit:0,stdout:values.join("\n")+"\n"+JSON.stringify({...foot,...fields})}));
});

test("expired, late and rejected configuration cannot reach input or renew the deadline", async t => {
  t.mock.timers.enable({apis:["Date"],now:1000});
  const report={};let calls=0;
  await assert.rejects(requestDirectOpaque(async()=>{calls++;},999,report),/deadline/u);
  assert.equal(calls,0);
  await assert.rejects(requestDirectOpaque(async()=>{calls++;t.mock.timers.tick(1001);return response;},2000,report),/deadline/u);
  assert.equal(calls,1);assert.equal(report.directOpaque.status,"configuration-failed");
  await assert.rejects(requestDirectOpaque(async()=>({exit:0,stdout:"ok"}),3000,report));
  assert.equal(report.directOpaque.status,"configuration-failed");
});

test("direct audit binds complete actual wire and rejects reordered, forged, duplicate and late evidence", () => {
  assert.equal(auditDirectOpaque(fixture()).configuration,"properties-confirmed");
  for(const mutate of [
    r=>r.workerTraffic.pop(),
    r=>{r.workerTraffic[1].text=r.workerTraffic[1].text.replace("true","false");},
    r=>{r.directOpaque.foot.class="kitty";},
    r=>r.workerTraffic.push({...r.workerTraffic[0],bytes:[...Buffer.from(formatRpcCommand(DIRECT_OPAQUE_COMMAND,"op2"))]}),
    r=>{r.directOpaque.respondedAt=iso(5001);},
    r=>{r.keyboard={startedAt:iso(1400)};},
    r=>{r.workerTraffic[0].bytes=[...Buffer.from(formatRpcCommand("echo forbidden","op1"))];},
  ]){const r=fixture();mutate(r);assert.throws(()=>auditDirectOpaque(r));}
  const negative=fixture();delete negative.directOpaque.response;delete negative.directOpaque.respondedAt;
  negative.directOpaque.status="configuration-failed";negative.workerTraffic.pop();
  assert.equal(auditDirectOpaque(negative).physicalInputTested,false);
  negative.keyboard={startedAt:iso(1600)};assert.throws(()=>auditDirectOpaque(negative));
  const early=fixture();delete early.directOpaque;early.workerTraffic=[];
  assert.equal(auditDirectOpaque(early).configuration,"not-reached");
});
