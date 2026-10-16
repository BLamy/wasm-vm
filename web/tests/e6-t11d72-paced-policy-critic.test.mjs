// Independent D72 JS policy/recording checks. Native clock semantics and stock
// desktop acceptance require their separately recorded actual-worker evidence.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const repo=resolve(process.env.CRITIC_D72_REPO_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
const {createGuestClockLifecycle,validateGuestClock,validateInteractiveClock,validateICountDivider}=
  await import(pathToFileURL(resolve(repo,'web/guest-clock.js')));
const {assertInteractivePauseProbe}=await import(pathToFileURL(resolve(repo,'tools/virgl-production/critic-fast-boots-final.mjs')));
const loader=readFileSync(resolve(repo,'web/loader.js'),'utf8');
const main=readFileSync(resolve(repo,'web/main.js'),'utf8');
function callback(name,parameters='') {
  const escaped=parameters.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const body=loader.match(new RegExp(`      ${name}: \\(${escaped}\\) => \\{([\\s\\S]*?)\\n      \\},`))?.[1];
  assert.ok(body,`actual ${name} callback remains identifiable`);
  return `(${parameters})=>{${body}\n}`;
}
function rig({paused=true,fault=null,policy='paced-on-keyboard'}={}) {
  const calls=[];
  const failure=new Error('independent paced selection refusal');
  let current={mode:'icount',mtime:'18446744073709550000',timebaseHz:10000000,clockDiv:64};
  let armed=false;
  const machine={
    setICountDivider(value){calls.push(['divider',value]);current={...current,clockDiv:value};},
    setGuestClock(mode){calls.push(['select',mode]);if(armed&&fault==='throw')throw failure;current={...current,mode};},
    guestClockState(){
      calls.push(['read',current.mode]);
      if(armed&&current.mode==='paced-icount') {
        if(fault==='stale-wall')return {...current,mode:'wall'};
        if(fault==='stale-icount')return {...current,mode:'icount'};
        if(fault==='mtime-drift')return {...current,mtime:String(BigInt(current.mtime)+1n)};
        if(fault==='number-time')return {...current,mtime:Number(current.mtime)};
        if(fault==='bad-divider')return {...current,clockDiv:63};
        if(fault==='bad-timebase')return {...current,timebaseHz:1000000};
        if(fault==='null')return null;
      }
      return {...current};
    },
    rebaseGuestClock(){calls.push(['rebase',current.mode]);},
    sendKeyboardEvent(...frame){calls.push(['stage',...frame,current.mode]);},
    syncKeyboard(){calls.push(['sync']);},
    setDiskReadOnly(){calls.push(['disk-read-only']);},
  };
  const lifecycle=createGuestClockLifecycle(machine,'icount',64,policy);
  armed=true;calls.length=0;
  const context=vm.createContext({machine,guestClockLifecycle:lifecycle,stopped:false,paused,gpuCaptureBusy:false,heldKeyboard:new Set(),
    quotaPaused:false,quotaReadOnly:false,lastPersistRetry:99,doneSettled:false,
    pendingFinishState:null,tickScheduled:false,
    productionGpu:{dispose(){calls.push(['dispose']);}},
    settleFinished(){calls.push(['settled']);},
    onState(state){assert.equal(context.stopped,true);calls.push(['state',state]);},
    onError(error){calls.push(['error',error.message]);},
    schedule(){if(!context.stopped)calls.push(['schedule']);},
  });
  const finish=loader.match(/    const finish = \(state\) => \{([\s\S]*?)\n    \};/)?.[1];
  assert.ok(finish);context.finish=vm.runInContext(`(state)=>{${finish}\n}`,context);
  const methods={};
  for(const [name,parameters] of [['sendKeyboardEvent','eventType, code, value'],['syncKeyboard',''],
    ['resume',''],['resumeAfterQuota',''],['continueReadOnly','']])
    methods[name]=vm.runInContext(callback(name,parameters),context);
  return {calls,machine,lifecycle,context,methods,failure,current:()=>({...current})};
}

test('paced critic: first paused lock repair selects native pacing before original make/SYN',()=>{
  for(const paused of [false,true]) {
    const r=rig({paused});const before=r.current();
    const receipt=r.lifecycle.dividerSelection();
    assert.equal(r.methods.sendKeyboardEvent(1,69,1),true);
    assert.equal(r.methods.syncKeyboard(),true);
    assert.deepEqual(r.calls,[['read','icount'],['select','paced-icount'],['read','paced-icount'],
      ['stage',1,69,1,'paced-icount'],['sync']]);
    assert.equal(r.current().mtime,before.mtime);assert.equal(r.current().clockDiv,64);
    assert.equal(r.context.paused,paused);assert.deepEqual(r.lifecycle.dividerSelection(),receipt);
    r.calls.length=0;
    for(const code of [1,20,69,248]) {r.methods.sendKeyboardEvent(1,code,1);r.methods.syncKeyboard();}
    assert.equal(r.calls.filter(([kind])=>kind==='select'||kind==='read'||kind==='rebase').length,0,
      'no repeated make may reset the host anchor');
    r.calls.length=0;
    if(!paused)r.context.paused=true;
    r.methods.resume();r.methods.resume();
    assert.deepEqual(r.calls,[['rebase','paced-icount'],['schedule']]);
  }
});

