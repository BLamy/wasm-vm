import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import {createGuestClockLifecycle,validateGuestClock,validateICountDivider,validateInteractiveClock} from '../guest-clock.js';

for (const [policy,selectedMode] of [['wall-on-keyboard','wall'],['paced-on-keyboard','paced-icount']]) {
function machineModel() {
  const calls=[],state={mode:'icount',mtime:'9007199254740997',timebaseHz:10000000,clockDiv:64};
  const machine={
    guestClockState(){calls.push('state');return {...state};},
    setICountDivider(value){calls.push('divider');state.clockDiv=value;},
    setGuestClock(value){calls.push('select:'+value);state.mode=value;},
    rebaseGuestClock(){calls.push('rebase');},
    sendKeyboardEvent(...args){calls.push(['make',...args]);},
  };
  return {machine,calls,state};
}
test(policy+': policy validation is exact and omitted policy never reads host time',()=>{
  const poison=new Proxy({},{get(){throw Error('unexpected realm read');}});
  assert.equal(validateInteractiveClock(undefined,'icount',poison),undefined);
  for(const value of [null,false,0,'wall','wall-on-keyboard ',[],{}])
    assert.throws(()=>validateInteractiveClock(value,'icount',poison),/unsupported interactiveClock/);
  assert.throws(()=>validateInteractiveClock(policy,'wall',poison),/requires guestClock=icount/);
  for(const sample of [NaN,Infinity,-1,'1'])
    assert.throws(()=>validateInteractiveClock(policy,'icount',{performance:{now:()=>sample}}),/finite nonnegative/);
  assert.equal(validateInteractiveClock(policy,'icount',{performance:{now:()=>0}}),policy);
});
test(policy+': all handoff APIs are required before initial divider mutation',()=>{
  for(const method of ['setGuestClock','rebaseGuestClock','guestClockState']) {
    const {machine,calls}=machineModel();machine[method]=undefined;
    assert.throws(()=>createGuestClockLifecycle(machine,'icount',64,policy),new RegExp(method));
    assert.deepEqual(calls,[]);
  }
});
test(policy+': only original PC105 makes select, preserving decimal mtime and boot divider receipt',()=>{
  const {machine,calls,state}=machineModel();
  const lifecycle=createGuestClockLifecycle(machine,'icount',64,policy),initial=lifecycle.dividerSelection();
  calls.length=0;
  for(const args of [[1,20,0],[1,20,2],[0,0,0],[1,0,1],[1,249,1],[1,1.5,1],[1,NaN,1],['1',20,1],[1,20,'1']])
    assert.equal(lifecycle.beforeKeyboardEvent(...args),false);
  assert.deepEqual(calls,[]);
  assert.equal(lifecycle.beforeKeyboardEvent(1,1,1),true);
  assert.deepEqual(calls,['state','select:'+selectedMode,'state']);
  assert.equal(state.mtime,'9007199254740997');assert.equal(state.mode,selectedMode);
  assert.deepEqual(lifecycle.dividerSelection(),initial);
  calls.length=0;
  for(const code of [20,69,248])assert.equal(lifecycle.beforeKeyboardEvent(1,code,1),false);
  assert.deepEqual(calls,[]);lifecycle.resume();lifecycle.resume();
  assert.deepEqual(calls,['rebase','rebase']);
  const native=readFileSync(new URL('../../crates/core/src/dev/virtio/input/keyboard.rs',import.meta.url),'utf8');
  assert.match(native,/PC105_KEY_RANGE[^\n]*= 1\.\.=248;/,'handoff range must track original keyboard capability');
});
test(policy+': omitted policy and plain wall lifecycle do not select on keyboard input',()=>{
  for(const mode of ['icount','wall','paced-icount']) {
    const {machine,calls}=machineModel();const lifecycle=createGuestClockLifecycle(machine,mode);
    calls.length=0;assert.equal(lifecycle.beforeKeyboardEvent(1,20,1),false);assert.deepEqual(calls,[]);
  }
});
const loader=readFileSync(new URL('../loader.js',import.meta.url),'utf8');
const keyboardBody=loader.match(/      sendKeyboardEvent: \(eventType, code, value\) => \{([\s\S]*?)\n      \},/)?.[1];
assert.ok(keyboardBody);
function actualKeyboardCallback(model,lifecycle,{stopped=false,paused=false}={}) {
  const sandbox={...model,guestClockLifecycle:lifecycle,stopped,paused,
    finish(status){model.calls.push('finish:'+status);sandbox.stopped=true;},
    onState(status){model.calls.push('status:'+status);},
    onError(error){model.calls.push('error:'+error.message);},
  };
  return {sandbox,send:vm.runInNewContext('(eventType,code,value)=>{'+keyboardBody+'}',sandbox)};
}
test(policy+': actual loader first NumLock repair selects before staging and stopped input cannot select',()=>{
  for(const paused of [false,true]) {
    const model=machineModel(),lifecycle=createGuestClockLifecycle(model.machine,'icount',64,policy);
    model.calls.length=0;const {send,sandbox}=actualKeyboardCallback(model,lifecycle,{paused});
    assert.equal(send(1,69,1),true);
    assert.deepEqual(model.calls,['state','select:'+selectedMode,'state',['make',1,69,1]]);
    assert.equal(sandbox.paused,paused,'handoff never schedules or unpauses');
    model.calls.length=0;lifecycle.resume();assert.deepEqual(model.calls,['rebase']);
    sandbox.stopped=true;model.calls.length=0;assert.equal(send(1,20,1),false);assert.deepEqual(model.calls,[]);
  }
});
test(policy+': actual loader rejects nonrepresentable ABI frames before clock or native staging',()=>{
  const model=machineModel(),lifecycle=createGuestClockLifecycle(model.machine,'icount',64,policy);
  model.calls.length=0;const {send,sandbox}=actualKeyboardCallback(model,lifecycle);
  for(const frame of [[1,30.5,1],[1.5,30,1],[1,30,1.5],[-65535,30,1],
    [65537,30,1],[1,65566,1],[1,30,0x100000001],[1,-1,1],
    [1,30,-0x80000001],[1,30,0x80000000],['1',30,1],[1,'30',1],[1,30,'1'],[NaN,30,1],
    [1,Infinity,1],[1,30,null],[1,30,undefined]]) {
    assert.equal(send(...frame),false,JSON.stringify(frame));
    assert.deepEqual(model.calls,[]);assert.equal(sandbox.stopped,false);
  }
  for(const value of [-0x80000000,-1,0x7fffffff]) {
    assert.equal(send(4,4,value),true,'original signed MSC_SCAN stays representable');
    assert.deepEqual(model.calls,[['make',4,4,value]]);model.calls.length=0;
    assert.equal(model.state.mode,'icount');
  }
  assert.equal(send(1,30,1),true);
  assert.deepEqual(model.calls,['state','select:'+selectedMode,'state',['make',1,30,1]]);
});
test(policy+': actual loader refuses staging and stops on thrown or invalid clock readback',()=>{
  for(const failure of ['throw','mode','mtime','timebase','divider']) {
    const model=machineModel(),lifecycle=createGuestClockLifecycle(model.machine,'icount',64,policy);
    const original=model.machine.setGuestClock;
    model.machine.setGuestClock=value=>{
      original(value);
      if(failure==='throw')throw Error('selection refused');
      if(failure==='mode')model.state.mode='icount';
      if(failure==='mtime')model.state.mtime='9007199254740998';
      if(failure==='timebase')model.state.timebaseHz=1;
      if(failure==='divider')model.state.clockDiv=1;
    };
    model.calls.length=0;const {send,sandbox}=actualKeyboardCallback(model,lifecycle);
    assert.throws(()=>send(1,20,1),/selection/);assert.equal(sandbox.stopped,true);
    assert.ok(model.calls.includes('finish:error'));
    assert.ok(!model.calls.some(row=>Array.isArray(row)),'original native make was never staged');
    assert.throws(()=>lifecycle.resume(),/restart required/);
    assert.throws(()=>lifecycle.beforeKeyboardEvent(1,20,1),/restart required/);
  }
});
test(policy+': actual prefetch validation rejects nonaccelerated policy before boot work',()=>{
  const begin=loader.indexOf('    validateGuestClock(guestClock);');
  const end=loader.indexOf('    const manifest = await fetchJsonAsset',begin);
  assert.ok(begin>0&&end>begin);
  const body=loader.slice(begin,end);
  for(const virgl of [false,undefined,'true',true]) {
    const sandbox={validateGuestClock,validateICountDivider,validateInteractiveClock,
      guestClock:'icount',icountDivider:64,interactiveClock:policy,virgl,
      workerMode:true,freshDesktop:false,opts:{bootSnapshot:false},isChunked:true,persist:false,extraDiskUrl:null};
    const run=()=>vm.runInNewContext(body,sandbox);
    if(virgl===true)run();else assert.throws(run,/requires accelerated graphics/);
  }
});

}
