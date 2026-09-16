// Harness fixtures only. No synthetic image or snapshot is product evidence.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { opaqueTerminalPixels } from "./omarchy-opaque-preparation.mjs";
import { prepareDirectOpaqueDesktop } from "./omarchy-direct-opaque-preparation.mjs";
import { DIRECT_OPAQUE_COMMAND } from "./omarchy-direct-opaque-command.mjs";

const foot={class:"foot",mapped:true,hidden:false,address:"0x123",at:[12,38],size:[1256,750]};
const presentation=n=>({backend:"canvas2d",width:1280,height:800,framesReceived:n,successfulPresents:n,
  latest:{resourceWidth:1280,resourceHeight:832,rect:{x:0,y:0,width:1280,height:800}}});
function pixels(blank=false){
  const bytes=new Uint8ClampedArray(1280*800*4);
  if(!blank)for(let n=0;n<100;n++)bytes.set([150+n%20,160,170,255],(50*1280+30+n)*4);
  return bytes;
}
function fixture({badProperties=false,badFoot=false,stale=false,blank=false,exportFailure=false}={}){
  const report={restored:true},events=[],image=pixels(blank);let configured=false;
  const runtime=n=>({presentation:presentation(n),clock:{mode:"icount",clockDiv:64},jit:{hasExecutor:true,admissionProbe:false,
    coldCounterRecycling:{enabled:false,threshold:512,capacity:65536,epochs:"0",discardedCounters:"0"},
    decodedCacheEntries:4096,jitResidencyPolicy:"cap-256",jitResidencyCap:256,entryCost:{timingEnabled:false}}});
  const page={async evaluate(fn,arg){
    assert.ok(configured,"pixels must follow configuration and active-window response");
    const state=presentation(arg ? stale?4:5 : 4);
    return vm.runInNewContext(`(${fn.toString()})(arg)`,{arg,window:{__presentation:{state:()=>state,readPixels:()=>image}}});
  }};
  const hooks={
    async exec(command){events.push(command);
      assert.equal(command,DIRECT_OPAQUE_COMMAND);configured=true;
      const values=badProperties?["false","true","1","1","1","true","true","true"]:["true","true","1","1","1","true","true","true"];
      return{exit:0,stdout:[...Array(8).fill("ok"),...values,
        JSON.stringify({...foot,class:badFoot?"other":"foot"})].join("\n\n\n")};
    },
    observeRuntime:async label=>runtime(label.endsWith("before")?2:5),
    screenshot:async name=>{events.push(name);},
    capturePair:async()=>{events.push("capture");if(exportFailure)throw Error("fixture export failure");report.pair={synthetic:true};},
  };
  return{report,events,page,hooks};
}

test("direct preparation uses embedded active Foot and post-response fresh pixels before export",async()=>{
  const f=fixture(),deadline=Date.now()+1000;
  await prepareDirectOpaqueDesktop(f.page,deadline,f.report,f.hooks);
  assert.deepEqual(f.events,[DIRECT_OPAQUE_COMMAND,"prepared-desktop.png","capture"]);
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
    await assert.rejects(prepareDirectOpaqueDesktop(f.page,Date.now()+60,f.report,f.hooks));
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
  const f=fixture();await assert.rejects(prepareDirectOpaqueDesktop(f.page,Date.now()-1,f.report,f.hooks),/deadline/u);
  assert.deepEqual(f.events,[]);
});