test('paced critic: stale wall mode and malformed successful readback poison actual loader before staging',()=>{
  for(const fault of ['throw','stale-wall','stale-icount','mtime-drift','number-time','bad-divider','bad-timebase','null']) {
    const r=rig({fault});
    assert.throws(()=>r.methods.sendKeyboardEvent(1,248,1),fault==='throw'?e=>e===r.failure:/selection changed time/);
    assert.equal(r.context.stopped,true,fault);assert.equal(r.context.pendingFinishState,'error');
    assert.equal(r.methods.syncKeyboard(),false);assert.equal(r.methods.sendKeyboardEvent(1,1,1),false);
    r.methods.resume();
    assert.equal(r.calls.filter(([kind])=>['stage','sync','rebase','schedule'].includes(kind)).length,0,fault);
    assert.equal(r.calls.filter(([kind])=>kind==='dispose').length,1);
    assert.throws(()=>r.lifecycle.resume(),/restart required/);
    assert.throws(()=>r.lifecycle.beforeKeyboardEvent(1,20,1),/restart required/);
  }
});

test('paced critic: quota resume rebases committed pacing before any execution or readonly mutation',()=>{
  for(const method of ['resumeAfterQuota','continueReadOnly'])for(const refuse of [false,true]) {
    const r=rig();r.context.quotaPaused=true;
    r.methods.sendKeyboardEvent(1,69,1);r.methods.syncKeyboard();r.calls.length=0;
    const failure=new Error('independent paced rebase refusal');
    r.machine.rebaseGuestClock=()=>{
      assert.equal(r.context.quotaPaused,true);assert.equal(r.context.quotaReadOnly,false);
      r.calls.push(['rebase','paced-icount']);if(refuse)throw failure;
    };
    if(refuse) {
      assert.throws(()=>r.methods[method](),e=>e===failure);
      assert.deepEqual(r.calls,[['rebase','paced-icount']]);
      assert.equal(r.context.quotaPaused,true);assert.equal(r.context.quotaReadOnly,false);
      assert.equal(r.context.lastPersistRetry,99);
    } else {
      r.methods[method]();
      assert.deepEqual(r.calls,method==='continueReadOnly'?
        [['rebase','paced-icount'],['disk-read-only'],['schedule']]:[['rebase','paced-icount'],['schedule']]);
      r.calls.length=0;r.methods[method]();
      assert.equal(r.calls.some(([kind])=>kind==='rebase'),false,'cleared quota pause does not reset anchor');
    }
  }
});

test('paced critic: direct paced mode validates source receiver, exact labels and API shape',()=>{
  for(const sample of [0,0.125,912345.75]) {
    let reads=0;const performance={now(){assert.equal(this,performance);reads++;return sample;}};
    assert.equal(validateGuestClock('paced-icount',{performance}),'paced-icount');assert.equal(reads,1);
  }
  const poison=new Proxy({},{get(){throw Error('unexpected realm access');}});
  for(const label of ['paced','Paced-ICount','paced-icount ',' paced-icount',null,0,{},['paced-icount']])
    assert.throws(()=>validateGuestClock(label,poison),/unsupported guestClock/);
  for(const realm of [null,{}, {performance:null},{performance:{}},{performance:{now:1}}])
    assert.throws(()=>validateGuestClock('paced-icount',realm),/monotonic performance.now/);
  for(const sample of [NaN,Infinity,-Infinity,-0.001,'0',0n,null,undefined,false,[]])
    assert.throws(()=>validateGuestClock('paced-icount',{performance:{now:()=>sample}}),/finite nonnegative/);
  for(const method of ['setGuestClock','guestClockState','rebaseGuestClock'])for(const value of [undefined,null,1,{}]) {
    let sideEffects=0;
    const machine={setGuestClock(){sideEffects++;},guestClockState(){sideEffects++;},rebaseGuestClock(){sideEffects++;},[method]:value};
    assert.throws(()=>createGuestClockLifecycle(machine,'paced-icount'),new RegExp(method));
    assert.equal(sideEffects,0);
  }
  assert.throws(()=>createGuestClockLifecycle({},'paced-icount',64),/icountDivider requires guestClock=icount/);
  assert.throws(()=>validateInteractiveClock('paced-on-keyboard','paced-icount',poison),/requires guestClock=icount/);
});

