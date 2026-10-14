import assert from 'node:assert/strict';
import test from 'node:test';
import {assertPublicDesktopFinal} from './critic-fast-boots-final.mjs';
const state=()=>({serial:'original Linux output\r\n',workerErrors:[],pageErrors:[],gpu:{qualified:true,lost:false,poisoned:false,disposed:false,lastFailure:null,pending:null,counters:{begun:4,completed:4,failed:0,cancelled:0,draws:2}}});
test('actual quiescent and single active original GPU snapshots are admissible',()=>{
  const s=state();assertPublicDesktopFinal(s);s.gpu.pending={epoch:'2',sequence:'5'};s.gpu.counters.begun=5;assertPublicDesktopFinal(s);
});
test('a real pre-host DRM refusal fails despite zero host failure counters',()=>{
  const s=state();s.serial+='[  501.156000] [drm:virtio_gpu_dequeue_ctrl_func] *ERROR* response 0x1205 (command 0x207)\r\n';assert.throws(()=>assertPublicDesktopFinal(s),/DRM transport/);
});
test('new errors, lost owners and mismatched original retirement fail',()=>{
  const attacks=[s=>s.workerErrors.push('worker failed'),s=>s.pageErrors.push('browser failed'),s=>s.gpu.qualified=false,s=>s.gpu.lost=true,s=>s.gpu.poisoned=true,s=>s.gpu.disposed=true,s=>s.gpu.lastFailure={code:'invalid'},s=>s.gpu.counters.failed=1,s=>s.gpu.counters.cancelled=1,s=>s.gpu.counters.draws=0,s=>s.gpu.counters.begun=6,s=>s.gpu.pending={sequence:'5'}];
  for(const attack of attacks){const s=state();attack(s);assert.throws(()=>assertPublicDesktopFinal(s));}
});

test('late first run cannot hide the paused interval in the real clock oracle',async()=>{
  const {assertInteractivePauseProbe}=await import('./critic-fast-boots-final.mjs');
  const clock=mtime=>({mode:'wall',mtime:String(mtime),timebaseHz:10000000,clockDiv:64});
  const probe={beforePause:clock(40000000),afterPause:clock(40000000),resumed:clock(40000000),progressed:clock(42500000),pauseMillis:1000,resumeSent:2000,progressReceived:2250};
  assert.equal(assertInteractivePauseProbe(probe).actualTicks,'2500000');
  probe.progressed=clock(52500000);
  assert.throws(()=>assertInteractivePauseProbe(probe),/excludes the paused/);
});

test('clock samples retain decimal precision and cannot move backward',async()=>{
  const {assertInteractivePauseProbe}=await import('./critic-fast-boots-final.mjs');
  const clock=mtime=>({mode:'wall',mtime:String(mtime),timebaseHz:10000000,clockDiv:64});
  const probe={beforePause:clock(9007199254740997n),afterPause:clock(9007199254740997n),resumed:clock(9007199255740997n),progressed:clock(9007199256740997n),pauseMillis:1000,resumeSent:2000,progressReceived:2250};
  assert.equal(assertInteractivePauseProbe(probe).actualTicks,'2000000');
  probe.progressed=clock(9007199255240997n);
  assert.throws(()=>assertInteractivePauseProbe(probe),/backward/);
  probe.progressed=clock(9007199256740997n);probe.resumed.mtime=9007199255740997;
  assert.throws(()=>assertInteractivePauseProbe(probe));
});
