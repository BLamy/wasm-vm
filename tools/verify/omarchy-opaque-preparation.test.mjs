// Harness fixtures only. No synthetic image or snapshot is product evidence.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { opaqueTerminalPixels, prepareOpaqueDesktop, ACTIVE_FOOT_COMMAND } from "./omarchy-opaque-preparation.mjs";
import { OPAQUE_FOOT_COMMAND, auditOpaqueFoot } from "./omarchy-opaque-foot-command.mjs";
import { formatRpcCommand } from "../../web/guest-rpc.js";

const foot={class:"foot",mapped:true,hidden:false,address:"0x123",at:[12,38],size:[1256,750]};
const presentation=n=>({backend:"canvas2d",width:1280,height:800,framesReceived:n,successfulPresents:n,
  latest:{resourceWidth:1280,resourceHeight:832,rect:{x:0,y:0,width:1280,height:800}}});
function pixels(blank=false){
  const bytes=new Uint8ClampedArray(1280*800*4);
  if(!blank)for(let n=0;n<100;n++)bytes.set([150+n%20,160,170,255],(50*1280+30+n)*4);
  return bytes;
}
function fixture({badProperties=false,badFoot=false,stale=false,blank=false,exportFailure=false}={}){
  const report={restored:true},events=[],image=pixels(blank);let configured=false,active=false;
  const runtime=n=>({presentation:presentation(n),clock:{mode:"icount",clockDiv:64},jit:{hasExecutor:true,admissionProbe:false,
    coldCounterRecycling:{enabled:false,threshold:512,capacity:65536,epochs:"0",discardedCounters:"0"},
    decodedCacheEntries:4096,jitResidencyPolicy:"cap-256",jitResidencyCap:256,entryCost:{timingEnabled:false}}});
  const page={async evaluate(fn,arg){
    assert.ok(configured&&active,"pixels must follow configuration and active-window response");
    const state=presentation(arg ? stale?4:5 : 4);
    return vm.runInNewContext(`(${fn.toString()})(arg)`,{arg,window:{__presentation:{state:()=>state,readPixels:()=>image}}});
  }};
  const hooks={
    async exec(command){events.push(command);
      if(command===OPAQUE_FOOT_COMMAND){configured=true;return{exit:0,stdout:badProperties?"ok\nfalse\nfalse\n0.985":"ok\ntrue\ntrue\n1"};}
      assert.equal(command,ACTIVE_FOOT_COMMAND);active=true;
      return{exit:0,stdout:JSON.stringify({...foot,class:badFoot?"other":"foot"})};
    },
    observeRuntime:async label=>runtime(label.endsWith("before")?2:5),
    screenshot:async name=>{events.push(name);},
    capturePair:async()=>{events.push("capture");if(exportFailure)throw Error("fixture export failure");report.pair={synthetic:true};},
  };
  return{report,events,page,hooks};
}

test("opaque preparation uses confirmed window, post-query fresh native pixels and separate bounded export",async()=>{
  const f=fixture(),deadline=Date.now()+1000;
  await prepareOpaqueDesktop(f.page,deadline,f.report,f.hooks);
  assert.deepEqual(f.events,[OPAQUE_FOOT_COMMAND,ACTIVE_FOOT_COMMAND,"prepared-desktop.png","capture"]);
  assert.equal(f.report.modePreparation.status,"pair-captured-input-untested");
  assert.equal(f.report.modePreparation.presentationBaseline.framesReceived,4);
  assert.equal(f.report.modePreparation.lastPixels.state.framesReceived,5);
  assert.equal(Date.parse(f.report.modePreparation.deadlineAt),deadline);
  assert.equal(Date.parse(f.report.modePreparation.exportDeadlineAt)-Date.parse(f.report.modePreparation.exportStartedAt),180000);
  assert.equal(f.report.keyboard,undefined);
});

test("wrong properties/window, stale image, blank terminal and failed export cannot make a prepared pair",async()=>{
  for(const options of [{badProperties:true},{badFoot:true},{stale:true},{blank:true},{exportFailure:true}]){
    const f=fixture(options);
    await assert.rejects(prepareOpaqueDesktop(f.page,Date.now()+60,f.report,f.hooks));
    assert.equal(f.report.modePreparation.status,"preparation-failed-input-untested");
    assert.equal(f.report.pair,undefined);
    if(!options.exportFailure)assert.ok(!f.events.includes("prepared-desktop.png"));
  }
});

test("native terminal ROI rejects bar-only pixels, wrong geometry and expired startup",async()=>{
  assert.equal(opaqueTerminalPixels(pixels(),1280,800,foot).nonblank,true);
  const bar=pixels(true);for(let i=0;i<1280*26*4;i++)bar[i]=255;
  assert.equal(opaqueTerminalPixels(bar,1280,800,foot).nonblank,false);
  assert.throws(()=>opaqueTerminalPixels(pixels(),1280,800,{...foot,at:[12,0]}));
  assert.throws(()=>opaqueTerminalPixels(pixels(),1280,800,{...foot,size:[1280,800]}));
  const f=fixture();await assert.rejects(prepareOpaqueDesktop(f.page,Date.now()-1,f.report,f.hooks),/deadline/u);
  assert.deepEqual(f.events,[]);
});

test("preparation supplies a fixed extra read command to the wire audit; report text cannot authorize it",()=>{
  const at=new Date().toISOString(),deadline=Date.now()+1000;
  const report={opaqueFootRequested:true,startup:{deadlineAt:new Date(deadline).toISOString()},
    opaqueFoot:{command:OPAQUE_FOOT_COMMAND,requestCount:1,startedAt:at,respondedAt:at,deadlineAtMs:deadline,
      status:"properties-confirmed",response:{stdout:"ok\ntrue\ntrue\n1\n",exit:0}},
    workerTraffic:[
      {type:"serial-input",sent:true,timestamp:at,ms:1,bytes:[...Buffer.from(formatRpcCommand(OPAQUE_FOOT_COMMAND,"o1"))]},
      {type:"serial-output",timestamp:at,ms:2,text:"\n__WVBEGIN_o1\nok\ntrue\ntrue\n1\n__WVEND_o1_0\n"},
      {type:"serial-input",sent:true,timestamp:at,ms:3,bytes:[...Buffer.from(formatRpcCommand(ACTIVE_FOOT_COMMAND,"o2"))]},
    ]};
  assert.throws(()=>auditOpaqueFoot(report));
  assert.equal(auditOpaqueFoot(report,{additionalCommands:[ACTIVE_FOOT_COMMAND]}).configuration,"properties-confirmed");
});