test('paced critic: actual main defaults scope handoff to accelerated ephemeral Omarchy',async()=>{
  const body=main.match(/async function bootOmarchy\(\) \{([\s\S]*?)\n\}\n\nwindow\.wvmDemo/)?.[1];
  assert.ok(body,'execute actual production option construction');
  for(const c of [
    {search:'',worker:true,graphics:'gpu',accelerated:true},
    {search:'?gpu=0',worker:true,graphics:'software',accelerated:false},
    {search:'',worker:false,graphics:'software',accelerated:false},
    {search:'?persist=1',worker:true,graphics:'gpu',accelerated:false},
    {search:'?persist=0',worker:true,graphics:'gpu',accelerated:false},
    {search:'?noSnapshot=1',worker:true,graphics:'gpu',accelerated:true},
    {search:'?gpu=0&noSnapshot=1',worker:true,graphics:'software',accelerated:false},
  ]) {
    let observed=null;
    const actions=new Map(['gpu-retry','gpu-cold-retry'].map(id=>[id,{hidden:false}]));
    const context=vm.createContext({URLSearchParams,location:{search:c.search},_useCpuWorker:c.worker,
      graphicsSelect:{value:c.graphics},gpuStatusEl:{textContent:''},R2_ASSETS:'https://owned-assets.invalid',
      document:{documentElement:{dataset:{gpuBootError:'true'}},getElementById(id){assert.ok(actions.has(id));return actions.get(id);}},
      linuxCtl:{},async runLinuxBoot(opts){observed=opts;return {winner:'omarchy'};}});
    await vm.runInContext(`(async()=>{${body}\n})()`,context);
    assert.ok([...actions.values()].every(action=>action.hidden),'fresh launch clears previous recovery choices');
    assert.equal(context.document.documentElement.dataset.gpuBootError,undefined,'fresh launch clears previous failure overlay');
    assert.equal(observed.virgl,c.accelerated);
    assert.equal(observed.interactiveClock,c.accelerated?'paced-on-keyboard':undefined);
    assert.equal(observed.guestClock,'icount');assert.equal(observed.icountDivider,64);
    assert.equal(observed.bootSnapshot,!new URLSearchParams(c.search).has('noSnapshot'));
  }
});

test('paced critic: prefetch validation runs before the actual manifest call',async()=>{
  const begin=loader.indexOf('    validateGuestClock(guestClock);');
  const end=loader.indexOf('    const manifest = await fetchJsonAsset',begin);
  assert.ok(begin>0&&end>begin);
  const prefix=loader.slice(begin,end);
  for(const virgl of [true,false,undefined,'true']) {
    const calls=[];
    const context=vm.createContext({validateGuestClock,validateInteractiveClock,validateICountDivider,
      guestClock:'icount',icountDivider:64,interactiveClock:'paced-on-keyboard',virgl,
      workerMode:true,freshDesktop:false,opts:{bootSnapshot:false},isChunked:true,persist:false,extraDiskUrl:null,
      async fetchJsonAsset(){calls.push('manifest');}});
    const run=()=>vm.runInContext(`(async()=>{${prefix}\nawait fetchJsonAsset();})()`,context);
    if(virgl===true){await run();assert.deepEqual(calls,['manifest']);}
    else {await assert.rejects(run,/requires accelerated graphics/);assert.deepEqual(calls,[]);}
  }
});

test('paced critic: pause bound uses literal phase-safe retirement budget and rejects one excess tick',()=>{
  const base=9007199254742226n;
  const clock=value=>({mode:'paced-icount',mtime:String(value),timebaseHz:10000000,clockDiv:37});
  const probe={beforePause:clock(base),afterPause:clock(base),resumed:clock(base),
    progressed:clock(base+1245003n),pauseMillis:5000,resumeSent:2000,progressReceived:2123.5,
    retired:{beforePause:9007199254700000,afterPause:9007199254700000,
      resumed:9007199254700001,progressed:9007199254700076}};
  const result=assertInteractivePauseProbe(probe);
  assert.equal(result.retirementTicks,'3');assert.equal(result.maximumTicks,'1245003');
  const over=structuredClone(probe);over.progressed.mtime=String(base+1245004n);
  assert.throws(()=>assertInteractivePauseProbe(over),/excludes the paused/);
  for(const change of [p=>p.retired.progressed=2**53,p=>p.retired.progressed=NaN,
    p=>p.retired.beforePause=-1,p=>p.retired.resumed=p.retired.afterPause-1,
    p=>p.retired.afterPause++,p=>p.afterPause.clockDiv=36,p=>p.progressed.mode='wall',
    p=>p.progressed.mtime=Number(base+1n),p=>p.progressReceived=2000,p=>p.progressReceived=7000,
    p=>p.resumed.mtime=String(base-1n)]) {
    const bad=structuredClone(probe);change(bad);assert.throws(()=>assertInteractivePauseProbe(bad));
  }
});
