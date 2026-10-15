// Actual unmodified shipping Wasm under Node, actual loader numeric callbacks.
// No guest execution/clock source is simulated. Real browser paced selection is
// separately recorded; this suite proves exact ABI refusal and native staging.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const repo=resolve(process.env.CRITIC_D72_REPO_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'../..'));
const wasmBytes=readFileSync(resolve(repo,'web/dist/pkg/wasm_vm_wasm_bg.wasm'));
console.info('KEYBOARD_ABI_WASM_SHA256='+createHash('sha256').update(wasmBytes).digest('hex'));
const {initSync,WasmLinux}=await import(pathToFileURL(resolve(repo,'web/dist/pkg/wasm_vm_wasm.js')));
initSync({module:wasmBytes});
const {createGuestClockLifecycle}=await import(pathToFileURL(resolve(repo,'web/guest-clock.js')));
const loader=readFileSync(resolve(repo,'web/loader.js'),'utf8');
const kernel=new Uint8Array([0x73,0x00,0x50,0x10,0x6f,0x00,0x00,0x00]);
function callback(name,parameters='') {
  const escaped=parameters.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const body=loader.match(new RegExp(`      ${name}: \\(${escaped}\\) => \\{([\\s\\S]*?)\\n      \\},`))?.[1];
  assert.ok(body,`execute actual ${name} callback`);
  return `(${parameters})=>{${body}\n}`;
}
function originalMachine(policy) {
  const machine=new WasmLinux(8,kernel,new Uint8Array(),'',()=>{},false);
  const lifecycle=createGuestClockLifecycle(machine,'icount',64,policy);
  const context=vm.createContext({machine,guestClockLifecycle:lifecycle,stopped:false,
    finish(){context.stopped=true;},onState(){},onError(){}});
  const send=vm.runInContext(callback('sendKeyboardEvent','eventType, code, value'),context);
  const sync=vm.runInContext(callback('syncKeyboard'),context);
  return {machine,lifecycle,send,sync,context};
}
const malformed=[
  ['type-fraction',[1.5,30,1]],['type-wrap-high',[65537,30,1]],['type-wrap-low',[-65535,30,1]],
  ['type-string',['1',30,1]],['type-nan',[NaN,30,1]],['type-infinity',[Infinity,30,1]],
  ['type-boolean',[true,30,1]],['type-boxed',[new Number(1),30,1]],
  ['code-fraction',[1,30.5,1]],['code-wrap-high',[1,65566,1]],['code-wrap-low',[1,-65506,1]],
  ['code-string',[1,'30',1]],['code-nan',[1,NaN,1]],['code-infinity',[1,Infinity,1]],
  ['code-boolean',[1,true,1]],['code-bigint',[1,30n,1]],
  ['value-fraction',[1,30,1.5]],['value-wrap-high',[1,30,4294967297]],['value-wrap-low',[1,30,-4294967295]],
  ['value-string',[1,30,'1']],['value-nan',[1,30,NaN]],['value-infinity',[1,30,Infinity]],
  ['value-boolean',[1,30,true]],['value-bigint',[1,30,1n]],
  ['value-over-signed32',[1,30,2147483648]],['value-under-signed32',[1,30,-2147483649]],
];
for(const policy of ['paced-on-keyboard','wall-on-keyboard',undefined]) {
  test(`native ABI critic: ${policy??'omitted'} refuses all malformed words before native/SYN staging`,()=>{
    const r=originalMachine(policy);
    try {
      const before=r.machine.inputDeviceStats(),clock=r.machine.guestClockState();
      assert.equal(before.pendingEvents,0);assert.equal(before.pendingFrames,0);
      for(const [name,frame] of malformed) {
        assert.equal(r.send(...frame),false,name);
        assert.equal(r.sync(),true,`${name}: original sync remains callable`);
        assert.deepEqual(r.machine.inputDeviceStats(),before,`${name}: no native event, rejected event or stray SYN`);
        assert.deepEqual(r.machine.guestClockState(),clock,`${name}: no clock mutation`);
        assert.equal(r.context.stopped,false,`${name}: malformed shape does not stop the controller`);
        assert.doesNotThrow(()=>r.lifecycle.resume(),`${name}: policy is not poisoned`);
      }
      // Signed MSC_SCAN is an advertised, valid original non-make frame. It must
      // reach the actual native queue, without attempting a Node clock source.
      assert.equal(r.send(4,4,-1),true);assert.equal(r.sync(),true);
      const after=r.machine.inputDeviceStats();
      assert.equal(after.pendingEvents,2);assert.equal(after.pendingFrames,1);
      assert.equal(after.rejectedEvents,0);assert.deepEqual(r.machine.guestClockState(),clock);
    } finally {r.machine.free();}
  });
}

test('native ABI critic: valid omitted-policy KEY make/break and PC105 bounds stage real native events',()=>{
  const r=originalMachine(undefined);
  try {
    const before=r.machine.guestClockState();let frames=0;
    for(const frame of [[1,30,1],[1,30,0],[1,1,1],[1,1,0],[1,248,1],[1,248,0]]) {
      assert.equal(r.send(...frame),true);assert.equal(r.sync(),true);frames++;
      const state=r.machine.inputDeviceStats();
      assert.equal(state.pendingEvents,2*frames);assert.equal(state.pendingFrames,frames);
      assert.equal(state.rejectedEvents,0);assert.deepEqual(r.machine.guestClockState(),before);
    }
    // Repeat stays an unchanged native capability rejection, rather than being
    // transformed into a make or latching the clock policy.
    assert.equal(r.send(1,30,2),true);assert.equal(r.sync(),true);
    const state=r.machine.inputDeviceStats();assert.equal(state.pendingEvents,12);
    assert.equal(state.pendingFrames,6);assert.equal(state.rejectedEvents,1);
  } finally {r.machine.free();}
});

test('native ABI critic: advertised signed32 MSC_SCAN range is preserved in actual Wasm staging',()=>{
  for(const value of [-2147483648,-1,0,2147483647]) {
    const r=originalMachine(undefined);
    try {
      assert.equal(r.send(4,4,value),true);assert.equal(r.sync(),true);
      const state=r.machine.inputDeviceStats();assert.equal(state.pendingEvents,2);
      assert.equal(state.pendingFrames,1);assert.equal(state.rejectedEvents,0);
      assert.deepEqual(r.machine.guestClockState(),{mode:'icount',mtime:'0',timebaseHz:10000000,clockDiv:64});
    } finally {r.machine.free();}
  }
});
